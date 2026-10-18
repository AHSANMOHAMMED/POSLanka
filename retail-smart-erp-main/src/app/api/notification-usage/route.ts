import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { eq, and, gte, sql } from 'drizzle-orm'
import { notificationLogs, smsSettings, emailSettings } from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'

// GET - Get usage statistics for current tenant
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const tenantId = session.user.tenantId
    const now = new Date()
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    return await withTenant(tenantId, async (db) => {
      // Get settings for limits
      const [smsSettingsData] = await db
        .select()
        .from(smsSettings)
        .where(eq(smsSettings.tenantId, tenantId))

      const [emailSettingsData] = await db
        .select()
        .from(emailSettings)
        .where(eq(emailSettings.tenantId, tenantId))

      // Count SMS today
      const [smsTodayCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(notificationLogs)
        .where(
          and(
            eq(notificationLogs.tenantId, tenantId),
            eq(notificationLogs.channel, 'sms'),
            gte(notificationLogs.createdAt, startOfDay)
          )
        )

      // Count SMS this month
      const [smsMonthCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(notificationLogs)
        .where(
          and(
            eq(notificationLogs.tenantId, tenantId),
            eq(notificationLogs.channel, 'sms'),
            gte(notificationLogs.createdAt, startOfMonth)
          )
        )

      // Count Email today
      const [emailTodayCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(notificationLogs)
        .where(
          and(
            eq(notificationLogs.tenantId, tenantId),
            eq(notificationLogs.channel, 'email'),
            gte(notificationLogs.createdAt, startOfDay)
          )
        )

      // Count Email this month
      const [emailMonthCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(notificationLogs)
        .where(
          and(
            eq(notificationLogs.tenantId, tenantId),
            eq(notificationLogs.channel, 'email'),
            gte(notificationLogs.createdAt, startOfMonth)
          )
        )

      return NextResponse.json({
        sms: {
          sentToday: Number(smsTodayCount?.count) || 0,
          sentThisMonth: Number(smsMonthCount?.count) || 0,
          dailyLimit: smsSettingsData?.dailyLimit || 500,
          monthlyLimit: smsSettingsData?.monthlyLimit || 10000,
        },
        email: {
          sentToday: Number(emailTodayCount?.count) || 0,
          sentThisMonth: Number(emailMonthCount?.count) || 0,
          dailyLimit: emailSettingsData?.dailyLimit || 500,
          monthlyLimit: emailSettingsData?.monthlyLimit || 10000,
        },
      })
    })
  } catch (error) {
    logError('api/notification-usage', error)
    return NextResponse.json({ error: 'Failed to fetch usage' }, { status: 500 })
  }
}
