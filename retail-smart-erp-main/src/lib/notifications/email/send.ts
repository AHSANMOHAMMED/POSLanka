import { db } from '@/lib/db'
import { eq, and, gte, sql } from 'drizzle-orm'
import { notificationLogs, notificationUsage } from '@/lib/db/schema'
import type { SendEmailRequest, SendEmailResult } from '../types'
import { sendEmail } from './index'

// Platform rate limits
const DAILY_LIMIT = 500
const MONTHLY_LIMIT = 10000

/**
 * Send email with full logging and rate limiting.
 * Uses platform Resend account (no tenant email settings needed).
 */
export async function sendEmailWithLogging(request: SendEmailRequest): Promise<SendEmailResult & { logId?: string }> {
  const { to, subject, body, textBody, tenantId, userId, templateId, ...metadata } = request

  const recipients = Array.isArray(to) ? to : [to]

  // 1. Check rate limits
  const rateLimitResult = await checkRateLimits(tenantId, recipients.length)
  if (!rateLimitResult.allowed) {
    return {
      success: false,
      errorMessage: rateLimitResult.message,
    }
  }

  // 2. Create pending log entry
  const primaryRecipient = recipients[0]
  const [logEntry] = await db
    .insert(notificationLogs)
    .values({
      tenantId,
      channel: 'email',
      status: 'pending',
      recipientType: metadata.recipientType || 'manual',
      recipientId: metadata.recipientId,
      recipientName: metadata.recipientName,
      recipientContact: primaryRecipient,
      templateId,
      subject,
      content: body,
      entityType: metadata.entityType,
      entityId: metadata.entityId,
      entityReference: metadata.entityReference,
      provider: 'platform',
      sentBy: userId,
    })
    .returning()

  // 3. Send email via platform Resend
  const result = await sendEmail(tenantId, to, subject, body, textBody)

  // 4. Update log with result
  await db
    .update(notificationLogs)
    .set({
      status: result.success ? 'sent' : 'failed',
      providerMessageId: result.messageId,
      providerResponse: result.providerResponse,
      errorMessage: result.errorMessage,
      sentAt: result.success ? new Date() : null,
    })
    .where(eq(notificationLogs.id, logEntry.id))

  // 5. Update usage statistics
  for (let i = 0; i < recipients.length; i++) {
    await updateUsageStats(tenantId, 'email', result.success)
  }

  // 6. Log entries for additional recipients
  if (recipients.length > 1) {
    for (let i = 1; i < recipients.length; i++) {
      await db
        .insert(notificationLogs)
        .values({
          tenantId,
          channel: 'email',
          status: result.success ? 'sent' : 'failed',
          recipientType: metadata.recipientType || 'manual',
          recipientContact: recipients[i],
          templateId,
          subject,
          content: body,
          entityType: metadata.entityType,
          entityId: metadata.entityId,
          entityReference: metadata.entityReference,
          provider: 'platform',
          providerMessageId: result.messageId,
          providerResponse: result.providerResponse,
          errorMessage: result.errorMessage,
          sentBy: userId,
          sentAt: result.success ? new Date() : null,
        })
    }
  }

  return {
    ...result,
    logId: logEntry.id,
  }
}

/**
 * Check daily and monthly rate limits
 */
async function checkRateLimits(
  tenantId: string,
  recipientCount: number = 1
): Promise<{ allowed: boolean; message?: string }> {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const [dailyCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notificationLogs)
    .where(
      and(
        eq(notificationLogs.tenantId, tenantId),
        eq(notificationLogs.channel, 'email'),
        gte(notificationLogs.createdAt, startOfDay)
      )
    )

  if ((Number(dailyCount.count) + recipientCount) > DAILY_LIMIT) {
    return {
      allowed: false,
      message: `Daily email limit (${DAILY_LIMIT}) would be exceeded`,
    }
  }

  const [monthlyCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notificationLogs)
    .where(
      and(
        eq(notificationLogs.tenantId, tenantId),
        eq(notificationLogs.channel, 'email'),
        gte(notificationLogs.createdAt, startOfMonth)
      )
    )

  if ((Number(monthlyCount.count) + recipientCount) > MONTHLY_LIMIT) {
    return {
      allowed: false,
      message: `Monthly email limit (${MONTHLY_LIMIT}) would be exceeded`,
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
