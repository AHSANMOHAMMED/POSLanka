'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Check, Sparkles, Shield, Users, Zap, Globe, Gift,
} from 'lucide-react'
import {
  PageWrapper,
  BlurFadeIn,
  FadeIn,
  StaggerContainer,
  StaggerItem,
  HeroBadge,
} from '@/components/landing/motion'
import SectionHeading from '@/components/landing/SectionHeading'
import PricingCard from '@/components/landing/PricingCard'
import ComparisonTable from '@/components/landing/ComparisonTable'
import FAQAccordion from '@/components/landing/FAQAccordion'
import CTASection from '@/components/landing/CTASection'
import { useCurrencyDisplay } from '@/hooks/use-currency-display'

interface ApiTier {
  id: string
  name: string
  displayName: string
  priceMonthly: string | null
  priceYearly: string | null
  currency: string
  maxDatabaseBytes: number | null
  maxFileStorageBytes: number | null
  features: Record<string, unknown>
  sortOrder: number
}

interface DisplayTier {
  name: string
  price: string
  period: string
  features: string[]
  popular?: boolean
  storage?: string
  fileStorage?: string
  currencyNote?: string
  currencyCode?: string
  isCustom?: boolean
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes === 0) return 'Unlimited'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function buildFeatureList(tier: ApiTier, isCustom: boolean): string[] {
  const features: string[] = []
  features.push('All Features Included')
  features.push('Unlimited Users')
  features.push('Unlimited Locations')
  if (isCustom) {
    features.push(tier.maxDatabaseBytes ? `${formatBytes(tier.maxDatabaseBytes)} Database` : 'Custom Database Storage')
    features.push(tier.maxFileStorageBytes ? `${formatBytes(tier.maxFileStorageBytes)} File Storage` : 'Custom File Storage')
  } else {
    if (tier.maxDatabaseBytes) features.push(`${formatBytes(tier.maxDatabaseBytes)} Database`)
    if (tier.maxFileStorageBytes) features.push(`${formatBytes(tier.maxFileStorageBytes)} File Storage`)
  }
  features.push('Email Support')
  return features
}

const fallbackTiers: DisplayTier[] = [
  {
    name: 'Free',
    price: 'Free',
    period: 'forever',
    features: ['All Features Included', 'Unlimited Users', 'Unlimited Locations', '20 MB Database', '20 MB File Storage', 'Email Support'],
    storage: '20 MB',
    fileStorage: '20 MB',
  },
  {
    name: 'Starter',
    price: 'Rs 1,990',
    period: 'month',
    features: ['All Features Included', 'Unlimited Users', 'Unlimited Locations', '500 MB Database', '500 MB File Storage', 'Email Support'],
    storage: '500 MB',
    fileStorage: '500 MB',
  },
  {
    name: 'Professional',
    price: 'Rs 4,990',
    period: 'month',
    features: ['All Features Included', 'Unlimited Users', 'Unlimited Locations', '3 GB Database', '2 GB File Storage', 'Email Support'],
    popular: true,
    storage: '3 GB',
    fileStorage: '2 GB',
  },
  {
    name: 'Business',
    price: 'Rs 9,990',
    period: 'month',
    features: ['All Features Included', 'Unlimited Users', 'Unlimited Locations', '10 GB Database', '5 GB File Storage', 'Email Support'],
    storage: '10 GB',
    fileStorage: '5 GB',
  },
  {
    name: 'Enterprise',
    price: 'Rs 24,990',
    period: 'month',
    features: ['All Features Included', 'Unlimited Users', 'Unlimited Locations', '50 GB Database', '25 GB File Storage', 'Email Support'],
    storage: '50 GB',
    fileStorage: '25 GB',
  },
]

const faqItems = [
  {
    question: "What's included in the free plan?",
    answer: 'The Free plan includes every feature — POS, inventory, restaurant, auto service, accounting, HR, AI insights, and more. You get unlimited users and locations with 20 MB of database and file storage each. Perfect for trying out the system.',
  },
  {
    question: 'Why do all plans have the same features?',
    answer: 'We believe every business deserves access to all tools. You only pay for storage as your data grows. No feature gating, no surprises.',
  },
  {
    question: 'Can I switch plans anytime?',
    answer: 'Yes! You can upgrade or downgrade your plan at any time. Changes take effect immediately and billing is prorated.',
  },
  {
    question: 'Is there a contract?',
    answer: 'No contracts. All plans are month-to-month or annual. Cancel anytime with no penalties.',
  },
  {
    question: 'Do you offer discounts for annual billing?',
    answer: 'Annual billing is available at a discounted rate. The exact discount is shown on each plan.',
  },
  {
    question: 'What happens when I run out of storage?',
    answer: 'You\'ll receive warnings at 80% and 95% usage. At 100%, write operations pause while reads continue working. Upgrade instantly to increase your quota — no data loss.',
  },
  {
    question: 'What payment methods do you accept?',
    answer: 'We accept all major credit and debit cards via our secure payment gateway. For enterprise plans, we also offer bank transfers and custom invoicing.',
  },
  {
    question: 'Is my data secure?',
    answer: 'Absolutely. We use database-level data isolation, encrypted connections, and regular backups. Your data is completely separated from other businesses.',
  },
]

const highlights = [
  { icon: Gift, label: 'Free Forever', description: 'First company is 100% free. No trial, no expiry.', gradient: 'from-emerald-500 to-teal-500' },
  { icon: Sparkles, label: 'AI-Powered Analytics', description: 'AI chat assistant and smart warnings built in.', gradient: 'from-violet-500 to-purple-500' },
  { icon: Users, label: 'Unlimited Users', description: 'No per-user fees on any plan.', gradient: 'from-blue-500 to-sky-500' },
  { icon: Shield, label: 'Advanced Security', description: 'Complete data isolation and encryption.', gradient: 'from-stone-600 to-stone-700' },
  { icon: Zap, label: 'Real-Time Sync', description: 'Real-time live updates.', gradient: 'from-amber-500 to-orange-500' },
  { icon: Globe, label: 'Multi-Currency', description: 'Support for all currencies worldwide.', gradient: 'from-pink-500 to-rose-500' },
  { icon: Check, label: 'No Feature Gating', description: 'Every feature on every plan.', gradient: 'from-blue-600 to-violet-600' },
]

export default function PricingClient() {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly')
  const [apiTiers, setApiTiers] = useState<ApiTier[]>([])
  const [tiers, setTiers] = useState<DisplayTier[]>(fallbackTiers)
  const { currency, symbol, loading: currencyLoading, convertFromLKR, formatPrice } = useCurrencyDisplay('geoip')

  const fetchPricing = useCallback(async () => {
    try {
      const res = await fetch('/api/public/pricing-tiers')
      if (!res.ok) throw new Error('Failed to fetch pricing')
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) {
        setApiTiers(data)
      }
    } catch {
      // Keep fallback tiers
    }
  }, [])

  useEffect(() => {
    fetchPricing()
  }, [fetchPricing])

  useEffect(() => {
    if (apiTiers.length === 0 || currencyLoading) return

    const displayTiers: DisplayTier[] = apiTiers.map((tier) => {
      const isCustom = tier.priceMonthly == null && tier.priceYearly == null

      if (isCustom) {
        return {
          name: tier.displayName,
          price: 'Custom',
          period: 'custom',
          features: buildFeatureList(tier, true),
          popular: tier.name === 'professional',
          storage: tier.maxDatabaseBytes ? formatBytes(tier.maxDatabaseBytes) : undefined,
          fileStorage: tier.maxFileStorageBytes ? formatBytes(tier.maxFileStorageBytes) : undefined,
          isCustom: true,
        }
      }

      const priceLKR = billingCycle === 'annual'
        ? Number(tier.priceYearly) / 12
        : Number(tier.priceMonthly)

      const isFree = priceLKR === 0
      const isConverted = currency !== 'LKR'

      let priceDisplay: string
      if (isFree) {
        priceDisplay = 'Free'
      } else if (isConverted) {
        const converted = convertFromLKR(priceLKR)
        priceDisplay = `${symbol}${converted.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
      } else {
        priceDisplay = `Rs ${priceLKR.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
      }

      return {
        name: tier.displayName,
        price: priceDisplay,
        period: isFree ? 'forever' : 'month',
        features: buildFeatureList(tier, false),
        popular: tier.name === 'professional',
        storage: tier.maxDatabaseBytes ? formatBytes(tier.maxDatabaseBytes) : undefined,
        fileStorage: tier.maxFileStorageBytes ? formatBytes(tier.maxFileStorageBytes) : undefined,
        currencyNote: (!isFree && isConverted) ? '~' : undefined,
        currencyCode: (!isFree && isConverted) ? currency : undefined,
      }
    })

    setTiers(displayTiers)
  }, [apiTiers, billingCycle, currency, currencyLoading, convertFromLKR, formatPrice, symbol])

  const comparisonHeaders = apiTiers.length > 0
    ? apiTiers.map(t => t.displayName)
    : ['Free', 'Starter', 'Professional', 'Business', 'Enterprise']

  const comparisonRows = apiTiers.length > 0
    ? [
        { feature: 'All Features', values: apiTiers.map(() => true as boolean | string) },
        { feature: 'Unlimited Users', values: apiTiers.map(() => true as boolean | string) },
        { feature: 'Unlimited Locations', values: apiTiers.map(() => true as boolean | string) },
        { feature: 'POS & Inventory', values: apiTiers.map(() => true as boolean | string) },
        { feature: 'Restaurant Module', values: apiTiers.map(() => true as boolean | string) },
        { feature: 'Auto Service Module', values: apiTiers.map(() => true as boolean | string) },
        { feature: 'Accounting & HR', values: apiTiers.map(() => true as boolean | string) },
        { feature: 'AI Insights', values: apiTiers.map(() => true as boolean | string) },
        { feature: 'API Access', values: apiTiers.map(() => true as boolean | string) },
        { feature: 'Database Storage', values: apiTiers.map(t => (t.maxDatabaseBytes ? formatBytes(t.maxDatabaseBytes) : (t.priceMonthly == null ? 'Custom' : 'Unlimited')) as boolean | string) },
        { feature: 'File Storage', values: apiTiers.map(t => (t.maxFileStorageBytes ? formatBytes(t.maxFileStorageBytes) : (t.priceMonthly == null ? 'Custom' : 'Unlimited')) as boolean | string) },
        { feature: 'Support', values: apiTiers.map(() => true as boolean | string) },
      ]
    : [
        { feature: 'All Features', values: [true, true, true, true, true] as (boolean | string)[] },
        { feature: 'Unlimited Users', values: [true, true, true, true, true] as (boolean | string)[] },
        { feature: 'Database Storage', values: ['20 MB', '500 MB', '3 GB', '10 GB', '50 GB'] as (boolean | string)[] },
        { feature: 'File Storage', values: ['20 MB', '500 MB', '2 GB', '5 GB', '25 GB'] as (boolean | string)[] },
      ]

  return (
    <PageWrapper>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden pt-32 pb-24" style={{ background: 'linear-gradient(135deg, #09090b 0%, rgba(99,102,241,0.03) 50%, rgba(139,92,246,0.03) 100%)' }}>
        <div className="mesh-gradient-hero" />
        <div className="noise-overlay" />
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <BlurFadeIn>
            <HeroBadge text="All Features Included" icon={<Sparkles className="w-4 h-4 text-violet-600" />} className="mb-5" />
          </BlurFadeIn>
          <BlurFadeIn delay={0.1}>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight tracking-tight">
              Simple, <span className="gradient-text-animate">Transparent</span> Pricing
            </h1>
          </BlurFadeIn>
          <BlurFadeIn delay={0.2}>
            <p className="mt-6 text-lg sm:text-xl text-zinc-400 leading-relaxed max-w-2xl mx-auto">
              All features on every plan. Unlimited users. Only pay for storage as you grow. Your first company is free forever — no credit card needed.
            </p>
          </BlurFadeIn>
        </div>
      </section>

      {/* ── Billing Toggle + Pricing Cards ── */}
      <section className="section-bg-white pb-20 sm:pb-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 relative z-10">
          {/* Billing Toggle */}
          <FadeIn className="flex flex-col items-center gap-3 mb-14">
            <div className="inline-flex items-center bg-white/10 rounded-md p-1">
              <button
                onClick={() => setBillingCycle('monthly')}
                className={`px-5 py-2.5 text-sm font-semibold rounded transition-all ${
                  billingCycle === 'monthly'
                    ? 'bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-600/25'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingCycle('annual')}
                className={`px-5 py-2.5 text-sm font-semibold rounded transition-all inline-flex items-center gap-2 ${
                  billingCycle === 'annual'
                    ? 'bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-600/25'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                Annual
                <span className="inline-flex items-center px-2 py-0.5 text-xs font-bold rounded-full bg-emerald-500/10 text-emerald-400">
                  Save 20%
                </span>
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Your first company is always free
              {currency !== 'LKR' && !currencyLoading && (
                <span> &middot; Prices shown in {currency} (approximate conversion)</span>
              )}
            </p>
          </FadeIn>

          {/* Cards */}
          <StaggerContainer staggerDelay={0.1} className={`grid sm:grid-cols-2 gap-6 lg:gap-8 ${tiers.length <= 3 ? 'lg:grid-cols-3 max-w-5xl mx-auto' : tiers.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}>
            {tiers.map((tier) => (
              <StaggerItem key={tier.name}>
                <PricingCard
                  name={tier.name}
                  price={tier.price}
                  period={tier.period}
                  features={tier.features}
                  popular={tier.popular}
                  storage={tier.storage}
                  fileStorage={tier.fileStorage}
                  currencyNote={tier.currencyNote}
                  currencyCode={tier.currencyCode}
                  isCustom={tier.isCustom}
                />
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ── Highlights ── */}
      <section className="section-bg-subtle py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
              {highlights.map((h) => (
                <div key={h.label} className="flex flex-col items-center gap-2 text-center">
                  <div className={`w-10 h-10 rounded-md bg-gradient-to-br ${h.gradient} flex items-center justify-center shadow-lg`}>
                    <h.icon className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-xs font-semibold text-zinc-300">{h.label}</span>
                  <span className="text-[10px] text-zinc-500 leading-tight">{h.description}</span>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── Comparison Table ── */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Compare Plans"
            title="All features, every plan"
            highlight="every plan"
          />
          <ComparisonTable
            headers={comparisonHeaders}
            rows={comparisonRows}
          />
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="FAQ"
            title="Frequently asked questions"
            highlight="questions"
          />
          <FAQAccordion items={faqItems} />
        </div>
      </section>

      {/* ── CTA ── */}
      <CTASection
        title="Get started for free today"
        subtitle="Free Forever · No Credit Card. All features included from day one. Unlimited users."
      />
    </PageWrapper>
  )
}
