/**
 * Console broadcasts: notifications and emails sent to a filtered set of vendors.
 *
 * Audience → vendors (tenants) by plan, business type, vendor status, subscription status or an
 * explicit list of Business IDs. Recipients are each vendor's active owners (or all active staff).
 * Channels use the existing delivery systems:
 *   in_app   vendor app inbox (in_app_notifications, live "inbox-notification" event)
 *   account  account portal notifications (account_notifications, live "account-notification" event)
 *   email    system email transport (Resend); without RESEND_API_KEY the mail is only logged
 *   push     phones running the POSLanka app (Expo push, user_devices) of each vendor's owners and
 *            managers (pushScope 'owners_managers', default) or all active staff; sent in batches
 *            of 100 with per-vendor delivery counts
 * Every send is stored in platform_broadcasts with per-recipient delivery rows.
 */
import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  accountNotifications,
  businessTypeEnum,
  inAppNotifications,
  platformBroadcastRecipients,
  platformBroadcasts,
  pricingTiers,
  subscriptions,
  subscriptionStatusEnum,
  superAdmins,
  tenants,
  tenantStatusEnum,
  userDevices,
  users,
} from '@/lib/db/schema'
import { normalizeBusinessId } from '@/lib/tenant/business-id'
import { sendSystemEmail } from '@/lib/email/system-email'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import { sendPushDetailed } from '@/lib/notifications/push'
import { logError } from '@/lib/ai/error-logger'

export const BROADCAST_CHANNELS = ['in_app', 'account', 'email', 'push'] as const
export const PUSH_SCOPES = ['owners_managers', 'all_staff'] as const
export type BroadcastChannel = typeof BROADCAST_CHANNELS[number]
export const BROADCAST_CATEGORIES = ['info', 'maintenance', 'billing', 'feature', 'warning'] as const

/** User-facing problem with a broadcast request (empty or too large audience). */
export class BroadcastError extends Error {}

/** Hard limits per send (narrow the audience beyond these). */
export const MAX_VENDORS = 5000
export const MAX_EMAILS = 1000

export const audienceSchema = z.object({
  mode: z.enum(['all', 'filtered', 'selected', 'addresses']),
  tierIds: z.array(z.string().uuid()).max(50).optional(),
  businessTypes: z.array(z.enum(businessTypeEnum.enumValues)).max(10).optional(),
  /** Vendor status; default (all / filtered without statuses) = everything except archived. */
  statuses: z.array(z.enum(tenantStatusEnum.enumValues)).max(4).optional(),
  subscriptionStatuses: z.array(z.enum(subscriptionStatusEnum.enumValues)).max(5).optional(),
  /** mode 'selected': Business IDs in any spelling (PL-123456, pl123456, 123456). */
  businessIds: z.array(z.string().trim().min(1).max(20)).max(500).optional(),
  /** mode 'addresses' (email only): plain email addresses. */
  addresses: z.array(z.email().max(255)).max(MAX_EMAILS).optional(),
}).superRefine((a, ctx) => {
  if (a.mode === 'selected' && !(a.businessIds?.length)) ctx.addIssue({ code: 'custom', path: ['businessIds'], message: 'Enter at least one Business ID' })
  if (a.mode === 'addresses' && !(a.addresses?.length)) ctx.addIssue({ code: 'custom', path: ['addresses'], message: 'Enter at least one email address' })
})

export type Audience = z.infer<typeof audienceSchema>

export const broadcastInputSchema = z.object({
  title: z.string().trim().min(3, 'Enter a title of at least 3 characters').max(200),
  body: z.string().trim().min(5, 'Enter a message of at least 5 characters').max(5000),
  link: z.string().trim().max(500).optional()
    .refine((v) => !v || /^\/(?!\/)/.test(v) || /^https:\/\/[^\s]+$/.test(v), 'Use a path such as /account/billing or an https:// address'),
  category: z.enum(BROADCAST_CATEGORIES).default('info'),
  channels: z.array(z.enum(BROADCAST_CHANNELS)).min(1, 'Choose at least one channel').max(4),
  recipientScope: z.enum(['owners', 'all_staff']).default('owners'),
  /** Who gets the phone push (channel 'push'): owners and managers (default) or all active staff */
  pushScope: z.enum(PUSH_SCOPES).default('owners_managers'),
  audience: audienceSchema,
  /** Preview only: count recipients, send nothing. */
  dryRun: z.boolean().optional(),
}).superRefine((v, ctx) => {
  if (v.audience.mode === 'addresses' && (v.channels.length !== 1 || v.channels[0] !== 'email')) {
    ctx.addIssue({ code: 'custom', path: ['channels'], message: 'Plain email addresses can only receive email' })
  }
})

export type BroadcastInput = z.infer<typeof broadcastInputSchema>

interface Vendor { id: string; name: string; businessId: string; status: string; email: string }
interface Recipient { userId: string; tenantId: string; email: string; accountId: string | null; role: string }

export interface AudiencePreview {
  vendorCount: number
  userCount: number
  accountCount: number
  emailCount: number
  /** channel 'push': staff in scope / their registered phones */
  pushUserCount: number
  pushDeviceCount: number
  sample: Array<{ id: string; name: string; businessId: string; status: string }>
  unknownBusinessIds: string[]
  tooLarge: string | null
}

/** Vendors matched by an audience (not used for mode 'addresses'). */
export async function resolveVendors(a: Audience): Promise<{ vendors: Vendor[]; unknownBusinessIds: string[] }> {
  const conds: SQL[] = []
  let unknownBusinessIds: string[] = []
  if (a.mode === 'selected') {
    const wanted = new Map<string, string>()
    for (const raw of a.businessIds ?? []) {
      const bid = normalizeBusinessId(raw)
      if (bid) wanted.set(bid, raw)
      else unknownBusinessIds.push(raw)
    }
    if (wanted.size === 0) return { vendors: [], unknownBusinessIds }
    conds.push(inArray(tenants.businessId, [...wanted.keys()]))
    const rows = await db.select({ id: tenants.id, name: tenants.name, businessId: tenants.businessId, status: tenants.status, email: tenants.email })
      .from(tenants).where(and(...conds)).orderBy(asc(tenants.name))
    const found = new Set(rows.map((r) => r.businessId))
    unknownBusinessIds = [...unknownBusinessIds, ...[...wanted.entries()].filter(([bid]) => !found.has(bid)).map(([, raw]) => raw)]
    return { vendors: rows, unknownBusinessIds }
  }
  if (a.statuses?.length) conds.push(inArray(tenants.status, a.statuses))
  else conds.push(ne(tenants.status, 'cancelled'))
  if (a.mode === 'filtered') {
    if (a.businessTypes?.length) conds.push(inArray(tenants.businessType, a.businessTypes))
    if (a.tierIds?.length) conds.push(inArray(subscriptions.tierId, a.tierIds))
    if (a.subscriptionStatuses?.length) conds.push(inArray(subscriptions.status, a.subscriptionStatuses))
  }
  const rows = await db.select({ id: tenants.id, name: tenants.name, businessId: tenants.businessId, status: tenants.status, email: tenants.email })
    .from(tenants)
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .where(and(...conds))
    .orderBy(asc(tenants.name))
    .limit(MAX_VENDORS + 1)
  return { vendors: rows, unknownBusinessIds }
}

async function resolveRecipients(vendorIds: string[], scope: 'owners' | 'all_staff'): Promise<Recipient[]> {
  if (vendorIds.length === 0) return []
  const out: Recipient[] = []
  // chunked to keep the IN list reasonable
  for (let i = 0; i < vendorIds.length; i += 1000) {
    const chunk = vendorIds.slice(i, i + 1000)
    const rows = await db.select({ userId: users.id, tenantId: users.tenantId, email: users.email, accountId: users.accountId, role: users.role })
      .from(users)
      .where(and(inArray(users.tenantId, chunk), eq(users.isActive, true), scope === 'owners' ? eq(users.role, 'owner') : undefined))
    out.push(...rows)
  }
  return out
}

interface PushTarget { tenantId: string; userId: string; token: string }

/** Registered phones of the vendors' owners + managers (or all active staff). */
async function resolvePushTargets(vendorIds: string[], scope: typeof PUSH_SCOPES[number]): Promise<{ users: number; targets: PushTarget[] }> {
  if (vendorIds.length === 0) return { users: 0, targets: [] }
  let userCount = 0
  const targets: PushTarget[] = []
  for (let i = 0; i < vendorIds.length; i += 1000) {
    const chunk = vendorIds.slice(i, i + 1000)
    const staff = await db.select({ id: users.id, tenantId: users.tenantId })
      .from(users)
      .where(and(inArray(users.tenantId, chunk), eq(users.isActive, true), scope === 'owners_managers' ? inArray(users.role, ['owner', 'manager']) : undefined))
    userCount += staff.length
    if (staff.length === 0) continue
    const tenantOf = new Map(staff.map((u) => [u.id, u.tenantId]))
    for (let j = 0; j < staff.length; j += 1000) {
      const ids = staff.slice(j, j + 1000).map((u) => u.id)
      const devices = await db.select({ userId: userDevices.userId, tenantId: userDevices.tenantId, token: userDevices.pushToken })
        .from(userDevices)
        .where(and(inArray(userDevices.userId, ids), inArray(userDevices.tenantId, chunk)))
      for (const d of devices) {
        if (d.userId && d.tenantId && tenantOf.get(d.userId) === d.tenantId) targets.push({ tenantId: d.tenantId, userId: d.userId, token: d.token })
      }
    }
  }
  return { users: userCount, targets }
}

function emailTargets(vendors: Vendor[], recipients: Recipient[]): Array<{ vendor: Vendor | null; email: string }> {
  const byVendor = new Map<string, Set<string>>()
  for (const r of recipients) {
    // Owners created without an email sign in with a generated owner@<slug>.poslanka.local login
    if (!r.email || r.email.toLowerCase().endsWith('.poslanka.local')) continue
    const set = byVendor.get(r.tenantId) ?? new Set<string>()
    set.add(r.email.toLowerCase())
    byVendor.set(r.tenantId, set)
  }
  const out: Array<{ vendor: Vendor | null; email: string }> = []
  for (const v of vendors) {
    const emails = byVendor.get(v.id)
    if (emails?.size) for (const e of emails) out.push({ vendor: v, email: e })
    else if (v.email) out.push({ vendor: v, email: v.email.toLowerCase() }) // no active owner: business email
  }
  return out
}

/** Counts for the confirmation step (nothing is sent). */
export async function previewAudience(input: Pick<BroadcastInput, 'audience' | 'channels' | 'recipientScope'> & { pushScope?: BroadcastInput['pushScope'] }): Promise<AudiencePreview> {
  if (input.audience.mode === 'addresses') {
    const emails = [...new Set((input.audience.addresses ?? []).map((e) => e.toLowerCase()))]
    return { vendorCount: 0, userCount: 0, accountCount: 0, emailCount: emails.length, pushUserCount: 0, pushDeviceCount: 0, sample: [], unknownBusinessIds: [], tooLarge: null }
  }
  const { vendors, unknownBusinessIds } = await resolveVendors(input.audience)
  const recipients = await resolveRecipients(vendors.slice(0, MAX_VENDORS).map((v) => v.id), input.recipientScope)
  const emailCount = input.channels.includes('email') ? emailTargets(vendors, recipients).length : 0
  const push = input.channels.includes('push')
    ? await resolvePushTargets(vendors.slice(0, MAX_VENDORS).map((v) => v.id), input.pushScope ?? 'owners_managers')
    : { users: 0, targets: [] }
  const tooLarge = vendors.length > MAX_VENDORS
    ? `More than ${MAX_VENDORS} vendors match. Narrow the audience.`
    : emailCount > MAX_EMAILS ? `${emailCount} email addresses match; the limit per send is ${MAX_EMAILS}. Narrow the audience or send to owners only.` : null
  return {
    vendorCount: Math.min(vendors.length, MAX_VENDORS),
    userCount: input.channels.includes('in_app') ? recipients.length : 0,
    accountCount: input.channels.includes('account') ? new Set(recipients.map((r) => r.accountId).filter(Boolean)).size : 0,
    emailCount,
    pushUserCount: push.users,
    pushDeviceCount: new Set(push.targets.map((t) => t.token)).size,
    sample: vendors.slice(0, 8).map((v) => ({ id: v.id, name: v.name, businessId: v.businessId, status: v.status })),
    unknownBusinessIds,
    tooLarge,
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function renderBroadcastEmail(input: { title: string; body: string; link?: string | null; baseUrl: string }): { html: string; text: string } {
  const app = process.env.NEXT_PUBLIC_APP_NAME || 'POSLanka'
  const href = input.link ? (input.link.startsWith('/') ? `${input.baseUrl.replace(/\/$/, '')}${input.link}` : input.link) : null
  const paragraphs = input.body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
  const html = `
  <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;">
    <div style="background:#0f766e;padding:20px 24px;border-radius:12px 12px 0 0;">
      <h1 style="color:#ffffff;font-size:19px;font-weight:700;margin:0;">${esc(input.title)}</h1>
    </div>
    <div style="padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;color:#334155;font-size:15px;line-height:1.6;">
      ${paragraphs}
      ${href ? `<p style="margin:20px 0 0;"><a href="${esc(href)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;">Open</a></p>` : ''}
    </div>
    <p style="text-align:center;color:#94a3b8;font-size:12px;margin:16px 0;">${esc(app)} platform message</p>
  </div>`
  const text = `${input.title}\n\n${input.body}${href ? `\n\n${href}` : ''}\n\n- ${app}`
  return { html, text }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

export interface BroadcastResult {
  id: string
  status: string
  vendorCount: number
  inAppCount: number
  accountCount: number
  emailSent: number
  emailLogged: number
  emailFailed: number
  pushSent: number
  pushFailed: number
  pushNoDevice: number
}

/** Deliver a broadcast and record it. Throws `Error` with a user-facing message for an empty / too large audience. */
export async function sendBroadcast(input: BroadcastInput & { kind: 'notification' | 'email'; superAdminId: string; baseUrl: string }): Promise<BroadcastResult> {
  const channels = [...new Set(input.channels)]
  const addressMode = input.audience.mode === 'addresses'
  const { vendors, unknownBusinessIds } = addressMode ? { vendors: [] as Vendor[], unknownBusinessIds: [] as string[] } : await resolveVendors(input.audience)
  if (!addressMode && vendors.length === 0) throw new BroadcastError('No vendors match this audience.')
  if (vendors.length > MAX_VENDORS) throw new BroadcastError(`More than ${MAX_VENDORS} vendors match. Narrow the audience.`)
  const recipients = addressMode ? [] : await resolveRecipients(vendors.map((v) => v.id), input.recipientScope)
  const emailList = !channels.includes('email') ? []
    : addressMode ? [...new Set((input.audience.addresses ?? []).map((e) => e.toLowerCase()))].map((email) => ({ vendor: null, email }))
      : emailTargets(vendors, recipients)
  if (emailList.length > MAX_EMAILS) throw new BroadcastError(`${emailList.length} email addresses match; the limit per send is ${MAX_EMAILS}.`)

  const [broadcast] = await db.insert(platformBroadcasts).values({
    kind: input.kind,
    superAdminId: input.superAdminId,
    title: input.title,
    body: input.body,
    link: input.link || null,
    category: input.category,
    channels,
    audience: { ...input.audience, ...(unknownBusinessIds.length ? { unknownBusinessIds } : {}) },
    recipientScope: input.recipientScope,
    pushScope: channels.includes('push') ? input.pushScope : null,
    status: 'sending',
    vendorCount: vendors.length,
  }).returning({ id: platformBroadcasts.id })

  const perVendor = new Map<string, { inApp: number; account: number }>()
  const bump = (tenantId: string, key: 'inApp' | 'account') => {
    const v = perVendor.get(tenantId) ?? { inApp: 0, account: 0 }
    v[key]++
    perVendor.set(tenantId, v)
  }
  const data = { broadcastId: broadcast.id, category: input.category, ...(input.link ? { link: input.link } : {}) }

  // 1. vendor app inbox
  let inAppCount = 0
  if (channels.includes('in_app') && recipients.length) {
    for (let i = 0; i < recipients.length; i += 500) {
      const chunk = recipients.slice(i, i + 500)
      const rows = await db.insert(inAppNotifications).values(chunk.map((r) => ({
        tenantId: r.tenantId,
        userId: r.userId,
        type: 'platform_announcement',
        title: input.title.slice(0, 255),
        body: input.body,
        data,
      }))).returning({ id: inAppNotifications.id, userId: inAppNotifications.userId, tenantId: inAppNotifications.tenantId })
      inAppCount += rows.length
      for (const row of rows) {
        bump(row.tenantId, 'inApp')
        try { broadcastAccountChange(row.userId, 'inbox-notification', 'created', row.id, { tenantId: row.tenantId, alertType: 'platform_announcement' }) } catch { /* best effort */ }
      }
    }
  }

  // 2. account portal (one per account, even when it owns several matched vendors)
  let accountCount = 0
  if (channels.includes('account')) {
    const firstVendorOf = new Map<string, string>()
    for (const r of recipients) if (r.accountId && !firstVendorOf.has(r.accountId)) firstVendorOf.set(r.accountId, r.tenantId)
    const accountIds = [...firstVendorOf.keys()]
    for (let i = 0; i < accountIds.length; i += 500) {
      const chunk = accountIds.slice(i, i + 500)
      const rows = await db.insert(accountNotifications).values(chunk.map((accountId) => ({
        accountId,
        type: input.category === 'billing' ? 'billing' : 'info',
        title: input.title.slice(0, 255),
        message: input.body,
        link: input.link && input.link.startsWith('/') ? input.link : null,
        metadata: { ...data, sentBy: 'platform_admin' },
      }))).returning({ id: accountNotifications.id, accountId: accountNotifications.accountId })
      accountCount += rows.length
      for (const row of rows) {
        bump(firstVendorOf.get(row.accountId)!, 'account')
        try { broadcastAccountChange(row.accountId, 'account-notification', 'created', row.id) } catch { /* best effort */ }
      }
    }
  }

  // 3. email
  const { html, text } = renderBroadcastEmail({ title: input.title, body: input.body, link: input.link, baseUrl: input.baseUrl })
  const emailResults = await mapLimit(emailList, 4, async (t) => {
    try {
      const res = await sendSystemEmail({ to: t.email, subject: input.title, html, text })
      return { ...t, status: 'dev' in res && res.dev ? 'logged' : 'sent', error: null as string | null }
    } catch (error) {
      return { ...t, status: 'failed', error: error instanceof Error ? error.message.slice(0, 300) : 'Send failed' }
    }
  })
  const emailSent = emailResults.filter((r) => r.status === 'sent').length
  const emailLogged = emailResults.filter((r) => r.status === 'logged').length
  const emailFailed = emailResults.filter((r) => r.status === 'failed').length

  // 4. phone push (Expo, batches of 100), counted per vendor
  const pushByVendor = new Map<string, { sent: number; failed: number }>()
  let pushSent = 0
  let pushFailed = 0
  let pushNoDevice = 0
  if (channels.includes('push') && vendors.length) {
    const { targets } = await resolvePushTargets(vendors.map((v) => v.id), input.pushScope)
    const vendorOfToken = new Map<string, string>()
    for (const t of targets) if (!vendorOfToken.has(t.token)) vendorOfToken.set(t.token, t.tenantId)
    const tickets = vendorOfToken.size
      ? await sendPushDetailed([...vendorOfToken.keys()], {
        title: input.title.slice(0, 200),
        body: input.body.length > 300 ? `${input.body.slice(0, 297)}…` : input.body,
        data: { type: 'platform_announcement', ...data },
        channelId: 'default',
      })
      : []
    for (const t of tickets) {
      const vendorId = vendorOfToken.get(t.token)
      if (!vendorId) continue
      const v = pushByVendor.get(vendorId) ?? { sent: 0, failed: 0 }
      if (t.status === 'ok') { v.sent++; pushSent++ } else { v.failed++; pushFailed++ }
      pushByVendor.set(vendorId, v)
    }
    pushNoDevice = vendors.filter((v) => !pushByVendor.has(v.id)).length
  }
  const pushFields = (vendorId: string | null | undefined, first: boolean) => {
    if (!channels.includes('push') || !vendorId) return { pushStatus: null, pushSent: 0, pushFailed: 0 }
    const p = pushByVendor.get(vendorId)
    if (!first) return { pushStatus: null, pushSent: 0, pushFailed: 0 }
    if (!p) return { pushStatus: 'no_device', pushSent: 0, pushFailed: 0 }
    return { pushStatus: p.failed === 0 ? 'sent' : p.sent === 0 ? 'failed' : 'partial', pushSent: p.sent, pushFailed: p.failed }
  }

  // 5. per-recipient delivery rows: one per email address, plus one per vendor reached without email
  const rows: Array<typeof platformBroadcastRecipients.$inferInsert> = []
  const seenVendor = new Set<string>()
  for (const r of emailResults) {
    const first = !!r.vendor && !seenVendor.has(r.vendor.id)
    const counts = first ? perVendor.get(r.vendor!.id) : undefined
    if (r.vendor) seenVendor.add(r.vendor.id)
    rows.push({
      broadcastId: broadcast.id, vendorId: r.vendor?.id ?? null, vendorName: r.vendor?.name ?? null, email: r.email,
      inAppCount: counts?.inApp ?? 0, accountCount: counts?.account ?? 0, emailStatus: r.status, error: r.error,
      ...pushFields(r.vendor?.id, first),
    })
  }
  for (const v of vendors) {
    if (seenVendor.has(v.id)) continue
    const counts = perVendor.get(v.id)
    const push = pushFields(v.id, true)
    const reachedByPush = push.pushSent > 0
    rows.push({
      broadcastId: broadcast.id, vendorId: v.id, vendorName: v.name, email: null,
      inAppCount: counts?.inApp ?? 0, accountCount: counts?.account ?? 0,
      emailStatus: channels.includes('email') ? 'skipped' : null,
      error: !counts && !reachedByPush && channels.some((c) => c === 'in_app' || c === 'account') ? 'No active recipient' : null,
      ...push,
    })
  }
  for (let i = 0; i < rows.length; i += 1000) await db.insert(platformBroadcastRecipients).values(rows.slice(i, i + 1000))

  const delivered = inAppCount + accountCount + emailSent + emailLogged + pushSent
  const status = delivered === 0 ? 'failed' : emailFailed > 0 || pushFailed > 0 ? 'partial' : 'sent'
  await db.update(platformBroadcasts).set({
    status, inAppCount, accountCount, emailSent, emailLogged, emailFailed, pushSent, pushFailed, pushNoDevice, completedAt: new Date(),
  }).where(eq(platformBroadcasts.id, broadcast.id))

  if (emailFailed > 0) logError('admin/broadcast', new Error(`${emailFailed} broadcast emails failed`), { broadcastId: broadcast.id })

  if (pushFailed > 0) logError('admin/broadcast', new Error(`${pushFailed} broadcast push notifications failed`), { broadcastId: broadcast.id })

  return { id: broadcast.id, status, vendorCount: vendors.length, inAppCount, accountCount, emailSent, emailLogged, emailFailed, pushSent, pushFailed, pushNoDevice }
}


/** History list (newest first) with the sending admin. */
export async function listBroadcasts(kind: 'notification' | 'email', page: number, pageSize: number) {
  const where = eq(platformBroadcasts.kind, kind)
  const [rows, [count]] = await Promise.all([
    db.select({
      id: platformBroadcasts.id,
      title: platformBroadcasts.title,
      body: sql<string>`left(${platformBroadcasts.body}, 300)`,
      link: platformBroadcasts.link,
      category: platformBroadcasts.category,
      channels: platformBroadcasts.channels,
      audience: platformBroadcasts.audience,
      recipientScope: platformBroadcasts.recipientScope,
      status: platformBroadcasts.status,
      vendorCount: platformBroadcasts.vendorCount,
      inAppCount: platformBroadcasts.inAppCount,
      accountCount: platformBroadcasts.accountCount,
      emailSent: platformBroadcasts.emailSent,
      emailLogged: platformBroadcasts.emailLogged,
      emailFailed: platformBroadcasts.emailFailed,
      pushScope: platformBroadcasts.pushScope,
      pushSent: platformBroadcasts.pushSent,
      pushFailed: platformBroadcasts.pushFailed,
      pushNoDevice: platformBroadcasts.pushNoDevice,
      createdAt: platformBroadcasts.createdAt,
      completedAt: platformBroadcasts.completedAt,
      sentBy: superAdmins.fullName,
    })
      .from(platformBroadcasts)
      .leftJoin(superAdmins, eq(superAdmins.id, platformBroadcasts.superAdminId))
      .where(where)
      .orderBy(sql`${platformBroadcasts.createdAt} desc`)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(platformBroadcasts).where(where),
  ])
  return { broadcasts: rows, pagination: { page, pageSize, total: count?.total ?? 0 } }
}

/** One broadcast with a page of its delivery rows. */
export async function getBroadcast(id: string, page: number, pageSize: number) {
  const [row] = await db.select({ broadcast: platformBroadcasts, sentBy: superAdmins.fullName, sentByEmail: superAdmins.email })
    .from(platformBroadcasts)
    .leftJoin(superAdmins, eq(superAdmins.id, platformBroadcasts.superAdminId))
    .where(eq(platformBroadcasts.id, id))
  if (!row) return null
  const where = eq(platformBroadcastRecipients.broadcastId, id)
  const [recipients, [count]] = await Promise.all([
    db.select({
      id: platformBroadcastRecipients.id,
      vendorId: platformBroadcastRecipients.vendorId,
      vendorName: platformBroadcastRecipients.vendorName,
      businessId: tenants.businessId,
      email: platformBroadcastRecipients.email,
      inAppCount: platformBroadcastRecipients.inAppCount,
      accountCount: platformBroadcastRecipients.accountCount,
      emailStatus: platformBroadcastRecipients.emailStatus,
      pushStatus: platformBroadcastRecipients.pushStatus,
      pushSent: platformBroadcastRecipients.pushSent,
      pushFailed: platformBroadcastRecipients.pushFailed,
      error: platformBroadcastRecipients.error,
    })
      .from(platformBroadcastRecipients)
      .leftJoin(tenants, eq(tenants.id, platformBroadcastRecipients.vendorId))
      // failures first, then by vendor
      .orderBy(sql`case when ${platformBroadcastRecipients.emailStatus} = 'failed' or ${platformBroadcastRecipients.pushStatus} in ('failed', 'partial') then 0 else 1 end`, asc(platformBroadcastRecipients.vendorName), asc(platformBroadcastRecipients.email))
      .where(where)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(platformBroadcastRecipients).where(where),
  ])
  return { ...row.broadcast, sentBy: row.sentBy, sentByEmail: row.sentByEmail, recipients, pagination: { page, pageSize, total: count?.total ?? 0 } }
}

/** Active plans and the vendor count per status, for the audience picker. */
export async function audienceOptions() {
  const [tiers, statusCounts] = await Promise.all([
    db.select({ id: pricingTiers.id, displayName: pricingTiers.displayName, isActive: pricingTiers.isActive }).from(pricingTiers).orderBy(asc(pricingTiers.sortOrder), asc(pricingTiers.priceMonthly)),
    db.select({ status: tenants.status, count: sql<number>`count(*)::int` }).from(tenants).groupBy(tenants.status),
  ])
  return { tiers, vendorStatusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, s.count])) as Record<string, number> }
}
