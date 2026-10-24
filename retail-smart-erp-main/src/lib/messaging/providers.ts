/**
 * SMS / WhatsApp provider adapters. Each takes plain (decrypted) credentials and returns a
 * ProviderResult with a stable `code` the rest of the app can act on. Server-only.
 *
 * Outbound HTTP goes through messagingFetch(): fetchWithTimeout normally; tests install a fake with
 * setMessagingFetchForTests(); MESSAGING_DRY_RUN=1 skips the network and reports success.
 *
 *   SMS        notify_lk (Notify.lk)  text_lk (Text.lk)  websms_lk (WebSMS.lk / Newsletters.lk)
 *              twilio  generic_http (any gateway with an HTTP API)
 *   WhatsApp   Meta WhatsApp Business Cloud API (text, or an approved template)
 */
import { fetchWithTimeout } from '@/lib/utils/fetch-timeout'
import { isLankanMobile } from './phone'

export const SMS_PROVIDERS = ['notify_lk', 'text_lk', 'websms_lk', 'twilio', 'generic_http'] as const
export type SmsProviderKey = (typeof SMS_PROVIDERS)[number]

export const SMS_PROVIDER_LABELS: Record<SmsProviderKey, string> = {
  notify_lk: 'Notify.lk',
  text_lk: 'Text.lk',
  websms_lk: 'WebSMS.lk / Newsletters.lk',
  twilio: 'Twilio',
  generic_http: 'Other HTTP gateway',
}

/** Result codes used across the messaging service (also returned to the client). */
export type MessagingCode =
  | 'OK'
  | 'INVALID_NUMBER'
  | 'NOT_SUBSCRIBED'
  | 'CHANNEL_DISABLED'
  | 'FEATURE_DISABLED'
  | 'SUBSCRIPTION_EXPIRED'
  | 'NO_CREDIT'
  | 'QUOTA_EXHAUSTED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'OWN_PROVIDER_NOT_CONFIGURED'
  | 'AUTH_FAILED'
  | 'PROVIDER_REJECTED'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'

export interface ProviderResult {
  ok: boolean
  code: MessagingCode
  error?: string
  messageId?: string
  httpStatus?: number
  /** provider's own error code, when it sends one */
  providerCode?: string
  raw?: unknown
}

export interface NotifyLkCreds { userId: string; apiKey: string; senderId: string }
export interface TextLkCreds { apiToken: string; senderId: string }
export interface WebSmsCreds { apiKey: string; apiToken: string; senderId: string }
export interface TwilioCreds { accountSid: string; authToken: string; fromNumber: string }
export interface GenericHttpCreds {
  url: string
  method: 'GET' | 'POST'
  recipientParam: string
  messageParam: string
  senderParam?: string
  senderId?: string
  apiKeyParam?: string
  apiKey?: string
  staticParams?: Array<{ key: string; value: string }>
  /** a response body containing this text means success (optional; HTTP 2xx otherwise) */
  successMatch?: string
}

export type SmsCreds =
  | { provider: 'notify_lk'; creds: NotifyLkCreds }
  | { provider: 'text_lk'; creds: TextLkCreds }
  | { provider: 'websms_lk'; creds: WebSmsCreds }
  | { provider: 'twilio'; creds: TwilioCreds }
  | { provider: 'generic_http'; creds: GenericHttpCreds }

export interface WhatsAppCreds {
  phoneNumberId: string
  accessToken: string
  businessAccountId?: string
  apiVersion?: string
}

export interface WhatsAppTemplate {
  name: string
  language: string
  /** body variables {{1}}, {{2}} … in order */
  params: string[]
  namespace?: string
}

/* ------------------------------------------------------------------ outbound HTTP */

type FetchFn = (url: string, init: RequestInit) => Promise<Response>

declare global {
  var __messagingFetch: FetchFn | undefined
}

/** Tests only: route every provider call through `fn` (null restores real HTTP). */
export function setMessagingFetchForTests(fn: FetchFn | null): void {
  globalThis.__messagingFetch = fn ?? undefined
}

async function messagingFetch(url: string, init: RequestInit): Promise<Response> {
  if (globalThis.__messagingFetch) return globalThis.__messagingFetch(url, init)
  if (process.env.MESSAGING_DRY_RUN === '1') {
    return new Response(JSON.stringify({ status: 'success', dryRun: true, messages: [{ id: `dry-${Date.now()}` }], data: { uid: `dry-${Date.now()}` }, sid: `dry-${Date.now()}` }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return fetchWithTimeout(url, init)
}

function networkFailure(error: unknown): ProviderResult {
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') {
    return { ok: false, code: 'TIMEOUT', error: 'The provider did not answer in time' }
  }
  return { ok: false, code: 'NETWORK_ERROR', error: error instanceof Error ? error.message : 'Could not reach the provider' }
}

async function readBody(res: Response): Promise<{ text: string; json: Record<string, unknown> | null }> {
  const text = await res.text().catch(() => '')
  try {
    const parsed = JSON.parse(text)
    return { text, json: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null }
  } catch {
    return { text, json: null }
  }
}

function httpFailure(status: number, message: string, providerCode?: string, raw?: unknown): ProviderResult {
  const code: MessagingCode = status === 401 || status === 403 ? 'AUTH_FAILED' : status >= 500 ? 'PROVIDER_ERROR' : 'PROVIDER_REJECTED'
  return { ok: false, code, error: message.slice(0, 500), httpStatus: status, providerCode, raw }
}

const str = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v))

/* ------------------------------------------------------------------ SMS */

/** Local aggregators only deliver to Sri Lankan mobiles. */
function needsLankan(provider: SmsProviderKey): boolean {
  return provider === 'notify_lk' || provider === 'text_lk' || provider === 'websms_lk'
}

/**
 * Send one SMS. `to` is already normalised (normalizeMsisdn); `sender` overrides the account's
 * sender ID (a vendor's own approved mask).
 */
export async function sendSmsVia(cfg: SmsCreds, to: string, text: string, sender?: string | null): Promise<ProviderResult> {
  if (needsLankan(cfg.provider) && !isLankanMobile(to)) {
    return { ok: false, code: 'INVALID_NUMBER', error: 'This gateway delivers to Sri Lankan mobile numbers (07X XXX XXXX) only' }
  }
  const unicode = /[^\x00-\x7F]/.test(text)
  try {
    switch (cfg.provider) {
      case 'notify_lk': {
        // https://developer.notify.lk/api-endpoints/  GET /api/v1/send
        const c = cfg.creds
        const q = new URLSearchParams({ user_id: c.userId, api_key: c.apiKey, sender_id: sender || c.senderId, to, message: text })
        if (unicode) q.set('type', 'unicode')
        const res = await messagingFetch(`https://app.notify.lk/api/v1/send?${q.toString()}`, { method: 'GET', headers: { accept: 'application/json' } })
        const { text: body, json } = await readBody(res)
        if (res.ok && json?.status === 'success') {
          const data = json.data as Record<string, unknown> | string | undefined
          return { ok: true, code: 'OK', messageId: typeof data === 'object' && data ? str(data.message_id ?? data.id) || undefined : undefined, httpStatus: res.status, raw: json }
        }
        const msg = str(json?.errors ?? json?.message ?? json?.data) || body || `HTTP ${res.status}`
        const auth = /api.?key|user.?id|unauthori[sz]ed|invalid credentials/i.test(msg)
        return auth ? { ok: false, code: 'AUTH_FAILED', error: msg, httpStatus: res.status, raw: json ?? body } : httpFailure(res.ok ? 400 : res.status, msg, undefined, json ?? body)
      }

      case 'text_lk': {
        // https://text.lk/docs  POST /api/v3/sms/send (Bearer token)
        const c = cfg.creds
        const res = await messagingFetch('https://app.text.lk/api/v3/sms/send', {
          method: 'POST',
          headers: { authorization: `Bearer ${c.apiToken}`, accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ recipient: to, sender_id: sender || c.senderId, type: unicode ? 'unicode' : 'plain', message: text }),
        })
        const { text: body, json } = await readBody(res)
        if (res.ok && json?.status === 'success') {
          const data = (json.data ?? {}) as Record<string, unknown>
          return { ok: true, code: 'OK', messageId: str(data.uid ?? data.id) || undefined, httpStatus: res.status, raw: json }
        }
        const msg = str(json?.message) || body || `HTTP ${res.status}`
        if (res.status === 401 || /unauthenticated|token/i.test(msg)) return { ok: false, code: 'AUTH_FAILED', error: msg, httpStatus: res.status, raw: json ?? body }
        return httpFailure(res.ok ? 400 : res.status, msg, undefined, json ?? body)
      }

      case 'websms_lk': {
        // WebSMS.lk / Newsletters.lk smsAPI (form POST); success "0|<id>|<credits>" or JSON status success
        const c = cfg.creds
        const form = new URLSearchParams({ sendsms: '', apikey: c.apiKey, apitoken: c.apiToken, type: unicode ? 'unicode' : 'sms', from: sender || c.senderId, to, text })
        const res = await messagingFetch('https://app.newsletters.lk/smsAPI', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        })
        const { text: body, json } = await readBody(res)
        const parts = body.split('|').map((p) => p.trim())
        if (res.ok && (parts[0] === '0' || body.startsWith('1701') || json?.status === 'success' || json?.status === 'queued')) {
          return { ok: true, code: 'OK', messageId: parts[1] || str(json?.campaign_id ?? json?.group_id) || undefined, httpStatus: res.status, raw: json ?? body }
        }
        const msg = str(json?.message) || parts[1] || body || `HTTP ${res.status}`
        return /api.?key|token|auth/i.test(msg)
          ? { ok: false, code: 'AUTH_FAILED', error: msg, providerCode: parts[0], raw: json ?? body }
          : httpFailure(res.ok ? 400 : res.status, msg, parts[0], json ?? body)
      }

      case 'twilio': {
        const c = cfg.creds
        const res = await messagingFetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.accountSid)}/Messages.json`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            authorization: 'Basic ' + Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64'),
          },
          body: new URLSearchParams({ To: `+${to}`, From: c.fromNumber, Body: text }).toString(),
        })
        const { text: body, json } = await readBody(res)
        if (res.ok && json?.sid) return { ok: true, code: 'OK', messageId: str(json.sid), httpStatus: res.status, raw: json }
        return httpFailure(res.status, str(json?.message) || body || `HTTP ${res.status}`, str(json?.code) || undefined, json ?? body)
      }

      case 'generic_http': {
        const c = cfg.creds
        const params = new URLSearchParams()
        for (const p of c.staticParams ?? []) if (p.key) params.set(p.key, p.value ?? '')
        if (c.apiKeyParam && c.apiKey) params.set(c.apiKeyParam, c.apiKey)
        if (c.senderParam && (sender || c.senderId)) params.set(c.senderParam, (sender || c.senderId)!)
        params.set(c.recipientParam || 'to', to)
        params.set(c.messageParam || 'text', text)
        let url = c.url
        const init: RequestInit = { method: c.method }
        if (c.method === 'GET') url = `${url}${url.includes('?') ? '&' : '?'}${params.toString()}`
        else {
          init.headers = { 'content-type': 'application/x-www-form-urlencoded' }
          init.body = params.toString()
        }
        const res = await messagingFetch(url, init)
        const { text: body, json } = await readBody(res)
        const success = res.ok && (c.successMatch ? body.includes(c.successMatch) : !/error|fail|invalid/i.test(body))
        if (success) {
          return { ok: true, code: 'OK', messageId: str(json?.id ?? json?.messageId ?? json?.message_id ?? json?.msgid) || undefined, httpStatus: res.status, raw: json ?? body }
        }
        return httpFailure(res.ok ? 400 : res.status, str(json?.error ?? json?.message) || body || `HTTP ${res.status}`, undefined, json ?? body)
      }
    }
  } catch (error) {
    return networkFailure(error)
  }
}

/* ------------------------------------------------------------------ WhatsApp (Meta Cloud API) */

/** Meta error codes worth telling apart (https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes) */
function metaCode(code: number | undefined, status: number): MessagingCode {
  if (code === 190 || code === 0 || code === 10 || code === 200 || status === 401) return 'AUTH_FAILED'
  if (code === 131026 || code === 131030 || code === 100) return 'INVALID_NUMBER' // not on WhatsApp / not in allowed list / bad param
  if (code === 131047) return 'PROVIDER_REJECTED' // outside the 24-hour window: a template is required
  if (status >= 500) return 'PROVIDER_ERROR'
  return 'PROVIDER_REJECTED'
}

export async function sendWhatsAppVia(
  creds: WhatsAppCreds,
  to: string,
  message: { text: string } | { template: WhatsAppTemplate },
): Promise<ProviderResult> {
  const version = creds.apiVersion || 'v21.0'
  const payload: Record<string, unknown> = { messaging_product: 'whatsapp', recipient_type: 'individual', to }
  if ('template' in message) {
    const t = message.template
    payload.type = 'template'
    payload.template = {
      name: t.name,
      language: { code: t.language || 'en' },
      ...(t.namespace ? { namespace: t.namespace } : {}),
      components: t.params.length ? [{ type: 'body', parameters: t.params.map((p) => ({ type: 'text', text: p || '-' })) }] : [],
    }
  } else {
    payload.type = 'text'
    payload.text = { preview_url: true, body: message.text }
  }
  try {
    const res = await messagingFetch(`https://graph.facebook.com/${version}/${encodeURIComponent(creds.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${creds.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const { text: body, json } = await readBody(res)
    const messages = json?.messages as Array<{ id?: string }> | undefined
    if (res.ok && messages?.[0]?.id) return { ok: true, code: 'OK', messageId: messages[0].id, httpStatus: res.status, raw: json }
    const err = (json?.error ?? {}) as { message?: string; code?: number; error_data?: { details?: string } }
    const msg = [err.message, err.error_data?.details].filter(Boolean).join(' — ') || body || `HTTP ${res.status}`
    return { ok: false, code: metaCode(err.code, res.status), error: msg.slice(0, 500), httpStatus: res.status, providerCode: err.code !== undefined ? String(err.code) : undefined, raw: json ?? body }
  } catch (error) {
    return networkFailure(error)
  }
}
