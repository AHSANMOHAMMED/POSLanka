// SMS / WhatsApp through the business's messaging plan (GET /api/messaging, POST /api/messaging/send-receipt).
// Without a plan the receipt screen keeps the free WhatsApp share link.
import { useEffect, useState } from 'react'
import { apiGet, apiPost } from './api'

export interface MessagingAvailability { sms: boolean; whatsapp: boolean }

let cached: { value: MessagingAvailability; at: number } | null = null
const TTL_MS = 2 * 60 * 1000
const NONE: MessagingAvailability = { sms: false, whatsapp: false }

export async function loadMessagingAvailability(force = false): Promise<MessagingAvailability> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.value
  const res = await apiGet<{ available?: MessagingAvailability }>('/api/messaging')
  if (res.ok && res.data?.available) {
    cached = { value: res.data.available, at: Date.now() }
    return cached.value
  }
  return cached?.value ?? NONE
}

export function clearMessagingAvailability() {
  cached = null
}

export function useMessagingAvailability(enabled: boolean): MessagingAvailability {
  const [value, setValue] = useState<MessagingAvailability>(cached?.value ?? NONE)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    loadMessagingAvailability().then((v) => { if (alive) setValue(v) })
    return () => { alive = false }
  }, [enabled])
  return value
}

export interface SendReceiptResult { ok: boolean; code?: string; error?: string }

/** Codes for which the plan cannot send now: the app offers the free share link instead. */
export const FALLBACK_CODES = ['NOT_SUBSCRIBED', 'CHANNEL_DISABLED', 'NO_CREDIT', 'QUOTA_EXHAUSTED', 'SUBSCRIPTION_EXPIRED', 'PROVIDER_NOT_CONFIGURED']

export async function sendReceiptMessage(saleId: string, channel: 'sms' | 'whatsapp', phone?: string): Promise<SendReceiptResult> {
  const res = await apiPost<{ ok?: boolean; code?: string; error?: string }>('/api/messaging/send-receipt', {
    saleId,
    channel,
    phone: phone?.trim() || undefined,
  })
  if (res.ok && res.data?.ok) return { ok: true }
  // a refusal means the balance changed: re-check next time
  if (res.data?.code && FALLBACK_CODES.includes(res.data.code)) cached = null
  return { ok: false, code: res.data?.code, error: res.data?.error || res.error || 'Could not send' }
}
