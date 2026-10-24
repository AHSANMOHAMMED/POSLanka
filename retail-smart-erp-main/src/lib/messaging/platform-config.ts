/**
 * Platform messaging accounts (the SMS gateway and WhatsApp Business number the platform owner buys
 * and resells), edited in /sys-control/messaging and stored in system_settings['messaging_providers'].
 * Secret fields are encrypted at rest (src/lib/crypto/secret-box) and never leave the server:
 * the console gets maskedPlatformConfig() (set / last 4 characters only). Server-only.
 */
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { systemSettings } from '@/lib/db/schema'
import { decryptSecret, encryptSecret, maskSecret } from '@/lib/crypto/secret-box'
import { SMS_PROVIDERS, type SmsCreds, type WhatsAppCreds } from './providers'
import { MESSAGE_PURPOSES, type MessagePurpose } from './templates'

export const MESSAGING_SETTING_KEY = 'messaging_providers'

export interface PlatformMessagingConfig {
  sms: {
    provider: 'none' | (typeof SMS_PROVIDERS)[number]
    notify_lk: { userId: string; apiKey: string; senderId: string }
    text_lk: { apiToken: string; senderId: string }
    websms_lk: { apiKey: string; apiToken: string; senderId: string }
    twilio: { accountSid: string; authToken: string; fromNumber: string }
    generic_http: {
      url: string
      method: 'GET' | 'POST'
      recipientParam: string
      messageParam: string
      senderParam: string
      senderId: string
      apiKeyParam: string
      apiKey: string
      successMatch: string
      staticParams: Array<{ key: string; value: string }>
    }
  }
  whatsapp: {
    enabled: boolean
    phoneNumberId: string
    businessAccountId: string
    accessToken: string
    apiVersion: string
    templateNamespace: string
    templateLanguage: string
    /** approved template name per purpose ('' = send plain text, only delivered inside the 24-hour window) */
    templates: Record<MessagePurpose, string>
  }
}

/** Dotted paths of the fields that are encrypted and masked. */
export const SECRET_PATHS = [
  'sms.notify_lk.apiKey',
  'sms.text_lk.apiToken',
  'sms.websms_lk.apiKey',
  'sms.websms_lk.apiToken',
  'sms.twilio.authToken',
  'sms.generic_http.apiKey',
  'whatsapp.accessToken',
] as const
export type SecretPath = (typeof SECRET_PATHS)[number]

export const DEFAULT_PLATFORM_CONFIG: PlatformMessagingConfig = {
  sms: {
    provider: 'none',
    notify_lk: { userId: '', apiKey: '', senderId: 'NotifyDEMO' },
    text_lk: { apiToken: '', senderId: '' },
    websms_lk: { apiKey: '', apiToken: '', senderId: '' },
    twilio: { accountSid: '', authToken: '', fromNumber: '' },
    generic_http: { url: '', method: 'POST', recipientParam: 'to', messageParam: 'text', senderParam: '', senderId: '', apiKeyParam: '', apiKey: '', successMatch: '', staticParams: [] },
  },
  whatsapp: {
    enabled: false,
    phoneNumberId: '',
    businessAccountId: '',
    accessToken: '',
    apiVersion: 'v21.0',
    templateNamespace: '',
    templateLanguage: 'en',
    templates: Object.fromEntries(MESSAGE_PURPOSES.map((p) => [p, ''])) as Record<MessagePurpose, string>,
  },
}

/* ------------------------------------------------------------------ path helpers */

type Obj = Record<string, unknown>
function getPath(o: Obj, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Obj)[k] : undefined), o)
}
function setPath(o: Obj, path: string, value: unknown): void {
  const keys = path.split('.')
  let cur = o
  for (const k of keys.slice(0, -1)) {
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {}
    cur = cur[k] as Obj
  }
  cur[keys[keys.length - 1]] = value
}
function deepMerge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return (over === undefined ? base : over) as T
  const out: Obj = { ...(base as Obj) }
  for (const [k, v] of Object.entries(over as Obj)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? deepMerge(out[k], v) : v
  }
  return out as T
}

/* ------------------------------------------------------------------ load / save */

async function loadStored(): Promise<{ value: PlatformMessagingConfig; updatedAt: Date | null }> {
  const row = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, MESSAGING_SETTING_KEY) })
  return { value: deepMerge(structuredClone(DEFAULT_PLATFORM_CONFIG), row?.value), updatedAt: row?.updatedAt ?? null }
}

/** Decrypted config for sending. Server-only — never return this to a client. */
export async function loadPlatformConfig(): Promise<PlatformMessagingConfig> {
  const { value } = await loadStored()
  for (const p of SECRET_PATHS) setPath(value as unknown as Obj, p, decryptSecret(getPath(value as unknown as Obj, p) as string) ?? '')
  return value
}

export interface MaskedPlatformConfig {
  config: PlatformMessagingConfig
  secrets: Record<SecretPath, { set: boolean; hint: string }>
  updatedAt: Date | null
  status: { sms: boolean; whatsapp: boolean }
}

/** What the console sees: every secret blanked, plus whether it is set and its last 4 characters. */
export async function maskedPlatformConfig(): Promise<MaskedPlatformConfig> {
  const { value, updatedAt } = await loadStored()
  const plain = await loadPlatformConfig()
  const secrets = {} as MaskedPlatformConfig['secrets']
  for (const p of SECRET_PATHS) {
    const v = getPath(plain as unknown as Obj, p) as string
    secrets[p] = { set: !!v, hint: maskSecret(v) }
    setPath(value as unknown as Obj, p, '')
  }
  return { config: value, secrets, updatedAt, status: { sms: !!platformSmsCreds(plain), whatsapp: !!platformWhatsAppCreds(plain) } }
}

const text = (max: number) => z.string().trim().max(max)
const senderId = z.string().trim().max(11, 'A sender ID / mask is at most 11 characters')

/** PUT body: any subset of the config. Secret fields: a new value replaces; omit to keep; list in clearSecrets to remove. */
export const platformConfigPatchSchema = z.object({
  sms: z.object({
    provider: z.enum(['none', ...SMS_PROVIDERS]).optional(),
    notify_lk: z.object({ userId: text(50), apiKey: text(200), senderId }).partial().optional(),
    text_lk: z.object({ apiToken: text(500), senderId }).partial().optional(),
    websms_lk: z.object({ apiKey: text(200), apiToken: text(200), senderId }).partial().optional(),
    twilio: z.object({ accountSid: text(64), authToken: text(200), fromNumber: text(20) }).partial().optional(),
    generic_http: z.object({
      url: z.string().trim().max(500).refine((v) => v === '' || /^https:\/\//i.test(v), 'The gateway address must start with https://'),
      method: z.enum(['GET', 'POST']),
      recipientParam: text(50),
      messageParam: text(50),
      senderParam: text(50),
      senderId,
      apiKeyParam: text(50),
      apiKey: text(500),
      successMatch: text(100),
      staticParams: z.array(z.object({ key: text(50), value: text(200) })).max(10),
    }).partial().optional(),
  }).partial().optional(),
  whatsapp: z.object({
    enabled: z.boolean(),
    phoneNumberId: z.string().trim().regex(/^\d{0,30}$/, 'The phone number ID is a number from WhatsApp Manager'),
    businessAccountId: z.string().trim().regex(/^\d{0,30}$/, 'The WhatsApp Business Account ID is a number'),
    accessToken: text(1000),
    apiVersion: z.string().trim().regex(/^v\d{1,2}\.\d$/, 'e.g. v21.0'),
    templateNamespace: text(100),
    templateLanguage: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, 'e.g. en or en_US'),
    templates: z.object(Object.fromEntries(MESSAGE_PURPOSES.map((p) => [p, z.string().trim().regex(/^[a-z0-9_]{0,512}$/, 'Template names use lower-case letters, digits and _')])) as Record<MessagePurpose, z.ZodString>).partial(),
  }).partial().optional(),
  clearSecrets: z.array(z.enum(SECRET_PATHS)).max(SECRET_PATHS.length).optional(),
})
export type PlatformConfigPatch = z.infer<typeof platformConfigPatchSchema>

/** Merge a patch into the stored config. Returns the dotted paths that changed (no values) and the row id. */
export async function savePlatformConfig(patch: PlatformConfigPatch): Promise<{ changed: string[]; id: string | null }> {
  const { value: stored } = await loadStored()
  const before = JSON.stringify(stored)
  const { clearSecrets, ...rest } = patch
  const incoming = structuredClone(rest) as Obj
  const secretUpdates = new Map<string, string>()
  for (const p of SECRET_PATHS) {
    const v = getPath(incoming, p)
    if (typeof v === 'string' && v.trim()) secretUpdates.set(p, v.trim())
    // never merge a secret from the body directly (blank = keep)
    const parent = p.split('.').slice(0, -1).join('.')
    const holder = getPath(incoming, parent)
    if (holder && typeof holder === 'object') delete (holder as Obj)[p.split('.').pop()!]
  }
  const next = deepMerge(stored, incoming) as unknown as Obj
  for (const [p, v] of secretUpdates) setPath(next, p, encryptSecret(v))
  for (const p of clearSecrets ?? []) setPath(next, p, '')

  const changed: string[] = []
  const walk = (a: unknown, b: unknown, path: string) => {
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      for (const k of new Set([...Object.keys(a as Obj), ...Object.keys(b as Obj)])) walk((a as Obj)[k], (b as Obj)[k], path ? `${path}.${k}` : k)
    } else if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(path)
  }
  walk(JSON.parse(before), next, '')
  if (!changed.length) return { changed, id: null }

  const now = new Date()
  const [row] = await db.insert(systemSettings)
    .values({ key: MESSAGING_SETTING_KEY, value: next, description: 'Platform SMS gateway and WhatsApp Business account (secrets encrypted)' })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: next, updatedAt: now } })
    .returning({ id: systemSettings.id })
  return { changed, id: row.id }
}

/* ------------------------------------------------------------------ credentials for sending */

/** The platform SMS account, or null when no provider is chosen or a required field is missing. */
export function platformSmsCreds(cfg: PlatformMessagingConfig): SmsCreds | null {
  const s = cfg.sms
  switch (s.provider) {
    case 'notify_lk':
      return s.notify_lk.userId && s.notify_lk.apiKey && s.notify_lk.senderId ? { provider: 'notify_lk', creds: { ...s.notify_lk } } : null
    case 'text_lk':
      return s.text_lk.apiToken && s.text_lk.senderId ? { provider: 'text_lk', creds: { ...s.text_lk } } : null
    case 'websms_lk':
      return s.websms_lk.apiKey && s.websms_lk.apiToken && s.websms_lk.senderId ? { provider: 'websms_lk', creds: { ...s.websms_lk } } : null
    case 'twilio':
      return s.twilio.accountSid && s.twilio.authToken && s.twilio.fromNumber ? { provider: 'twilio', creds: { ...s.twilio } } : null
    case 'generic_http': {
      const g = s.generic_http
      return g.url ? { provider: 'generic_http', creds: { ...g, staticParams: g.staticParams ?? [] } } : null
    }
    default:
      return null
  }
}

export function platformWhatsAppCreds(cfg: PlatformMessagingConfig): WhatsAppCreds | null {
  const w = cfg.whatsapp
  if (!w.enabled || !w.phoneNumberId || !w.accessToken) return null
  return { phoneNumberId: w.phoneNumberId, accessToken: w.accessToken, businessAccountId: w.businessAccountId || undefined, apiVersion: w.apiVersion || 'v21.0' }
}
