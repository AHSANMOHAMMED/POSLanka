import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { smsSettings } from '@/lib/db/schema'
import { sendSms } from '@/lib/notifications/sms'
import type { SmsSettings } from '@/lib/notifications/types'
import { logError } from '@/lib/ai/error-logger'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation'
import { testSmsSchema } from '@/lib/validation/schemas/users'

// POST - Test SMS connection or send test message
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const parsed = await validateBody(request, testSmsSchema)
    if (!parsed.success) return parsed.response
    const { testPhone } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Get current settings
      const [settings] = await db
        .select()
        .from(smsSettings)
        .where(eq(smsSettings.tenantId, session.user.tenantId))

      if (!settings) {
        return NextResponse.json({
          success: false,
          errorMessage: 'SMS settings not configured. Please save settings first.'
        })
      }

      if (!settings.isEnabled) {
        return NextResponse.json({
          success: false,
          errorMessage: 'SMS is disabled. Please enable it in settings.'
        })
      }

      if (!settings.genericApiUrl) {
        return NextResponse.json({
          success: false,
          errorMessage: 'SMS Gateway URL is not configured.'
        })
      }

      // Send test SMS directly (without logging to avoid database issues)
      const testMessage = `Test message from ${session.user.tenantName || 'your business'}. SMS is working!`

      const result = await sendSms(settings as SmsSettings, testPhone, testMessage)

      if (result.providerResponse) {
        console.error('SMS provider response:', result.providerResponse)
      }

      return NextResponse.json({
        success: result.success,
        errorMessage: result.errorMessage,
        messageId: result.messageId,
      })
    })
  } catch (error) {
    logError('api/sms-settings/test', error)
    console.error('POST /api/sms-settings/test error:', error)
    return NextResponse.json({
      success: false,
      errorMessage: 'Failed to test SMS'
    })
  }
}
