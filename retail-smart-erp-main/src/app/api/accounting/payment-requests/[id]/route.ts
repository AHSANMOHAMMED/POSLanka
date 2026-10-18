import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { paymentRequests } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updatePaymentRequestSchema } from '@/lib/validation/schemas/accounting'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
  const result = await withAuthTenant(async (session, db) => {
    const [pr] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, id))
    if (!pr) return NextResponse.json({ error: 'Payment request not found' }, { status: 404 })
    return NextResponse.json(pr)
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

    const parsed = await validateBody(request, updatePaymentRequestSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const updateData: Record<string, unknown> = { updatedAt: new Date() }

    if (body.status !== undefined) updateData.status = body.status
    if (body.emailTo !== undefined) updateData.emailTo = body.emailTo || null
    if (body.subject !== undefined) updateData.subject = body.subject || null
    if (body.message !== undefined) updateData.message = body.message || null
    if (body.modeOfPaymentId !== undefined) updateData.modeOfPaymentId = body.modeOfPaymentId || null
    if (body.paymentEntryId !== undefined) updateData.paymentEntryId = body.paymentEntryId || null
    if (body.paidAt !== undefined) updateData.paidAt = body.paidAt ? new Date(body.paidAt) : null

    // Mark as paid
    if (body.status === 'paid' && !body.paidAt) {
      updateData.paidAt = new Date()
    }

    const [updated] = await db.update(paymentRequests).set(updateData).where(eq(paymentRequests.id, id)).returning()
    if (!updated) return NextResponse.json({ error: 'Payment request not found' }, { status: 404 })

    logAndBroadcast(session.user.tenantId, 'payment-request', 'updated', id)
    return NextResponse.json(updated)
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
