'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Loader2, MessageCircle, MessageSquare } from 'lucide-react'
import { sharedJson } from '@/lib/client/shared-fetch'

export interface MessagingAvailability { sms: boolean; whatsapp: boolean }

/** Whether the business can send SMS / WhatsApp through its messaging plan (shared, cached 60 s). */
export function useMessagingAvailability(): MessagingAvailability {
  const [a, setA] = useState<MessagingAvailability>({ sms: false, whatsapp: false })
  useEffect(() => {
    let cancelled = false
    sharedJson<{ available?: MessagingAvailability }>('/api/messaging', { maxAgeMs: 60_000 })
      .then((d) => { if (!cancelled && d?.available) setA(d.available) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])
  return a
}

interface Props {
  saleId: string
  defaultPhone?: string | null
  availability: MessagingAvailability
  /** Free wa.me share (used when WhatsApp is not in the plan) */
  onShareWhatsApp?: (phone: string) => void
  compact?: boolean
}

/**
 * "Send SMS" / "Send WhatsApp" through the server when the business has a messaging plan; otherwise
 * only the free WhatsApp share link (opens WhatsApp on this device).
 */
export function SendReceiptButtons({ saleId, defaultPhone, availability, onShareWhatsApp, compact }: Props) {
  const [phone, setPhone] = useState(defaultPhone || '')
  const [pending, setPending] = useState<'sms' | 'whatsapp' | 'share' | null>(null)
  const [busy, setBusy] = useState<'sms' | 'whatsapp' | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function send(channel: 'sms' | 'whatsapp', to: string) {
    setBusy(channel); setResult(null)
    try {
      const res = await fetch('/api/messaging/send-receipt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ saleId, channel, phone: to || undefined }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.ok) {
        setResult({ ok: true, text: `${channel === 'sms' ? 'SMS' : 'WhatsApp'} sent` })
        setPending(null)
      } else if (channel === 'whatsapp' && onShareWhatsApp && ['NOT_SUBSCRIBED', 'CHANNEL_DISABLED', 'NO_CREDIT', 'QUOTA_EXHAUSTED', 'SUBSCRIPTION_EXPIRED', 'PROVIDER_NOT_CONFIGURED'].includes(body.code)) {
        // plan can't send → free share link instead
        onShareWhatsApp(to)
        setPending(null)
      } else {
        setResult({ ok: false, text: body.error || 'Could not send' })
      }
    } catch {
      setResult({ ok: false, text: 'No connection' })
    } finally {
      setBusy(null)
    }
  }

  function start(kind: 'sms' | 'whatsapp' | 'share') {
    const to = phone.trim()
    if (!to && pending !== kind) { setPending(kind); return }
    // the free share link also works without a number (WhatsApp asks for the chat)
    if (kind === 'share') { onShareWhatsApp?.(to); setPending(null); return }
    if (to) void send(kind, to)
  }

  const btn = compact
    ? 'px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors disabled:opacity-60'
    : 'w-full py-3 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] disabled:opacity-60'
  const showShare = !availability.whatsapp && !!onShareWhatsApp

  return (
    <div className="space-y-1.5">
      <div className={compact ? 'flex flex-wrap gap-1.5' : 'space-y-2'}>
        {availability.sms && (
          <button type="button" disabled={!!busy} onClick={() => start('sms')} className={`${btn} bg-blue-600 hover:bg-blue-700 text-white`} title="Send the bill by SMS">
            {busy === 'sms' ? <Loader2 size={compact ? 13 : 18} className="animate-spin" /> : <MessageSquare size={compact ? 13 : 18} />}
            {compact ? 'SMS' : 'Send via SMS'}
          </button>
        )}
        {availability.whatsapp && (
          <button type="button" disabled={!!busy} onClick={() => start('whatsapp')} className={`${btn} bg-emerald-600 hover:bg-emerald-700 text-white`} title="Send the bill on WhatsApp">
            {busy === 'whatsapp' ? <Loader2 size={compact ? 13 : 18} className="animate-spin" /> : <MessageCircle size={compact ? 13 : 18} />}
            {compact ? 'WhatsApp' : 'Send via WhatsApp'}
          </button>
        )}
        {showShare && (
          <button type="button" onClick={() => start('share')} className={`${btn} bg-emerald-600 hover:bg-emerald-700 text-white`} title="Share bill via WhatsApp">
            <MessageCircle size={compact ? 13 : 18} />
            {compact ? 'WhatsApp' : 'Share via WhatsApp'}
          </button>
        )}
      </div>

      {pending && (
        <div className="flex items-center gap-1.5 pt-1">
          <input
            type="tel"
            placeholder="Mobile number, e.g. 0771234567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && phone.trim()) start(pending) }}
            className="flex-1 text-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white font-mono"
            autoFocus
          />
          <button
            type="button"
            disabled={(!phone.trim() && pending !== 'share') || !!busy}
            onClick={() => start(pending)}
            className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 flex items-center gap-1 disabled:opacity-60"
          >
            Send <ArrowRight size={12} />
          </button>
        </div>
      )}
      {result && <p className={`text-xs ${result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`} role="status">{result.text}</p>}
    </div>
  )
}
