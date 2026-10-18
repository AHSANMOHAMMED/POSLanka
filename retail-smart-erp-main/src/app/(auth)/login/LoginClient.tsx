'use client'

import { useState, useEffect, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import {
  Mail, Lock, Loader2, CheckCircle, Eye, EyeOff,
  ShieldCheck, BarChart3, Zap, Users, Sparkles,
} from 'lucide-react'
import { Logo } from '@/components/ui/logo'
import { broadcastAuthEvent } from '@/lib/auth/events'
import { MockPOS } from '@/components/landing/mockups/MockPOS'
import { MockBrowserFrame } from '@/components/landing/mockups/MockBrowserFrame'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    fetch('/api/account-auth/session')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.user?.id) {
          router.push('/account')
        } else {
          setCheckingSession(false)
        }
      })
      .catch(() => setCheckingSession(false))
  }, [router])

  const registered = searchParams.get('registered') === 'true'

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError('Invalid email or password')
        setLoading(false)
      } else {
        broadcastAuthEvent('login', 'account')
        router.push('/account')
        router.refresh()
      }
    } catch {
      setError('An error occurred. Please try again.')
      setLoading(false)
    }
  }

  if (checkingSession) {
    return <LoginFallback />
  }

  return (
    <div className="min-h-screen flex">
      {/* Left side — Image + gradient hero panel */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden">
        {/* Background image */}
        <Image
          src="https://images.unsplash.com/photo-1556742031-c6961e8560b0?w=1200"
          alt=""
          fill
          className="object-cover"
          priority
          quality={85}
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/90 via-emerald-800/80 to-stone-900/70" />

        {/* Floating decorative shapes */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
          <div className="absolute top-[10%] right-[15%] w-20 h-20 rounded-2xl bg-white/10 backdrop-blur-sm rotate-12 sparkle-1" />
          <div className="absolute bottom-[20%] left-[10%] w-16 h-16 rounded-full bg-white/10 backdrop-blur-sm sparkle-2" />
          <div className="absolute top-[45%] right-[8%] w-12 h-12 rounded-md bg-white/10 backdrop-blur-sm -rotate-12 sparkle-3" />
          <div className="absolute top-[70%] left-[25%] w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm rotate-45 sparkle-1" />
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div>
            <Logo variant="full" size={44} subtitle="Point of Sale System" />
          </div>

          <div>
            <h2 className="text-4xl xl:text-5xl font-extrabold leading-tight text-white mb-4 tracking-tight">
              Welcome back to<br />
              your <span className="bg-gradient-to-r from-amber-300 to-emerald-300 bg-clip-text text-transparent">dashboard.</span>
            </h2>
            <p className="text-lg text-emerald-200 mb-10 max-w-md">
              AI-powered POS & ERP for retail, restaurants, supermarkets, and auto service centers.
            </p>

            {/* App mockup preview */}
            <div className="my-6 rounded-md overflow-hidden shadow-2xl shadow-black/30 border border-white/20">
              <MockBrowserFrame url="app.retailsmarterp.com/pos">
                <div className="max-h-[250px] overflow-hidden">
                  <MockPOS />
                </div>
              </MockBrowserFrame>
            </div>

            {/* Feature highlights */}
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Sparkles, label: 'AI Analytics', desc: 'Smart predictions & insights', color: 'text-amber-300' },
                { icon: Zap, label: 'Real-Time Sync', desc: 'Live updates everywhere', color: 'text-emerald-300' },
                { icon: Users, label: 'Unlimited Users', desc: 'No per-user fees ever', color: 'text-violet-300' },
                { icon: BarChart3, label: 'All Features', desc: 'Included on every plan', color: 'text-sky-300' },
              ].map((f) => (
                <div key={f.label} className="flex items-center gap-3 p-3 rounded-md bg-white/10 backdrop-blur-sm border border-white/10">
                  <f.icon size={20} className={`${f.color} flex-shrink-0`} />
                  <div>
                    <p className="font-semibold text-sm text-white">{f.label}</p>
                    <p className="text-emerald-200 text-xs">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Stats bar */}
          <div className="flex items-center gap-8 text-sm">
            {[
              { value: '4', label: 'Business Types' },
              { value: '100%', label: 'Data Isolation' },
              { value: '99.9%', label: 'Uptime SLA' },
            ].map((stat, i) => (
              <div key={stat.label} className="flex items-center gap-3">
                {i > 0 && <div className="w-px h-8 bg-white/20" />}
                <div className={i > 0 ? 'pl-3' : ''}>
                  <p className="font-extrabold text-xl text-white">{stat.value}</p>
                  <p className="text-emerald-200 text-xs">{stat.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right side — Form panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 relative overflow-hidden bg-[#09090b]">
        {/* Subtle orbs */}
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl" />

        <div className="w-full max-w-md relative z-10">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center mb-8">
            <Logo variant="full" size={44} subtitle="Point of Sale System" />
          </div>

          {/* Form card */}
          <div className="glass-card-v2 rounded-2xl p-8">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-extrabold text-white">Welcome back</h2>
              <p className="text-zinc-500 mt-1">Sign in to your account</p>
            </div>

            {registered && (
              <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-md flex items-center gap-3">
                <CheckCircle className="text-emerald-400 flex-shrink-0" size={20} />
                <div>
                  <p className="text-emerald-300 font-semibold">Account created!</p>
                  <p className="text-emerald-400 text-sm">Sign in to add your first business.</p>
                </div>
              </div>
            )}

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
                    className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-md text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-zinc-300 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
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
              </div>

              <div className="flex justify-end">
                <Link href="/forgot-password" className="text-sm text-emerald-400 hover:underline">
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-semibold rounded-md transition-all shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40 flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 size={20} className="animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-zinc-400">
                Don&apos;t have an account?{' '}
                <Link href="/register" className="text-emerald-400 hover:underline font-semibold">
                  Create account
                </Link>
              </p>
            </div>
          </div>

          {/* Security badge */}
          <div className="mt-6 flex items-center justify-center gap-2 text-zinc-500">
            <ShieldCheck size={14} />
            <span className="text-xs">Secure &amp; encrypted &middot; Enterprise security</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function LoginFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
      <div className="flex items-center gap-3">
        <Loader2 size={24} className="animate-spin text-emerald-500" />
        <span className="text-zinc-400">Loading...</span>
      </div>
    </div>
  )
}

export default function LoginClient() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  )
}
