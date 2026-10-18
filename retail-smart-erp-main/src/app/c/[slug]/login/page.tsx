'use client'

import { useState, useEffect, Suspense, use } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Mail, Lock, Loader2, CheckCircle, Eye, EyeOff, LogIn } from 'lucide-react'
import { Logo } from '@/components/ui/logo'
import { InstallPromptPopup } from '@/components/ui/install-prompt-popup'
import { broadcastAuthEvent } from '@/lib/auth/events'

// Business-type-aware gradient and accent colors
const GRADIENTS: Record<string, string> = {
  retail: 'from-blue-900 to-indigo-900',
  restaurant: 'from-orange-900 to-red-900',
  supermarket: 'from-emerald-900 to-teal-900',
  auto_service: 'from-slate-800 to-zinc-900',
}

const ACCENTS: Record<string, string> = {
  retail: 'text-blue-300',
  restaurant: 'text-orange-300',
  supermarket: 'text-emerald-300',
  auto_service: 'text-slate-300',
}

const THEME_COLORS: Record<string, string> = {
  retail: '#1e3a8a',
  restaurant: '#7c2d12',
  supermarket: '#064e3b',
  auto_service: '#1e293b',
}

// Company logo display — shows uploaded logo or initials fallback
function CompanyLogo({
  logoUrl,
  name,
  size = 80,
  variant = 'dark',
}: {
  logoUrl: string | null
  name: string
  size?: number
  variant?: 'dark' | 'light'
}) {
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        alt={`${name} logo`}
        width={size}
        height={size}
        className="rounded-2xl object-contain"
      />
    )
  }

  const initials = name
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  const bgClass = variant === 'dark'
    ? 'bg-white/15 border-white/20 text-white'
    : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200'

  return (
    <div
      className={`rounded-2xl backdrop-blur-sm border flex items-center justify-center font-bold ${bgClass}`}
      style={{ width: size, height: size, fontSize: size * 0.35 }}
    >
      {initials || 'CO'}
    </div>
  )
}

function CompanyLoginForm({ slug }: { slug: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [companyName, setCompanyName] = useState<string>('')
  const [companyLogo, setCompanyLogo] = useState<string | null>(null)
  const [businessType, setBusinessType] = useState<string>('retail')
  const [accountUser, setAccountUser] = useState<{ name: string; email: string } | null>(null)
  const [transferring, setTransferring] = useState(false)

  useEffect(() => {
    // Fetch company info (public endpoint)
    fetch(`/api/c/${slug}/public-info`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.name) setCompanyName(data.name)
        if (data?.logoUrl) setCompanyLogo(data.logoUrl)
        if (data?.businessType) setBusinessType(data.businessType)
      })
      .catch(() => {})

    // Check for transfer token in URL (from account portal "Open Company")
    const transfer = searchParams.get('transfer')
    if (transfer) {
      setCheckingSession(true)
      signIn('transfer', { transferToken: transfer, redirect: false })
        .then(result => {
          if (result?.error) {
            setError('Transfer failed. Please sign in manually.')
            setCheckingSession(false)
          } else {
            broadcastAuthEvent('login', 'company')
            // Full page navigation ensures server layout runs with fresh session
            window.location.href = `/c/${slug}/dashboard`
          }
        })
        .catch(() => {
          setError('Transfer failed. Please sign in manually.')
          setCheckingSession(false)
        })
      return
    }

    // Check if already logged into this company
    const isExplicitLogout = searchParams.get('logout') === 'true'

    fetch('/api/auth/session')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.user?.tenantSlug === slug && !isExplicitLogout) {
          router.push(`/c/${slug}/dashboard`)
        } else {
          // Skip auto-transfer if user explicitly logged out
          if (isExplicitLogout) {
            setCheckingSession(false)
            return
          }

          // Check if user has an account session — auto-transfer to avoid extra click
          fetch('/api/account-auth/session')
            .then(res => res.ok ? res.json() : null)
            .then(async (accountData) => {
              if (accountData?.user?.id) {
                // Auto-transfer: seamlessly create company session
                try {
                  const transferRes = await fetch('/api/account-auth/transfer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tenantSlug: slug }),
                  })
                  if (transferRes.ok) {
                    const { transferToken } = await transferRes.json()
                    const result = await signIn('transfer', { transferToken, redirect: false })
                    if (!result?.error) {
                      broadcastAuthEvent('login', 'company')
                      window.location.href = `/c/${slug}/dashboard`
                      return
                    }
                  }
                } catch { /* fall through to manual login */ }

                // Auto-transfer failed — show "Continue as" button as fallback
                setAccountUser({
                  name: accountData.user.name || accountData.user.email,
                  email: accountData.user.email,
                })
              }
              setCheckingSession(false)
            })
            .catch(() => setCheckingSession(false))
        }
      })
      .catch(() => setCheckingSession(false))
  }, [router, slug, searchParams])

  // Inject PWA manifest + theme-color + service worker
  useEffect(() => {
    // Manifest link
    let manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null
    if (!manifestLink) {
      manifestLink = document.createElement('link')
      manifestLink.rel = 'manifest'
      document.head.appendChild(manifestLink)
    }
    manifestLink.href = `/api/c/${slug}/manifest.json`

    // Theme color
    let themeMeta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
    if (!themeMeta) {
      themeMeta = document.createElement('meta')
      themeMeta.name = 'theme-color'
      document.head.appendChild(themeMeta)
    }
    themeMeta.content = THEME_COLORS[businessType] || '#1e3a8a'

    // Service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
    }

    return () => {
      manifestLink?.remove()
      themeMeta?.remove()
    }
  }, [slug, businessType])

  const registered = searchParams.get('registered') === 'true'
  const invited = searchParams.get('invited') === 'true'

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const result = await signIn('credentials', {
        email,
        password,
        tenantSlug: slug,
        redirect: false,
      })

      if (result?.error) {
        setError('Sign in failed. Please check your email and password, and ensure you have access to this company.')
        setLoading(false)
      } else {
        broadcastAuthEvent('login', 'company')
        // Full page navigation ensures server layout runs with fresh session
        window.location.href = `/c/${slug}/dashboard`
      }
    } catch {
      setError('An error occurred. Please try again.')
      setLoading(false)
    }
  }

  if (checkingSession) {
    return <LoginFallback />
  }

  const gradient = GRADIENTS[businessType] || GRADIENTS.retail
  const accent = ACCENTS[businessType] || ACCENTS.retail
  const displayName = companyName || slug

  return (
    <div className="min-h-screen flex">
      {/* Left side - Company Branding Panel */}
      <div className={`hidden lg:flex lg:w-[55%] relative overflow-hidden bg-gradient-to-br ${gradient}`}>
        {/* Subtle pattern */}
        <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '32px 32px' }} />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between p-12 text-white w-full">
          {/* Top: Powered by */}
          <div className="animate-auth-slide-left">
            <Logo variant="full" size={32} onDark subtitle="Business Portal" />
          </div>

          {/* Center: Company branding */}
          <div className="flex flex-col items-center text-center animate-auth-fade-in">
            <CompanyLogo logoUrl={companyLogo} name={displayName} size={96} variant="dark" />
            <h1 className="text-3xl xl:text-4xl font-bold mt-6 leading-tight">
              {displayName}
            </h1>
            <p className={`text-lg mt-2 ${accent} opacity-80`}>Business Portal</p>
            <div className="mt-6 px-4 py-2 rounded-full bg-white/10 border border-white/10 text-sm">
              <span className="capitalize">{businessType.replace('_', ' ')}</span>
            </div>
          </div>

          {/* Bottom */}
          <div className="text-white/50 text-sm text-center animate-auth-fade-in">
            <p>Need access? Ask your company administrator to invite you.</p>
          </div>
        </div>
      </div>

      {/* Right side - Form Panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 relative overflow-hidden bg-gradient-to-br from-slate-50 to-blue-50/30 dark:from-slate-950 dark:to-slate-900">
        {/* Decorative blurred circles */}
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-blue-400/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-indigo-400/10 rounded-full blur-3xl" />

        <div className="w-full max-w-md relative z-10 animate-auth-fade-in">
          {/* Mobile branding (replaces Retail Smart ERP logo) */}
          <div className="lg:hidden flex flex-col items-center mb-8 gap-3">
            <CompanyLogo logoUrl={companyLogo} name={displayName} size={64} variant="light" />
            <div className="text-center">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">{displayName}</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Business Portal</p>
            </div>
          </div>

          {/* Glass card */}
          <div className="glass-card p-8">
            {/* Header with company logo */}
            <div className="text-center mb-8">
              <div className="hidden lg:flex items-center justify-center gap-3 mb-4">
                <CompanyLogo logoUrl={companyLogo} name={displayName} size={48} variant="light" />
                <div className="text-left">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">{displayName}</h2>
                  <p className="text-gray-500 dark:text-gray-400 text-sm">Staff Sign In</p>
                </div>
              </div>
              <p className="lg:hidden text-gray-600 dark:text-gray-400">Staff Sign In</p>
            </div>

            {invited && (
              <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/50 rounded-md flex items-center gap-3 animate-message-in">
                <CheckCircle className="text-blue-600 dark:text-blue-400 flex-shrink-0" size={20} />
                <div>
                  <p className="text-blue-800 dark:text-blue-300 font-medium">Invitation accepted!</p>
                  <p className="text-blue-600 dark:text-blue-400 text-sm">You can now log in to this company.</p>
                </div>
              </div>
            )}

            {registered && (
              <div className="mb-6 p-4 bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800/50 rounded-md flex items-center gap-3 animate-message-in">
                <CheckCircle className="text-green-600 dark:text-green-400 flex-shrink-0" size={20} />
                <div>
                  <p className="text-green-800 dark:text-green-300 font-medium">Account created!</p>
                  <p className="text-green-600 dark:text-green-400 text-sm">Sign in to access your company.</p>
                </div>
              </div>
            )}

            {error && (
              <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/50 rounded-md animate-message-in">
                <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Quick login via account session */}
            {accountUser && (
              <div className="mb-6">
                <button
                  type="button"
                  disabled={transferring}
                  onClick={async () => {
                    setTransferring(true)
                    setError('')
                    try {
                      const transferRes = await fetch('/api/account-auth/transfer', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tenantSlug: slug }),
                      })

                      if (!transferRes.ok) {
                        const err = await transferRes.json()
                        throw new Error(err.error || 'Transfer failed')
                      }

                      const { transferToken } = await transferRes.json()
                      const result = await signIn('transfer', { transferToken, redirect: false })

                      if (result?.error) {
                        throw new Error('Sign in failed')
                      }

                      broadcastAuthEvent('login', 'company')
                      // Full page navigation ensures server layout runs with fresh session
                      window.location.href = `/c/${slug}/dashboard`
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Quick login failed. Please sign in manually.')
                      setTransferring(false)
                    }
                  }}
                  className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-md border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors text-blue-700 dark:text-blue-300 font-medium"
                >
                  {transferring ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      <LogIn size={18} />
                      Continue as {accountUser.name}
                    </>
                  )}
                </button>
                <div className="relative my-5">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200 dark:border-gray-700" />
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-3 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400">or sign in with email</span>
                  </div>
                </div>
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
                    autoComplete="email"
                    className="auth-input"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" size={18} />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
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

              <div className="flex justify-end">
                <Link
                  href={`/c/${slug}/forgot-password`}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-glow w-full py-3 px-4 flex items-center justify-center gap-2"
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

            {/* PWA Install Prompt */}
            <InstallPromptPopup />

            <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700 space-y-3">
              <div className="text-center">
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  Don&apos;t have access?{' '}
                  <Link
                    href={`/c/${slug}/setup`}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                  >
                    Company Setup
                  </Link>
                </p>
              </div>
              <div className="text-center">
                <p className="text-gray-400 dark:text-gray-500 text-xs">
                  Manage multiple companies?{' '}
                  <Link href="/login" className="text-gray-500 dark:text-gray-400 hover:underline">
                    Account portal
                  </Link>
                </p>
              </div>
            </div>
          </div>

          {/* Security badge */}
          <div className="mt-6 flex items-center justify-center gap-2 text-gray-400 dark:text-gray-500 animate-auth-fade-in-delay">
            <Lock size={14} />
            <span className="text-xs">Company-secured workspace</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function LoginFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50/30 dark:from-slate-950 dark:to-slate-900">
      <div className="flex items-center gap-3">
        <Loader2 size={24} className="animate-spin text-blue-600" />
        <span className="text-gray-600 dark:text-gray-400">Loading company portal...</span>
      </div>
    </div>
  )
}

export default function CompanyLoginPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  return (
    <Suspense fallback={<LoginFallback />}>
      <CompanyLoginForm slug={slug} />
    </Suspense>
  )
}
