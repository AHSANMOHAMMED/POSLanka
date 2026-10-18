import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { dunningTypes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateDunningTypeSchema } from '@/lib/validation/schemas/accounting'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
  const result = await withAuthTenant(async (session, db) => {
    const [dt] = await db.select().from(dunningTypes).where(eq(dunningTypes.id, id))
    if (!dt) return NextResponse.json({ error: 'Dunning type not found' }, { status: 404 })
    return NextResponse.json(dt)
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
  const result = await withAuthTenant(async (session, db) => {
    const denied = requirePermission(session, 'manageAccounting')
    if (denied) return denied

    const parsed = await validateBody(request, updateDunningTypeSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const updateData: Record<string, unknown> = { updatedAt: new Date() }

    if (body.name !== undefined) updateData.name = body.name
    if (body.startDay !== undefined) updateData.startDay = body.startDay
    if (body.endDay !== undefined) updateData.endDay = body.endDay
    if (body.dunningFee !== undefined) updateData.dunningFee = String(body.dunningFee)
    if (body.interestRate !== undefined) updateData.interestRate = String(body.interestRate)
    if (body.bodyText !== undefined) updateData.bodyText = body.bodyText || null
    if (body.isActive !== undefined) updateData.isActive = body.isActive

    const [updated] = await db.update(dunningTypes).set(updateData).where(eq(dunningTypes.id, id)).returning()
    if (!updated) return NextResponse.json({ error: 'Dunning type not found' }, { status: 404 })

    logAndBroadcast(session.user.tenantId, 'dunning-type', 'updated', id)
    return NextResponse.json(updated)
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
  const result = await withAuthTenant(async (session, db) => {
    const denied = requirePermission(session, 'manageAccounting')
    if (denied) return denied

    const [deleted] = await db.delete(dunningTypes).where(eq(dunningTypes.id, id)).returning()
    if (!deleted) return NextResponse.json({ error: 'Dunning type not found' }, { status: 404 })

    logAndBroadcast(session.user.tenantId, 'dunning-type', 'deleted', id)
    return NextResponse.json({ success: true })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
