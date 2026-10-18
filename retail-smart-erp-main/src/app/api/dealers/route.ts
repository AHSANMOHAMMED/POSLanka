import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { dealers, warehouses } from '@/lib/db/schema'
import { eq, and, or, ilike, desc, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { dealersListSchema, createDealerSchema } from '@/lib/validation/schemas/dealership'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = validateSearchParams(request, dealersListSchema)
    if (!parsed.success) return parsed.response
    const { search, status, type, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(or(
          ilike(dealers.name, `%${escaped}%`),
          ilike(dealers.code, `%${escaped}%`),
          ilike(dealers.territory, `%${escaped}%`),
          ilike(dealers.contactPerson, `%${escaped}%`)
        ))
      }
      if (status) conditions.push(eq(dealers.status, status))
      if (type) conditions.push(eq(dealers.type, type))
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(dealers)
        .where(whereClause)

      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db
        .select({
          dealer: dealers,
          warehouseName: warehouses.name,
        })
        .from(dealers)
        .leftJoin(warehouses, eq(dealers.warehouseId, warehouses.id))
        .where(whereClause)
        .orderBy(desc(dealers.createdAt))
        .limit(limit)
        .offset(offset ?? 0)

      const data = result.map(r => ({ ...r.dealer, warehouseName: r.warehouseName }))

      if (all) return NextResponse.json(data)
      return NextResponse.json({
        data,
        pagination: { page, pageSize, total: totalCount, totalPages: Math.ceil(totalCount / pageSize) }
      })
    })
  } catch (error) {
    logError('GET /api/dealers', error)
    return NextResponse.json({ error: 'Failed to fetch dealers' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError
    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError
    const parsed = await validateBody(request, createDealerSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Check for duplicate code
      const [existing] = await db.select().from(dealers)
        .where(eq(dealers.code, body.code))
      if (existing) {
        return NextResponse.json({ error: 'Dealer code already exists' }, { status: 400 })
      }

      const [dealer] = await db.insert(dealers).values({
        tenantId: session.user.tenantId,
        name: body.name,
        code: body.code,
        type: body.type,
        contactPerson: body.contactPerson || null,
        email: body.email || null,
        phone: body.phone || null,
        address: body.address || null,
        warehouseId: body.warehouseId || null,
        territory: body.territory || null,
        commissionRate: body.commissionRate != null ? String(body.commissionRate) : null,
        creditLimit: body.creditLimit != null ? String(body.creditLimit) : null,
        paymentTermDays: body.paymentTermDays,
        status: body.status,
        contractStartDate: body.contractStartDate || null,
        contractEndDate: body.contractEndDate || null,
        notes: body.notes || null,
      }).returning()

      logAndBroadcast(session.user.tenantId, 'dealer', 'created', dealer.id, {
        userId: session.user.id,
        description: `Created dealer ${body.name} (${body.code})`,
      })

      return NextResponse.json(dealer, { status: 201 })
    })
  } catch (error) {
    logError('POST /api/dealers', error)
    return NextResponse.json({ error: 'Failed to create dealer' }, { status: 500 })
  }
}
