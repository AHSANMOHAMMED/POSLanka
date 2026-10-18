import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { dealers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateDealerSchema } from '@/lib/validation/schemas/dealership'

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
      const [record] = await db.select().from(dealers).where(eq(dealers.id, id))
      if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(record)
    })
  } catch (error) {
    logError('GET /api/dealers/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch dealer' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageDealers')
    if (permError) return permError
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateDealerSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      const fields = ['name', 'code', 'type', 'contactPerson', 'email', 'phone', 'address',
        'warehouseId', 'territory', 'status', 'contractStartDate', 'contractEndDate', 'notes'] as const
      for (const f of fields) { if ((body as Record<string, unknown>)[f] !== undefined) updateData[f] = (body as Record<string, unknown>)[f] || null }
      if (body.commissionRate !== undefined) updateData.commissionRate = body.commissionRate != null ? String(body.commissionRate) : null
      if (body.creditLimit !== undefined) updateData.creditLimit = body.creditLimit != null ? String(body.creditLimit) : null
      if (body.paymentTermDays !== undefined) updateData.paymentTermDays = body.paymentTermDays
      if (body.isActive !== undefined) updateData.isActive = body.isActive

      const [updated] = await db.update(dealers).set(updateData).where(eq(dealers.id, id)).returning()
      if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      logAndBroadcast(session.user.tenantId, 'dealer', 'updated', id, {
        userId: session.user.id,
        description: `Updated dealer ${updated.name}`,
      })

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('PUT /api/dealers/[id]', error)
    return NextResponse.json({ error: 'Failed to update dealer' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requirePermission(session, 'manageDealers')
    if (permError) return permError
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const [record] = await db.select().from(dealers).where(eq(dealers.id, id))
      if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

      // Soft delete - deactivate instead of hard delete
      const [updated] = await db.update(dealers)
        .set({ isActive: false, status: 'inactive', updatedAt: new Date() })
        .where(eq(dealers.id, id))
        .returning()

      logAndBroadcast(session.user.tenantId, 'dealer', 'deleted', id, {
        userId: session.user.id,
        description: `Deactivated dealer ${record.name}`,
      })

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('DELETE /api/dealers/[id]', error)
    return NextResponse.json({ error: 'Failed to delete dealer' }, { status: 500 })
  }
}
