/**
 * sendMessage() — the one way the app sends an SMS or WhatsApp message to a customer or owner.
 *
 *   1. number normalised (07X… → 947X…), feature switch (`sms` / `whatsapp`) must be on;
 *   2. the vendor's messaging subscription: channel enabled, not expired;
 *   3. SMS with "use own provider": the vendor's sms_settings account, nothing is charged;
 *      otherwise the platform account (system_settings['messaging_providers']);
 *   4. platform sends reserve credits / quota atomically (one UPDATE … WHERE balance >= units),
 *      refused with NO_CREDIT / QUOTA_EXHAUSTED when used up, refunded when the provider fails;
 *   5. notification_logs row (billed_via, purpose) and notification_usage counters.
 * Never throws for business errors: the result carries a stable `code` and a readable `error`.
 * Server-only.
 */
import { and, eq, sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { messagingSubscriptions, notificationLogs, notificationTemplates, notificationUsage, smsSettings, tenants } from '@/lib/db/schema'
import { getTenantFeatureFlags } from '@/lib/features/check'
import { decryptSecret } from '@/lib/crypto/secret-box'
import { logError } from '@/lib/ai/error-logger'
import { normalizeMsisdn, smsSegments } from './phone'
import { sendSmsVia, sendWhatsAppVia, type MessagingCode, type ProviderResult, type SmsCreds } from './providers'
import { loadPlatformConfig, platformSmsCreds, platformWhatsAppCreds } from './platform-config'
import { DEFAULT_TEXTS, TEMPLATE_TRIGGER_PREFIX, WHATSAPP_TEMPLATE_PARAMS, renderMessage, type MessagePurpose } from './templates'

export type MessageChannel = 'sms' | 'whatsapp'
export type SendPurpose = MessagePurpose | 'test' | 'manual'

export interface SendMessageInput {
  tenantId: string
  channel: MessageChannel
  to: string
  purpose: SendPurpose
  /** Explicit text; otherwise the vendor's template (or the default) for `purpose` rendered with `vars` */
  text?: string
  vars?: Record<string, string | number | null | undefined>
  context?: {
    userId?: string | null
    recipientType?: 'customer' | 'supplier' | 'staff' | 'owner' | 'manual'
    recipientId?: string | null
    recipientName?: string | null
    entityType?: string | null
    entityId?: string | null
    entityReference?: string | null
  }
}

export interface SendMessageResult {
  ok: boolean
  code: MessagingCode
  error?: string
  logId?: string
  messageId?: string
  /** SMS parts / WhatsApp messages charged (0 when nothing was charged) */
  units: number
  billedVia?: 'platform' | 'own'
  /** credits or quota left after this send (platform billing only) */
  remaining?: number
}

export const CODE_MESSAGES: Partial<Record<MessagingCode, string>> = {
  INVALID_NUMBER: 'Enter a valid mobile number (e.g. 077 123 4567)',
  NOT_SUBSCRIBED: 'This business has no SMS / WhatsApp plan. Contact skyERPOS support to add one.',
  CHANNEL_DISABLED: 'This channel is not part of the business’s messaging plan.',
  FEATURE_DISABLED: 'This feature is turned off for the business.',
  SUBSCRIPTION_EXPIRED: 'The messaging plan has expired. Contact skyERPOS support to renew it.',
  NO_CREDIT: 'No message credits left. Contact skyERPOS support to top up.',
  QUOTA_EXHAUSTED: 'This month’s message quota is used up. Contact skyERPOS support to raise it.',
  PROVIDER_NOT_CONFIGURED: 'The messaging service is not set up yet. Contact skyERPOS support.',
  OWN_PROVIDER_NOT_CONFIGURED: 'Set up and enable your SMS gateway in Settings → SMS first.',
}

const fail = (code: MessagingCode, error?: string): SendMessageResult => ({ ok: false, code, error: error ?? CODE_MESSAGES[code] ?? code, units: 0 })

/** YYYY-MM-DD in Sri Lanka time */
export function colomboDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
export function currentPeriod(d = new Date()): string {
  return `${colomboDate(d).slice(0, 7)}-01`
}

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) || []
}

export type MessagingSubscription = typeof messagingSubscriptions.$inferSelect

export async function getSubscription(tenantId: string): Promise<MessagingSubscription | null> {
  return withTenant(tenantId, async (tdb) => {
    const [row] = await tdb.select().from(messagingSubscriptions).where(eq(messagingSubscriptions.tenantId, tenantId)).limit(1)
    return row ?? null
  })
}

/** Vendor's text for a purpose ('' when they never edited it). */
export async function getVendorTemplates(tenantId: string): Promise<Partial<Record<MessagePurpose, string>>> {
  return withTenant(tenantId, async (tdb) => {
    const list = await tdb.select({ triggerEvent: notificationTemplates.triggerEvent, smsContent: notificationTemplates.smsContent, isActive: notificationTemplates.isActive })
      .from(notificationTemplates)
      .where(and(eq(notificationTemplates.tenantId, tenantId), sql`${notificationTemplates.triggerEvent} LIKE ${TEMPLATE_TRIGGER_PREFIX + '%'}`))
    const out: Partial<Record<MessagePurpose, string>> = {}
    for (const t of list) {
      if (t.isActive && t.smsContent && t.triggerEvent) out[t.triggerEvent.slice(TEMPLATE_TRIGGER_PREFIX.length) as MessagePurpose] = t.smsContent
    }
    return out
  })
}

/** The vendor's own gateway from Settings → SMS (sms_settings), as adapter credentials. */
function ownSmsCreds(s: typeof smsSettings.$inferSelect | undefined): SmsCreds | null {
  if (!s || !s.isEnabled) return null
  switch (s.provider) {
    case 'websms_lk':
      return s.websmsApiKey && s.websmsApiToken && s.websmsSenderId
        ? { provider: 'websms_lk', creds: { apiKey: decryptSecret(s.websmsApiKey) ?? '', apiToken: decryptSecret(s.websmsApiToken) ?? '', senderId: s.websmsSenderId } }
        : null
    case 'twilio':
      return s.twilioAccountSid && s.twilioAuthToken && s.twilioPhoneNumber
        ? { provider: 'twilio', creds: { accountSid: s.twilioAccountSid, authToken: decryptSecret(s.twilioAuthToken) ?? '', fromNumber: s.twilioPhoneNumber } }
        : null
    case 'generic_http':
      return s.genericApiUrl
        ? {
            provider: 'generic_http',
            creds: {
              url: s.genericApiUrl,
              method: s.genericMethod === 'GET' ? 'GET' : 'POST',
              recipientParam: s.genericRecipientParam || 'to',
              messageParam: s.genericMessageParam || 'text',
              staticParams: (Array.isArray(s.genericStaticParams) ? s.genericStaticParams : []) as Array<{ key: string; value: string }>,
            },
          }
        : null
    default:
      return null
  }
}

/** Atomically take `units` from the plan. Returns what is left, or the refusal code. */
async function reserve(tenantId: string, channel: MessageChannel, mode: string, units: number): Promise<{ ok: true; remaining: number } | { ok: false; code: MessagingCode }> {
  const period = currentPeriod()
  return withTenant(tenantId, async (tdb) => {
    if (mode === 'monthly_quota') {
      const used = channel === 'sms' ? sql.raw('sms_used_period') : sql.raw('whatsapp_used_period')
      const other = channel === 'sms' ? sql.raw('whatsapp_used_period') : sql.raw('sms_used_period')
      const quota = channel === 'sms' ? sql.raw('sms_monthly_quota') : sql.raw('whatsapp_monthly_quota')
      const res = await tdb.execute(sql`
        UPDATE messaging_subscriptions
           SET ${used} = (CASE WHEN period_month = ${period}::date THEN ${used} ELSE 0 END) + ${units},
               ${other} = CASE WHEN period_month = ${period}::date THEN ${other} ELSE 0 END,
               period_month = ${period}::date,
               updated_at = now()
         WHERE tenant_id = ${tenantId}
           AND (CASE WHEN period_month = ${period}::date THEN ${used} ELSE 0 END) + ${units} <= ${quota}
        RETURNING ${quota} - ${used} AS remaining`)
      const row = rows<{ remaining: number }>(res)[0]
      return row ? { ok: true as const, remaining: Number(row.remaining) } : { ok: false as const, code: 'QUOTA_EXHAUSTED' as const }
    }
    const credits = channel === 'sms' ? sql.raw('sms_credits') : sql.raw('whatsapp_credits')
    const res = await tdb.execute(sql`
      UPDATE messaging_subscriptions SET ${credits} = ${credits} - ${units}, updated_at = now()
       WHERE tenant_id = ${tenantId} AND ${credits} >= ${units}
      RETURNING ${credits} AS remaining`)
    const row = rows<{ remaining: number }>(res)[0]
    return row ? { ok: true as const, remaining: Number(row.remaining) } : { ok: false as const, code: 'NO_CREDIT' as const }
  })
}

/** Give back what reserve() took (provider failure). */
async function release(tenantId: string, channel: MessageChannel, mode: string, units: number): Promise<number | undefined> {
  const period = currentPeriod()
  return withTenant(tenantId, async (tdb) => {
    if (mode === 'monthly_quota') {
      const used = channel === 'sms' ? sql.raw('sms_used_period') : sql.raw('whatsapp_used_period')
      const quota = channel === 'sms' ? sql.raw('sms_monthly_quota') : sql.raw('whatsapp_monthly_quota')
      const res = await tdb.execute(sql`
        UPDATE messaging_subscriptions SET ${used} = GREATEST(${used} - ${units}, 0), updated_at = now()
         WHERE tenant_id = ${tenantId} AND period_month = ${period}::date
        RETURNING ${quota} - ${used} AS remaining`)
      const row = rows<{ remaining: number }>(res)[0]
      return row ? Number(row.remaining) : undefined
    }
    const credits = channel === 'sms' ? sql.raw('sms_credits') : sql.raw('whatsapp_credits')
    const res = await tdb.execute(sql`
      UPDATE messaging_subscriptions SET ${credits} = ${credits} + ${units}, updated_at = now()
       WHERE tenant_id = ${tenantId}
      RETURNING ${credits} AS remaining`)
    const row = rows<{ remaining: number }>(res)[0]
    return row ? Number(row.remaining) : undefined
  })
}

async function recordUsage(tenantId: string, channel: MessageChannel, ok: boolean, cost: number): Promise<void> {
  await withTenant(tenantId, (tdb) => tdb.insert(notificationUsage)
    .values({ tenantId, channel, periodMonth: currentPeriod(), sentCount: ok ? 1 : 0, failedCount: ok ? 0 : 1, totalCost: cost.toFixed(2) })
    .onConflictDoUpdate({
      target: [notificationUsage.tenantId, notificationUsage.channel, notificationUsage.periodMonth],
      set: {
        sentCount: ok ? sql`${notificationUsage.sentCount} + 1` : notificationUsage.sentCount,
        failedCount: ok ? notificationUsage.failedCount : sql`${notificationUsage.failedCount} + 1`,
        totalCost: sql`COALESCE(${notificationUsage.totalCost}, 0) + ${cost.toFixed(2)}::numeric`,
      },
    }))
}

export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const { tenantId, channel, purpose } = input
  const ctx = input.context ?? {}
  try {
    const to = normalizeMsisdn(input.to)
    if (!to) return fail('INVALID_NUMBER')

    const flags = await getTenantFeatureFlags(tenantId)
    if (!flags[channel]) return fail('FEATURE_DISABLED', channel === 'sms' ? 'SMS is turned off for this business.' : 'WhatsApp is turned off for this business.')

    const sub = await getSubscription(tenantId)
    if (!sub) return fail('NOT_SUBSCRIBED')
    if (!(channel === 'sms' ? sub.smsEnabled : sub.whatsappEnabled)) {
      return fail('CHANNEL_DISABLED', channel === 'sms' ? 'SMS is not part of this business’s messaging plan.' : 'WhatsApp is not part of this business’s messaging plan.')
    }
    if (sub.expiresAt && sub.expiresAt < colomboDate()) return fail('SUBSCRIPTION_EXPIRED')

    // text
    let text = input.text?.trim() || ''
    const isTemplatePurpose = purpose === 'sale_receipt' || purpose === 'payment_reminder' || purpose === 'low_stock'
    if (!text && isTemplatePurpose) {
      const custom = (await getVendorTemplates(tenantId))[purpose]
      text = renderMessage(custom || DEFAULT_TEXTS[purpose], input.vars ?? {})
    }
    if (!text) return fail('PROVIDER_REJECTED', 'The message is empty')

    // route
    const useOwn = channel === 'sms' && sub.useOwnSmsProvider
    let smsCreds: SmsCreds | null = null
    const platform = useOwn ? null : await loadPlatformConfig()
    if (channel === 'sms') {
      if (useOwn) {
        const own = await withTenant(tenantId, async (tdb) => (await tdb.select().from(smsSettings).where(eq(smsSettings.tenantId, tenantId)).limit(1))[0])
        smsCreds = ownSmsCreds(own)
        if (!smsCreds) return fail('OWN_PROVIDER_NOT_CONFIGURED')
      } else {
        smsCreds = platformSmsCreds(platform!)
        if (!smsCreds) return fail('PROVIDER_NOT_CONFIGURED')
      }
    }
    const waCreds = channel === 'whatsapp' ? platformWhatsAppCreds(platform!) : null
    if (channel === 'whatsapp' && !waCreds) return fail('PROVIDER_NOT_CONFIGURED')

    const units = channel === 'sms' ? smsSegments(text) : 1
    const billedVia: 'platform' | 'own' = useOwn ? 'own' : 'platform'

    let remaining: number | undefined
    if (!useOwn) {
      const r = await reserve(tenantId, channel, sub.billingMode, units)
      if (!r.ok) return fail(r.code)
      remaining = r.remaining
    }

    const providerName = channel === 'whatsapp' ? 'meta_whatsapp' : smsCreds!.provider
    const [log] = await withTenant(tenantId, (tdb) => tdb.insert(notificationLogs).values({
      tenantId,
      channel,
      status: 'pending',
      recipientType: ctx.recipientType || 'manual',
      recipientId: ctx.recipientId || null,
      recipientName: ctx.recipientName || null,
      recipientContact: to,
      content: text,
      entityType: ctx.entityType || null,
      entityId: ctx.entityId || null,
      entityReference: ctx.entityReference || null,
      provider: providerName,
      segments: units,
      sentBy: ctx.userId || null,
      billedVia,
      purpose,
    }).returning({ id: notificationLogs.id }))

    let result: ProviderResult
    if (channel === 'sms') {
      result = await sendSmsVia(smsCreds!, to, text, useOwn ? null : sub.senderMask)
    } else {
      const templateName = isTemplatePurpose ? platform!.whatsapp.templates[purpose] : ''
      if (templateName) {
        const vars = input.vars ?? {}
        result = await sendWhatsAppVia(waCreds!, to, {
          template: {
            name: templateName,
            language: platform!.whatsapp.templateLanguage || 'en',
            namespace: platform!.whatsapp.templateNamespace || undefined,
            params: WHATSAPP_TEMPLATE_PARAMS[purpose as MessagePurpose].map((k) => String(vars[k] ?? '')),
          },
        })
      } else {
        result = await sendWhatsAppVia(waCreds!, to, { text })
      }
    }

    const price = billedVia === 'platform' ? Number(channel === 'sms' ? sub.smsPrice : sub.whatsappPrice) || 0 : 0
    const cost = result.ok ? price * units : 0
    if (!result.ok && !useOwn) remaining = (await release(tenantId, channel, sub.billingMode, units)) ?? remaining

    await withTenant(tenantId, (tdb) => tdb.update(notificationLogs).set({
      status: result.ok ? 'sent' : 'failed',
      providerMessageId: result.messageId ?? null,
      providerResponse: (result.raw ?? null) as Record<string, unknown> | null,
      errorMessage: result.ok ? null : `${result.code}: ${result.error ?? ''}`.slice(0, 1000),
      cost: cost.toFixed(4),
      sentAt: result.ok ? new Date() : null,
    }).where(eq(notificationLogs.id, log.id)))
    await recordUsage(tenantId, channel, result.ok, cost).catch((e) => logError('messaging/usage', e, { tenantId }))

    return {
      ok: result.ok,
      code: result.code,
      error: result.ok ? undefined : result.error || CODE_MESSAGES[result.code] || 'The message could not be sent',
      logId: log.id,
      messageId: result.messageId,
      units: result.ok ? units : 0,
      billedVia,
      remaining,
    }
  } catch (error) {
    logError('messaging/sendMessage', error, { tenantId, channel, purpose })
    return fail('PROVIDER_ERROR', 'The message could not be sent')
  }
}

/** What the POS / mobile app needs to decide between "send through the server" and the free share link. */
export async function messagingAvailability(tenantId: string): Promise<{ sms: boolean; whatsapp: boolean }> {
  const [sub, flags] = await Promise.all([getSubscription(tenantId), getTenantFeatureFlags(tenantId)])
  if (!sub || (sub.expiresAt && sub.expiresAt < colomboDate())) return { sms: false, whatsapp: false }
  const hasUnits = (ch: MessageChannel) => {
    if (ch === 'sms' && sub.useOwnSmsProvider) return true
    if (sub.billingMode === 'monthly_quota') {
      const used = sub.periodMonth === currentPeriod() ? (ch === 'sms' ? sub.smsUsedPeriod : sub.whatsappUsedPeriod) : 0
      return used < (ch === 'sms' ? sub.smsMonthlyQuota : sub.whatsappMonthlyQuota)
    }
    return (ch === 'sms' ? sub.smsCredits : sub.whatsappCredits) > 0
  }
  return {
    sms: flags.sms && sub.smsEnabled && hasUnits('sms'),
    whatsapp: flags.whatsapp && sub.whatsappEnabled && hasUnits('whatsapp'),
  }
}

/** Shop name / phone / currency for message variables. */
export async function shopInfo(tenantId: string): Promise<{ name: string; phone: string; currency: string }> {
  return withTenant(tenantId, async (tdb) => {
    const [t] = await tdb.select({ name: tenants.name, phone: tenants.phone, currency: tenants.currency }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    return { name: t?.name ?? 'Shop', phone: t?.phone ?? '', currency: t?.currency ?? 'LKR' }
  })
}

/** HTTP status for a send result (routes answer with the result body as-is). */
export function httpStatusFor(r: Pick<SendMessageResult, 'ok' | 'code'>): number {
  if (r.ok) return 200
  switch (r.code) {
    case 'INVALID_NUMBER': return 400
    case 'NOT_SUBSCRIBED': case 'CHANNEL_DISABLED': case 'FEATURE_DISABLED': return 403
    case 'SUBSCRIPTION_EXPIRED': case 'NO_CREDIT': case 'QUOTA_EXHAUSTED': return 402
    case 'PROVIDER_NOT_CONFIGURED': case 'OWN_PROVIDER_NOT_CONFIGURED': return 409
    default: return 502
  }
}

export function money(currency: string, amount: number | string): string {
  const n = Number(amount) || 0
  return `${currency} ${n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
