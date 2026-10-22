'use client'

import { useEffect, useRef, useState } from 'react'
import { KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react'
import { Alert, AuthHeading, AuthShell, BrandMark, Button, Field, Input, PasswordInput } from '@/components/admin/kit'

function minutesFrom(retryAfter: string | null): number | null {
  const s = retryAfter ? parseInt(retryAfter, 10) : NaN
  return Number.isFinite(s) && s > 0 ? Math.max(1, Math.ceil(s / 60)) : null
}

export function AdminLoginForm({ sessionExpired }: { sessionExpired?: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const totpRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (needsTotp) totpRef.current?.focus()
  }, [needsTotp])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (needsTotp && !/^\d{6}$/.test(totpCode)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/sys-control/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, totpCode: needsTotp ? totpCode : undefined }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.ok) {
        // Full navigation so the protected layout reads the new session cookie
        window.location.href = '/sys-control'
        return
      }
      if (res.status === 428) {
        setNeedsTotp(true)
        setError('')
      } else if (res.status === 401 && data?.requires2fa) {
        setNeedsTotp(true)
        setTotpCode('')
        setError('That code didn’t work. Codes change every 30 seconds — try the current one.')
      } else if (res.status === 429) {
        const mins = minutesFrom(res.headers.get('Retry-After'))
        setError(`Too many sign-in attempts from this network. Try again ${mins ? `in ${mins} minute${mins === 1 ? '' : 's'}` : 'later'}.`)
      } else if (res.status === 400) {
        setError(data?.error || 'Check your email and password and try again.')
      } else {
        setError(data?.error || 'Sign-in failed. Please try again.')
      }
    } catch {
      setError('Can’t reach the server. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell aside={null} mobileHeader={<BrandMark subtitle="Platform admin" />}>
      <div className="rounded-2xl border border-adm-border bg-adm-surface p-6 shadow-[var(--adm-shadow-lg)] sm:p-8">
        <AuthHeading
          title={needsTotp ? 'Two-factor verification' : 'Sign in to the admin console'}
          description={
            needsTotp
              ? 'Enter the 6-digit code from the authenticator app linked to this account.'
              : 'For POSLanka platform administrators only.'
          }
        />

        {sessionExpired && !error && (
          <Alert tone="info" className="mb-5">You were signed out after 15 minutes of inactivity.</Alert>
        )}
        {error && <Alert tone="danger" className="mb-5">{error}</Alert>}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className={needsTotp ? 'hidden' : 'space-y-4'}>
            <Field label="Email" htmlFor="admin-email">
              <Input
                id="admin-email"
                type="email"
                leftIcon={Mail}
                size="lg"
                autoComplete="username"
                placeholder="name@poslanka.lk"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field label="Password" htmlFor="admin-password">
              <PasswordInput
                id="admin-password"
                leftIcon={Lock}
                size="lg"
                autoComplete="current-password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
          </div>

          {needsTotp && (
            <Field label="Authentication code" htmlFor="admin-totp" hint={<>Signing in as <span className="font-medium text-adm-fg">{email}</span></>}>
              <Input
                ref={totpRef}
                id="admin-totp"
                leftIcon={KeyRound}
                size="lg"
                code
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                placeholder="000000"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              />
            </Field>
          )}

          <Button type="submit" variant="primary" size="lg" fullWidth loading={loading} disabled={!email || !password}>
            {loading ? 'Signing in…' : needsTotp ? 'Verify and sign in' : 'Sign in'}
          </Button>

          {needsTotp && (
            <Button
              variant="ghost"
              fullWidth
              onClick={() => {
                setNeedsTotp(false)
                setTotpCode('')
                setError('')
              }}
            >
              Use a different account
            </Button>
          )}
        </form>
      </div>

      <p className="mt-6 text-center text-[12.5px] leading-relaxed text-adm-subtle">
        <ShieldCheck size={14} className="mr-1 inline-block align-[-2px]" aria-hidden />
        Five wrong passwords lock the account for 30 minutes. Turn on two-factor sign-in under Settings.
      </p>
    </AuthShell>
  )
}
