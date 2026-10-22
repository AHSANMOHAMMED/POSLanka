'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { AdminCard, AdminPage, Alert, Button, Field, PasswordInput } from '@/components/admin/kit'
import { TwoFactorCard } from '@/components/admin/TwoFactorCard'
import { adminFetch } from '@/components/admin/console-helpers'

/** Change-password form for the signed-in admin (Settings → Security and the forced-change gate). */
export function ChangePasswordCard({ onDone, title = 'Change your password', description }: { onDone?: () => void; title?: string; description?: string }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const policyError = next && (next.length < 10 || !/[A-Za-z]/.test(next) || !/\d/.test(next))
    ? 'Use at least 10 characters with a letter and a number.'
    : null
  const mismatch = confirm && next !== confirm ? 'The passwords do not match.' : null
  const canSubmit = !!current && !!next && !policyError && next === confirm && !busy

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await adminFetch('/api/sys-control/users/me/password', { method: 'POST', json: { currentPassword: current, newPassword: next } })
      setCurrent(''); setNext(''); setConfirm('')
      setDone(true)
      onDone?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the password')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminCard title={title} description={description ?? 'Your other signed-in sessions are ended when the password changes.'} icon={<KeyRound size={17} />}>
      <form onSubmit={submit} className="max-w-md space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {done && !error && <Alert tone="success">Password changed.</Alert>}
        <Field label="Current password" htmlFor="pw-current" required>
          <PasswordInput id="pw-current" autoComplete="current-password" value={current} onChange={(e) => { setCurrent(e.target.value); setDone(false) }} />
        </Field>
        <Field label="New password" htmlFor="pw-new" required error={policyError} hint="At least 10 characters with a letter and a number.">
          <PasswordInput id="pw-new" autoComplete="new-password" value={next} invalid={!!policyError} onChange={(e) => { setNext(e.target.value); setDone(false) }} />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm" required error={mismatch}>
          <PasswordInput id="pw-confirm" autoComplete="new-password" value={confirm} invalid={!!mismatch} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" loading={busy} disabled={!canSubmit}>Change password</Button>
      </form>
    </AdminCard>
  )
}

/**
 * Shown instead of the console when another admin reset this admin's password (must choose a
 * new one) or requires two-factor authentication that is not set up yet.
 */
export function AccountSetupGate({ mode }: { mode: 'password' | 'totp' }) {
  const router = useRouter()
  return (
    <AdminPage
      title={mode === 'password' ? 'Choose a new password' : 'Set up two-factor authentication'}
      description={
        mode === 'password'
          ? 'Your password was set by another administrator. Choose your own password to continue.'
          : 'Two-factor authentication is required for your account. Set it up to continue using the console.'
      }
    >
      <div className="max-w-2xl space-y-4">
        {mode === 'password' ? (
          <ChangePasswordCard
            title="New password"
            description="Enter the temporary password you were given, then your new password."
            onDone={() => router.refresh()}
          />
        ) : (
          <>
            <Alert tone="info" title="Why am I seeing this?">
              <span className="inline-flex items-center gap-1"><ShieldCheck size={14} aria-hidden /> An administrator turned on the two-factor requirement for your account.</span>
            </Alert>
            <TwoFactorCard onChange={(enabled) => { if (enabled) router.refresh() }} />
          </>
        )}
      </div>
    </AdminPage>
  )
}
