'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, CheckCircle2, Lock, Mail, MailCheck } from 'lucide-react'
import { Alert, AuthHeading, AuthResult, AuthShell, Button, Field, Input, LinkButton, PasswordInput } from '@/components/admin/kit'
import { CompanyLogo, CompanyNotFound } from '../login/CompanyLoginClient'
import type { CompanyInfo } from '../login/company'

function RequestForm({ slug, company }: { slug: string; company: CompanyInfo }) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/staff-forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), tenantSlug: slug }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(res.status === 429 ? 'Too many requests. Please wait a few minutes and try again.' : data.error || 'Something went wrong. Please try again.')
        return
      }
      setSubmitted(true)
    } catch {
      setError('Can’t reach skyERPOS. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <AuthResult
        icon={<MailCheck size={26} aria-hidden />}
        title="Check your email"
        description={<>If <span className="font-medium text-adm-fg">{email}</span> has access to {company.name}, a reset link is on its way. Didn’t get it? Check spam, or ask your manager.</>}
      >
        <Button fullWidth size="lg" onClick={() => { setSubmitted(false); setEmail('') }}>Try another email</Button>
        <LinkButton href={`/c/${slug}/login`} variant="ghost" size="lg" icon={ArrowLeft} className="w-full">Back to sign in</LinkButton>
      </AuthResult>
    )
  }

  return (
    <>
      <AuthHeading title="Reset your password" description={<>Enter the email you use at <span className="font-medium text-adm-fg">{company.name}</span>. We’ll send you a reset link.</>} />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" leftIcon={Mail} size="lg" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus />
        </Field>
        <Button type="submit" variant="primary" size="lg" fullWidth loading={loading}>
          {loading ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
      <div className="mt-6 text-center">
        <Link href={`/c/${slug}/login`} className="inline-flex items-center gap-1 text-[13.5px] font-medium text-adm-primary hover:underline">
          <ArrowLeft size={15} aria-hidden /> Back to sign in
        </Link>
      </div>
    </>
  )
}

function ResetForm({ slug, token }: { slug: string; token: string }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    if (newPassword.length < 8) {
      setError('Use at least 8 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('The two passwords don’t match.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/staff-reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'The link may have expired. Request a new one and try again.')
        return
      }
      setSuccess(true)
    } catch {
      setError('Can’t reach skyERPOS. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <AuthResult icon={<CheckCircle2 size={26} aria-hidden />} title="Password updated" description="You can now sign in with your new password.">
        <LinkButton href={`/c/${slug}/login`} variant="primary" size="lg" className="w-full">Sign in</LinkButton>
      </AuthResult>
    )
  }

  return (
    <>
      <AuthHeading title="Set a new password" description="Choose a password with at least 8 characters." />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="New password" htmlFor="new-password">
          <PasswordInput id="new-password" leftIcon={Lock} size="lg" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required minLength={8} autoFocus />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm-password">
          <PasswordInput id="confirm-password" leftIcon={Lock} size="lg" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" required invalid={!!confirmPassword && confirmPassword !== newPassword} />
        </Field>
        <Button type="submit" variant="primary" size="lg" fullWidth loading={loading}>
          {loading ? 'Saving…' : 'Update password'}
        </Button>
      </form>
    </>
  )
}

function Inner({ slug, company }: { slug: string; company: CompanyInfo }) {
  const token = useSearchParams().get('token')
  return token ? <ResetForm slug={slug} token={token} /> : <RequestForm slug={slug} company={company} />
}

export function StaffForgotPasswordClient({ slug, company }: { slug: string; company: CompanyInfo | null }) {
  if (!company) return <CompanyNotFound slug={slug} />
  return (
    <AuthShell
      aside={null}
      mobileHeader={
        <div className="flex items-center gap-3">
          <CompanyLogo company={company} size={36} />
          <div className="min-w-0">
            <p className="truncate text-[16px] font-semibold text-adm-fg">{company.name}</p>
            <p className="text-[12.5px] text-adm-muted">Staff portal</p>
          </div>
        </div>
      }
    >
      <div>
        <Suspense fallback={null}>
          <Inner slug={slug} company={company} />
        </Suspense>
      </div>
    </AuthShell>
  )
}
