'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertTriangle, ArrowLeft, CheckCircle2, Lock } from 'lucide-react'
import { Alert, AuthHeading, AuthResult, AuthShell, Button, Field, LinkButton, PasswordInput } from '@/components/admin/kit'

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    if (newPassword.length < 4) {
      setError('Use at least 4 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('The two passwords don’t match.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        return
      }
      setSuccess(true)
    } catch {
      setError('Can’t reach skyERPOS. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <AuthResult icon={<AlertTriangle size={26} aria-hidden />} tone="warning" title="This link isn’t valid" description="The reset link is incomplete, expired or already used. Request a new one.">
        <LinkButton href="/forgot-password" variant="primary" size="lg" className="w-full">Request a new link</LinkButton>
        <LinkButton href="/login?tab=account" variant="ghost" size="lg" icon={ArrowLeft} className="w-full">Back to sign in</LinkButton>
      </AuthResult>
    )
  }

  if (success) {
    return (
      <AuthResult icon={<CheckCircle2 size={26} aria-hidden />} title="Password updated" description="You can now sign in with your new password.">
        <LinkButton href="/login?tab=account" variant="primary" size="lg" className="w-full">Sign in</LinkButton>
      </AuthResult>
    )
  }

  return (
    <>
      <AuthHeading title="Set a new password" description="Choose a password with at least 4 characters." />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="New password" htmlFor="new-password">
          <PasswordInput id="new-password" leftIcon={Lock} size="lg" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required minLength={4} autoFocus />
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

export default function ResetPasswordClient() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  )
}
