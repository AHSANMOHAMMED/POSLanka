'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Check,
  Loader2,
  CreditCard,
  Sparkles,
  Globe,
} from 'lucide-react'
import { AIConsentModal } from '@/components/modals'
import { countries, dateFormats, timeFormats, getCountryDefaults } from '@/lib/utils/countries'
import { formatCurrencyWithSymbol, getExchangeRate } from '@/lib/utils/currency'
import { FormInput, FormField, FormSelect, FormCheckbox } from '@/components/ui/form-elements'
import { BUSINESS_TYPES } from '@/lib/constants/business-types'

interface PricingTier {
  id: string
  name: string
  displayName: string
  priceMonthly: number
  priceYearly: number
  currency: string
  maxUsers: number | null
  maxSalesMonthly: number | null
  features: Record<string, boolean>
}

function generateParticles() {
  const particles: { angle: number; r: number; size: number; color: string; delay: number; transitionDuration: number }[] = []
  const colors = ['#8b5cf6', '#a78bfa', '#c4b5fd', '#7c3aed', '#6d28d9', '#ddd6fe']
  for (let i = 0; i < 28; i++) {
    const angle = (i / 28) * Math.PI * 2 + (Math.random() - 0.5) * 0.3
    particles.push({
      angle,
      r: 180 + Math.random() * 280,
      size: 4 + Math.random() * 7,
      color: colors[i % colors.length],
      delay: i * 60,
      transitionDuration: 1.6 + Math.random() * 0.8,
    })
  }
  return particles
}

const PARTICLES = generateParticles()

function AIEnabledOverlay({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<'enter' | 'visible' | 'exit'>('enter')
  const [particleStyles, setParticleStyles] = useState<React.CSSProperties[]>([])

  useEffect(() => {
    // Start particles after a tick so initial position renders first
    const t0 = setTimeout(() => {
      setParticleStyles(PARTICLES.map(p => ({
        transform: `translate(${Math.cos(p.angle) * p.r}px, ${Math.sin(p.angle) * p.r}px) scale(0)`,
        opacity: 0,
      })))
    }, 100)
    const t1 = setTimeout(() => setPhase('visible'), 50)
    const t2 = setTimeout(() => setPhase('exit'), 2800)
    const t3 = setTimeout(onComplete, 3500)
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [onComplete])

  // Generate keyframes for rings
  const ringKeyframes = `
    @keyframes ai-ring-expand {
      0% { transform: translate(-50%, -50%) scale(0.2); opacity: 0.5; }
      100% { transform: translate(-50%, -50%) scale(3); opacity: 0; }
    }
    @keyframes ai-text-in {
      0% { transform: translate(-50%, -50%) scale(0.7); opacity: 0; }
      100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
    }
    @keyframes ai-text-out {
      0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(0.95); opacity: 0; }
    }
  `

  return (
    <div
      className="fixed inset-0 z-[100] pointer-events-none overflow-hidden"
      style={{
        background: phase === 'exit' ? 'transparent' : 'rgba(139, 92, 246, 0.08)',
        backdropFilter: phase === 'exit' ? 'none' : 'blur(1px)',
        transition: 'background 600ms ease, backdrop-filter 600ms ease',
      }}
    >
      <style>{ringKeyframes}</style>

      {/* Expanding rings */}
      {[0, 0.3, 0.6, 0.9].map((delay, i) => (
        <div
          key={`ring-${i}`}
          className="absolute left-1/2 top-1/2 rounded-full"
          style={{
            width: 100,
            height: 100,
            border: `2px solid rgba(139, 92, 246, ${0.35 - i * 0.06})`,
            animation: `ai-ring-expand ${1.8 + i * 0.2}s cubic-bezier(0.25, 0.46, 0.45, 0.94) ${delay}s forwards`,
            transform: 'translate(-50%, -50%) scale(0.2)',
            opacity: 0,
          }}
        />
      ))}

      {/* Sparkle particles */}
      {PARTICLES.map((p, i) => (
        <div
          key={`p-${i}`}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: p.size,
            height: p.size,
            borderRadius: '50%',
            background: p.color,
            boxShadow: `0 0 ${p.size * 3}px ${p.color}, 0 0 ${p.size * 6}px ${p.color}40`,
            transform: 'translate(0, 0) scale(1)',
            opacity: 1,
            transition: `transform ${p.transitionDuration}s cubic-bezier(0.25, 0.46, 0.45, 0.94) ${p.delay}ms, opacity ${1.8}s ease ${p.delay + 800}ms`,
            ...(particleStyles[i] || {}),
          }}
        />
      ))}

      {/* Center content */}
      <div
        className="absolute left-1/2 top-1/2 text-center"
        style={{
          animation: phase === 'exit'
            ? 'ai-text-out 500ms ease-in forwards'
            : 'ai-text-in 600ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
          opacity: 0,
        }}
      >
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-violet-500/15 backdrop-blur-md border border-violet-300/30 flex items-center justify-center shadow-lg shadow-violet-500/20">
          <Sparkles className="w-8 h-8 text-violet-600 animate-pulse" />
        </div>
        <h2 className="text-lg font-bold text-violet-900 dark:text-violet-200 mb-1 whitespace-nowrap">AI Features Enabled</h2>
        <p className="text-violet-600/70 dark:text-violet-400/70 text-sm whitespace-nowrap">Powered by Google Gemini & DeepSeek</p>
      </div>
    </div>
  )
}

function NewCompanyForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const typeFromUrl = searchParams.get('type')

  const [hasExistingCompanies, setHasExistingCompanies] = useState<boolean | null>(null)
  const [checkingCompanies, setCheckingCompanies] = useState(true)

  const [tiers, setTiers] = useState<PricingTier[]>([])
  const [selectedTier, setSelectedTier] = useState('')
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly')
  const [accountCurrency, setAccountCurrency] = useState('USD')
  const [tierCurrency, setTierCurrency] = useState('LKR')
  const [exchangeRate, setExchangeRate] = useState(1)

  const [step, setStep] = useState(0)
  const [selectedType, setSelectedType] = useState(typeFromUrl || '')
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    email: '',
    phone: '',
    address: '',
    country: '',
    dateFormat: '',
    timeFormat: '',
  })
  const [aiEnabled, setAiEnabled] = useState(false)
  const [showAIConsent, setShowAIConsent] = useState(false)
  const [showAIAnimation, setShowAIAnimation] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [slugTouched, setSlugTouched] = useState(false)
  const [slugStatus, setSlugStatus] = useState<{ available?: boolean; reason?: string; checking?: boolean } | null>(null)

  useEffect(() => {
    async function checkCompanies() {
      try {
        const res = await fetch('/api/account/companies')
        if (res.ok) {
          const companies = await res.json()
          setHasExistingCompanies(companies.length > 0)
          if (companies.length === 0) {
            setStep(typeFromUrl ? 2 : 1)
          } else {
            setStep(0)
          }
        }
      } catch (error) {
        console.error('Failed to check companies:', error)
        setHasExistingCompanies(false)
        setStep(typeFromUrl ? 2 : 1)
      } finally {
        setCheckingCompanies(false)
      }
    }
    checkCompanies()
  }, [typeFromUrl])

  // Debounced slug availability check
  useEffect(() => {
    const slug = formData.slug
    if (!slug || slug.length < 3) {
      setSlugStatus(slug ? { available: false, reason: 'Must be at least 3 characters' } : null)
      return
    }
    if (slug.length > 25) {
      setSlugStatus({ available: false, reason: 'Must be 25 characters or less' })
      return
    }
    if (slug.startsWith('-') || slug.endsWith('-')) {
      setSlugStatus({ available: false, reason: 'Must start and end with a letter or number' })
      return
    }

    setSlugStatus({ checking: true })
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/account/companies/check-slug?slug=${encodeURIComponent(slug)}`)
        if (res.ok) {
          const data = await res.json()
          setSlugStatus(data)
        }
      } catch {
        setSlugStatus(null)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [formData.slug])

  useEffect(() => {
    if (hasExistingCompanies) {
      async function fetchTiers() {
        try {
          const [tiersRes, walletRes] = await Promise.all([
            fetch('/api/account/pricing-tiers'),
            fetch('/api/account/wallet'),
          ])

          let paidTiers: PricingTier[] = []
          if (tiersRes.ok) {
            const tiersData = await tiersRes.json()
            paidTiers = tiersData.filter((t: PricingTier) =>
              t.name !== 'trial' && t.name !== 'free'
            )
            setTiers(paidTiers)
            // Store the currency tiers are priced in
            if (paidTiers.length > 0) {
              setTierCurrency(paidTiers[0].currency || 'LKR')
            }
          }

          if (walletRes.ok) {
            const walletData = await walletRes.json()
            const userCurrency = walletData.currency || 'LKR'
            setAccountCurrency(userCurrency)

            // Convert from tier currency to account currency
            const baseCurrency = paidTiers.length > 0 ? (paidTiers[0].currency || 'LKR') : 'LKR'
            if (userCurrency !== baseCurrency) {
              const rate = await getExchangeRate(baseCurrency, userCurrency)
              if (rate) {
                setExchangeRate(rate)
              }
            }
          }
        } catch (error) {
          console.error('Failed to fetch tiers:', error)
        }
      }
      fetchTiers()
    }
  }, [hasExistingCompanies])

  useEffect(() => {
    if (typeFromUrl && BUSINESS_TYPES.some(t => t.value === typeFromUrl)) {
      setSelectedType(typeFromUrl)
      if (!hasExistingCompanies && !checkingCompanies) {
        setStep(2)
      }
    }
  }, [typeFromUrl, hasExistingCompanies, checkingCompanies])

  const convertPrice = useCallback((tierPrice: number) => {
    return Math.round(tierPrice * exchangeRate * 100) / 100
  }, [exchangeRate])

  // Show prices in account currency if conversion available, otherwise in tier currency
  const displayCurrency = exchangeRate !== 1 ? accountCurrency : tierCurrency

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 25)
  }

  const handleNameChange = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      name: value,
      slug: slugTouched ? prev.slug : generateSlug(value),
    }))
  }

  const handleSlugChange = (value: string) => {
    setSlugTouched(true)
    setFormData((prev) => ({
      ...prev,
      slug: value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 25),
    }))
  }

  const handleCountryChange = (countryCode: string) => {
    const defaults = getCountryDefaults(countryCode)
    setFormData((prev) => ({
      ...prev,
      country: countryCode,
      dateFormat: defaults.dateFormat,
      timeFormat: defaults.timeFormat,
    }))
  }

  const handleSubmit = async () => {
    setError('')
    setLoading(true)

    try {
      const payload: Record<string, unknown> = {
        ...formData,
        businessType: selectedType,
        aiEnabled,
      }

      if (hasExistingCompanies) {
        payload.tierId = selectedTier
        payload.billingCycle = billingCycle
      }

      const res = await fetch('/api/account/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to create company')
        setLoading(false)
        return
      }

      if (data.isPending) {
        router.push(`/account/payments?pendingCompany=${data.id}`)
        return
      }

      // Redirect to company login page — it will auto-detect the account
      // session and seamlessly transfer the user into the company dashboard.
      // The layout then redirects to setup if setup isn't completed yet.
      if (data.slug) {
        const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN
        window.location.href = baseDomain
          ? `https://${data.slug}.${baseDomain}/login`
          : `/c/${data.slug}/login`
      } else {
        router.push('/account')
      }
    } catch {
      setError('Failed to create company. Please try again.')
      setLoading(false)
    }
  }

  const selectedTypeInfo = BUSINESS_TYPES.find(t => t.value === selectedType)
  const selectedTierInfo = tiers.find(t => t.id === selectedTier)

  if (checkingCompanies) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <Link
          href="/account"
          className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </Link>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
        <div className="px-4 sm:px-8 py-4 sm:py-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-white dark:from-gray-800 dark:to-gray-800">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-md flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                {hasExistingCompanies ? 'Add New Business' : 'Create New Business'}
              </h1>
              <p className="text-gray-500 dark:text-gray-400 mt-0.5">
                {hasExistingCompanies
                  ? 'Select a plan and set up your new business'
                  : 'Set up a new business — your first company is free forever'
                }
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-8">
          {/* Progress steps */}
          <nav aria-label="Setup progress" className="flex items-center justify-center mb-10">
            {hasExistingCompanies && (
              <>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-9 h-9 rounded-md flex items-center justify-center font-semibold text-sm transition-all ${
                      step >= 0 ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-lg' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                    }`}
                    aria-current={step === 0 ? 'step' : undefined}
                  >
                    {step > 0 ? <Check className="w-4 h-4" /> : '1'}
                  </div>
                  <span className={`text-xs sm:text-sm ${step >= 0 ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                    Plan
                  </span>
                </div>
                <div className={`w-6 sm:w-12 h-0.5 mx-1 sm:mx-3 ${step > 0 ? 'bg-gray-900 dark:bg-white' : 'bg-gray-200 dark:bg-gray-700'}`} />
              </>
            )}
            <div className="flex items-center gap-2">
              <div
                className={`w-9 h-9 rounded-md flex items-center justify-center font-semibold text-sm transition-all ${
                  step >= 1 ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-lg' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                }`}
                aria-current={step === 1 ? 'step' : undefined}
              >
                {step > 1 ? <Check className="w-4 h-4" /> : (hasExistingCompanies ? '2' : '1')}
              </div>
              <span className={`text-xs sm:text-sm ${step >= 1 ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                Type
              </span>
            </div>
            <div className={`w-6 sm:w-12 h-0.5 mx-1 sm:mx-3 ${step > 1 ? 'bg-gray-900 dark:bg-white' : 'bg-gray-200 dark:bg-gray-700'}`} />
            <div className="flex items-center gap-2">
              <div
                className={`w-9 h-9 rounded-md flex items-center justify-center font-semibold text-sm transition-all ${
                  step >= 2 ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 shadow-lg' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                }`}
                aria-current={step === 2 ? 'step' : undefined}
              >
                {hasExistingCompanies ? '3' : '2'}
              </div>
              <span className={`text-xs sm:text-sm ${step >= 2 ? 'text-gray-900 dark:text-white font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                Details
              </span>
            </div>
          </nav>

          {/* Step 0: Select plan */}
          {step === 0 && hasExistingCompanies && (
            <div className="space-y-6" role="region" aria-label="Select a plan">
              <h3 className="font-semibold text-gray-900 dark:text-white text-center text-lg">
                Select a plan for your new business
              </h3>

              <div className="flex justify-center">
                <div className="inline-flex items-center p-1.5 bg-gray-100 dark:bg-gray-700 rounded-md">
                  <button
                    onClick={() => setBillingCycle('monthly')}
                    className={`px-5 py-2.5 text-sm font-medium rounded transition-all ${
                      billingCycle === 'monthly' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow' : 'text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    onClick={() => setBillingCycle('yearly')}
                    className={`px-5 py-2.5 text-sm font-medium rounded transition-all ${
                      billingCycle === 'yearly' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow' : 'text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    Yearly (Save ~17%)
                  </button>
                </div>
              </div>

              <div className="grid gap-4" role="radiogroup" aria-label="Pricing plan">
                {tiers.map((tier) => {
                  const price = billingCycle === 'monthly' ? tier.priceMonthly : tier.priceYearly / 12
                  const isTierSelected = selectedTier === tier.id
                  return (
                    <button
                      key={tier.id}
                      role="radio"
                      aria-checked={isTierSelected}
                      onClick={() => setSelectedTier(tier.id)}
                      className={`relative p-5 rounded-md border-2 text-left transition-all duration-200 ${
                        isTierSelected
                          ? 'border-gray-900 dark:border-white bg-gray-50 dark:bg-gray-700 ring-1 ring-gray-900/10 dark:ring-white/10'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 hover:shadow-md'
                      }`}
                    >
                      {isTierSelected && (
                        <div className="absolute top-3 right-3 w-6 h-6 bg-gray-900 dark:bg-white rounded-full flex items-center justify-center">
                          <Check className="w-3.5 h-3.5 text-white dark:text-gray-900" />
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-gray-900 dark:text-white">{tier.displayName}</div>
                          <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {tier.maxUsers ? `Up to ${tier.maxUsers} users` : 'Unlimited users'}
                            {tier.maxSalesMonthly && ` - ${tier.maxSalesMonthly.toLocaleString()} sales/month`}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-gray-900 dark:text-white">
                            {formatCurrencyWithSymbol(convertPrice(price), displayCurrency)}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">/month</div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              {tiers.length === 0 && (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Loading plans...
                </div>
              )}

              <div className="flex justify-end pt-4">
                <button
                  onClick={() => setStep(1)}
                  disabled={!selectedTier}
                  className="px-6 py-3 bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 1: Select business type */}
          {step === 1 && (
            <div className="space-y-6" role="region" aria-label="Select business type">
              {hasExistingCompanies && selectedTierInfo && (
                <div className="flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-900/30 rounded-md border border-blue-200 dark:border-blue-800">
                  <CreditCard className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
                    {selectedTierInfo.displayName} - {formatCurrencyWithSymbol(
                      convertPrice(billingCycle === 'monthly' ? selectedTierInfo.priceMonthly : selectedTierInfo.priceYearly / 12),
                      displayCurrency
                    )}/month
                  </span>
                  <button
                    onClick={() => setStep(0)}
                    className="ml-auto text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                  >
                    Change
                  </button>
                </div>
              )}

              <h3 className="font-semibold text-gray-900 dark:text-white text-center text-lg">
                What type of business are you creating?
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4" role="radiogroup" aria-label="Business type">
                {BUSINESS_TYPES.map((type) => {
                  const isSelected = selectedType === type.value
                  return (
                    <button
                      key={type.value}
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setSelectedType(type.value)}
                      className={`relative p-5 rounded-md border-2 text-left transition-all duration-200 ${
                        isSelected
                          ? 'border-gray-900 dark:border-white bg-gray-50 dark:bg-gray-700 ring-1 ring-gray-900/10 dark:ring-white/10'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-md hover:-translate-y-0.5'
                      }`}
                    >
                      {isSelected && (
                        <div className="absolute top-3 right-3 w-6 h-6 bg-gray-900 dark:bg-white rounded-full flex items-center justify-center">
                          <Check className="w-3.5 h-3.5 text-white dark:text-gray-900" />
                        </div>
                      )}
                      <div className={`w-12 h-12 rounded-md flex items-center justify-center mb-3 ${type.color}`}>
                        <type.icon className="w-6 h-6" />
                      </div>
                      <div className={`font-semibold ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                        {type.label}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">{type.description}</div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {type.features.map((feature) => (
                          <span key={feature} className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-full">
                            {feature}
                          </span>
                        ))}
                      </div>
                    </button>
                  )
                })}
              </div>
              <div className="flex justify-between pt-4">
                {hasExistingCompanies && (
                  <button
                    onClick={() => setStep(0)}
                    className="px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
                  >
                    Back
                  </button>
                )}
                <button
                  onClick={() => setStep(2)}
                  disabled={!selectedType}
                  className={`px-6 py-3 bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium ${!hasExistingCompanies ? 'ml-auto' : ''}`}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Enter details */}
          {step === 2 && (
            <div className="space-y-5" role="region" aria-label="Business details">
              {selectedTypeInfo && (
                <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-700 rounded-md border border-gray-200 dark:border-gray-600">
                  <div className={`w-10 h-10 rounded-md flex items-center justify-center ${selectedTypeInfo.color}`}>
                    <selectedTypeInfo.icon className="w-5 h-5" />
                  </div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{selectedTypeInfo.label}</span>
                  <button
                    onClick={() => setStep(1)}
                    className="ml-auto text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium"
                  >
                    Change
                  </button>
                </div>
              )}

              <h3 className="font-semibold text-gray-900 dark:text-white text-lg">
                Enter your business details
              </h3>

              {error && (
                <div role="alert" className="p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-md text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-5">
                <FormField label="Business Name" required>
                  <FormInput
                    id="name"
                    value={formData.name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="My Business"
                    inputSize="lg"
                  />
                </FormField>

                <FormField label="Business Code" required hint="3–25 characters. Lowercase letters, numbers, and hyphens only.">
                  <div className="flex items-center">
                    <FormInput
                      id="slug"
                      value={formData.slug}
                      onChange={(e) => handleSlugChange(e.target.value)}
                      placeholder="my-business"
                      className="flex-1 font-mono"
                      inputSize="lg"
                      maxLength={25}
                      aria-describedby="slug-status slug-preview"
                    />
                  </div>
                  {formData.slug && (
                    <>
                      <div id="slug-status" className="mt-1.5 flex items-center gap-1.5 text-xs">
                        {slugStatus?.checking ? (
                          <span className="text-gray-400 dark:text-gray-500 flex items-center gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Checking availability...
                          </span>
                        ) : slugStatus?.available ? (
                          <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                            <Check className="w-3 h-3" />
                            Available
                          </span>
                        ) : slugStatus?.reason ? (
                          <span className="text-red-500 dark:text-red-400">{slugStatus.reason}</span>
                        ) : null}
                        <span className="text-gray-400 dark:text-gray-500 ml-auto">{formData.slug.length}/25</span>
                      </div>
                      <div id="slug-preview" className="mt-1 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
                        <Globe className="w-3 h-3" />
                        <span className="font-mono">{formData.slug}.retailsmarterp.com</span>
                      </div>
                    </>
                  )}
                </FormField>

                <FormField label="Business Email" optional>
                  <FormInput
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="contact@mybusiness.com"
                    inputSize="lg"
                  />
                </FormField>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Phone">
                    <FormInput
                      id="phone"
                      value={formData.phone}
                      onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
                      placeholder="+1 234 567 8900"
                      inputSize="lg"
                    />
                  </FormField>
                  <FormField label="Address">
                    <FormInput
                      id="address"
                      value={formData.address}
                      onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
                      placeholder="123 Main St, City"
                      inputSize="lg"
                    />
                  </FormField>
                </div>

                <FormField label="Country" required>
                  <FormSelect
                    id="country"
                    value={formData.country}
                    onChange={(e) => handleCountryChange(e.target.value)}
                    required
                    selectSize="lg"
                  >
                    <option value="">Select country</option>
                    {countries.map((country) => (
                      <option key={country.code} value={country.code}>
                        {country.name} ({country.currency})
                      </option>
                    ))}
                  </FormSelect>
                </FormField>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField label="Date Format" required>
                    <FormSelect
                      id="dateFormat"
                      value={formData.dateFormat}
                      onChange={(e) => setFormData((prev) => ({ ...prev, dateFormat: e.target.value }))}
                      required
                      selectSize="lg"
                    >
                      <option value="">Select format</option>
                      {dateFormats.map((format) => (
                        <option key={format.value} value={format.value}>
                          {format.label}
                        </option>
                      ))}
                    </FormSelect>
                  </FormField>
                  <FormField label="Time Format" required>
                    <FormSelect
                      id="timeFormat"
                      value={formData.timeFormat}
                      onChange={(e) => setFormData((prev) => ({ ...prev, timeFormat: e.target.value }))}
                      required
                      selectSize="lg"
                    >
                      <option value="">Select format</option>
                      {timeFormats.map((format) => (
                        <option key={format.value} value={format.value}>
                          {format.label}
                        </option>
                      ))}
                    </FormSelect>
                  </FormField>
                </div>
              </div>

              {/* AI Features Toggle */}
              <div className={`p-4 rounded-md border transition-all duration-500 ${
                aiEnabled
                  ? 'border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/30 shadow-sm shadow-violet-100'
                  : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700'
              }`}>
                <FormCheckbox
                  label="Enable AI Features"
                  description="Chat assistant, business insights, smart suggestions, and error analysis"
                  checked={aiEnabled}
                  onChange={() => {
                    if (!aiEnabled) {
                      setShowAIConsent(true)
                    } else {
                      setAiEnabled(false)
                    }
                  }}
                />
                {aiEnabled && (
                  <p className="mt-2 ml-7 text-xs text-violet-600 dark:text-violet-400 animate-in fade-in slide-in-from-bottom-1 duration-300">
                    AI features will be enabled using Google Gemini and DeepSeek.
                  </p>
                )}
              </div>

              <AIConsentModal
                isOpen={showAIConsent}
                onClose={() => setShowAIConsent(false)}
                onAgree={() => {
                  setShowAIConsent(false)
                  setAiEnabled(true)
                  setShowAIAnimation(true)
                }}
              />

              <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-3 pt-4 sm:pt-6">
                <button
                  onClick={() => setStep(1)}
                  className="px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading || !formData.name || !formData.slug || !formData.country || !formData.dateFormat || !formData.timeFormat || !slugStatus?.available}
                  className="px-6 py-3 bg-gray-900 text-white rounded-md hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {hasExistingCompanies ? 'Saving...' : 'Creating...'}
                    </>
                  ) : (
                    hasExistingCompanies ? 'Continue to Payment' : 'Create Business'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Info text */}
      <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
        {hasExistingCompanies ? (
          'After submitting, you will be redirected to complete your payment.'
        ) : (
          <span className="flex items-center justify-center gap-2">
            <Sparkles className="w-4 h-4 text-green-500" />
            Your first business is completely free forever. No credit card required.
          </span>
        )}
      </div>

      {/* Fullscreen AI Enabled Animation */}
      {showAIAnimation && <AIEnabledOverlay onComplete={() => setShowAIAnimation(false)} />}
    </div>
  )
}

export default function NewCompanyPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    }>
      <NewCompanyForm />
    </Suspense>
  )
}
