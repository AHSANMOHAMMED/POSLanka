'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck, Loader2 } from 'lucide-react'

/**
 * Super-admin two-factor (TOTP) enrolment card for /sys-control/settings.
 * Flow: setup → scan QR in Google Authenticator / Authy → enter code → enabled.
 */
export function TwoFactorCard({ cardClass }: { cardClass: string }) {
  const [loading, setLoading] = useState(true)
  const [enabled, setEnabled] = useState(false)
  const [email, setEmail] = useState('')
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/sys-control/auth/2fa')
      .then((r) => r.json())
      .then((d) => { setEnabled(!!d.enabled); setEmail(d.email || '') })
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [])

  async function post(action: 'setup' | 'enable' | 'disable') {
    setBusy(true); setMessage(null)
    try {
      const res = await fetch('/api/sys-control/auth/2fa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, code: code || undefined }),
      })
      const data = await res.json()
      if (!res.ok) { setMessage({ type: 'error', text: data.error || 'Failed' }); return }
      if (action === 'setup') setSetup({ secret: data.secret, qrDataUrl: data.qrDataUrl })
      if (action === 'enable') { setEnabled(true); setSetup(null); setCode(''); setMessage({ type: 'ok', text: 'Two-factor authentication is now required for this account.' }) }
      if (action === 'disable') { setEnabled(false); setCode(''); setMessage({ type: 'ok', text: 'Two-factor authentication disabled.' }) }
    } catch {
      setMessage({ type: 'error', text: 'Network error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={cardClass}>
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <ShieldCheck className="w-5 h-5" />
          Two-factor authentication (TOTP)
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Protects the super-admin login ({email || 'this account'}) with a 6-digit code from an authenticator app. Also required for the mobile companion.
        </p>
      </div>
      <div className="p-6 space-y-4">
        {loading ? (
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        ) : enabled ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Enabled</p>
            <div className="flex items-center gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="Current code" className="w-40 px-3 py-2 border rounded dark:bg-gray-900 dark:border-gray-700" />
              <button type="button" disabled={busy || code.length !== 6} onClick={() => post('disable')} className="px-4 py-2 rounded bg-red-600 text-white text-sm font-medium disabled:opacity-50">Disable</button>
            </div>
          </div>
        ) : setup ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">Scan this QR code with Google Authenticator, Authy or 1Password, then enter the 6-digit code.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qrDataUrl} alt="TOTP QR code" width={220} height={220} className="rounded border bg-white p-2" />
            <p className="text-xs font-mono text-gray-500 break-all">Manual key: {setup.secret}</p>
            <div className="flex items-center gap-2">
              <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6-digit code" className="w-40 px-3 py-2 border rounded dark:bg-gray-900 dark:border-gray-700" />
              <button type="button" disabled={busy || code.length !== 6} onClick={() => post('enable')} className="px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium disabled:opacity-50">Verify & enable</button>
              <button type="button" onClick={() => { setSetup(null); setCode('') }} className="px-3 py-2 text-sm text-gray-500">Cancel</button>
            </div>
          </div>
        ) : (
          <button type="button" disabled={busy} onClick={() => post('setup')} className="px-4 py-2 rounded bg-slate-900 text-white text-sm font-medium disabled:opacity-50">
            {busy ? 'Preparing…' : 'Set up two-factor authentication'}
          </button>
        )}
        {message && <p className={`text-sm ${message.type === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>{message.text}</p>}
      </div>
    </div>
  )
}
