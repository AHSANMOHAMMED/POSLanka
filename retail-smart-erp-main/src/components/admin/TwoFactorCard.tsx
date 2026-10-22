'use client'

import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { AdminCard, Alert, Badge, Button, Field, Input, Skeleton } from '@/components/admin/kit'
import { adminFetch } from '@/components/admin/console-helpers'

interface Status {
  enabled: boolean
  required: boolean
  email?: string
}

/**
 * Two-factor (TOTP) enrolment for the signed-in platform admin.
 * Flow: set up → scan the QR code in an authenticator app → enter a code → enabled.
 */
export function TwoFactorCard({ onChange }: { onChange?: (enabled: boolean) => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      setStatus(await adminFetch<Status>('/api/sys-control/auth/2fa'))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load two-factor status')
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function post(action: 'setup' | 'enable' | 'disable') {
    setBusy(true)
    setMessage(null)
    try {
      const data = await adminFetch<{ secret?: string; qrDataUrl?: string; enabled?: boolean }>('/api/sys-control/auth/2fa', {
        method: 'POST',
        json: { action, code: code || undefined },
      })
      if (action === 'setup') {
        setSetup({ secret: data.secret!, qrDataUrl: data.qrDataUrl! })
      } else {
        const enabled = action === 'enable'
        setStatus((s) => (s ? { ...s, enabled } : s))
        setSetup(null)
        setCode('')
        setMessage({ tone: 'success', text: enabled ? 'Two-factor authentication is on. You will be asked for a code at every sign-in.' : 'Two-factor authentication is off.' })
        onChange?.(enabled)
      }
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof Error ? e.message : 'Request failed' })
    } finally {
      setBusy(false)
    }
  }

  const codeInput = (id: string, placeholder: string) => (
    <Input
      id={id}
      code
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder={placeholder}
      wrapperClassName="w-full sm:w-44"
    />
  )

  return (
    <AdminCard
      title="Two-factor authentication"
      description={`Protects the console sign-in${status?.email ? ` for ${status.email}` : ''} with a 6-digit code from an authenticator app. Also used by the mobile companion.`}
      icon={<ShieldCheck size={17} />}
      actions={status ? (
        <span className="flex flex-wrap gap-1.5">
          <Badge tone={status.enabled ? 'success' : 'neutral'} dot>{status.enabled ? 'On' : 'Off'}</Badge>
          {status.required && <Badge tone="info">Required for you</Badge>}
        </span>
      ) : undefined}
    >
      <div className="space-y-4">
        {loadError ? (
          <Alert tone="danger" action={<Button size="sm" onClick={load}>Retry</Button>}>{loadError}</Alert>
        ) : !status ? (
          <Skeleton className="h-9 w-56" />
        ) : status.enabled ? (
          status.required ? (
            <p className="text-[13.5px] text-adm-muted">Two-factor authentication is required for your account, so it cannot be turned off here.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-[13.5px] text-adm-muted">To turn it off, enter a current code from your authenticator app.</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <Field label="Current code" htmlFor="totp-disable">{codeInput('totp-disable', '123456')}</Field>
                <Button variant="danger-soft" loading={busy} disabled={code.length !== 6} onClick={() => post('disable')}>Turn off</Button>
              </div>
            </div>
          )
        ) : setup ? (
          <div className="space-y-3">
            <p className="text-[13.5px] text-adm-muted">Scan this QR code with Google Authenticator, Microsoft Authenticator, Authy or 1Password, then enter the 6-digit code it shows.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={200} height={200} className="rounded-lg border border-adm-border bg-white p-2" />
            <p className="break-all font-mono text-[12.5px] text-adm-subtle">Setup key: {setup.secret}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Field label="6-digit code" htmlFor="totp-enable">{codeInput('totp-enable', '123456')}</Field>
              <div className="flex gap-2">
                <Button variant="primary" loading={busy} disabled={code.length !== 6} onClick={() => post('enable')}>Verify and turn on</Button>
                <Button variant="ghost" onClick={() => { setSetup(null); setCode('') }}>Cancel</Button>
              </div>
            </div>
          </div>
        ) : (
          <Button variant="primary" loading={busy} onClick={() => post('setup')}>Set up two-factor authentication</Button>
        )}
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
      </div>
    </AdminCard>
  )
}
