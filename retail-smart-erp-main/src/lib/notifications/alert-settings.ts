/**
 * Tenant alert settings (tenants.settings.alerts) and per-user preference helpers.
 */
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import {
  DEFAULT_ALERT_PREFERENCES, DEFAULT_ALERT_SETTINGS, isAlertType,
  type AlertPreferences, type AlertType, type TenantAlertSettings,
} from './alert-types'

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { at: number; value: TenantAlertSettings; timezone: string }>()

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

export function normalizeAlertSettings(raw: unknown): TenantAlertSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const defaultMinStock = num(r.defaultMinStock)
  const largeRefundAmount = num(r.largeRefundAmount)
  const expiryWarningDays = num(r.expiryWarningDays)
  const varianceThreshold = num(r.varianceThreshold)
  return {
    defaultMinStock: defaultMinStock !== null && defaultMinStock > 0 ? defaultMinStock : null,
    expiryWarningDays: expiryWarningDays !== null && expiryWarningDays >= 1 ? Math.min(Math.round(expiryWarningDays), 365) : DEFAULT_ALERT_SETTINGS.expiryWarningDays,
    largeRefundAmount: largeRefundAmount !== null && largeRefundAmount > 0 ? largeRefundAmount : null,
    varianceThreshold: varianceThreshold !== null && varianceThreshold >= 0 ? varianceThreshold : DEFAULT_ALERT_SETTINGS.varianceThreshold,
    digestEnabled: typeof r.digestEnabled === 'boolean' ? r.digestEnabled : DEFAULT_ALERT_SETTINGS.digestEnabled,
  }
}

async function loadTenant(tenantId: string) {
  const hit = cache.get(tenantId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit
  // tenants is a platform table (no RLS): readable from the plain connection
  const [row] = await db.select({ settings: tenants.settings, timezone: tenants.timezone })
    .from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  const settings = (row?.settings && typeof row.settings === 'object' ? row.settings : {}) as Record<string, unknown>
  const entry = { at: Date.now(), value: normalizeAlertSettings(settings.alerts), timezone: row?.timezone || 'Asia/Colombo' }
  cache.set(tenantId, entry)
  return entry
}

/** Tenant alert settings with defaults (cached for a minute). Never throws. */
export async function getAlertSettings(tenantId: string): Promise<TenantAlertSettings> {
  try {
    return (await loadTenant(tenantId)).value
  } catch {
    return { ...DEFAULT_ALERT_SETTINGS }
  }
}

export async function getTenantTimezone(tenantId: string): Promise<string> {
  try {
    return (await loadTenant(tenantId)).timezone
  } catch {
    return 'Asia/Colombo'
  }
}

/** Replace tenants.settings.alerts (other settings keys are preserved). */
export async function saveAlertSettings(tenantId: string, value: TenantAlertSettings): Promise<TenantAlertSettings> {
  const normalized = normalizeAlertSettings(value)
  await db.update(tenants)
    .set({ settings: sql`jsonb_set(COALESCE(${tenants.settings}, '{}'::jsonb), '{alerts}', ${JSON.stringify(normalized)}::jsonb, true)` })
    .where(eq(tenants.id, tenantId))
  cache.delete(tenantId)
  return normalized
}

export function clearAlertSettingsCache(tenantId?: string) {
  if (tenantId) cache.delete(tenantId)
  else cache.clear()
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export interface PreferenceRow {
  enabledTypes: string[] | null
  mutedTypes: string[] | null
  quietStart: string | null
  quietEnd: string | null
  timezone: string | null
  digestHour: number | null
  pushEnabled: boolean
}

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : null)

export function toPreferences(row: PreferenceRow | null | undefined): AlertPreferences {
  if (!row) return { ...DEFAULT_ALERT_PREFERENCES }
  return {
    enabledTypes: row.enabledTypes ? row.enabledTypes.filter(isAlertType) : null,
    mutedTypes: (row.mutedTypes || []).filter(isAlertType),
    quietStart: hhmm(row.quietStart),
    quietEnd: hhmm(row.quietEnd),
    timezone: row.timezone || null,
    digestHour: row.digestHour ?? null,
    pushEnabled: row.pushEnabled,
  }
}

export function wantsType(prefs: AlertPreferences, type: AlertType): boolean {
  if (prefs.mutedTypes.includes(type)) return false
  return prefs.enabledTypes === null || prefs.enabledTypes.includes(type)
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Local {hour, minute, date 'YYYY-MM-DD'} in `tz` (falls back to Asia/Colombo). */
export function localParts(now: Date, tz: string | null | undefined): { hour: number; minute: number; date: string } {
  const zone = tz && isValidTimezone(tz) ? tz : 'Asia/Colombo'
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '00'
  return { hour: parseInt(get('hour'), 10) % 24, minute: parseInt(get('minute'), 10), date: `${get('year')}-${get('month')}-${get('day')}` }
}

function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t)
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

/** True when `now` falls inside the user's quiet hours (supports windows across midnight). */
export function inQuietHours(prefs: Pick<AlertPreferences, 'quietStart' | 'quietEnd'>, now: Date, tz: string | null | undefined): boolean {
  if (!prefs.quietStart || !prefs.quietEnd) return false
  const start = toMinutes(prefs.quietStart)
  const end = toMinutes(prefs.quietEnd)
  if (start === null || end === null || start === end) return false
  const { hour, minute } = localParts(now, tz)
  const m = hour * 60 + minute
  return start < end ? m >= start && m < end : m >= start || m < end
}
