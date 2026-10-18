import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { modesOfPayment, chartOfAccounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateModeOfPaymentSchema } from '@/lib/validation/schemas/accounting'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
  const result = await withAuthTenant(async (session, db) => {
    const [mode] = await db.select({
      id: modesOfPayment.id,
      tenantId: modesOfPayment.tenantId,
      name: modesOfPayment.name,
      type: modesOfPayment.type,
      methodKey: modesOfPayment.methodKey,
      defaultAccountId: modesOfPayment.defaultAccountId,
      isEnabled: modesOfPayment.isEnabled,
      sortOrder: modesOfPayment.sortOrder,
      createdAt: modesOfPayment.createdAt,
      updatedAt: modesOfPayment.updatedAt,
      accountName: chartOfAccounts.name,
      accountNumber: chartOfAccounts.accountNumber,
    })
      .from(modesOfPayment)
      .leftJoin(chartOfAccounts, eq(modesOfPayment.defaultAccountId, chartOfAccounts.id))
      .where(eq(modesOfPayment.id, id))

    if (!mode) {
      return NextResponse.json({ error: 'Mode of payment not found' }, { status: 404 })
    }
    return NextResponse.json(mode)
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

    const parsed = await validateBody(request, updateModeOfPaymentSchema)
    if (!parsed.success) return parsed.response
    const { name, type, methodKey, defaultAccountId, isEnabled, sortOrder } = parsed.data

    const updateData: Record<string, unknown> = { updatedAt: new Date() }
    if (name !== undefined) updateData.name = name
    if (type !== undefined) updateData.type = type
    if (methodKey !== undefined) updateData.methodKey = methodKey || null
    if (defaultAccountId !== undefined) updateData.defaultAccountId = defaultAccountId
    if (isEnabled !== undefined) updateData.isEnabled = isEnabled
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder

    const [updated] = await db.update(modesOfPayment).set(updateData).where(eq(modesOfPayment.id, id)).returning()
    if (!updated) {
      return NextResponse.json({ error: 'Mode of payment not found' }, { status: 404 })
    }

    logAndBroadcast(session.user.tenantId, 'mode-of-payment', 'updated', id)
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

    const [deleted] = await db.delete(modesOfPayment).where(eq(modesOfPayment.id, id)).returning()
    if (!deleted) {
      return NextResponse.json({ error: 'Mode of payment not found' }, { status: 404 })
    }

    logAndBroadcast(session.user.tenantId, 'mode-of-payment', 'deleted', id)
    return NextResponse.json({ success: true })
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
