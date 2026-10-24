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
} from '@/components/admin/kit'

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
  // Remembered company (per browser); null during SSR so the markup stays stable
  const recentRaw = useSyncExternalStore(noopSubscribe, readRecentRaw, () => null)
  const [recentDismissed, setRecentDismissed] = useState(false)
  const storedRecent = useMemo(() => parseRecent(recentRaw), [recentRaw])
  const recent = recentDismissed ? null : storedRecent

  // One form for everyone: the server works out owner vs staff and the role's landing page
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  // null until typed: then a remembered shop pre-fills it
  const [businessIdInput, setBusinessId] = useState<string | null>(searchParams.get('company'))
  const [showBusinessId, setShowBusinessId] = useState(!!searchParams.get('company'))
  const [choices, setChoices] = useState<Array<{ slug: string; name: string }> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const businessId = businessIdInput ?? recent?.slug ?? ''
  const isUsername = login.trim() !== '' && !login.includes('@')
  const businessIdVisible = showBusinessId || isUsername || !!recent

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

  async function staffSignIn(slug: string, name: string, landing: string) {
    const csrfRes = await fetch('/api/auth/csrf')
    const csrfData = await csrfRes.json().catch(() => ({}))
    const authRes = await fetch('/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Auth-Return-Redirect': '1' },
      body: new URLSearchParams({
        email: login.trim(),
        password,
        tenantSlug: slug,
        businessId: slug,
        csrfToken: csrfData?.csrfToken || '',
        callbackUrl: `/c/${slug}${landing}`,
        json: 'true',
      }),
    })
    const authData = await authRes.json().catch(() => ({}))
    if (!authRes.ok || String(authData?.url || '').includes('error=')) {
      setError(`Sign-in to ${name} failed. Please try again.`)
      setLoading(false)
      return
    }
    try { localStorage.setItem(RECENT_KEY, JSON.stringify({ slug, name, logoUrl: null })) } catch { /* ignore */ }
    broadcastAuthEvent('login', 'company')
    window.location.assign(`/c/${slug}${landing}`)
  }

  async function submit(e?: React.FormEvent<HTMLFormElement>, pickedSlug?: string) {
    e?.preventDefault()
    if (!login.trim() || !password) {
      setError('Enter your username or email and your password.')
      return
    }
    setLoading(true)
    setError('')
    setChoices(null)
    try {
      const bid = (pickedSlug ?? (businessIdVisible ? businessId : '')).trim()
      const res = await fetch('/api/auth/resolve-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: login.trim(), password, ...(bid ? { businessId: bid } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.field === 'businessId') setShowBusinessId(true)
        setError(data?.error || 'Those details don’t match.')
        setLoading(false)
        return
      }
      if (data.kind === 'owner') {
        const result = await signIn('credentials', { email: login.trim(), password, redirect: false })
        if (result?.error) {
          setError('That email and password don’t match an owner account.')
          setLoading(false)
          return
        }
        broadcastAuthEvent('login', 'account')
        router.push('/account')
        router.refresh()
        return
      }
      if (data.kind === 'choose') {
        setChoices(data.companies)
        setLoading(false)
        return
      }
      await staffSignIn(data.slug, data.name, data.landing || '/dashboard')
    } catch {
      setError('Could not connect. Please check your connection and try again.')
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
        title="Welcome back"
        description="Sign in once — owners go to their business account, staff go straight to their work screen."
      />

      <div className="space-y-5">
        {registered && <Alert tone="success" title="Account created">Sign in to add your first business.</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}

        {choices && (
          <div className="rounded-xl border border-adm-border bg-adm-surface-2 p-3">
            <p className="mb-2 text-[13px] font-medium text-adm-fg">You work at more than one shop. Choose one:</p>
            <div className="space-y-2">
              {choices.map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => { setBusinessId(c.slug); setShowBusinessId(true); void submit(undefined, c.slug) }}
                  className="adm-focus flex w-full items-center gap-3 rounded-lg border border-adm-border bg-adm-surface p-2.5 text-left hover:border-adm-primary"
                >
                  <CompanyAvatar name={c.name} logoUrl={null} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-adm-fg">{c.name}</span>
                    <span className="block text-[12px] text-adm-subtle">Business ID {c.slug}</span>
                  </span>
                  <ArrowRight size={16} className="text-adm-subtle" aria-hidden />
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={(e) => submit(e)} className="space-y-4" noValidate>
          <Field label="Username or email" htmlFor="login">
            <Input
              id="login"
              type="text"
              leftIcon={Mail}
              size="lg"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="e.g. cashier1 or you@business.lk"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              required
            />
          </Field>

          <Field
            label="Password"
            htmlFor="password"
            labelAside={<Link href="/forgot-password" className="font-medium text-adm-primary hover:underline">Forgot password?</Link>}
          >
            <PasswordInput
              id="password"
              leftIcon={Lock}
              size="lg"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Your password"
              required
            />
          </Field>

          {businessIdVisible ? (
            <Field
              label={isUsername ? 'Business ID' : 'Business ID (optional)'}
              htmlFor="business-id"
              hint="Your shop’s name, e.g. alisha-shop. Owners can leave it blank."
            >
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    id="business-id"
                    leftIcon={Building2}
                    size="lg"
                    value={businessId}
                    onChange={(e) => setBusinessId(e.target.value)}
                    placeholder="e.g. alisha-shop"
                    autoComplete="organization"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </div>
                {recent && businessId === recent.slug && (
                  <button
                    type="button"
                    aria-label={`Forget ${recent.name} on this device`}
                    onClick={() => {
                      try { localStorage.removeItem(RECENT_KEY) } catch { /* ignore */ }
                      setRecentDismissed(true)
                      setBusinessId('')
                    }}
                    className="adm-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-adm-border text-adm-subtle hover:bg-adm-surface-2 hover:text-adm-fg"
                  >
                    <X size={16} aria-hidden />
                  </button>
                )}
              </div>
            </Field>
          ) : (
            <button type="button" onClick={() => setShowBusinessId(true)} className="text-[13px] font-medium text-adm-primary hover:underline">
              Staff of a shop? Add your Business ID
            </button>
          )}

          <Button type="submit" variant="primary" size="lg" fullWidth loading={loading} iconRight={loading ? undefined : ArrowRight}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
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
