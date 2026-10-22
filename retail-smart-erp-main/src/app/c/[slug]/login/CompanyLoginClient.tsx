'use client'

import { Suspense, useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, Building2, Lock, LogIn, Mail, ShieldCheck } from 'lucide-react'
import { broadcastAuthEvent } from '@/lib/auth/events'
import { InstallPromptPopup } from '@/components/ui/install-prompt-popup'
import {
  Alert,
  AuthBrandPanel,
  AuthHeading,
  AuthShell,
  BrandMark,
  Button,
  Divider,
  Field,
  Input,
  LinkButton,
  PasswordInput,
  businessTypeLabel,
} from '@/components/admin/kit'
import { cn } from '@/lib/utils'

import type { CompanyInfo } from './company'

const THEME_COLOR = '#0f766e'
const RECENT_KEY = 'poslanka:last-company'

export function CompanyLogo({ company, size, onBrand }: { company: CompanyInfo; size: number; onBrand?: boolean }) {
  const [broken, setBroken] = useState(false)
  if (company.logoUrl && !broken) {
    return (
      <Image
        src={company.logoUrl}
        alt={`${company.name} logo`}
        width={size}
        height={size}
        unoptimized
        onError={() => setBroken(true)}
        className="rounded-2xl bg-white object-contain p-1.5 shadow-sm"
        style={{ width: size, height: size }}
      />
    )
  }
  const initials = company.name.split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2)
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-2xl font-semibold',
        onBrand ? 'border border-white/25 bg-white/15 text-white' : 'bg-adm-primary-soft text-adm-primary-soft-fg'
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initials || 'CO'}
    </span>
  )
}

function BusinessIdChip({ id, onBrand }: { id: string; onBrand?: boolean }) {
  if (!id) return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12.5px]',
        onBrand ? 'bg-white/15 text-white/90' : 'bg-adm-surface-2 text-adm-muted ring-1 ring-adm-border'
      )}
    >
      Business ID <span className={cn('adm-num font-semibold tracking-wide', onBrand ? 'text-white' : 'text-adm-fg')}>{id}</span>
    </span>
  )
}

function rememberCompany(company: CompanyInfo) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify({ slug: company.slug, name: company.name, logoUrl: company.logoUrl }))
  } catch {
    // storage unavailable
  }
}

function LoginForm({ slug, company }: { slug: string; company: CompanyInfo }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accountUser, setAccountUser] = useState<{ name: string; email: string } | null>(null)
  const [transferring, setTransferring] = useState(false)

  const registered = searchParams.get('registered') === 'true'
  const invited = searchParams.get('invited') === 'true'

  const enterCompany = () => {
    rememberCompany(company)
    broadcastAuthEvent('login', 'company')
    // Full page navigation so the server layout runs with the fresh session
    window.location.href = `/c/${slug}/dashboard`
  }

  useEffect(() => {
    let cancelled = false
    const transfer = searchParams.get('transfer')
    if (transfer) {
      // Arrived from the owner portal's "Open company"
      signIn('transfer', { transferToken: transfer, redirect: false })
        .then((result) => {
          if (cancelled) return
          if (result?.error) {
            setError('We couldn’t sign you in automatically. Please sign in with your email and password.')
          } else {
            enterCompany()
          }
        })
        .catch(() => {
          if (!cancelled) setError('We couldn’t sign you in automatically. Please sign in with your email and password.')
        })
      return () => {
        cancelled = true
      }
    }

    const isExplicitLogout = searchParams.get('logout') === 'true'
    ;(async () => {
      try {
        const res = await fetch('/api/auth/session')
        const data = res.ok ? await res.json() : null
        if (cancelled) return
        if (data?.user?.tenantSlug === slug && !isExplicitLogout) {
          router.replace(`/c/${slug}/dashboard`)
          return
        }
        if (isExplicitLogout) return

        // Signed in to the owner portal? Offer (and try) a one-click switch into this company.
        const accRes = await fetch('/api/account-auth/session')
        const acc = accRes.ok ? await accRes.json() : null
        if (cancelled || !acc?.user?.id) return
        try {
          const transferRes = await fetch('/api/account-auth/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantSlug: slug }),
          })
          if (transferRes.ok) {
            const { transferToken } = await transferRes.json()
            const result = await signIn('transfer', { transferToken, redirect: false })
            if (!result?.error && !cancelled) {
              enterCompany()
              return
            }
          }
        } catch {
          // fall through to the manual option
        }
        if (!cancelled) setAccountUser({ name: acc.user.name || acc.user.email, email: acc.user.email })
      } catch {
        // offline / server error — just show the form
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, searchParams, router])

  // PWA: per-company manifest + theme colour + service worker
  useEffect(() => {
    let manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null
    if (!manifestLink) {
      manifestLink = document.createElement('link')
      manifestLink.rel = 'manifest'
      document.head.appendChild(manifestLink)
    }
    manifestLink.href = `/api/c/${slug}/manifest.json`
    let themeMeta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
    if (!themeMeta) {
      themeMeta = document.createElement('meta')
      themeMeta.name = 'theme-color'
      document.head.appendChild(themeMeta)
    }
    themeMeta.content = THEME_COLOR
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
    }
    return () => {
      manifestLink?.remove()
      themeMeta?.remove()
    }
  }, [slug])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = await signIn('credentials', { email: email.trim(), password, tenantSlug: slug, redirect: false })
      if (result?.error) {
        setError(`Sign-in failed. Check your email and password, and that you have access to ${company.name}.`)
        setLoading(false)
      } else {
        enterCompany()
      }
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  async function continueAsAccount() {
    setTransferring(true)
    setError('')
    try {
      const transferRes = await fetch('/api/account-auth/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantSlug: slug }),
      })
      if (!transferRes.ok) {
        const err = await transferRes.json().catch(() => ({}))
        throw new Error(err.error || 'Your account doesn’t have access to this company.')
      }
      const { transferToken } = await transferRes.json()
      const result = await signIn('transfer', { transferToken, redirect: false })
      if (result?.error) throw new Error('Sign-in failed.')
      enterCompany()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Quick sign-in failed. Please use your email and password.')
      setTransferring(false)
    }
  }

  return (
    <AuthShell
      aside={
        <AuthBrandPanel footer={<>Need access? Ask your company administrator to invite you.</>}>
          <div className="max-w-sm">
            <CompanyLogo company={company} size={88} onBrand />
            <h2 className="mt-6 text-[32px] font-semibold leading-tight tracking-[-0.02em] text-white">{company.name}</h2>
            <p className="mt-1.5 text-[15px] text-white/75">{businessTypeLabel(company.businessType)} · Staff portal</p>
            <div className="mt-5"><BusinessIdChip id={company.businessId} onBrand /></div>
          </div>
        </AuthBrandPanel>
      }
      mobileHeader={
        <div className="flex items-center gap-3">
          <CompanyLogo company={company} size={48} />
          <div className="min-w-0">
            <p className="truncate text-[17px] font-semibold text-adm-fg">{company.name}</p>
            {company.businessId && <p className="adm-num text-[12.5px] text-adm-muted">Business ID {company.businessId}</p>}
          </div>
        </div>
      }
      footer={
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck size={14} aria-hidden /> Secured by POSLanka
        </span>
      }
    >
      <AuthHeading title="Staff sign-in" description={<>Sign in to <span className="font-medium text-adm-fg">{company.name}</span> with the email your manager invited.</>} />

      <div className="space-y-4">
        {invited && <Alert tone="success" title="Invitation accepted">You can now sign in to this company.</Alert>}
        {registered && <Alert tone="success" title="Account created">Sign in to get started.</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}

        {accountUser && (
          <>
            <Button variant="secondary" size="lg" fullWidth icon={LogIn} loading={transferring} onClick={continueAsAccount}>
              {transferring ? 'Signing in…' : `Continue as ${accountUser.name}`}
            </Button>
            <Divider>or use email</Divider>
          </>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              leftIcon={Mail}
              size="lg"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus={!accountUser}
            />
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            labelAside={<Link href={`/c/${slug}/forgot-password`} className="font-medium text-adm-primary hover:underline">Forgot password?</Link>}
          >
            <PasswordInput
              id="password"
              name="password"
              leftIcon={Lock}
              size="lg"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </Field>
          <Button type="submit" variant="primary" size="lg" fullWidth loading={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <div className="flex flex-col items-center gap-1.5 pt-2 text-[13px] text-adm-muted">
          <Link href="/login" className="inline-flex items-center gap-1 hover:text-adm-fg">
            <ArrowLeft size={14} aria-hidden /> Not your company? Enter a different Business ID
          </Link>
          <Link href="/login?tab=account" className="hover:text-adm-fg">Business owner? Sign in to your account</Link>
        </div>
      </div>
      <InstallPromptPopup />
    </AuthShell>
  )
}

export function CompanyNotFound({ slug }: { slug: string }) {
  return (
    <AuthShell aside={null} mobileHeader={<BrandMark href="/" />}>
      <div className="rounded-2xl border border-adm-border bg-adm-surface p-6 text-center shadow-[var(--adm-shadow-lg)] sm:p-8">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-adm-surface-2 text-adm-subtle">
          <Building2 size={22} aria-hidden />
        </span>
        <h1 className="mt-4 text-[20px] font-semibold text-adm-fg">Company not found</h1>
        <p className="mt-1.5 text-[14px] text-adm-muted">
          There’s no active business at <span className="font-medium text-adm-fg">/c/{slug}</span>. Check the link, or sign in with your Business ID.
        </p>
        <LinkButton href="/login" variant="primary" size="lg" className="mt-6 w-full">Sign in with Business ID</LinkButton>
      </div>
    </AuthShell>
  )
}

export function CompanyLoginClient({ slug, company }: { slug: string; company: CompanyInfo | null }) {
  if (!company) return <CompanyNotFound slug={slug} />
  return (
    <Suspense fallback={<div className="adm-root min-h-[100dvh]" />}>
      <LoginForm slug={slug} company={company} />
    </Suspense>
  )
}
