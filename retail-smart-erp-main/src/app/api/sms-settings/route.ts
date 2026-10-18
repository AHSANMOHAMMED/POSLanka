import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { smsSettings } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody } from '@/lib/validation'
import { updateSmsSettingsSchema } from '@/lib/validation/schemas/users'

// GET - Get SMS settings for current tenant
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const [settings] = await db
        .select()
        .from(smsSettings)
        .where(eq(smsSettings.tenantId, session.user.tenantId))

      if (!settings) {
        // Return default settings if none exist
        return NextResponse.json({
          isEnabled: false,
          genericApiUrl: '',
          genericMethod: 'POST',
          genericMessageParam: 'text',
          genericRecipientParam: 'to',
          genericStaticParams: [],
          dailyLimit: 500,
          monthlyLimit: 10000,
        })
      }

      return NextResponse.json({
        isEnabled: settings.isEnabled,
        genericApiUrl: settings.genericApiUrl || '',
        genericMethod: settings.genericMethod || 'POST',
        genericMessageParam: settings.genericMessageParam || 'text',
        genericRecipientParam: settings.genericRecipientParam || 'to',
        genericStaticParams: settings.genericStaticParams || [],
        dailyLimit: settings.dailyLimit || 500,
        monthlyLimit: settings.monthlyLimit || 10000,
      })
    })
  } catch (error) {
    logError('api/sms-settings', error)
    return NextResponse.json({ error: 'Failed to fetch SMS settings' }, { status: 500 })
  }
}

// PUT - Update SMS settings for current tenant
export async function PUT(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const parsed = await validateBody(request, updateSmsSettingsSchema)
    if (!parsed.success) return parsed.response
    const {
      isEnabled,
      genericApiUrl,
      genericMethod,
      genericMessageParam,
      genericRecipientParam,
      genericStaticParams,
      dailyLimit,
      monthlyLimit,
    } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Check if settings exist
      const [existing] = await db
        .select()
        .from(smsSettings)
        .where(eq(smsSettings.tenantId, session.user.tenantId))

      const updateData = {
        provider: 'generic_http' as const,
        isEnabled: isEnabled ?? false,
        genericApiUrl: genericApiUrl || null,
        genericMethod: genericMethod || 'POST',
        genericMessageParam: genericMessageParam || 'text',
        genericRecipientParam: genericRecipientParam || 'to',
        genericStaticParams: genericStaticParams || [],
        dailyLimit: dailyLimit || 500,
        monthlyLimit: monthlyLimit || 10000,
        updatedAt: new Date(),
      }

      let result
      if (existing) {
        [result] = await db
          .update(smsSettings)
          .set(updateData)
          .where(eq(smsSettings.tenantId, session.user.tenantId))
          .returning()
      } else {
        [result] = await db
          .insert(smsSettings)
          .values({
            tenantId: session.user.tenantId,
            ...updateData,
          })
          .returning()
      }

      logAndBroadcast(session.user.tenantId, 'sms-settings', 'updated', result.id, { userId: session.user.id })
      return NextResponse.json({
        isEnabled: result.isEnabled,
        genericApiUrl: result.genericApiUrl || '',
        genericMethod: result.genericMethod || 'POST',
        genericMessageParam: result.genericMessageParam || 'text',
        genericRecipientParam: result.genericRecipientParam || 'to',
        genericStaticParams: result.genericStaticParams || [],
        dailyLimit: result.dailyLimit || 500,
        monthlyLimit: result.monthlyLimit || 10000,
      })
    })
  } catch (error) {
    logError('api/sms-settings', error)
    return NextResponse.json({ error: 'Failed to update SMS settings' }, { status: 500 })
  }
}
