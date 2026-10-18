'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Mail, Loader2, ArrowLeft, CheckCircle, ShieldCheck } from 'lucide-react'
import { Logo } from '@/components/ui/logo'

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
        body: JSON.stringify({ email }),
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
          {submitted ? (
            /* Success state */
            <div className="text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-6">
                <CheckCircle className="text-emerald-400" size={32} />
              </div>
              <h2 className="text-2xl font-extrabold text-white mb-2">Check your email</h2>
              <p className="text-zinc-400 mb-6">
                If an account exists with <span className="text-zinc-300 font-medium">{email}</span>, we&apos;ve sent password reset instructions.
              </p>
              <p className="text-zinc-500 text-sm mb-8">
                Didn&apos;t receive an email? Check your spam folder, or try again with a different email address.
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => {
                    setSubmitted(false)
                    setEmail('')
                  }}
                  className="w-full py-3 px-4 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-semibold rounded-md transition-all"
                >
                  Try another email
                </button>
                <Link
                  href="/login"
                  className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-semibold rounded-md transition-all shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40 flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={18} />
                  Back to Sign In
                </Link>
              </div>
            </div>
          ) : (
            /* Form state */
            <>
              <div className="text-center mb-8">
                <h2 className="text-2xl font-extrabold text-white">Forgot password?</h2>
                <p className="text-zinc-500 mt-1">
                  Enter your email and we&apos;ll send you a link to reset your password.
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-md">
                  <p className="text-red-400 text-sm">{error}</p>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-zinc-300 mb-2">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
                    <input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                      className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-md text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-semibold rounded-md transition-all shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40 flex items-center justify-center gap-2 disabled:opacity-60"
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
