import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction, TenantDb } from '@/lib/db'
import { purchaseRequisitions, purchaseRequisitionItems, users } from '@/lib/db/schema'
import { eq, and, ilike, sql, desc, asc, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { purchaseRequisitionsListSchema, createPurchaseRequisitionSchema } from '@/lib/validation/schemas/purchases'

async function generateRequisitionNo(tx: TenantDb): Promise<string> {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `PR-${dateStr}-`

  const existing = await tx
    .select({ requisitionNo: purchaseRequisitions.requisitionNo })
    .from(purchaseRequisitions)
    .where(ilike(purchaseRequisitions.requisitionNo, `${prefix}%`))
    .orderBy(desc(purchaseRequisitions.requisitionNo))
    .limit(1)
    .for('update')

  let nextNum = 1
  if (existing.length > 0) {
    const lastNum = parseInt(existing[0].requisitionNo.split('-').pop() || '0', 10)
    nextNum = lastNum + 1
  }

  return `${prefix}${nextNum.toString().padStart(3, '0')}`
}

export async function GET(request: NextRequest) {
  try {
    const parsed = validateSearchParams(request, purchaseRequisitionsListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, search, all, status, sortBy, sortOrder: sortOrderParam } = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      const conditions: ReturnType<typeof eq>[] = []

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(purchaseRequisitions.requisitionNo, `%${escaped}%`),
            ilike(purchaseRequisitions.purpose, `%${escaped}%`),
            ilike(purchaseRequisitions.department, `%${escaped}%`)
          )!
        )
      }

      if (status) {
        conditions.push(eq(purchaseRequisitions.status, status))
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const sortFn = sortOrderParam === 'asc' ? asc : desc
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sortFieldMap: Record<string, any> = {
        createdAt: purchaseRequisitions.createdAt,
        requisitionNo: purchaseRequisitions.requisitionNo,
        status: purchaseRequisitions.status,
        estimatedTotal: purchaseRequisitions.estimatedTotal,
        requiredByDate: purchaseRequisitions.requiredByDate,
      }
      const orderByField = sortFieldMap[sortBy] || purchaseRequisitions.createdAt
      const orderByClause = sortFn(orderByField)

      if (all) {
        const data = await db
          .select({
            id: purchaseRequisitions.id,
            requisitionNo: purchaseRequisitions.requisitionNo,
            status: purchaseRequisitions.status,
            estimatedTotal: purchaseRequisitions.estimatedTotal,
          })
          .from(purchaseRequisitions)
          .where(whereClause)
          .orderBy(orderByClause)

        return data
      }

      const offset = (page - 1) * pageSize

      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(purchaseRequisitions)
        .leftJoin(users, eq(purchaseRequisitions.requestedBy, users.id))
        .where(whereClause)

      const total = Number(countResult.count)
      const totalPages = Math.ceil(total / pageSize)

      const data = await db
        .select({
          id: purchaseRequisitions.id,
          requisitionNo: purchaseRequisitions.requisitionNo,
          status: purchaseRequisitions.status,
          requestedBy: purchaseRequisitions.requestedBy,
          requestedByName: users.fullName,
          department: purchaseRequisitions.department,
          requiredByDate: purchaseRequisitions.requiredByDate,
          purpose: purchaseRequisitions.purpose,
          estimatedTotal: purchaseRequisitions.estimatedTotal,
          createdAt: purchaseRequisitions.createdAt,
          updatedAt: purchaseRequisitions.updatedAt,
        })
        .from(purchaseRequisitions)
        .leftJoin(users, eq(purchaseRequisitions.requestedBy, users.id))
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(pageSize)
        .offset(offset)

      return {
        data,
        pagination: { page, pageSize, total, totalPages },
      }
    })

    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching purchase requisitions:', error)
    return NextResponse.json({ error: 'Failed to fetch purchase requisitions' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await validateBody(request, createPurchaseRequisitionSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'createRequisitions')
      if (permError) return { error: permError }

      const quotaError = await requireQuota(session.user.tenantId, 'standard')
      if (quotaError) return { error: quotaError }

      const requisitionNo = await generateRequisitionNo(tx)

      let estimatedTotal = 0
      if (body.items?.length) {
        for (const item of body.items) {
          estimatedTotal += (item.quantity || 0) * (item.estimatedUnitPrice || 0)
        }
      }

      const [requisition] = await tx.insert(purchaseRequisitions).values({
        tenantId: session.user.tenantId,
        requisitionNo,
        requestedBy: session.user.id,
        department: body.department || null,
        costCenterId: body.costCenterId || null,
        requiredByDate: body.requiredByDate || null,
        purpose: body.purpose || null,
        notes: body.notes || null,
        estimatedTotal: estimatedTotal.toFixed(2),
      }).returning()

      if (body.items?.length) {
        await tx.insert(purchaseRequisitionItems).values(
          body.items.map(item => ({
            tenantId: session.user.tenantId,
            requisitionId: requisition.id,
            itemId: item.itemId || null,
            itemName: item.itemName,
            quantity: item.quantity.toString(),
            estimatedUnitPrice: (item.estimatedUnitPrice || 0).toFixed(2),
            estimatedTotal: ((item.quantity || 0) * (item.estimatedUnitPrice || 0)).toFixed(2),
            preferredSupplierId: item.preferredSupplierId || null,
            warehouseId: item.warehouseId || null,
            notes: item.notes || null,
          }))
        )
      }

      logAndBroadcast(session.user.tenantId, 'purchase-requisition', 'created', requisition.id)
      return { data: requisition }
    })

    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data, { status: 201 })
  } catch (error) {
    console.error('Error creating purchase requisition:', error)
    return NextResponse.json({ error: 'Failed to create purchase requisition' }, { status: 500 })
  }
}
