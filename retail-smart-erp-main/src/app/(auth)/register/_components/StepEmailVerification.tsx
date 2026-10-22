'use client'

import { useState, useEffect } from 'react'
import { Mail, Loader2, ArrowLeft } from 'lucide-react'
import { OTPInput } from './OTPInput'
import { Alert, Button } from '@/components/admin/kit'

interface StepEmailVerificationProps {
  email: string
  onVerified: (token: string) => void
  onBack: () => void
}

export function StepEmailVerification({ email, onVerified, onBack }: StepEmailVerificationProps) {
  const [otp, setOtp] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  // Send OTP on mount
  useEffect(() => {
    sendOtp()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cooldown timer
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(c => c - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [cooldown])

  // Auto-verify when all digits entered
  useEffect(() => {
    if (otp.length === 5 && !verifying) {
      verifyOtp()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp])

  const sendOtp = async () => {
    setSending(true)
    setError('')

    try {
      const res = await fetch('/api/register/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to send code')
        return
      }

      setSent(true)
      setCooldown(60)
    } catch {
      setError('Failed to send verification code')
    } finally {
      setSending(false)
    }
  }

  const verifyOtp = async () => {
    if (otp.length !== 5) return

    setVerifying(true)
    setError('')

    try {
      const res = await fetch('/api/register/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Verification failed')
        setOtp('')
        setVerifying(false)
        return
      }

      onVerified(data.verificationToken)
    } catch {
      setError('Verification failed. Please try again.')
      setOtp('')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div>
      <div className="mb-6 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-adm-primary-soft text-adm-primary-soft-fg">
          <Mail size={24} aria-hidden />
        </span>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-adm-fg">Check your email</h1>
        <p className="mt-1.5 text-[14px] text-adm-muted">
          Enter the 5-digit code we sent to <span className="font-medium text-adm-fg break-all">{email}</span>
        </p>
      </div>

      {sent && (
        <Alert tone="info" className="mb-4">Can’t find it? Look in your Spam or Junk folder.</Alert>
      )}
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      <div className="mb-5">
        <OTPInput value={otp} onChange={setOtp} disabled={verifying} />
      </div>

      <div className="mb-6 min-h-[22px] text-center text-[13.5px] text-adm-muted" aria-live="polite">
        {verifying ? (
          <span className="inline-flex items-center gap-2 text-adm-primary"><Loader2 size={16} className="animate-spin" aria-hidden /> Verifying…</span>
        ) : !sent && sending ? (
          <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" aria-hidden /> Sending code…</span>
        ) : (
          <>
            Didn’t get a code?{' '}
            {cooldown > 0 ? (
              <span className="adm-num">Resend in {cooldown}s</span>
            ) : (
              <button type="button" onClick={sendOtp} disabled={sending} className="adm-focus font-medium text-adm-primary hover:underline disabled:opacity-50">
                {sending ? 'Sending…' : 'Resend code'}
              </button>
            )}
          </>
        )}
      </div>

      <Button size="lg" fullWidth icon={ArrowLeft} onClick={onBack}>Back</Button>
    </div>
  )
}
