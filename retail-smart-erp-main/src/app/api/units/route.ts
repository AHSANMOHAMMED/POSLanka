import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { units } from '@/lib/db/schema'
import { asc, sql } from 'drizzle-orm'
import { validateBody } from '@/lib/validation/helpers'
import { createUnitSchema } from '@/lib/validation/schemas/pricing'
import { ensureDefaultUnits } from '@/lib/pricing/catalog'
import { isUniqueViolation } from '@/lib/db/errors'
import { logError } from '@/lib/ai/error-logger'
import { notInRecycleBin } from '@/lib/recycle-bin'

// GET /api/units — units of measure (seeds pcs/kg/g/l/ml/box/pack/dozen for a new company)
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const tenantId = session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      await ensureDefaultUnits(db, tenantId)
      const rows = await db.select({
        id: units.id, code: units.code, name: units.name, allowFraction: units.allowFraction, isActive: units.isActive,
        inUse: sql<number>`(SELECT count(*)::int FROM item_uoms iu WHERE iu.tenant_id = ${tenantId}::uuid AND lower(iu.uom) = lower("units"."code"))`,
      }).from(units).where(notInRecycleBin('unit', units.id)).orderBy(asc(units.code))
      return NextResponse.json(rows)
    })
  } catch (error) {
    logError('api/units', error)
    return NextResponse.json({ error: 'Failed to fetch units' }, { status: 500 })
  }
}

// POST /api/units { code, name, allowFraction? }
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const parsed = await validateBody(request, createUnitSchema)
    if (!parsed.success) return parsed.response
    const tenantId = session!.user.tenantId
    const [row] = await withTenantTransaction(tenantId, async (tx) => {
      await ensureDefaultUnits(tx, tenantId)
      return tx.insert(units).values({
        tenantId, code: parsed.data.code, name: parsed.data.name, allowFraction: parsed.data.allowFraction ?? false,
      }).returning()
    })
    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: 'A unit with this code already exists', code: 'DUPLICATE', field: 'code' }, { status: 409 })
    logError('api/units', error)
    return NextResponse.json({ error: 'Failed to create unit' }, { status: 500 })
  }
}
