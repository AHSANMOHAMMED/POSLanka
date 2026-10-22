import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenantTransaction } from '@/lib/db'
import { units } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateUnitSchema } from '@/lib/validation/schemas/pricing'
import { logError } from '@/lib/ai/error-logger'

// PUT /api/units/[id] { name?, allowFraction?, isActive? } — the code is fixed (items / sale lines store it)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, updateUnitSchema)
    if (!parsed.success) return parsed.response
    const [row] = await withTenantTransaction(session!.user.tenantId, (tx) =>
      tx.update(units).set(parsed.data).where(eq(units.id, p.data.id)).returning())
    if (!row) return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
    return NextResponse.json(row)
  } catch (error) {
    logError('api/units/[id]', error)
    return NextResponse.json({ error: 'Failed to update unit' }, { status: 500 })
  }
}

// DELETE /api/units/[id] — only while no item uses the unit (base unit or conversion)
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const tenantId = session!.user.tenantId
    const res = await withTenantTransaction(tenantId, async (tx) => {
      const [unit] = await tx.select().from(units).where(eq(units.id, p.data.id))
      if (!unit) return { status: 404 as const }
      const [{ used }] = (await tx.execute(sql`
        SELECT ((SELECT count(*) FROM item_uoms WHERE tenant_id = ${tenantId}::uuid AND lower(uom) = lower(${unit.code}))
              + (SELECT count(*) FROM items WHERE tenant_id = ${tenantId}::uuid AND lower(unit) = lower(${unit.code})))::int AS used
      `)).rows as Array<{ used: number }>
      if (used > 0) return { status: 409 as const, used }
      await tx.delete(units).where(eq(units.id, unit.id))
      return { status: 200 as const }
    })
    if (res.status === 404) return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
    if (res.status === 409) {
      return NextResponse.json({ error: `Unit is used by ${res.used} item(s). Deactivate it instead.`, suggestion: 'deactivate' }, { status: 409 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/units/[id]', error)
    return NextResponse.json({ error: 'Failed to delete unit' }, { status: 500 })
  }
}
