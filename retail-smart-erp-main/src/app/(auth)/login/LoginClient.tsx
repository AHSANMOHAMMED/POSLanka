'use client'

import { Suspense, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight, Building2, Lock, Mail, X } from 'lucide-react'
import { broadcastAuthEvent } from '@/lib/auth/events'
import {
  Alert,
  AuthHeading,
  AuthShell,
  Button,
  Field,
  Input,
  PasswordInput,
  SegmentedControl,
} from '@/components/admin/kit'

type Mode = 'staff' | 'owner'

interface RecentCompany {
  slug: string
  name: string
  logoUrl: string | null
}

const RECENT_KEY = 'poslanka:last-company'

function parseRecent(raw: string | null): RecentCompany | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return v && typeof v.slug === 'string' && typeof v.name === 'string' ? v : null
  } catch {
    return null
  }
}

function readRecentRaw(): string | null {
  try {
    return localStorage.getItem(RECENT_KEY)
  } catch {
    return null
  }
}

const noopSubscribe = () => () => {}

function CompanyAvatar({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const [broken, setBroken] = useState(false)
  if (logoUrl && !broken) {
    return (
      <Image src={logoUrl} alt="" width={36} height={36} unoptimized onError={() => setBroken(true)} className="h-9 w-9 rounded-lg border border-adm-border bg-white object-contain" />
    )
  }
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  return <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-adm-primary-soft text-[13px] font-semibold text-adm-primary-soft-fg">{initials || '•'}</span>
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const registered = searchParams.get('registered') === 'true'
  const [mode, setMode] = useState<Mode>(registered || searchParams.get('tab') === 'account' ? 'owner' : 'staff')
  // Remembered company (per browser); null during SSR so the markup stays stable
  const recentRaw = useSyncExternalStore(noopSubscribe, readRecentRaw, () => null)
  const [recentDismissed, setRecentDismissed] = useState(false)
  const storedRecent = useMemo(() => parseRecent(recentRaw), [recentRaw])
  const recent = recentDismissed ? null : storedRecent

  // Business ID step
  const [identifier, setIdentifier] = useState(searchParams.get('company') ?? '')
  const [lookupError, setLookupError] = useState('')

  // Staff direct sign-in (Business ID + Email + Password in one step)
  const [staffEmail, setStaffEmail] = useState('')
  const [staffPassword, setStaffPassword] = useState('')
  const [staffLoading, setStaffLoading] = useState(false)

  // Owner account step
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Already signed in to the owner portal → go straight there
    let cancelled = false
    fetch('/api/account-auth/session')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.user?.id) router.replace('/account')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [router])

  const goToCompany = (c: RecentCompany) => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(c))
    } catch {
      // storage unavailable — not important
    }
    router.push(`/c/${encodeURIComponent(c.slug)}/login`)
  }

  async function handleStaffSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const rawBizId = identifier.trim()
    const rawEmail = staffEmail.trim()
    if (!rawBizId) {
      setLookupError('Enter your Business ID — your shop’s name, e.g. alisha-shop')
      return
    }
    if (!rawEmail) {
      setLookupError('Enter your staff email or username')
      return
    }
    if (!staffPassword) {
      setLookupError('Enter your password')
      return
    }

    setLookupError('')
    setStaffLoading(true)

    try {
      // First resolve Business ID or slug to get the canonical tenant
      const res = await fetch('/api/lookup-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: rawBizId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.tenant) {
        setLookupError(data?.error || 'Business ID not found. Please verify your Business ID.')
        setStaffLoading(false)
        return
      }

      // Save to recent
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(data.tenant))
      } catch {
        // ignore
      }

      // 1. Get CSRF token for company auth (/api/auth)
      const csrfRes = await fetch('/api/auth/csrf')
      const csrfData = await csrfRes.json().catch(() => ({}))
      const csrfToken = csrfData?.csrfToken || ''

      // 2. Perform company authentication directly against /api/auth
      const authRes = await fetch('/api/auth/callback/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Auth-Return-Redirect': '1',
        },
        body: new URLSearchParams({
          email: rawEmail,
          password: staffPassword,
          tenantSlug: data.tenant.slug,
          businessId: rawBizId,
          csrfToken,
          callbackUrl: `/c/${data.tenant.slug}/pos`,
          json: 'true',
        }),
      })

      const authData = await authRes.json().catch(() => ({}))
      const targetUrl = authData?.url || ''

      if (targetUrl.includes('error=') || !authRes.ok) {
        setLookupError(`Sign-in failed. Please verify your email and password for ${data.tenant.name}.`)
        setStaffLoading(false)
        return
      }

      broadcastAuthEvent('login', 'company')
      window.location.href = `/c/${data.tenant.slug}/pos`
    } catch {
      setLookupError('Could not connect. Please check your connection and try again.')
      setStaffLoading(false)
    }
  }

  async function handleOwnerSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = await signIn('credentials', { email: email.trim(), password, redirect: false })
      if (result?.error) {
        setError('That email and password don’t match an owner account.')
        setLoading(false)
      } else {
        broadcastAuthEvent('login', 'account')
        router.push('/account')
        router.refresh()
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <AuthShell
      footer={
        <>
          New to skyERPOS?{' '}
          <Link href="/register" className="font-medium text-adm-primary hover:underline">Create an account</Link>
        </>
      }
    >
      <AuthHeading
        title="Sign in"
        description={mode === 'staff' ? 'Enter your Business ID to open your company’s sign-in page.' : 'Business owners: manage your companies, billing and staff.'}
      />

      <SegmentedControl
        ariaLabel="Sign-in type"
        className="mb-6 flex w-full [&>button]:flex-1"
        value={mode}
        onChange={(m) => {
          setMode(m)
          setError('')
          setLookupError('')
        }}
        options={[
          { value: 'staff', label: 'Staff sign-in' },
          { value: 'owner', label: 'Owner account' },
        ]}
      />

      {mode === 'staff' ? (
        <div className="space-y-5">
          {recent && (
            <div className="flex items-center gap-3 rounded-xl border border-adm-border bg-adm-surface p-3">
              <CompanyAvatar name={recent.name} logoUrl={recent.logoUrl} />
              <button type="button" onClick={() => goToCompany(recent)} className="adm-focus min-w-0 flex-1 rounded-md text-left">
                <span className="block text-[12px] text-adm-subtle">Continue to</span>
                <span className="block truncate text-[14px] font-medium text-adm-fg">{recent.name}</span>
              </button>
              <Button variant="primary" size="sm" iconRight={ArrowRight} onClick={() => goToCompany(recent)}>
                Open
              </Button>
              <button
                type="button"
                aria-label={`Forget ${recent.name} on this device`}
                onClick={() => {
                  try { localStorage.removeItem(RECENT_KEY) } catch { /* ignore */ }
                  setRecentDismissed(true)
                }}
                className="adm-focus flex h-7 w-7 items-center justify-center rounded-md text-adm-subtle hover:bg-adm-surface-2 hover:text-adm-fg"
              >
                <X size={15} aria-hidden />
              </button>
            </div>
          )}

          {lookupError && <Alert tone="danger">{lookupError}</Alert>}

          <form onSubmit={handleStaffSignIn} className="space-y-4" noValidate>
            <Field
              label="Business ID"
              htmlFor="business-id"
              hint="Your shop’s name, e.g. alisha-shop (the PL-123456 number works too)."
            >
              <Input
                id="business-id"
                leftIcon={Building2}
                size="lg"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="e.g. alisha-shop"
                autoComplete="organization"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus={!recent}
                invalid={!!lookupError}
                required
              />
            </Field>

            <Field label="Username or email" htmlFor="staff-email">
              <Input
                id="staff-email"
                type="text"
                leftIcon={Mail}
                size="lg"
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
                placeholder="e.g. cashier1"
                autoComplete="username"
                required
              />
            </Field>

            <Field label="Password" htmlFor="staff-password">
              <PasswordInput
                id="staff-password"
                size="lg"
                value={staffPassword}
                onChange={(e) => setStaffPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={staffLoading}
              iconRight={staffLoading ? undefined : ArrowRight}
            >
              Sign In to POS
            </Button>
          </form>
          <p className="text-center text-[13px] text-adm-muted">
            Ask your store manager or owner if you don’t have your Business ID.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {registered && (
            <Alert tone="success" title="Account created">Sign in to add your first business.</Alert>
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          <form onSubmit={handleOwnerSignIn} className="space-y-4">
            <Field label="Email" htmlFor="owner-email">
              <Input
                id="owner-email"
                type="email"
                leftIcon={Mail}
                size="lg"
                autoComplete="email"
                placeholder="you@business.lk"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field
              label="Password"
              htmlFor="owner-password"
              labelAside={<Link href="/forgot-password" className="font-medium text-adm-primary hover:underline">Forgot password?</Link>}
            >
              <PasswordInput
                id="owner-password"
                leftIcon={Lock}
                size="lg"
                autoComplete="current-password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" variant="primary" size="lg" fullWidth loading={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>
      )}
    </AuthShell>
  )
}

export default function LoginClient() {
  return (
    <Suspense fallback={<div className="adm-root min-h-[100dvh]" />}>
      <LoginForm />
    </Suspense>
  )
}
