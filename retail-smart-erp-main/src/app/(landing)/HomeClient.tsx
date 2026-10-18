'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import {
  Sparkles, Shield, Users, Store, BarChart3, ShoppingCart,
  Package, Calculator, Utensils, Monitor, Wrench, Car, Brain,
  ShieldCheck, Check, UserPlus, Settings, Rocket, ArrowRight, Gift,
} from 'lucide-react'
import {
  PageWrapper, FadeIn, BlurFadeIn, HeroBadge, TrustBar,
  StaggerContainer, StaggerItem, FloatingMockup, CountUpOnView, LogoMarquee,
} from '@/components/landing/motion'
import SectionHeading from '@/components/landing/SectionHeading'
import FeatureTabSwitcher from '@/components/landing/FeatureTabSwitcher'
import CTASection from '@/components/landing/CTASection'
import TestimonialCarousel from '@/components/landing/TestimonialCarousel'
import PricingCard from '@/components/landing/PricingCard'
import AIBadge from '@/components/landing/AIBadge'
import {
  MockPOS, MockDashboard, MockKitchenDisplay,
  MockWorkOrders, MockInventory, MockAccounting, MockTables,
  MockBrowserFrame,
} from '@/components/landing/mockups'
import { useCurrencyDisplay } from '@/hooks'

/* ── All features by category ── */
const allFeatures = [
  { category: 'Point of Sale', color: 'bg-emerald-500', items: ['Fast Checkout', 'Barcode Scanning', 'Held Sales', 'Layaway', 'Split Payments', 'Gift Cards', 'Loyalty Points', 'Daily Summary'] },
  { category: 'Inventory', color: 'bg-amber-500', items: ['Multi-Warehouse', 'Stock Transfers', 'Reorder Alerts', 'Batch Tracking', 'Stock Movements', 'Purchase Orders', 'Suppliers'] },
  { category: 'Accounting', color: 'bg-sky-500', items: ['Chart of Accounts', 'Journal Entries', 'Bank Accounts', 'Budgets', 'Cost Centers', 'Tax Templates', 'Period Closing'] },
  { category: 'HR & Payroll', color: 'bg-violet-500', items: ['Employee Records', 'Salary Structures', 'Payroll Runs', 'Salary Slips', 'Employee Advances', 'Attendance'] },
  { category: 'Restaurant', color: 'bg-orange-500', items: ['Kitchen Display', 'Table Management', 'Floor Plan', 'Reservations', 'Recipe Costing', 'Waste Tracking', 'Deliveries'] },
  { category: 'Auto Service', color: 'bg-rose-500', items: ['Work Orders', 'Vehicle Tracking', 'Inspections', 'Insurance Estimates', 'Parts Management', 'Labor Guides'] },
  { category: 'Platform', color: 'bg-stone-500', items: ['Real-time sync', 'AI Intelligence', 'Multi-Currency', 'Role-Based Access', 'Custom Reports', 'Export Excel/PDF'] },
]

/* ── Pricing helpers ── */
interface ApiTier {
  name: string
  displayName: string
  priceMonthly: string | null
  currency: string
  maxDatabaseBytes: number | null
  maxFileStorageBytes: number | null
}

function formatBytesShort(bytes: number | null): string {
  if (!bytes || bytes === 0) return 'Unlimited'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const fallbackPricingTiers = [
  { name: 'Free', price: 'Free', period: 'forever', features: ['All Features', 'Unlimited Users', '80 MB Database', '100 MB Files'] },
  { name: 'Starter', price: 'Rs 1,990', period: 'month', features: ['All Features', 'Unlimited Users', '500 MB Database', '500 MB Files'] },
  { name: 'Professional', price: 'Rs 4,990', period: 'month', features: ['All Features', 'Unlimited Users', '3 GB Database', '2 GB Files'], popular: true },
]

export default function HomeClient() {
  const [pricingTiers, setPricingTiers] = useState(fallbackPricingTiers)
  const { currency, symbol, loading: currencyLoading, convertFromLKR } = useCurrencyDisplay('geoip')

  useEffect(() => {
    if (currencyLoading) return
    let cancelled = false

    async function loadPricing() {
      try {
        const res = await fetch('/api/public/pricing-tiers')
        if (!res.ok || cancelled) return
        const data: ApiTier[] = await res.json()
        if (!Array.isArray(data) || data.length === 0 || cancelled) return

        const isConverted = currency !== 'LKR'
        const preview = data.slice(0, 3).map((tier) => {
          const isCustom = tier.priceMonthly == null
          if (isCustom) {
            return {
              name: tier.displayName,
              price: 'Custom',
              period: 'custom',
              features: [
                'All Features',
                'Unlimited Users',
                tier.maxDatabaseBytes ? `${formatBytesShort(tier.maxDatabaseBytes)} Database` : 'Custom Storage',
              ],
              popular: tier.name === 'professional',
              isCustom: true,
            }
          }
          const priceLKR = Number(tier.priceMonthly)
          const isFree = priceLKR === 0
          let priceDisplay: string
          if (isFree) {
            priceDisplay = 'Free'
          } else if (isConverted) {
            const converted = convertFromLKR(priceLKR)
            priceDisplay = `~${symbol}${converted.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
          } else {
            priceDisplay = `Rs ${priceLKR.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
          }
          const features: string[] = ['All Features', 'Unlimited Users']
          if (tier.maxDatabaseBytes) features.push(`${formatBytesShort(tier.maxDatabaseBytes)} Database`)
          if (tier.maxFileStorageBytes) features.push(`${formatBytesShort(tier.maxFileStorageBytes)} Files`)
          return {
            name: tier.displayName,
            price: priceDisplay,
            period: isFree ? 'forever' : 'month',
            features,
            popular: tier.name === 'professional',
            isCustom: false,
          }
        })
        if (!cancelled) setPricingTiers(preview)
      } catch {
        /* Keep fallback */
      }
    }
    loadPricing()
    return () => { cancelled = true }
  }, [currency, symbol, currencyLoading, convertFromLKR])

  /* ── Feature tab data with mockups ── */
  const featureTabs = [
    { key: 'pos', label: 'Point of Sale', icon: ShoppingCart, gradient: 'from-emerald-500 to-teal-500', mockup: <MockPOS />, description: 'Fast, intuitive checkout with barcode scanning, multiple payment methods, and real-time inventory updates.', features: ['Barcode & SKU scanning', 'Multiple payment methods', 'Held sales & layaway', 'Returns and exchanges', 'Receipt printing & email', 'Gift card support'] },
    { key: 'inventory', label: 'Inventory', icon: Package, gradient: 'from-amber-500 to-orange-500', mockup: <MockInventory />, description: 'Multi-warehouse tracking with reorder alerts, stock transfers, and complete movement history.', features: ['Multi-warehouse support', 'Smart reorder alerts', 'Stock transfers', 'Batch & serial tracking', 'Min/max stock levels', 'Movement history'] },
    { key: 'accounting', label: 'Accounting', icon: Calculator, gradient: 'from-sky-500 to-blue-500', mockup: <MockAccounting />, description: 'Complete double-entry accounting with chart of accounts, journal entries, bank reconciliation, and financial insights.', features: ['Chart of accounts', 'Journal entries', 'Bank reconciliation', 'Financial statements', 'Tax management', 'Budget tracking'] },
    { key: 'hr', label: 'HR & Payroll', icon: Users, gradient: 'from-violet-500 to-purple-500', mockup: <MockDashboard />, description: 'Employee management, salary structures, payroll runs, advances, attendance tracking, and leave management.', features: ['Employee profiles', 'Salary structures', 'Payroll processing', 'Employee advances', 'Attendance tracking', 'Leave management'] },
    { key: 'kitchen', label: 'Restaurant Kitchen', icon: Utensils, gradient: 'from-orange-500 to-red-500', mockup: <MockKitchenDisplay />, description: 'Real-time kitchen display system with order queues, status tracking, and automatic notifications.', features: ['Order queue management', 'Status tracking', 'Priority ordering', 'Cook time tracking', 'Auto-notifications', 'Multi-station support'] },
    { key: 'tables', label: 'Tables', icon: Monitor, gradient: 'from-rose-500 to-pink-500', mockup: <MockTables />, description: 'Visual table management with floor plan designer, real-time status updates, and reservation integration.', features: ['Floor plan designer', 'Real-time table status', 'Table merging & splitting', 'Reservation linking', 'Capacity management', 'Waiter assignment'] },
    { key: 'workorders', label: 'Auto Service', icon: Wrench, gradient: 'from-indigo-500 to-violet-500', mockup: <MockWorkOrders />, description: 'Complete work order management with vehicle tracking, inspections, and insurance estimate integration.', features: ['Work order management', 'Vehicle tracking', 'Multi-point inspections', 'Insurance estimates', 'Parts management', 'Labor guides'] },
    { key: 'dashboard', label: 'AI Dashboard', icon: Brain, gradient: 'from-emerald-600 to-amber-500', mockup: <MockDashboard />, description: 'Real-time dashboards with AI chat assistant, sales analytics, and business intelligence.', features: ['Real-time metrics', 'AI chat assistant', 'Sales trend analysis', 'Smart warnings', 'Custom reports', 'Export to Excel/PDF'] },
  ]

  return (
    <PageWrapper>
      {/* ══════════════════════════════════════════════
          Section 1 — Hero (full viewport, image bg)
         ══════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex items-center overflow-hidden">
        {/* Background image */}
        <Image
          src="https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=1920"
          alt=""
          fill
          priority
          quality={90}
          className="object-cover"
          sizes="100vw"
        />
        <div className="hero-image-overlay" />
        <div className="noise-overlay" />

        {/* Content */}
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 sm:py-32">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left column */}
            <BlurFadeIn>
              <div>
                <div className="flex flex-wrap items-center gap-3 mb-6">
                  <HeroBadge
                    text="AI-Powered Business Platform"
                    icon={<Sparkles className="w-4 h-4 text-emerald-600" />}
                    className="!bg-white/10 !border-white/20 !text-white backdrop-blur-sm !mb-0"
                  />
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 backdrop-blur-sm">
                    <Check className="w-3.5 h-3.5" />
                    Free Forever
                  </span>
                </div>
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-[1.1] text-white tracking-tight">
                  The Smart ERP for{' '}
                  <span className="gradient-text-animate">Every Business</span>
                </h1>
                <p className="mt-6 text-lg sm:text-xl text-white/80 leading-relaxed max-w-xl">
                  POS, inventory, accounting, HR, and AI analytics — all in one platform.
                  Built for retail, restaurants, supermarkets, and auto service.{' '}
                  <strong className="text-white">Free Forever. Unlimited Users. No Credit Card.</strong>
                </p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <Link
                    href="/register"
                    className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 rounded-md transition-all shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40 hover:-translate-y-0.5"
                  >
                    Get Started Free
                    <ArrowRight className="w-5 h-5" />
                  </Link>
                  <Link
                    href="/features"
                    className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold border border-white/30 text-white hover:bg-white/10 rounded-md transition-all hover:-translate-y-0.5"
                  >
                    See All Features
                  </Link>
                </div>
                <div className="mt-8 flex flex-wrap items-center gap-6 text-sm text-white/60">
                  <div className="flex items-center gap-1.5">
                    <Gift className="w-4 h-4 text-emerald-400" />
                    Free Forever
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-emerald-400" />
                    Unlimited Users
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-amber-400" />
                    Advanced Security
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-rose-400" />
                    AI-Powered
                  </div>
                </div>
              </div>
            </BlurFadeIn>

            {/* Right column — Dashboard mockup */}
            <FadeIn className="hidden lg:block" delay={0.3}>
              <FloatingMockup>
                <MockBrowserFrame url="app.retailsmarterp.com/dashboard">
                  <MockDashboard />
                </MockBrowserFrame>
              </FloatingMockup>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 2 — Logo Marquee (tech stack)
         ══════════════════════════════════════════════ */}
      <section className="section-bg-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="text-center mb-8">
            <p className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
              Built with Modern Technology
            </p>
          </FadeIn>
          <LogoMarquee speed={30}>
            {[
              'Modern Stack', 'Real-Time Sync', 'Complete Data Isolation',
              'AI Analytics', 'Advanced Security', 'Multi-Currency', 'Mobile Ready', 'Cloud Native',
            ].map((tech) => (
              <span
                key={tech}
                className="inline-flex items-center px-5 py-2.5 rounded-full bg-white/10 text-zinc-300 text-sm font-semibold border border-white/10 whitespace-nowrap"
              >
                {tech}
              </span>
            ))}
          </LogoMarquee>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 3 — Trust Bar
         ══════════════════════════════════════════════ */}
      <TrustBar
        metrics={[
          { value: 'High', label: 'Availability', icon: <Shield className="w-5 h-5 text-emerald-600" /> },
          { value: 'Unlimited', label: 'Users', icon: <Users className="w-5 h-5 text-amber-600" /> },
          { value: '5', label: 'Business Types', icon: <Store className="w-5 h-5 text-rose-600" /> },
          { value: 'AI', label: 'Powered', icon: <Sparkles className="w-5 h-5 text-violet-600" /> },
        ]}
      />

      {/* ══════════════════════════════════════════════
          Section 4 — Feature Tabs
         ══════════════════════════════════════════════ */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Live Preview"
            title="Explore by category"
            highlight="category"
            subtitle="Click any tab to see exactly how RetailSmart works for your business."
          />
          <FeatureTabSwitcher tabs={featureTabs} />
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 5 — Business Types (2x2 image cards)
         ══════════════════════════════════════════════ */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Built For You"
            title="Built for your business type"
            highlight="your business"
          />
          <StaggerContainer staggerDelay={0.1} className="grid md:grid-cols-2 gap-6">
            {/* Retail */}
            <StaggerItem>
              <Link href="/retail" className="group relative block overflow-hidden rounded-2xl h-80">
                <Image
                  src="https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800"
                  alt="Retail store"
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-blue-900/90 via-sky-600/50 to-transparent" />
                <div className="absolute inset-0 p-6 flex flex-col justify-end">
                  <div className="flex items-center gap-2 mb-2">
                    <Store className="w-5 h-5 text-sky-300" />
                    <h3 className="text-xl font-bold text-white">Retail Store</h3>
                  </div>
                  <p className="text-white/80 text-sm max-w-sm mb-3">
                    Complete POS with barcode scanning, multi-warehouse inventory, loyalty programs, and layaway.
                  </p>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-sky-300 group-hover:text-white transition-colors">
                    Explore <ArrowRight className="w-4 h-4" />
                  </span>
                </div>
                <div className="absolute top-4 right-4 w-24 opacity-60 group-hover:opacity-80 transition-opacity">
                  <div className="transform scale-[0.15] origin-top-right">
                    <MockPOS />
                  </div>
                </div>
              </Link>
            </StaggerItem>

            {/* Restaurant */}
            <StaggerItem>
              <Link href="/restaurant" className="group relative block overflow-hidden rounded-2xl h-80">
                <Image
                  src="https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800"
                  alt="Restaurant"
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-red-900/90 via-orange-600/50 to-transparent" />
                <div className="absolute inset-0 p-6 flex flex-col justify-end">
                  <div className="flex items-center gap-2 mb-2">
                    <Utensils className="w-5 h-5 text-orange-300" />
                    <h3 className="text-xl font-bold text-white">Restaurant</h3>
                  </div>
                  <p className="text-white/80 text-sm max-w-sm mb-3">
                    Kitchen display, table management, reservations, recipe costing, and multi-channel orders.
                  </p>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-orange-300 group-hover:text-white transition-colors">
                    Explore <ArrowRight className="w-4 h-4" />
                  </span>
                </div>
                <div className="absolute top-4 right-4 w-24 opacity-60 group-hover:opacity-80 transition-opacity">
                  <div className="transform scale-[0.15] origin-top-right">
                    <MockKitchenDisplay />
                  </div>
                </div>
              </Link>
            </StaggerItem>

            {/* Supermarket */}
            <StaggerItem>
              <Link href="/supermarket" className="group relative block overflow-hidden rounded-2xl h-80">
                <Image
                  src="https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=800"
                  alt="Supermarket"
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-emerald-900/90 via-green-600/50 to-transparent" />
                <div className="absolute inset-0 p-6 flex flex-col justify-end">
                  <div className="flex items-center gap-2 mb-2">
                    <ShoppingCart className="w-5 h-5 text-emerald-300" />
                    <h3 className="text-xl font-bold text-white">Supermarket</h3>
                  </div>
                  <p className="text-white/80 text-sm max-w-sm mb-3">
                    High-volume checkout, department management, batch tracking, and category analytics.
                  </p>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-300 group-hover:text-white transition-colors">
                    Explore <ArrowRight className="w-4 h-4" />
                  </span>
                </div>
                <div className="absolute top-4 right-4 w-24 opacity-60 group-hover:opacity-80 transition-opacity">
                  <div className="transform scale-[0.15] origin-top-right">
                    <MockInventory />
                  </div>
                </div>
              </Link>
            </StaggerItem>

            {/* Auto Service */}
            <StaggerItem>
              <Link href="/auto-service" className="group relative block overflow-hidden rounded-2xl h-80">
                <Image
                  src="https://images.unsplash.com/photo-1487754180451-c456f719a1fc?w=800"
                  alt="Auto service workshop"
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-purple-900/90 via-violet-600/50 to-transparent" />
                <div className="absolute inset-0 p-6 flex flex-col justify-end">
                  <div className="flex items-center gap-2 mb-2">
                    <Wrench className="w-5 h-5 text-violet-300" />
                    <h3 className="text-xl font-bold text-white">Auto Service</h3>
                  </div>
                  <p className="text-white/80 text-sm max-w-sm mb-3">
                    Work orders, vehicle tracking, inspections, insurance estimates, and parts management.
                  </p>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-violet-300 group-hover:text-white transition-colors">
                    Explore <ArrowRight className="w-4 h-4" />
                  </span>
                </div>
                <div className="absolute top-4 right-4 w-24 opacity-60 group-hover:opacity-80 transition-opacity">
                  <div className="transform scale-[0.15] origin-top-right">
                    <MockWorkOrders />
                  </div>
                </div>
              </Link>
            </StaggerItem>

            {/* Vehicle Dealership */}
            <StaggerItem className="md:col-span-2">
              <Link href="/dealership" className="group relative block overflow-hidden rounded-2xl h-80">
                <Image
                  src="https://images.unsplash.com/photo-1580273916550-e323be2ae537?w=1200"
                  alt="Vehicle dealership showroom"
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  sizes="100vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-cyan-900/90 via-teal-600/50 to-transparent" />
                <div className="absolute inset-0 p-6 flex flex-col justify-end">
                  <div className="flex items-center gap-2 mb-2">
                    <Car className="w-5 h-5 text-cyan-300" />
                    <h3 className="text-xl font-bold text-white">Vehicle Dealership</h3>
                  </div>
                  <p className="text-white/80 text-sm max-w-lg mb-3">
                    New and used vehicle sales, trade-in management, test drive scheduling, financing, and full inventory tracking for cars, motorbikes, and more.
                  </p>
                  <span className="inline-flex items-center gap-1 text-sm font-semibold text-cyan-300 group-hover:text-white transition-colors">
                    Explore <ArrowRight className="w-4 h-4" />
                  </span>
                </div>
              </Link>
            </StaggerItem>
          </StaggerContainer>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 6 — AI Showcase (dark section)
         ══════════════════════════════════════════════ */}
      <section className="bg-stone-900 py-20 sm:py-28 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-600/10 rounded-full blur-[120px]" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-[120px]" />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="AI Intelligence"
            title="Powered by AI Intelligence"
            highlight="AI Intelligence"
            gradientClass="gradient-text-emerald-gold"
            className="[&_h2]:text-white [&_p]:text-stone-400 [&_span.inline-block]:!bg-gradient-to-r [&_span.inline-block]:from-amber-500/10 [&_span.inline-block]:to-emerald-500/10 [&_span.inline-block]:!text-amber-400 [&_span.inline-block]:!border-amber-500/30"
          />
          <StaggerContainer staggerDelay={0.1} className="grid sm:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              {
                icon: Brain,
                title: 'Smart Inventory Alerts',
                description: 'Set min/max stock levels and get automated alerts when items need reordering, helping reduce stockouts and overstock.',
                iconBg: 'from-emerald-500 to-emerald-600',
              },
              {
                icon: BarChart3,
                title: 'Sales Pattern Analysis',
                description: 'Ask the AI chat assistant about your sales trends, peak hours, best-selling items, and more — get instant answers in natural language.',
                iconBg: 'from-amber-500 to-amber-600',
              },
              {
                icon: ShieldCheck,
                title: 'Intelligent Error Detection',
                description: 'Built-in smart warnings flag potential issues like unusual transactions, missing data, or configuration problems for your review.',
                iconBg: 'from-rose-500 to-rose-600',
              },
            ].map((item) => (
              <StaggerItem key={item.title}>
                <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 hover:bg-white/[0.08] transition-colors">
                  <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${item.iconBg} flex items-center justify-center mb-4 shadow-lg`}>
                    <item.icon className="w-7 h-7 text-white" />
                  </div>
                  <AIBadge size="md" className="mb-3 !bg-amber-500/10 !text-amber-400 !border-amber-500/30" />
                  <h3 className="text-lg font-bold text-white mb-2">{item.title}</h3>
                  <p className="text-sm text-stone-400 leading-relaxed">{item.description}</p>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 7 — Complete Feature Grid
         ══════════════════════════════════════════════ */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="All Features"
            title="Everything your business needs"
            highlight="Everything"
            subtitle="All features are included on every plan. No feature gating, no hidden costs."
          />
          <StaggerContainer staggerDelay={0.06} className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {allFeatures.map((group) => (
              <StaggerItem key={group.category}>
                <div className="bg-white/5 rounded-2xl border border-white/10 p-5 shadow-sm hover:shadow-md transition-shadow">
                  <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${group.color}`} />
                    {group.category}
                  </h3>
                  <ul className="space-y-1.5">
                    {group.items.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-sm text-zinc-400">
                        <Check className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 8 — Stats Counter (dark)
         ══════════════════════════════════════════════ */}
      <section className="cta-mesh-dark py-20 sm:py-24 relative overflow-hidden">
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <StaggerContainer staggerDelay={0.12} className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { value: 4, label: 'Business Types', suffix: '' },
              { value: 15, label: 'Access Roles', suffix: '+' },
              { value: 8, label: 'Core Modules', suffix: '+' },
              { value: 65, label: 'Secured Tables', suffix: '+' },
            ].map((stat) => (
              <StaggerItem key={stat.label}>
                <div className="text-center">
                  <div className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight">
                    <CountUpOnView
                      value={stat.value}
                      suffix={stat.suffix}
                      decimals={(stat as { decimals?: number }).decimals || 0}
                    />
                  </div>
                  <div className="mt-2 text-sm font-medium text-stone-400">{stat.label}</div>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 9 — How It Works
         ══════════════════════════════════════════════ */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Get Started"
            title="Get started in 3 steps"
            highlight="3 steps"
          />
          <div className="max-w-3xl mx-auto">
            <StaggerContainer staggerDelay={0.15} className="relative">
              {/* Connecting gradient line */}
              <div className="absolute left-6 top-12 bottom-12 w-0.5 bg-gradient-to-b from-emerald-500 to-amber-500 hidden sm:block" />
              <div className="space-y-12">
                {[
                  {
                    number: 1,
                    icon: UserPlus,
                    title: 'Create Account',
                    description: 'Sign up in seconds. Your first company is free forever. Choose your country and verify your email.',
                  },
                  {
                    number: 2,
                    icon: Settings,
                    title: 'Configure Business',
                    description: 'Select your business type. Add products, set up departments, configure staff roles and permissions.',
                  },
                  {
                    number: 3,
                    icon: Rocket,
                    title: 'Start Selling',
                    description: 'Go live instantly. Process sales, track inventory, and grow your business with AI-powered insights.',
                  },
                ].map((step) => (
                  <StaggerItem key={step.number}>
                    <div className="flex gap-6 items-start">
                      <div className="relative z-10 flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-emerald-600 to-amber-500 text-white flex items-center justify-center font-bold text-lg shadow-lg shadow-emerald-600/25">
                        {step.number}
                      </div>
                      <div className="pt-1">
                        <div className="flex items-center gap-2 mb-1">
                          <step.icon className="w-5 h-5 text-emerald-600" />
                          <h3 className="text-xl font-bold text-white">{step.title}</h3>
                        </div>
                        <p className="mt-1 text-zinc-400 leading-relaxed">{step.description}</p>
                      </div>
                    </div>
                  </StaggerItem>
                ))}
              </div>
            </StaggerContainer>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 10 — Testimonials
         ══════════════════════════════════════════════ */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Testimonials"
            title="Built for every business type"
            highlight="every business"
          />
          <TestimonialCarousel />
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 11 — Pricing Preview
         ══════════════════════════════════════════════ */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Pricing"
            title="Simple, transparent pricing"
            highlight="transparent pricing"
            subtitle="All features on every plan. No per-user fees. Your first company is free forever."
          />

          {/* All features badge */}
          <FadeIn className="text-center -mt-6 mb-10">
            <span className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-emerald-500/10 text-emerald-400 text-sm font-semibold border border-emerald-500/30">
              <Check className="w-4 h-4" />
              All features included on every plan
            </span>
          </FadeIn>

          <StaggerContainer staggerDelay={0.1} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {pricingTiers.map((tier) => (
              <StaggerItem key={tier.name}>
                <PricingCard
                  name={tier.name}
                  price={tier.price}
                  period={tier.period}
                  features={tier.features}
                  popular={tier.popular}
                  isCustom={(tier as { isCustom?: boolean }).isCustom}
                />
              </StaggerItem>
            ))}
          </StaggerContainer>
          <FadeIn className="text-center mt-10">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              View full pricing <ArrowRight className="w-4 h-4" />
            </Link>
          </FadeIn>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 12 — CTA
         ══════════════════════════════════════════════ */}
      <CTASection
        title="Ready to transform your business?"
        subtitle="Start managing your business with RetailSmart ERP. All features included, unlimited users, free forever."
      />
    </PageWrapper>
  )
}
