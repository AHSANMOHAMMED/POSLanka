import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { adminAuthError, adminAudit, withRateLimit, STRICT_LIMIT, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { BroadcastError, audienceOptions, broadcastInputSchema, listBroadcasts, previewAudience, sendBroadcast } from '@/lib/admin/broadcast'

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(15),
  meta: z.enum(['1', 'true']).optional(),
})

/** GET /api/sys-control/send-email — emails sent from the console (newest first). */
export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession('read')
    if (!session) return adminAuthError()
    const parsed = validateSearchParams(request, listSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize, meta } = parsed.data
    const [history, options] = await Promise.all([
      listBroadcasts('email', page, pageSize),
      meta ? audienceOptions() : Promise.resolve(null),
    ])
    return NextResponse.json({
      ...history,
      ...(options ?? {}),
      ...(meta ? { emailConfigured: !!process.env.RESEND_API_KEY } : {}),
    })
  } catch (error) {
    logError('api/sys-control/send-email GET', error)
    return NextResponse.json({ error: 'Failed to load sent emails' }, { status: 500 })
  }
}

const emailInputSchema = z.object({
  subject: z.string(),
  body: z.string(),
}).passthrough()

/**
 * POST /api/sys-control/send-email — email vendors (owners or all staff of the matched vendors)
 * or a list of addresses through the system email transport. `dryRun: true` previews counts.
 * Accepts { subject, body, link?, audience, recipientScope?, dryRun? }. Audited.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await validateAdminSession('notifications')
    if (!session) return adminAuthError()
    const raw = await validateBody(request, emailInputSchema)
    if (!raw.success) return raw.response
    const { subject, body, ...rest } = raw.data
    const parsed = broadcastInputSchema.safeParse({ ...rest, title: subject, body, channels: ['email'] })
    if (!parsed.success) {
      return NextResponse.json({
        error: 'Validation failed',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.').replace(/^title$/, 'subject'), message: i.message })),
      }, { status: 400 })
    }
    const input = parsed.data
    if (input.dryRun) return NextResponse.json({ preview: await previewAudience(input) })

    const rateLimited = await withRateLimit('/api/sys-control/send-email', STRICT_LIMIT)
    if (rateLimited) return rateLimited

    const result = await sendBroadcast({
      ...input,
      kind: 'email',
      superAdminId: session.superAdminId,
      baseUrl: process.env.NEXTAUTH_URL || request.nextUrl.origin,
    })
    await adminAudit.create(session.superAdminId, 'broadcast', result.id, {
      op: 'send_email', subject: input.title, audience: input.audience, ...result,
    })
    return NextResponse.json({ result }, { status: 201 })
  } catch (error) {
    if (error instanceof BroadcastError) return NextResponse.json({ error: error.message }, { status: 400 })
    logError('api/sys-control/send-email', error)
    return NextResponse.json({ error: 'Failed to send the email' }, { status: 500 })
  }
}
