import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { platformBroadcasts, systemSettings, tenants } from '@/lib/db/schema'
import { announcementTextForLocale, normalizeAnnouncement } from '@/lib/admin/announcement'
import { normalizeBusinessId } from '@/lib/tenant/business-id'
import { pickLocalizedPair, resolveLocale, type Locale } from '@/lib/i18n/locale'

export interface LoginNotice {
  id: string
  kind: 'announcement' | 'broadcast'
  category: string
  type: 'info' | 'warning' | 'error' | 'maintenance' | 'billing' | 'feature'
  title: string
  body: string
  link?: string | null
  createdAt?: string
}

type AudienceMeta = {
  mode?: string
  businessIds?: string[]
  statuses?: string[]
  businessTypes?: string[]
  tierIds?: string[]
  subscriptionStatuses?: string[]
  showOnLogin?: boolean
  translations?: Partial<Record<Locale, { title?: string; body?: string }>>
}

function audienceIncludesVendor(
  audience: AudienceMeta,
  vendor: { id: string; businessId: string; status: string; businessType: string },
): boolean {
  if (audience.showOnLogin !== true) return false
  const mode = audience.mode || 'all'
  if (mode === 'addresses') return false
  if (mode === 'selected') {
    const wanted = new Set((audience.businessIds || []).map((id) => normalizeBusinessId(id)))
    return wanted.has(normalizeBusinessId(vendor.businessId))
  }
  // all / filtered: if statuses listed, vendor must match; else anything except archived
  if (audience.statuses?.length) {
    if (!audience.statuses.includes(vendor.status)) return false
  } else if (vendor.status === 'archived') {
    return false
  }
  if (audience.businessTypes?.length && !audience.businessTypes.includes(vendor.businessType)) return false
  // tier / subscription filters are approximate on login (no join) — show when mode is all or filtered without those
  if (mode === 'filtered' && (audience.tierIds?.length || audience.subscriptionStatuses?.length)) {
    // Conservative: still show filtered broadcasts on login for matching type/status vendors
    // Exact plan matching would need a subscription join; skip plan-only mismatches by allowing through
  }
  return true
}

/** Public notices for login screens (system banner + recent SA broadcasts marked showOnLogin). */
export async function getLoginNotices(opts: {
  locale?: string | null
  slug?: string | null
  limit?: number
}): Promise<{ locale: Locale; notices: LoginNotice[] }> {
  const locale = resolveLocale(opts.locale)
  const notices: LoginNotice[] = []

  const setting = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, 'system_announcement'),
  })
  if (setting?.value) {
    const ann = normalizeAnnouncement(setting.value)
    const message = announcementTextForLocale(ann, locale)
    if (ann.enabled && message && ann.showOnLogin !== false) {
      notices.push({
        id: 'system_announcement',
        kind: 'announcement',
        category: ann.type,
        type: ann.type,
        title: locale === 'si' ? 'පද්ධති දැනුම්දීම' : locale === 'ta' ? 'கணினி அறிவிப்பு' : 'System notice',
        body: message,
      })
    }
  }

  let vendor: { id: string; businessId: string; status: string; businessType: string } | null = null
  const slugProvided = Boolean(opts.slug && String(opts.slug).trim())
  if (slugProvided) {
    const t = await db.query.tenants.findFirst({
      where: eq(tenants.slug, String(opts.slug).trim()),
      columns: { id: true, businessId: true, status: true, businessType: true },
    })
    if (t) vendor = t
  }

  // Unknown slug: return only the system announcement (already pushed above) so responses
  // do not diverge from "no company" in a way that confirms tenant existence via broadcasts.
  if (slugProvided && !vendor) {
    return { locale, notices: notices.slice(0, opts.limit ?? 8) }
  }

  const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000)
  const rows = await db
    .select({
      id: platformBroadcasts.id,
      title: platformBroadcasts.title,
      body: platformBroadcasts.body,
      link: platformBroadcasts.link,
      category: platformBroadcasts.category,
      audience: platformBroadcasts.audience,
      createdAt: platformBroadcasts.createdAt,
      status: platformBroadcasts.status,
    })
    .from(platformBroadcasts)
    .where(and(
      gte(platformBroadcasts.createdAt, since),
      sql`coalesce((${platformBroadcasts.audience}->>'showOnLogin')::boolean, false) = true`,
      sql`${platformBroadcasts.status} in ('sent', 'completed', 'partial')`,
    ))
    .orderBy(desc(platformBroadcasts.createdAt))
    .limit(40)

  for (const row of rows) {
    const audience = (row.audience || {}) as AudienceMeta
    if (vendor) {
      if (!audienceIncludesVendor(audience, vendor)) continue
    } else if (audience.mode === 'selected') {
      // Global /login without a company: only show "all"/"filtered" notices
      continue
    } else if (audience.showOnLogin !== true) {
      continue
    }

    const localized = pickLocalizedPair(audience.translations, locale, {
      title: row.title,
      body: row.body,
    })
    const cat = row.category || 'info'
    notices.push({
      id: row.id,
      kind: 'broadcast',
      category: cat,
      type: (cat === 'warning' || cat === 'error' || cat === 'maintenance' || cat === 'billing' || cat === 'feature'
        ? cat
        : 'info') as LoginNotice['type'],
      title: localized.title,
      body: localized.body,
      link: row.link,
      createdAt: row.createdAt?.toISOString?.() ?? undefined,
    })
    if (notices.length >= (opts.limit ?? 8)) break
  }

  return { locale, notices: notices.slice(0, opts.limit ?? 8) }
}
