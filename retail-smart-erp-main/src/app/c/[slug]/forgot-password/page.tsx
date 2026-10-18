'use client'

import { useState, useEffect, Suspense, use } from 'react'
import Link from 'next/link'
import { Mail, Lock, Loader2, ArrowLeft, CheckCircle, Eye, EyeOff } from 'lucide-react'
import { useSearchParams } from 'next/navigation'

function StaffForgotPasswordForm({ slug }: { slug: string }) {
  const searchParams = useSearchParams()
  const resetToken = searchParams.get('token')

  // If token is present, show the reset form; otherwise show the forgot form
  if (resetToken) {
    return <ResetPasswordForm slug={slug} token={resetToken} />
  }

  return <ForgotPasswordForm slug={slug} />
}

function ForgotPasswordForm({ slug }: { slug: string }) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [companyName, setCompanyName] = useState('')

  useEffect(() => {
    fetch(`/api/c/${slug}/public-info`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.name) setCompanyName(data.name)
      })
      .catch(() => {})
  }, [slug])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/staff-forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, tenantSlug: slug }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }

      setSubmitted(true)
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const displayName = companyName || slug

  return (
    <div className="min-h-screen flex items-center justify-center p-6 sm:p-8 relative overflow-hidden bg-gradient-to-br from-slate-50 to-blue-50/30 dark:from-slate-950 dark:to-slate-900">
      <div className="absolute -top-24 -right-24 w-64 h-64 bg-blue-400/10 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-indigo-400/10 rounded-full blur-3xl" />

      <div className="w-full max-w-md relative z-10">
        <div className="glass-card p-8">
          {submitted ? (
            <div className="text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800 flex items-center justify-center mb-6">
                <CheckCircle className="text-green-600 dark:text-green-400" size={32} />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Check your email</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                If a staff account exists with <span className="font-medium text-gray-900 dark:text-white">{email}</span> at {displayName}, we&apos;ve sent password reset instructions.
              </p>
              <p className="text-gray-500 dark:text-gray-500 text-sm mb-8">
                Didn&apos;t receive an email? Check your spam folder, or try again.
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => { setSubmitted(false); setEmail('') }}
                  className="w-full py-3 px-4 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium rounded-md transition-colors"
                >
                  Try another email
                </button>
                <Link
                  href={`/c/${slug}/login`}
                  className="w-full py-3 px-4 btn-glow flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={18} />
                  Back to Sign In
                </Link>
              </div>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Forgot password?</h2>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                  Enter your email and we&apos;ll send you a link to reset your {displayName} password.
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 rounded-md">
                  <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" size={18} />
                    <input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                      className="auth-input"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-glow w-full py-3 px-4 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 size={20} className="animate-spin" />
                      Sending...
                    </>
                  ) : (
                    'Send Reset Link'
                  )}
                </button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  href={`/c/${slug}/login`}
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium inline-flex items-center gap-1.5"
                >
                  <ArrowLeft size={16} />
                  Back to Sign In
                </Link>
              </div>
            </>
          )}
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-gray-400 dark:text-gray-500">
          <Lock size={14} />
          <span className="text-xs">Company-secured workspace</span>
        </div>
      </div>
    </div>
  )
}

function ResetPasswordForm({ slug, token }: { slug: string; token: string }) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [companyName, setCompanyName] = useState('')

  useEffect(() => {
    fetch(`/api/c/${slug}/public-info`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.name) setCompanyName(data.name)
      })
      .catch(() => {})
  }, [slug])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/staff-reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to reset password. Please try again.')
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

  const displayName = companyName || slug

  return (
    <div className="min-h-screen flex items-center justify-center p-6 sm:p-8 relative overflow-hidden bg-gradient-to-br from-slate-50 to-blue-50/30 dark:from-slate-950 dark:to-slate-900">
      <div className="absolute -top-24 -right-24 w-64 h-64 bg-blue-400/10 rounded-full blur-3xl" />
      <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-indigo-400/10 rounded-full blur-3xl" />

      <div className="w-full max-w-md relative z-10">
        <div className="glass-card p-8">
          {success ? (
            <div className="text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 border border-green-200 dark:border-green-800 flex items-center justify-center mb-6">
                <CheckCircle className="text-green-600 dark:text-green-400" size={32} />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Password reset!</h2>
              <p className="text-gray-600 dark:text-gray-400 mb-8">
                Your password has been updated successfully. You can now sign in to {displayName} with your new password.
              </p>
              <Link
                href={`/c/${slug}/login`}
                className="btn-glow w-full py-3 px-4 flex items-center justify-center gap-2"
              >
                Sign In
              </Link>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Set new password</h2>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                  Choose a new password for your {displayName} account.
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 rounded-md">
                  <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    New Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" size={18} />
                    <input
                      id="newPassword"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Enter new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={8}
                      autoFocus
                      className="auth-input"
                      style={{ paddingRight: '2.75rem' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" size={18} />
                    <input
                      id="confirmPassword"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Confirm new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={8}
                      className="auth-input"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-glow w-full py-3 px-4 flex items-center justify-center gap-2"
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
                <Link
                  href={`/c/${slug}/login`}
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium inline-flex items-center gap-1.5"
                >
                  <ArrowLeft size={16} />
                  Back to Sign In
                </Link>
              </div>
            </>
          )}
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-gray-400 dark:text-gray-500">
          <Lock size={14} />
          <span className="text-xs">Company-secured workspace</span>
        </div>
      </div>
    </div>
  )
}

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50/30 dark:from-slate-950 dark:to-slate-900">
      <div className="flex items-center gap-3">
        <Loader2 size={24} className="animate-spin text-blue-600" />
        <span className="text-gray-600 dark:text-gray-400">Loading...</span>
      </div>
    </div>
  )
}

export default function StaffForgotPasswordPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  return (
    <Suspense fallback={<PageFallback />}>
      <StaffForgotPasswordForm slug={slug} />
    </Suspense>
  )
}
