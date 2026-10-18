import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { vehicleExpenses, vehicleInventory } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateVehicleExpenseSchema } from '@/lib/validation/schemas/vehicles'
import { idParamSchema } from '@/lib/validation/schemas/common'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recalcTotalExpenses(db: any, vehicleInventoryId: string) {
  const [result] = await db
    .select({ total: sql<string>`COALESCE(SUM(CASE WHEN ${vehicleExpenses.isCapitalized} = true THEN ${vehicleExpenses.amount} ELSE 0 END), 0)` })
    .from(vehicleExpenses)
    .where(eq(vehicleExpenses.vehicleInventoryId, vehicleInventoryId))
  await db.update(vehicleInventory)
    .set({ totalExpenses: result?.total || '0', updatedAt: new Date() })
    .where(eq(vehicleInventory.id, vehicleInventoryId))
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const [record] = await db.select().from(vehicleExpenses).where(eq(vehicleExpenses.id, id))
      if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(record)
    })
  } catch (error) {
    logError('GET /api/vehicle-expenses/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch expense' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateVehicleExpenseSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const [existing] = await db.select().from(vehicleExpenses).where(eq(vehicleExpenses.id, id))
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (body.category !== undefined) updateData.category = body.category
      if (body.description !== undefined) updateData.description = body.description || null
      if (body.amount !== undefined) updateData.amount = body.amount.toString()
      if (body.vendorName !== undefined) updateData.vendorName = body.vendorName || null
      if (body.supplierId !== undefined) updateData.supplierId = body.supplierId || null
      if (body.receiptNo !== undefined) updateData.receiptNo = body.receiptNo || null
      if (body.expenseDate !== undefined) updateData.expenseDate = body.expenseDate || null
      if (body.isCapitalized !== undefined) updateData.isCapitalized = body.isCapitalized
      if (body.notes !== undefined) updateData.notes = body.notes || null

      const [updated] = await db.update(vehicleExpenses).set(updateData).where(eq(vehicleExpenses.id, id)).returning()

      await recalcTotalExpenses(db, existing.vehicleInventoryId)

      logAndBroadcast(session.user.tenantId, 'vehicle-expense', 'updated', id, {
        userId: session.user.id,
        description: `Updated vehicle expense`,
      })

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('PUT /api/vehicle-expenses/[id]', error)
    return NextResponse.json({ error: 'Failed to update expense' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const [existing] = await db.select().from(vehicleExpenses).where(eq(vehicleExpenses.id, id))
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      await db.delete(vehicleExpenses).where(eq(vehicleExpenses.id, id))
      await recalcTotalExpenses(db, existing.vehicleInventoryId)

      logAndBroadcast(session.user.tenantId, 'vehicle-expense', 'deleted', id, {
        userId: session.user.id,
        description: `Deleted vehicle expense`,
      })

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('DELETE /api/vehicle-expenses/[id]', error)
    return NextResponse.json({ error: 'Failed to delete expense' }, { status: 500 })
  }
}
