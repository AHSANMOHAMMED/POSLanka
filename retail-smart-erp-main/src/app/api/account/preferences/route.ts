import { NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { updatePreferencesSchema } from '@/lib/validation/schemas/account'

// GET /api/account/preferences - Get user preferences
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, session.user.accountId),
    })

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    return NextResponse.json({
      language: account.language,
      timezone: account.timezone,
      dateFormat: account.dateFormat,
      currency: account.currency,
      theme: account.theme,
      notifications: {
        email: account.notifyEmail,
        billing: account.notifyBilling,
        security: account.notifySecurity,
        marketing: account.notifyMarketing,
      },
    })
  } catch (error) {
    logError('api/account/preferences', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/account/preferences - Update user preferences
export async function PUT(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, updatePreferencesSchema)
    if (!parsed.success) return parsed.response
    const { language, timezone, dateFormat, currency, theme, notifications } = parsed.data

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    }

    if (language !== undefined) updateData.language = language
    if (timezone !== undefined) updateData.timezone = timezone
    if (dateFormat !== undefined) updateData.dateFormat = dateFormat
    if (currency !== undefined) updateData.currency = currency
    if (theme !== undefined) updateData.theme = theme

    if (notifications) {
      if (notifications.email !== undefined) updateData.notifyEmail = notifications.email
      if (notifications.billing !== undefined) updateData.notifyBilling = notifications.billing
      if (notifications.security !== undefined) updateData.notifySecurity = notifications.security
      if (notifications.marketing !== undefined) updateData.notifyMarketing = notifications.marketing
    }

    const [updated] = await db.update(accounts)
      .set(updateData)
      .where(eq(accounts.id, session.user.accountId))
      .returning()

    if (!updated) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    return NextResponse.json({
      language: updated.language,
      timezone: updated.timezone,
      dateFormat: updated.dateFormat,
      currency: updated.currency,
      theme: updated.theme,
      notifications: {
        email: updated.notifyEmail,
        billing: updated.notifyBilling,
        security: updated.notifySecurity,
        marketing: updated.notifyMarketing,
      },
    })
  } catch (error) {
    logError('api/account/preferences', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
