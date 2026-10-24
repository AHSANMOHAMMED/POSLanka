'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Mail, MailCheck } from 'lucide-react'
import { Alert, AuthHeading, AuthResult, AuthShell, Button, Field, Input, LinkButton } from '@/components/admin/kit'

export default function ForgotPasswordClient() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
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

  return (
    <AuthShell>
      {submitted ? (
        <AuthResult
          icon={<MailCheck size={26} aria-hidden />}
          title="Check your email"
          description={
            <>
              If an owner account exists for <span className="font-medium text-adm-fg">{email}</span>, we’ve sent a link to reset the password.
              Didn’t get it? Check spam, or try another address.
            </>
          }
        >
          <Button fullWidth size="lg" onClick={() => { setSubmitted(false); setEmail('') }}>Try another email</Button>
          <LinkButton href="/login?tab=account" variant="ghost" size="lg" icon={ArrowLeft} className="w-full">Back to sign in</LinkButton>
        </AuthResult>
      ) : (
        <>
          <AuthHeading title="Reset your password" description="Enter the email of your owner account and we’ll send you a reset link." />
          {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" leftIcon={Mail} size="lg" placeholder="you@business.lk" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus />
            </Field>
            <Button type="submit" variant="primary" size="lg" fullWidth loading={loading}>
              {loading ? 'Sending…' : 'Send reset link'}
            </Button>
          </form>
          <p className="mt-6 text-center text-[13px] text-adm-muted">
            Staff member? Ask your manager, or use <span className="font-medium text-adm-fg">Forgot password</span> on your company’s sign-in page.
          </p>
          <div className="mt-4 text-center">
            <Link href="/login?tab=account" className="inline-flex items-center gap-1 text-[13.5px] font-medium text-adm-primary hover:underline">
              <ArrowLeft size={15} aria-hidden /> Back to sign in
            </Link>
          </div>
        </>
      )}
    </AuthShell>
  )
}
