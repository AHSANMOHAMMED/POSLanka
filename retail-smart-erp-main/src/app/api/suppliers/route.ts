import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { suppliers } from '@/lib/db/schema'
import { ilike, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { suppliersListSchema, createSupplierSchema } from '@/lib/validation/schemas/suppliers'

// GET all suppliers for the tenant (with pagination support)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, suppliersListSchema)
    if (!parsed.success) return parsed.response
    const { all, page, pageSize, search } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      const whereClause = search ? ilike(suppliers.name, `%${escapeLikePattern(search)}%`) : undefined

      // Return all suppliers (for dropdowns)
      if (all) {
        const result = await db.query.suppliers.findMany({
          where: whereClause,
          orderBy: (suppliers, { asc }) => [asc(suppliers.name)],
          limit: 1000,
        })
        return NextResponse.json(result)
      }

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(suppliers)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // Get paginated results
      const result = await db.query.suppliers.findMany({
        where: whereClause,
        orderBy: (suppliers, { asc }) => [asc(suppliers.name)],
        limit: pageSize,
        offset,
      })

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/suppliers', error)
    return NextResponse.json({ error: 'Failed to fetch suppliers' }, { status: 500 })
  }
}

// POST create new supplier
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'managePurchases')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createSupplierSchema)
    if (!parsed.success) return parsed.response
    const { name, email, phone, address, taxId, taxInclusive, paymentTermsTemplateId } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Check for duplicate supplier name within tenant (RLS scopes the query)
      const existingSupplier = await db.query.suppliers.findFirst({
        where: ilike(suppliers.name, name),
      })
      if (existingSupplier) {
        return NextResponse.json({ error: 'A supplier with this name already exists' }, { status: 400 })
      }

      const [newSupplier] = await db.insert(suppliers).values({
        tenantId: session.user.tenantId,
        name,
        email: email || null,
        phone: phone || null,
        address: address || null,
        taxId: taxId || null,
        taxInclusive,
        paymentTermsTemplateId: paymentTermsTemplateId || null,
      }).returning()

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'supplier', 'created', newSupplier.id)

      return NextResponse.json(newSupplier)
    })
  } catch (error) {
    logError('api/suppliers', error)
    return NextResponse.json({ error: 'Failed to create supplier' }, { status: 500 })
  }
}
