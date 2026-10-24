/**
 * Messaging plans, top-ups, usage and delivery logs — shared by the super-admin routes
 * (/api/sys-control/vendors/[id]/messaging/**) and the vendor's read-only page (/api/messaging/**).
 * Server-only.
 */
import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { db, withTenant } from '@/lib/db'
import { messagingCreditLedger, messagingSubscriptions, notificationLogs, notificationUsage } from '@/lib/db/schema'
import { setTenantFeatureFlags } from '@/lib/features/check'
import { escapeLikePattern } from '@/lib/utils/sql'
import { normalizeMsisdn } from './phone'
import { currentPeriod, type MessageChannel, type MessagingSubscription } from './service'

const money = z.number().min(0).max(1000).multipleOf(0.01)
const count = z.number().int().min(0).max(10_000_000)

export const subscriptionSchema = z.object({
  smsEnabled: z.boolean(),
  whatsappEnabled: z.boolean(),
  useOwnSmsProvider: z.boolean(),
  senderMask: z.string().trim().max(11, 'A sender mask is at most 11 characters')
    .refine((v) => v === '' || /^[A-Za-z0-9 .&-]+$/.test(v), 'Letters, digits, spaces and . & - only').optional().default(''),
  billingMode: z.enum(['prepaid', 'monthly_quota']),
  smsMonthlyQuota: count,
  whatsappMonthlyQuota: count,
  smsPrice: money,
  whatsappPrice: money,
  expiresAt: z.string().trim().refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a date').optional().default(''),
  notes: z.string().trim().max(1000).optional().default(''),
  alertPhone: z.string().trim().max(30).refine((v) => v === '' || !!normalizeMsisdn(v), 'Enter a valid mobile number').optional().default(''),
  lowStockChannel: z.enum(['off', 'sms', 'whatsapp']).optional().default('off'),
})
export type SubscriptionInput = z.infer<typeof subscriptionSchema>

export const topUpSchema = z.object({
  channel: z.enum(['sms', 'whatsapp']),
  /** positive = add, negative = remove (correction) */
  credits: z.number().int().min(-10_000_000).max(10_000_000).refine((v) => v !== 0, 'Enter the number of messages'),
  amountPaid: z.number().min(0).max(100_000_000).optional(),
  note: z.string().trim().max(500).optional().default(''),
})

export const logFilterSchema = z.object({
  channel: z.enum(['sms', 'whatsapp']).optional(),
  status: z.enum(['pending', 'sent', 'delivered', 'failed']).optional(),
  purpose: z.string().trim().max(40).optional(),
  search: z.string().trim().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
})
export type LogFilter = z.infer<typeof logFilterSchema>

export function emptySubscription(tenantId: string): MessagingSubscription {
  const now = new Date()
  return {
    id: '', tenantId, smsEnabled: false, whatsappEnabled: false, useOwnSmsProvider: false, senderMask: null,
    billingMode: 'prepaid', smsMonthlyQuota: 0, whatsappMonthlyQuota: 0, smsCredits: 0, whatsappCredits: 0,
    periodMonth: null, smsUsedPeriod: 0, whatsappUsedPeriod: 0, smsPrice: '0', whatsappPrice: '0', expiresAt: null,
    alertPhone: null, lowStockChannel: 'off', notes: null, updatedBy: null, createdAt: now, updatedAt: now,
  }
}

/**
 * Create / update a vendor's plan (super admin). Turning a channel on also turns its feature switch
 * on, so the switch and the plan agree; turning a channel off leaves the switch (the free WhatsApp
 * share link and the vendor's own SMS gateway still work).
 */
export async function saveSubscription(tenantId: string, input: SubscriptionInput, adminId: string): Promise<MessagingSubscription> {
  const values = {
    smsEnabled: input.smsEnabled,
    whatsappEnabled: input.whatsappEnabled,
    useOwnSmsProvider: input.useOwnSmsProvider,
    senderMask: input.senderMask || null,
    billingMode: input.billingMode,
    smsMonthlyQuota: input.smsMonthlyQuota,
    whatsappMonthlyQuota: input.whatsappMonthlyQuota,
    smsPrice: input.smsPrice.toFixed(2),
    whatsappPrice: input.whatsappPrice.toFixed(2),
    expiresAt: input.expiresAt || null,
    notes: input.notes || null,
    alertPhone: input.alertPhone ? normalizeMsisdn(input.alertPhone) : null,
    lowStockChannel: input.lowStockChannel,
    updatedBy: adminId,
    updatedAt: new Date(),
  }
  const [row] = await db.insert(messagingSubscriptions).values({ tenantId, ...values })
    .onConflictDoUpdate({ target: messagingSubscriptions.tenantId, set: values })
    .returning()
  const on: Record<string, boolean> = {}
  if (input.smsEnabled) on.sms = true
  if (input.whatsappEnabled) on.whatsapp = true
  if (Object.keys(on).length) await setTenantFeatureFlags(tenantId, on)
  return row
}

export class TopUpError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

/** Add (or correct) prepaid credits atomically, with a ledger row. */
export async function topUpCredits(tenantId: string, input: z.infer<typeof topUpSchema>, adminId: string) {
  return db.transaction(async (tx) => {
    await tx.insert(messagingSubscriptions).values({ tenantId }).onConflictDoNothing({ target: messagingSubscriptions.tenantId })
    const col = input.channel === 'sms' ? sql.raw('sms_credits') : sql.raw('whatsapp_credits')
    const res = await tx.execute(sql`
      UPDATE messaging_subscriptions SET ${col} = ${col} + ${input.credits}, updated_by = ${adminId}, updated_at = now()
       WHERE tenant_id = ${tenantId} AND ${col} + ${input.credits} >= 0
      RETURNING ${col} AS balance`)
    const row = ((res as unknown as { rows?: Array<{ balance: number }> }).rows ?? [])[0]
    if (!row) throw new TopUpError('That would take the balance below zero')
    const [entry] = await tx.insert(messagingCreditLedger).values({
      tenantId,
      channel: input.channel,
      change: input.credits,
      balanceAfter: Number(row.balance),
      reason: input.credits > 0 ? 'topup' : 'adjustment',
      amountPaid: input.amountPaid !== undefined ? input.amountPaid.toFixed(2) : null,
      note: input.note || null,
      adminId,
    }).returning()
    return { balance: Number(row.balance), entry }
  })
}

export interface UsageSummary {
  period: string
  sms: { sent: number; failed: number; cost: number; units: number }
  whatsapp: { sent: number; failed: number; cost: number; units: number }
}

/** This month's usage for a vendor (sent / failed messages, billable units and value at the plan price). */
export async function usageThisMonth(tenantId: string): Promise<UsageSummary> {
  const period = currentPeriod()
  return withTenant(tenantId, async (tdb) => {
    const usage = await tdb.select().from(notificationUsage)
      .where(and(eq(notificationUsage.tenantId, tenantId), eq(notificationUsage.periodMonth, period)))
    const units = await tdb.select({ channel: notificationLogs.channel, units: sql<number>`COALESCE(SUM(${notificationLogs.segments}), 0)::int` })
      .from(notificationLogs)
      .where(and(
        eq(notificationLogs.tenantId, tenantId),
        eq(notificationLogs.status, 'sent'),
        eq(notificationLogs.billedVia, 'platform'),
        gte(notificationLogs.createdAt, sql`${period}::date`),
      ))
      .groupBy(notificationLogs.channel)
    const pick = (ch: MessageChannel) => {
      const u = usage.find((r) => r.channel === ch)
      return { sent: u?.sentCount ?? 0, failed: u?.failedCount ?? 0, cost: Number(u?.totalCost ?? 0), units: Number(units.find((r) => r.channel === ch)?.units ?? 0) }
    }
    return { period, sms: pick('sms'), whatsapp: pick('whatsapp') }
  })
}

export async function listLedger(tenantId: string, limit = 50) {
  return withTenant(tenantId, (tdb) => tdb.select().from(messagingCreditLedger)
    .where(eq(messagingCreditLedger.tenantId, tenantId))
    .orderBy(desc(messagingCreditLedger.createdAt))
    .limit(limit))
}

/** Delivery log (SMS + WhatsApp) with filters, newest first. */
export async function listMessageLogs(tenantId: string, f: LogFilter) {
  const conds: SQL[] = [eq(notificationLogs.tenantId, tenantId), sql`${notificationLogs.channel} IN ('sms', 'whatsapp')`]
  if (f.channel) conds.push(eq(notificationLogs.channel, f.channel))
  if (f.status) conds.push(eq(notificationLogs.status, f.status))
  if (f.purpose) conds.push(eq(notificationLogs.purpose, f.purpose))
  if (f.from) conds.push(gte(notificationLogs.createdAt, sql`${f.from}::date`))
  if (f.to) conds.push(lt(notificationLogs.createdAt, sql`(${f.to}::date + 1)`))
  if (f.search) {
    const like = `%${escapeLikePattern(f.search)}%`
    conds.push(or(ilike(notificationLogs.recipientContact, like), ilike(notificationLogs.recipientName, like), ilike(notificationLogs.entityReference, like))!)
  }
  const where = and(...conds)
  return withTenant(tenantId, async (tdb) => {
    const [{ total }] = await tdb.select({ total: sql<number>`count(*)::int` }).from(notificationLogs).where(where)
    const logs = await tdb.select({
      id: notificationLogs.id,
      channel: notificationLogs.channel,
      status: notificationLogs.status,
      purpose: notificationLogs.purpose,
      billedVia: notificationLogs.billedVia,
      recipientContact: notificationLogs.recipientContact,
      recipientName: notificationLogs.recipientName,
      content: notificationLogs.content,
      entityReference: notificationLogs.entityReference,
      provider: notificationLogs.provider,
      segments: notificationLogs.segments,
      cost: notificationLogs.cost,
      errorMessage: notificationLogs.errorMessage,
      createdAt: notificationLogs.createdAt,
      sentAt: notificationLogs.sentAt,
    }).from(notificationLogs).where(where)
      .orderBy(desc(notificationLogs.createdAt))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize)
    return { logs, total: Number(total), page: f.page, pageSize: f.pageSize }
  })
}

/** Plan as shown to the vendor / console: balances computed for the current month. */
export function describePlan(sub: MessagingSubscription) {
  const period = currentPeriod()
  const samePeriod = sub.periodMonth === period
  return {
    smsEnabled: sub.smsEnabled,
    whatsappEnabled: sub.whatsappEnabled,
    useOwnSmsProvider: sub.useOwnSmsProvider,
    senderMask: sub.senderMask,
    billingMode: sub.billingMode as 'prepaid' | 'monthly_quota',
    smsCredits: sub.smsCredits,
    whatsappCredits: sub.whatsappCredits,
    smsMonthlyQuota: sub.smsMonthlyQuota,
    whatsappMonthlyQuota: sub.whatsappMonthlyQuota,
    smsUsedThisMonth: samePeriod ? sub.smsUsedPeriod : 0,
    whatsappUsedThisMonth: samePeriod ? sub.whatsappUsedPeriod : 0,
    smsPrice: Number(sub.smsPrice),
    whatsappPrice: Number(sub.whatsappPrice),
    expiresAt: sub.expiresAt,
    alertPhone: sub.alertPhone,
    lowStockChannel: sub.lowStockChannel as 'off' | 'sms' | 'whatsapp',
    notes: sub.notes,
    updatedAt: sub.updatedAt,
  }
}
