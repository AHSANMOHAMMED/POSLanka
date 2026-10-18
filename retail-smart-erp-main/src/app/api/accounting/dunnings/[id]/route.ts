import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { dunnings, dunningTypes, customers, sales } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateDunningSchema } from '@/lib/validation/schemas/accounting'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
  const result = await withAuthTenant(async (session, db) => {
    const data = await db.select({
      id: dunnings.id,
      dunningNumber: dunnings.dunningNumber,
      dunningTypeId: dunnings.dunningTypeId,
      customerId: dunnings.customerId,
      saleId: dunnings.saleId,
      outstandingAmount: dunnings.outstandingAmount,
      dunningFee: dunnings.dunningFee,
      dunningInterest: dunnings.dunningInterest,
      grandTotal: dunnings.grandTotal,
      status: dunnings.status,
      sentAt: dunnings.sentAt,
      resolvedAt: dunnings.resolvedAt,
      createdAt: dunnings.createdAt,
      dunningTypeName: dunningTypes.name,
      customerName: customers.name,
      saleInvoiceNo: sales.invoiceNo,
      saleTotal: sales.total,
    })
      .from(dunnings)
      .leftJoin(dunningTypes, eq(dunnings.dunningTypeId, dunningTypes.id))
      .leftJoin(customers, eq(dunnings.customerId, customers.id))
      .leftJoin(sales, eq(dunnings.saleId, sales.id))
      .where(eq(dunnings.id, id))

    if (!data.length) return NextResponse.json({ error: 'Dunning not found' }, { status: 404 })
    return NextResponse.json(data[0])
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

    const parsed = await validateBody(request, updateDunningSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data
    const updateData: Record<string, unknown> = {}

    if (body.status !== undefined) {
      updateData.status = body.status
      if (body.status === 'resolved') updateData.resolvedAt = new Date()
      if (body.status === 'unresolved' && body.sentAt === undefined) updateData.sentAt = new Date()
    }
    if (body.sentAt !== undefined) updateData.sentAt = body.sentAt ? new Date(body.sentAt) : null

    const [updated] = await db.update(dunnings).set(updateData).where(eq(dunnings.id, id)).returning()
    if (!updated) return NextResponse.json({ error: 'Dunning not found' }, { status: 404 })

    logAndBroadcast(session.user.tenantId, 'dunning', 'updated', id)
    return NextResponse.json(updated)
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return result
}
