import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { adminAuthError, adminAudit, withRateLimit, STRICT_LIMIT, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { BroadcastError, audienceOptions, broadcastInputSchema, listBroadcasts, previewAudience, sendBroadcast } from '@/lib/admin/broadcast'

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(15),
  /** Include plans and vendor counts for the audience picker (first load). */
  meta: z.enum(['1', 'true']).optional(),
})

/** GET /api/sys-control/notifications — notification broadcasts sent from the console (newest first). */
export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession('read')
    if (!session) return adminAuthError()
    const parsed = validateSearchParams(request, listSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, meta } = parsed.data
    const [history, options] = await Promise.all([
      listBroadcasts('notification', page, pageSize),
      meta ? audienceOptions() : Promise.resolve(null),
    ])
    return NextResponse.json({ ...history, ...(options ?? {}) })
  } catch (error) {
    logError('api/sys-control/notifications GET', error)
    return NextResponse.json({ error: 'Failed to load notifications' }, { status: 500 })
  }
}

/**
 * POST /api/sys-control/notifications — notify vendors (vendor app inbox, account portal and/or email).
 * `dryRun: true` returns the recipient counts without sending. Audited.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await validateAdminSession('notifications')
    if (!session) return adminAuthError()
    const parsed = await validateBody(request, broadcastInputSchema)
    if (!parsed.success) return parsed.response
    const input = parsed.data

    if (input.audience.mode === 'addresses') {
      return NextResponse.json({ error: 'Use Send email for plain email addresses' }, { status: 400 })
    }
    if (input.dryRun) return NextResponse.json({ preview: await previewAudience(input) })

    const rateLimited = await withRateLimit('/api/sys-control/notifications', STRICT_LIMIT)
    if (rateLimited) return rateLimited

    const result = await sendBroadcast({
      ...input,
      kind: 'notification',
      superAdminId: session.superAdminId,
      baseUrl: process.env.NEXTAUTH_URL || request.nextUrl.origin,
    })
    await adminAudit.create(session.superAdminId, 'broadcast', result.id, {
      op: 'send_notification', title: input.title, channels: input.channels, audience: input.audience, ...result,
    })
    return NextResponse.json({ result }, { status: 201 })
  } catch (error) {
    if (error instanceof BroadcastError) return NextResponse.json({ error: error.message }, { status: 400 })
    logError('api/sys-control/notifications POST', error)
    return NextResponse.json({ error: 'Failed to send the notification' }, { status: 500 })
  }
}
