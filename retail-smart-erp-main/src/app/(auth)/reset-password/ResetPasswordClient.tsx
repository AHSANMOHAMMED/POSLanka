'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Lock, Loader2, ArrowLeft, CheckCircle, Eye, EyeOff,
  ShieldCheck, AlertTriangle,
} from 'lucide-react'
import { Logo } from '@/components/ui/logo'

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  // No token in URL
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 sm:p-8 relative overflow-hidden bg-[#09090b]">
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl" />

        <div className="w-full max-w-md relative z-10">
          <div className="flex items-center justify-center mb-8">
            <Logo variant="full" size={44} subtitle="Point of Sale System" />
          </div>

          <div className="glass-card-v2 rounded-2xl p-8 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-6">
              <AlertTriangle className="text-amber-400" size={32} />
            </div>
            <h2 className="text-2xl font-extrabold text-white mb-2">Invalid Reset Link</h2>
            <p className="text-zinc-400 mb-6">
              This password reset link is invalid or has been used. Please request a new one.
            </p>
            <div className="space-y-3">
              <Link
                href="/forgot-password"
                className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-semibold rounded-md transition-all shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40 flex items-center justify-center gap-2"
              >
                Request New Reset Link
              </Link>
              <Link
                href="/login"
                className="w-full py-3 px-4 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold rounded-md transition-all flex items-center justify-center gap-2"
              >
                <ArrowLeft size={18} />
                Back to Sign In
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')

    // Client-side validation
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }

      setSuccess(true)
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 sm:p-8 relative overflow-hidden bg-[#09090b]">
      {/* Subtle background orbs */}
      <div className="absolute -top-24 -right-24 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl" />

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <Logo variant="full" size={44} subtitle="Point of Sale System" />
        </div>

        {/* Form card */}
        <div className="glass-card-v2 rounded-2xl p-8">
          {success ? (
            /* Success state */
            <div className="text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-6">
                <CheckCircle className="text-emerald-400" size={32} />
              </div>
              <h2 className="text-2xl font-extrabold text-white mb-2">Password reset!</h2>
              <p className="text-zinc-400 mb-8">
                Your password has been successfully reset. You can now sign in with your new password.
              </p>
              <Link
                href="/login"
                className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-semibold rounded-md transition-all shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40 flex items-center justify-center gap-2"
              >
                Sign In
              </Link>
            </div>
          ) : (
            /* Form state */
            <>
              <div className="text-center mb-8">
                <h2 className="text-2xl font-extrabold text-white">Set new password</h2>
                <p className="text-zinc-500 mt-1">
                  Enter your new password below. Must be at least 8 characters.
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-md">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="newPassword" className="block text-sm font-medium text-zinc-300 mb-2">
                    New Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
                    <input
                      id="newPassword"
                      name="newPassword"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={8}
                      autoFocus
                      className="w-full pl-10 pr-11 py-3 bg-white/5 border border-white/10 rounded-md text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {newPassword.length > 0 && newPassword.length < 8 && (
                    <p className="text-amber-400 text-xs mt-1.5">Must be at least 8 characters</p>
                  )}
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-zinc-300 mb-2">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={8}
                      className="w-full pl-10 pr-11 py-3 bg-white/5 border border-white/10 rounded-md text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                    <p className="text-red-400 text-xs mt-1.5">Passwords do not match</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading || newPassword.length < 8 || newPassword !== confirmPassword}
                  className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-semibold rounded-md transition-all shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40 flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      Resetting...
                    </>
                  ) : (
                    'Reset Password'
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link href="/login" className="text-emerald-400 hover:underline font-semibold inline-flex items-center gap-1.5">
                  <ArrowLeft size={16} />
                  Back to Sign In
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Security badge */}
        <div className="mt-6 flex items-center justify-center gap-2 text-zinc-500">
          <ShieldCheck size={14} />
          <span className="text-xs">Secure &amp; encrypted &middot; Enterprise security</span>
        </div>
      </div>
    </div>
  )
}

function ResetPasswordFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
      <div className="flex items-center gap-3">
        <Loader2 size={24} className="animate-spin text-emerald-500" />
        <span className="text-zinc-400">Loading...</span>
      </div>
    </div>
  )
}

export default function ResetPasswordClient() {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordForm />
    </Suspense>
  )
}
