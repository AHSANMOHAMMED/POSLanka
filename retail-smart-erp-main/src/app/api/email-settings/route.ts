import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { emailSettings } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody } from '@/lib/validation'
import { updateEmailSettingsSchema } from '@/lib/validation/schemas/settings'

const MASK = '••••••••'

// GET - Get email settings for current tenant
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const [settings] = await db
        .select()
        .from(emailSettings)
        .where(eq(emailSettings.tenantId, session.user.tenantId))

      if (!settings) {
        return NextResponse.json({
          provider: 'none',
          isEnabled: false,
          fromName: '',
          fromEmail: '',
          replyToEmail: '',
          smtpHost: '',
          smtpPort: 587,
          smtpSecure: true,
          smtpUser: '',
          smtpPassword: '',
          sendgridApiKey: '',
          resendApiKey: '',
          dailyLimit: 500,
          monthlyLimit: 10000,
        })
      }

      return NextResponse.json({
        provider: settings.provider,
        isEnabled: settings.isEnabled,
        fromName: settings.fromName || '',
        fromEmail: settings.fromEmail || '',
        replyToEmail: settings.replyToEmail || '',
        smtpHost: settings.smtpHost || '',
        smtpPort: settings.smtpPort || 587,
        smtpSecure: settings.smtpSecure ?? true,
        smtpUser: settings.smtpUser || '',
        smtpPassword: settings.smtpPassword ? MASK : '',
        sendgridApiKey: settings.sendgridApiKey ? MASK : '',
        resendApiKey: settings.resendApiKey ? MASK : '',
        dailyLimit: settings.dailyLimit || 500,
        monthlyLimit: settings.monthlyLimit || 10000,
      })
    })
  } catch (error) {
    logError('api/email-settings', error)
    return NextResponse.json({ error: 'Failed to fetch email settings' }, { status: 500 })
  }
}

// PUT - Update email settings for current tenant
export async function PUT(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const parsed = await validateBody(request, updateEmailSettingsSchema)
    if (!parsed.success) return parsed.response
    const {
      provider,
      isEnabled,
      fromName,
      fromEmail,
      replyToEmail,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpUser,
      smtpPassword,
      sendgridApiKey,
      resendApiKey,
      dailyLimit,
      monthlyLimit,
    } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Check if settings exist
      const [existing] = await db
        .select()
        .from(emailSettings)
        .where(eq(emailSettings.tenantId, session.user.tenantId))

      const updateData: Record<string, unknown> = {
        provider: provider || 'none',
        isEnabled: isEnabled ?? false,
        fromName: fromName || null,
        fromEmail: fromEmail || null,
        replyToEmail: replyToEmail || null,
        smtpHost: smtpHost || null,
        smtpPort: smtpPort || 587,
        smtpSecure: smtpSecure ?? true,
        smtpUser: smtpUser || null,
        dailyLimit: dailyLimit || 500,
        monthlyLimit: monthlyLimit || 10000,
        updatedAt: new Date(),
      }

      // Only overwrite sensitive fields if not masked placeholder
      if (smtpPassword && smtpPassword !== MASK) {
        updateData.smtpPassword = smtpPassword
      }
      if (sendgridApiKey && sendgridApiKey !== MASK) {
        updateData.sendgridApiKey = sendgridApiKey
      }
      if (resendApiKey && resendApiKey !== MASK) {
        updateData.resendApiKey = resendApiKey
      }

      let result
      if (existing) {
        [result] = await db
          .update(emailSettings)
          .set(updateData)
          .where(eq(emailSettings.tenantId, session.user.tenantId))
          .returning()
      } else {
        [result] = await db
          .insert(emailSettings)
          .values({
            tenantId: session.user.tenantId,
            ...updateData,
          })
          .returning()
      }

      logAndBroadcast(session.user.tenantId, 'email-settings', 'updated', result.id, { userId: session.user.id })
      return NextResponse.json({
        provider: result.provider,
        isEnabled: result.isEnabled,
        fromName: result.fromName || '',
        fromEmail: result.fromEmail || '',
        replyToEmail: result.replyToEmail || '',
        smtpHost: result.smtpHost || '',
        smtpPort: result.smtpPort || 587,
        smtpSecure: result.smtpSecure ?? true,
        smtpUser: result.smtpUser || '',
        smtpPassword: result.smtpPassword ? MASK : '',
        sendgridApiKey: result.sendgridApiKey ? MASK : '',
        resendApiKey: result.resendApiKey ? MASK : '',
        dailyLimit: result.dailyLimit || 500,
        monthlyLimit: result.monthlyLimit || 10000,
      })
    })
  } catch (error) {
    logError('api/email-settings', error)
    return NextResponse.json({ error: 'Failed to update email settings' }, { status: 500 })
  }
}
