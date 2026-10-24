import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenantTransaction } from '@/lib/db'
import { units } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateUnitSchema } from '@/lib/validation/schemas/pricing'
import { logError } from '@/lib/ai/error-logger'
import { moveToRecycleBin } from '@/lib/recycle-bin'

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
    // Vendors never hard-delete: the unit is archived (items keep their unit code) and goes to the
    // recycle bin, where only a super admin can restore or purge it.
    const binned = await withTenantTransaction(tenantId, (tx) => moveToRecycleBin(tx, {
      tenantId, entityType: 'unit', entityId: p.data.id, userId: session!.user.id, userName: session!.user.name,
    }))
    if (!binned) return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
    return NextResponse.json({ success: true, archived: true, recycleBinId: binned.binId })
  } catch (error) {
    logError('api/units/[id]', error)
    return NextResponse.json({ error: 'Failed to delete unit' }, { status: 500 })
  }
}
