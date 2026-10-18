import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant, withAuthTenantTransaction, TenantDb } from '@/lib/db'
import { supplierQuotations, supplierQuotationItems, suppliers, users } from '@/lib/db/schema'
import { eq, and, ilike, sql, desc, asc, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { recalculateDocumentTax } from '@/lib/utils/tax-recalculate'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { supplierQuotationsListSchema, createSupplierQuotationSchema } from '@/lib/validation/schemas/purchases'

async function generateQuotationNo(tx: TenantDb): Promise<string> {
  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `SQ-${dateStr}-`

  const existing = await tx
    .select({ quotationNo: supplierQuotations.quotationNo })
    .from(supplierQuotations)
    .where(ilike(supplierQuotations.quotationNo, `${prefix}%`))
    .orderBy(desc(supplierQuotations.quotationNo))
    .limit(1)
    .for('update')

  let nextNum = 1
  if (existing.length > 0) {
    const lastNum = parseInt(existing[0].quotationNo.split('-').pop() || '0', 10)
    nextNum = lastNum + 1
  }

  return `${prefix}${nextNum.toString().padStart(3, '0')}`
}

export async function GET(request: NextRequest) {
  try {
    const parsed = validateSearchParams(request, supplierQuotationsListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, search, all, status, supplierId, sortBy, sortOrder: sortOrderParam } = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      const conditions: ReturnType<typeof eq>[] = []

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(supplierQuotations.quotationNo, `%${escaped}%`),
            ilike(suppliers.name, `%${escaped}%`),
            ilike(supplierQuotations.supplierReference, `%${escaped}%`)
          )!
        )
      }

      if (status) {
        conditions.push(eq(supplierQuotations.status, status))
      }

      if (supplierId) {
        conditions.push(eq(supplierQuotations.supplierId, supplierId))
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const sortFn = sortOrderParam === 'asc' ? asc : desc
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sortFieldMap: Record<string, any> = {
        createdAt: supplierQuotations.createdAt,
        quotationNo: supplierQuotations.quotationNo,
        status: supplierQuotations.status,
        total: supplierQuotations.total,
        supplierName: suppliers.name,
      }
      const orderByField = sortFieldMap[sortBy] || supplierQuotations.createdAt
      const orderByClause = sortFn(orderByField)

      if (all) {
        const data = await db
          .select({
            id: supplierQuotations.id,
            quotationNo: supplierQuotations.quotationNo,
            supplierName: suppliers.name,
            status: supplierQuotations.status,
            total: supplierQuotations.total,
          })
          .from(supplierQuotations)
          .leftJoin(suppliers, eq(supplierQuotations.supplierId, suppliers.id))
          .where(whereClause)
          .orderBy(orderByClause)

        return data
      }

      const offset = (page - 1) * pageSize

      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(supplierQuotations)
        .leftJoin(suppliers, eq(supplierQuotations.supplierId, suppliers.id))
        .where(whereClause)

      const total = Number(countResult.count)
      const totalPages = Math.ceil(total / pageSize)

      const data = await db
        .select({
          id: supplierQuotations.id,
          quotationNo: supplierQuotations.quotationNo,
          supplierId: supplierQuotations.supplierId,
          supplierName: suppliers.name,
          requisitionId: supplierQuotations.requisitionId,
          status: supplierQuotations.status,
          validUntil: supplierQuotations.validUntil,
          deliveryDays: supplierQuotations.deliveryDays,
          subtotal: supplierQuotations.subtotal,
          taxAmount: supplierQuotations.taxAmount,
          total: supplierQuotations.total,
          supplierReference: supplierQuotations.supplierReference,
          createdByName: users.fullName,
          createdAt: supplierQuotations.createdAt,
        })
        .from(supplierQuotations)
        .leftJoin(suppliers, eq(supplierQuotations.supplierId, suppliers.id))
        .leftJoin(users, eq(supplierQuotations.createdBy, users.id))
        .where(whereClause)
        .orderBy(orderByClause)
        .limit(pageSize)
        .offset(offset)

      return { data, pagination: { page, pageSize, total, totalPages } }
    })

    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching supplier quotations:', error)
    return NextResponse.json({ error: 'Failed to fetch supplier quotations' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = await validateBody(request, createSupplierQuotationSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'managePurchases')
      if (permError) return { error: permError }

      const quotaError = await requireQuota(session.user.tenantId, 'standard')
      if (quotaError) return { error: quotaError }

      const quotationNo = await generateQuotationNo(tx)

      let subtotal = 0
      let taxAmount = 0
      if (body.items?.length) {
        for (const item of body.items) {
          const itemTotal = (item.quantity || 0) * (item.unitPrice || 0)
          subtotal += itemTotal
          taxAmount += item.tax || 0
        }
      }

      const [quotation] = await tx.insert(supplierQuotations).values({
        tenantId: session.user.tenantId,
        quotationNo,
        supplierId: body.supplierId,
        requisitionId: body.requisitionId || null,
        validUntil: body.validUntil || null,
        deliveryDays: body.deliveryDays || null,
        paymentTerms: body.paymentTerms || null,
        supplierReference: body.supplierReference || null,
        notes: body.notes || null,
        subtotal: subtotal.toFixed(2),
        taxAmount: taxAmount.toFixed(2),
        total: (subtotal + taxAmount).toFixed(2),
        createdBy: session.user.id,
      }).returning()

      if (body.items?.length) {
        await tx.insert(supplierQuotationItems).values(
          body.items.map(item => {
            const itemTotal = (item.quantity || 0) * (item.unitPrice || 0)
            return {
              tenantId: session.user.tenantId,
              quotationId: quotation.id,
              itemId: item.itemId || null,
              itemName: item.itemName,
              quantity: item.quantity.toString(),
              unitPrice: (item.unitPrice || 0).toFixed(2),
              tax: (item.tax || 0).toFixed(2),
              total: (itemTotal + (item.tax || 0)).toFixed(2),
              deliveryDays: item.deliveryDays || null,
              notes: item.notes || null,
            }
          })
        )

        // Dual mode: try template-based tax recalculation
        const lineItems = body.items.map(item => ({
          itemId: item.itemId || null,
          lineTotal: (item.quantity || 0) * (item.unitPrice || 0),
        }))
        const taxResult = await recalculateDocumentTax(tx, session.user.tenantId, lineItems, { type: 'purchase' })

        if (taxResult.taxBreakdown && taxResult.taxBreakdown.length > 0) {
          // Template configured — override with computed values
          await tx.update(supplierQuotations)
            .set({
              subtotal: taxResult.subtotal.toString(),
              taxAmount: taxResult.totalTax.toString(),
              taxBreakdown: taxResult.taxBreakdown,
              total: taxResult.total.toString(),
              updatedAt: new Date(),
            })
            .where(eq(supplierQuotations.id, quotation.id))
        }
      }

      logAndBroadcast(session.user.tenantId, 'supplier-quotation', 'created', quotation.id)
      return { data: quotation }
    })

    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data, { status: 201 })
  } catch (error) {
    console.error('Error creating supplier quotation:', error)
    return NextResponse.json({ error: 'Failed to create supplier quotation' }, { status: 500 })
  }
}
