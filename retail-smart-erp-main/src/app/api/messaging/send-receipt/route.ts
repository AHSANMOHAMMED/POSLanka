import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation'
import { sendSaleReceipt } from '@/lib/messaging/actions'
import { httpStatusFor } from '@/lib/messaging/service'

const schema = z.object({
  saleId: z.string().uuid(),
  channel: z.enum(['sms', 'whatsapp']),
  /** the number the cashier typed; defaults to the sale's customer */
  phone: z.string().trim().max(30).optional(),
})

/**
 * POST /api/messaging/send-receipt — "Send via SMS / WhatsApp" after a sale: total + bill link,
 * through the business's messaging plan. Refusals (no plan, no credit …) come back with a `code`
 * so the POS can fall back to the free WhatsApp share link.
 */
export async function POST(request: Request) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const perm = requirePermission(session, 'createSales')
    if (perm) return perm
    const parsed = await validateBody(request, schema)
    if (!parsed.success) return parsed.response
    const result = await sendSaleReceipt({
      tenantId: session.user.tenantId,
      saleId: parsed.data.saleId,
      channel: parsed.data.channel,
      phone: parsed.data.phone,
      userId: session.user.id,
      baseUrl: new URL(request.url).origin,
    })
    if (result.notFound) return NextResponse.json({ ...result, error: 'Sale not found' }, { status: 404 })
    return NextResponse.json(result, { status: httpStatusFor(result) })
  } catch (error) {
    logError('api/messaging/send-receipt', error)
    return NextResponse.json({ error: 'Failed to send the receipt' }, { status: 500 })
  }
}
