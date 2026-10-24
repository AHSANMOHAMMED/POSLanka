import { NextResponse } from 'next/server'
import { z } from 'zod'
import { adminAuthError, adminAudit, validateAdminSession, withRateLimit, STRICT_LIMIT } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation'
import { loadPlatformConfig, platformSmsCreds, platformWhatsAppCreds } from '@/lib/messaging/platform-config'
import { sendSmsVia, sendWhatsAppVia } from '@/lib/messaging/providers'
import { normalizeMsisdn } from '@/lib/messaging/phone'

const testSchema = z.object({
  channel: z.enum(['sms', 'whatsapp']),
  to: z.string().trim().min(7).max(30),
  text: z.string().trim().max(300).optional(),
  /** WhatsApp: send the approved "hello_world" template (works outside the 24-hour window) */
  useHelloWorld: z.boolean().optional(),
})

/**
 * POST /api/sys-control/messaging/test — send one test message through the saved platform account.
 * Nothing is charged to any vendor. Returns the provider's result code and error text.
 */
export async function POST(request: Request) {
  try {
    const limited = await withRateLimit('/api/sys-control/messaging/test', STRICT_LIMIT)
    if (limited) return limited
    const session = await validateAdminSession('settings')
    if (!session) return adminAuthError()

    const parsed = await validateBody(request, testSchema)
    if (!parsed.success) return parsed.response
    const { channel, useHelloWorld } = parsed.data
    const to = normalizeMsisdn(parsed.data.to)
    if (!to) return NextResponse.json({ ok: false, code: 'INVALID_NUMBER', error: 'Enter a valid mobile number' }, { status: 400 })
    const text = parsed.data.text || `${process.env.NEXT_PUBLIC_APP_NAME || 'skyERPOS'} test message. If you received this, ${channel === 'sms' ? 'SMS' : 'WhatsApp'} is working.`

    const cfg = await loadPlatformConfig()
    let result
    if (channel === 'sms') {
      const creds = platformSmsCreds(cfg)
      if (!creds) return NextResponse.json({ ok: false, code: 'PROVIDER_NOT_CONFIGURED', error: 'Choose an SMS provider and fill in its required fields first' }, { status: 400 })
      result = await sendSmsVia(creds, to, text)
    } else {
      const creds = platformWhatsAppCreds(cfg)
      if (!creds) return NextResponse.json({ ok: false, code: 'PROVIDER_NOT_CONFIGURED', error: 'Turn WhatsApp on and enter the phone number ID and access token first' }, { status: 400 })
      result = useHelloWorld
        ? await sendWhatsAppVia(creds, to, { template: { name: 'hello_world', language: 'en_US', params: [] } })
        : await sendWhatsAppVia(creds, to, { text })
    }
    await adminAudit.create(session.superAdminId, 'messaging_test', session.superAdminId, { channel, to: `${to.slice(0, 4)}…${to.slice(-3)}`, ok: result.ok, code: result.code })
    return NextResponse.json({ ok: result.ok, code: result.code, error: result.error, messageId: result.messageId, httpStatus: result.httpStatus, providerCode: result.providerCode })
  } catch (error) {
    logError('api/sys-control/messaging/test', error)
    return NextResponse.json({ error: 'Test send failed' }, { status: 500 })
  }
}
