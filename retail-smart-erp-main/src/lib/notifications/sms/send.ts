import { db } from '@/lib/db'
import { eq, and, gte, sql } from 'drizzle-orm'
import { smsSettings, notificationLogs, notificationUsage } from '@/lib/db/schema'
import type { SendSmsRequest, SendSmsResult, SmsSettings } from '../types'
import { sendSms } from './index'

/**
 * Send SMS with full logging and rate limiting
 */
export async function sendSmsWithLogging(request: SendSmsRequest): Promise<SendSmsResult & { logId?: string }> {
  const { to, message, tenantId, userId, templateId, ...metadata } = request

  // 1. Get SMS settings
  const [settings] = await db
    .select()
    .from(smsSettings)
    .where(eq(smsSettings.tenantId, tenantId))

  if (!settings) {
    return {
      success: false,
      errorMessage: 'SMS settings not configured',
    }
  }

  if (!settings.isEnabled) {
    return {
      success: false,
      errorMessage: 'SMS is disabled',
    }
  }

  // 2. Check rate limits
  try {
    const rateLimitResult = await checkRateLimits(tenantId, settings)
    if (!rateLimitResult.allowed) {
      return {
        success: false,
        errorMessage: rateLimitResult.message,
      }
    }
  } catch (e) {
    console.error('Rate limit check failed, continuing:', e)
  }

  // 3. Create pending log entry
  let logId: string | undefined
  try {
    const [logEntry] = await db
      .insert(notificationLogs)
      .values({
        tenantId,
        channel: 'sms',
        status: 'pending',
        recipientType: metadata.recipientType || 'manual',
        recipientId: metadata.recipientId,
        recipientName: metadata.recipientName,
        recipientContact: to,
        templateId: templateId || null,
        content: message,
        entityType: metadata.entityType,
        entityId: metadata.entityId,
        entityReference: metadata.entityReference,
        provider: settings.provider,
        sentBy: userId,
      })
      .returning()
    logId = logEntry.id
  } catch (e) {
    console.error('Failed to create SMS log entry:', e)
  }

  // 4. Send SMS
  const result = await sendSms(settings as SmsSettings, to, message)

  // 5. Update log with result
  if (logId) {
    try {
      await db
        .update(notificationLogs)
        .set({
          status: result.success ? 'sent' : 'failed',
          providerMessageId: result.messageId,
          providerResponse: result.providerResponse,
          errorMessage: result.errorMessage,
          cost: result.cost?.toString(),
          segments: result.segments,
          sentAt: result.success ? new Date() : null,
        })
        .where(eq(notificationLogs.id, logId))
    } catch (e) {
      console.error('Failed to update SMS log:', e)
    }
  }

  // 6. Update usage statistics
  try {
    await updateUsageStats(tenantId, 'sms', result.success)
  } catch (e) {
    console.error('Failed to update SMS usage stats:', e)
  }

  return {
    ...result,
    logId,
  }
}

/**
 * Check daily and monthly rate limits
 */
async function checkRateLimits(
  tenantId: string,
  settings: typeof smsSettings.$inferSelect
): Promise<{ allowed: boolean; message?: string }> {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  // Count today's messages
  const [dailyCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notificationLogs)
    .where(
      and(
        eq(notificationLogs.tenantId, tenantId),
        eq(notificationLogs.channel, 'sms'),
        gte(notificationLogs.createdAt, startOfDay)
      )
    )

  if (settings.dailyLimit && dailyCount.count >= settings.dailyLimit) {
    return {
      allowed: false,
      message: `Daily SMS limit (${settings.dailyLimit}) reached`,
    }
  }

  // Count this month's messages
  const [monthlyCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notificationLogs)
    .where(
      and(
        eq(notificationLogs.tenantId, tenantId),
        eq(notificationLogs.channel, 'sms'),
        gte(notificationLogs.createdAt, startOfMonth)
      )
    )

  if (settings.monthlyLimit && monthlyCount.count >= settings.monthlyLimit) {
    return {
      allowed: false,
      message: `Monthly SMS limit (${settings.monthlyLimit}) reached`,
    }
  }

  return { allowed: true }
}

/**
 * Update monthly usage statistics
 */
async function updateUsageStats(tenantId: string, channel: 'sms' | 'email', success: boolean): Promise<void> {
  const now = new Date()
  const periodMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]

  // Upsert usage record
  await db
    .insert(notificationUsage)
    .values({
      tenantId,
      channel,
      periodMonth,
      sentCount: success ? 1 : 0,
      failedCount: success ? 0 : 1,
    })
    .onConflictDoUpdate({
      target: [notificationUsage.tenantId, notificationUsage.channel, notificationUsage.periodMonth],
      set: {
        sentCount: success
          ? sql`${notificationUsage.sentCount} + 1`
          : notificationUsage.sentCount,
        failedCount: success
          ? notificationUsage.failedCount
          : sql`${notificationUsage.failedCount} + 1`,
      },
    })
}

/**
 * Get current usage for a tenant
 */
export async function getSmsUsage(tenantId: string): Promise<{
  sentToday: number
  sentThisMonth: number
  dailyLimit: number
  monthlyLimit: number
}> {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  // Get settings
  const [settings] = await db
    .select()
    .from(smsSettings)
    .where(eq(smsSettings.tenantId, tenantId))

  // Count today's messages
  const [dailyCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notificationLogs)
    .where(
      and(
        eq(notificationLogs.tenantId, tenantId),
        eq(notificationLogs.channel, 'sms'),
        eq(notificationLogs.status, 'sent'),
        gte(notificationLogs.createdAt, startOfDay)
      )
    )

  // Count this month's messages
  const [monthlyCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notificationLogs)
    .where(
      and(
        eq(notificationLogs.tenantId, tenantId),
        eq(notificationLogs.channel, 'sms'),
        eq(notificationLogs.status, 'sent'),
        gte(notificationLogs.createdAt, startOfMonth)
      )
    )

  return {
    sentToday: Number(dailyCount.count) || 0,
    sentThisMonth: Number(monthlyCount.count) || 0,
    dailyLimit: settings?.dailyLimit || 500,
    monthlyLimit: settings?.monthlyLimit || 10000,
  }
}
