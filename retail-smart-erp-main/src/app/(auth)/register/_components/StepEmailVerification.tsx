'use client'

import { useState, useEffect } from 'react'
import { Mail, Loader2, ArrowLeft } from 'lucide-react'
import { OTPInput } from './OTPInput'

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
      <div className="text-center mb-6">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-emerald-500/20 to-violet-500/20 flex items-center justify-center mx-auto mb-4">
          <Mail size={28} className="text-emerald-400" />
        </div>
        <h2 className="text-2xl font-extrabold text-white">Verify Your Email</h2>
        <p className="text-zinc-500 mt-1">
          We sent a 5-digit code to
        </p>
        <p className="text-emerald-400 font-semibold">{email}</p>
        {sent && (
          <div className="mt-3 px-4 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-md">
            <p className="text-amber-300 text-xs leading-relaxed">
              Can&apos;t find it? Check your <span className="font-semibold">Spam</span> or <span className="font-semibold">Junk</span> folder — sometimes our emails are too cool for the inbox.
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-md">
          <p className="text-red-400 text-sm text-center">{error}</p>
        </div>
      )}

      <div className="mb-6">
        <OTPInput
          value={otp}
          onChange={setOtp}
          disabled={verifying}
        />
      </div>

      {verifying && (
        <div className="flex items-center justify-center gap-2 text-emerald-400 mb-4">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm font-medium">Verifying...</span>
        </div>
      )}

      <div className="text-center mb-6">
        <p className="text-sm text-zinc-500">
          Didn&apos;t receive the code?{' '}
          {cooldown > 0 ? (
            <span className="text-zinc-500">
              Resend in {cooldown}s
            </span>
          ) : (
            <button
              onClick={sendOtp}
              disabled={sending}
              className="text-emerald-400 hover:underline font-semibold disabled:opacity-50"
            >
              {sending ? 'Sending...' : 'Resend Code'}
            </button>
          )}
        </p>
      </div>

      {!sent && sending && (
        <div className="flex items-center justify-center gap-2 text-zinc-500 mb-4">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Sending code...</span>
        </div>
      )}

      <button
        onClick={onBack}
        className="w-full py-3 px-4 border border-white/10 text-zinc-300 rounded-md hover:bg-white/5 transition-colors flex items-center justify-center gap-2"
      >
        <ArrowLeft size={18} />
        Back
      </button>
    </div>
  )
}
