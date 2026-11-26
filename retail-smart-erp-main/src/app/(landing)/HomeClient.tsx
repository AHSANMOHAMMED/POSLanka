'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import {
  Sparkles, Shield, Users, Store, ShoppingCart,
  Package, Calculator, Utensils, Monitor, Wrench, Car, Brain,
  Check, UserPlus, Settings, Rocket, ArrowRight, Phone,
  MessageCircle, Printer, ScanBarcode, Smartphone, Fingerprint,
  AlertTriangle, CheckCircle2, Tag, MapPin,
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

/* ── All features by category ── */
const allFeatures = [
  { category: 'Point of Sale', color: 'bg-[#0050c0]', items: ['Fast LKR Checkout', 'Barcode Scanning', 'Held Sales & Layaway', 'Returns & Exchanges', 'Split Payments', 'Gift Cards & Loyalty', 'Sinhala & English Receipts', 'Daily Shift Summary'] },
  { category: 'Inventory', color: 'bg-sky-500', items: ['Multi-Warehouse', 'Stock Transfers', 'Reorder Alerts', 'Batch & Expiry Tracking', 'Stock Movements', 'Purchase Orders', 'Supplier Ledgers'] },
  { category: 'Accounting', color: 'bg-indigo-500', items: ['Chart of Accounts', 'Journal Entries', 'Bank Reconciliation', 'Budgets & Cost Centers', 'Tax Templates', 'Profit & Loss / Balance Sheet'] },
  { category: 'HR & Payroll', color: 'bg-violet-500', items: ['Employee Records', 'Salary Structures', 'Payroll Runs & Slips', 'Employee Advances', 'ZKTeco Biometric Sync', 'Leave Management'] },
  { category: 'Restaurant', color: 'bg-orange-500', items: ['Kitchen Display (KDS)', 'Table Floor Plan', 'KOT Thermal Printing', 'Reservations', 'Recipe Costing', 'Waste Tracking'] },
  { category: 'Auto Service', color: 'bg-rose-500', items: ['Job Cards & Work Orders', 'Vehicle History', 'Multi-Point Inspections', 'Insurance Estimates', 'Parts Management', 'Labor Guides'] },
  { category: 'Platform & Mobile', color: 'bg-blue-400', items: ['Android POS & Admin Apps', 'Offline Queue Sync', 'AI Error & Sales Insights', 'Role-Based Permissions', 'WhatsApp & Email Alerts', 'Export Excel / PDF'] },
]

/* ── Business types: Problem → POS Solution + Devices ── */
const businessSolutions = [
  {
    title: 'Retail Shops & Boutiques',
    href: '/retail',
    icon: Store,
    image: '/images/landing/biz-retail.jpg',
    problem: 'Manual price tags, slow hand-written bills, staff pricing errors, and missing stock counts at month-end.',
    solution: 'Scan barcodes in under 1 second, print branded 80mm/58mm receipts, track every size/color variant, and monitor profit from your phone.',
    devices: ['Touchscreen POS', '2D Barcode Scanner', '80mm Thermal Printer', 'Android POS App'],
    accent: 'text-sky-300',
    badgeBg: 'bg-[#0050c0]/80 border-sky-400/40',
  },
  {
    title: 'Supermarkets & Mini-Marts',
    href: '/supermarket',
    icon: ShoppingCart,
    image: 'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=1200',
    problem: 'Long customer queues during rush hours, expired shelf stock, and multi-counter cash mismatches.',
    solution: 'Dual-screen checkout with live Customer Display, batch & expiry alerts, barcode label printing, and instant shift reconciliation.',
    devices: ['Dual-Screen POS', 'Customer Display', 'Barcode Label Printer', 'Cash Drawer'],
    accent: 'text-emerald-300',
    badgeBg: 'bg-emerald-700/80 border-emerald-400/40',
  },
  {
    title: 'Restaurants, Cafes & Bakeries',
    href: '/restaurant',
    icon: Utensils,
    image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1200',
    problem: 'Lost paper KOTs, delayed kitchen orders, table bill confusion, and untracked ingredient waste.',
    solution: 'Waiters punch orders on tablets, KOTs print or appear live on the Kitchen Display System (KDS), and tables split/merge cleanly.',
    devices: ['Tablet POS', 'Kitchen Display (KDS)', 'Thermal KOT Printer', 'Mobile Waiter App'],
    accent: 'text-orange-300',
    badgeBg: 'bg-orange-700/80 border-orange-400/40',
  },
  {
    title: 'Auto Service & Garages',
    href: '/auto-service',
    icon: Wrench,
    image: 'https://images.unsplash.com/photo-1487754180451-c456f719a1fc?w=1200',
    problem: 'Lost job cards, unbilled spare parts, messy insurance estimates, and no vehicle service history.',
    solution: 'Digital work orders by vehicle plate number, mechanic bay tracking, spare parts deduction, and one-click insurance & customer invoices.',
    devices: ['Workshop Tablet', 'Desktop ERP', 'A4 / Thermal Printer', 'Parts Barcode Scanner'],
    accent: 'text-violet-300',
    badgeBg: 'bg-violet-700/80 border-violet-400/40',
  },
  {
    title: 'Dealerships, Hardware & Wholesale',
    href: '/dealership',
    icon: Car,
    image: '/images/landing/biz-dealership.jpg',
    problem: 'Credit/installment balances slipping through cracks, multi-warehouse stock blind spots, and staff attendance disputes.',
    solution: 'Centralized multi-branch stock transfers, customer credit ledgers, ZKTeco fingerprint attendance sync, and Super Admin mobile control.',
    devices: ['Desktop / Laptop ERP', 'ZKTeco Fingerprint', 'Warehouse Scanner', 'skyERPOS Admin App'],
    accent: 'text-cyan-300',
    badgeBg: 'bg-cyan-800/80 border-cyan-400/40',
    wide: true,
  },
]

/* ── Hardware & Device Ecosystem ── */
const supportedDevices = [
  {
    icon: Monitor,
    title: 'Touchscreen POS & Desktop',
    detail: 'Works on any Windows, Mac, or Linux browser plus dedicated dual-screen POS counters with live Customer Display.',
  },
  {
    icon: Smartphone,
    title: 'Android POS & Admin Apps',
    detail: 'Official skyERPOS & skyERPOS Admin apps with offline billing queue, Bluetooth printing, and instant owner alerts.',
  },
  {
    icon: Printer,
    title: 'Thermal & Label Printers',
    detail: 'Plug-and-play 80mm / 58mm thermal receipt & KOT printers (USB, LAN, Bluetooth) plus ZPL/TSPL barcode stickers.',
  },
  {
    icon: ScanBarcode,
    title: '1D/2D Barcode Scanners',
    detail: 'Instant SKU, weight-embedded, and batch scanning via USB, wireless dongle, or Android camera.',
  },
  {
    icon: Fingerprint,
    title: 'ZKTeco Biometric Attendance',
    detail: 'Direct ADMS push integration for staff check-in/out synced straight into monthly Sri Lankan payroll runs.',
  },
  {
    icon: MessageCircle,
    title: 'WhatsApp & Email Receipts',
    detail: 'Send digital LKR invoices, payment due reminders, and daily owner summaries automatically.',
  },
]

/* ── Pricing helpers ── */
interface ApiTier {
  name: string
  displayName: string
  priceMonthly: string | null
  priceYearly?: string | null
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

interface PricingCardData {
  name: string
  monthlyLkr: number | null
  features: string[]
  popular?: boolean
  isCustom?: boolean
}

const fallbackPricingTiers: PricingCardData[] = [
  {
    name: 'Starter Shop',
    monthlyLkr: 1990,
    features: ['All POS & ERP Features', 'Unlimited Staff Users', '500 MB Database', '500 MB File Storage', 'WhatsApp & Email Support'],
  },
  {
    name: 'Business Growth',
    monthlyLkr: 3990,
    popular: true,
    features: ['All POS & ERP Features', 'Unlimited Staff Users', '3 GB Database', '2 GB File Storage', 'Multi-Warehouse & KDS', 'Priority Setup & Training'],
  },
  {
    name: 'Multi-Branch Enterprise',
    monthlyLkr: 7990,
    features: ['All POS & ERP Features', 'Unlimited Branches & Users', '10 GB+ Database', '5 GB+ File Storage', 'ZKTeco & Custom Onboarding', 'Up to 30% Multi-Branch Discount'],
  },
]

const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN || 'app.skyerpos.com'
const appLoginUrl = `https://${appDomain}/login`

export default function HomeClient() {
  const [tiers, setTiers] = useState<PricingCardData[]>(fallbackPricingTiers)
  const [annual, setAnnual] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadPricing() {
      try {
        const res = await fetch('/api/public/pricing-tiers')
        if (!res.ok || cancelled) return
        const data: ApiTier[] = await res.json()
        if (!Array.isArray(data) || data.length === 0 || cancelled) return

        const paid = data.filter((t) => t.priceMonthly == null || Number(t.priceMonthly) > 0)
        const source = paid.length >= 3 ? paid.slice(0, 3) : data.slice(0, 3)

        const mapped: PricingCardData[] = source.map((tier, idx) => {
          const isCustom = tier.priceMonthly == null
          const features: string[] = ['All POS & ERP Features', 'Unlimited Users']
          if (tier.maxDatabaseBytes) features.push(`${formatBytesShort(tier.maxDatabaseBytes)} Database`)
          if (tier.maxFileStorageBytes) features.push(`${formatBytesShort(tier.maxFileStorageBytes)} Files`)
          features.push('Free Setup & Training')
          return {
            name: tier.displayName,
            monthlyLkr: isCustom ? null : Number(tier.priceMonthly),
            features,
            popular: tier.name === 'professional' || idx === 1,
            isCustom,
          }
        })
        if (!cancelled && mapped.length > 0) setTiers(mapped)
      } catch {
        /* Keep Sri Lankan LKR fallback tiers */
      }
    }
    loadPricing()
    return () => { cancelled = true }
  }, [])

  /* ── Feature tab data with mockups ── */
  const featureTabs = [
    { key: 'pos', label: 'Point of Sale', icon: ShoppingCart, gradient: 'from-[#0050c0] to-[#2563eb]', mockup: <MockPOS />, description: 'Fast LKR checkout with barcode scanning, split payments, returns/exchanges, and thermal receipt printing.', features: ['Barcode & SKU scanning', 'Cash, Card, Bank & Credit', 'Held sales & layaway', 'Instant returns & exchanges', '80mm / 58mm thermal printing', 'Gift cards & loyalty points'] },
    { key: 'inventory', label: 'Inventory', icon: Package, gradient: 'from-sky-500 to-blue-600', mockup: <MockInventory />, description: 'Multi-warehouse tracking with reorder alerts, stock transfers, and batch/expiry control.', features: ['Multi-warehouse support', 'Low-stock reorder alerts', 'Branch stock transfers', 'Batch & expiry tracking', 'Purchase orders & GRN', 'Supplier ledger history'] },
    { key: 'accounting', label: 'Accounting', icon: Calculator, gradient: 'from-indigo-500 to-[#0050c0]', mockup: <MockAccounting />, description: 'Double-entry accounting with chart of accounts, journal entries, bank reconciliation, and tax reports.', features: ['Chart of accounts', 'Journal entries', 'Bank reconciliation', 'Profit & Loss statements', 'Tax templates', 'Expense tracking'] },
    { key: 'hr', label: 'HR & Payroll', icon: Users, gradient: 'from-violet-500 to-indigo-600', mockup: <MockDashboard />, description: 'Employee profiles, ZKTeco biometric attendance, salary structures, advances, and monthly payroll.', features: ['Employee profiles', 'ZKTeco fingerprint sync', 'Salary structures', 'Monthly payroll runs', 'Salary advances', 'Leave management'] },
    { key: 'kitchen', label: 'Restaurant KDS', icon: Utensils, gradient: 'from-orange-500 to-red-500', mockup: <MockKitchenDisplay />, description: 'Real-time kitchen display system with order queues, KOT thermal printing, and table status.', features: ['Live kitchen order queue', 'Thermal KOT printing', 'Priority ordering', 'Cook time tracking', 'Multi-station routing', 'Dine-in & takeaway'] },
    { key: 'tables', label: 'Tables', icon: Monitor, gradient: 'from-rose-500 to-pink-600', mockup: <MockTables />, description: 'Visual restaurant floor plan with real-time table status, merging, splitting, and waiter orders.', features: ['Floor plan designer', 'Live table status', 'Table merge & split', 'Reservations', 'Waiter assignment', 'QR menu support'] },
    { key: 'workorders', label: 'Auto Service', icon: Wrench, gradient: 'from-blue-600 to-violet-600', mockup: <MockWorkOrders />, description: 'Complete garage job cards with vehicle plate history, inspections, spare parts, and insurance estimates.', features: ['Vehicle job cards', 'Service history by plate', 'Multi-point inspections', 'Insurance estimates', 'Spare parts deduction', 'Labor charge guides'] },
    { key: 'dashboard', label: 'AI Dashboard', icon: Brain, gradient: 'from-[#0050c0] to-cyan-500', mockup: <MockDashboard />, description: 'Real-time owner analytics with AI insights, error monitoring, and branch-by-branch sales.', features: ['Live sales & profit KPIs', 'AI business assistant', 'Sales trend forecasts', 'Low-margin warnings', 'Daily owner reports', 'Export Excel & PDF'] },
  ]

  return (
    <PageWrapper>
      {/* ══════════════════════════════════════════════
          Section 1 — Hero (Realistic POS & Hardware)
         ══════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex items-center overflow-hidden pt-16">
        <Image
          src="/images/landing/hero-pos-devices.jpg"
          alt="skyERPOS touchscreen terminal, thermal receipt printer, barcode scanner and mobile POS"
          fill
          priority
          quality={90}
          className="object-cover object-center"
          sizes="100vw"
        />
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(105deg, rgba(6,10,22,0.94) 0%, rgba(6,16,42,0.86) 52%, rgba(0,40,110,0.58) 100%)',
          }}
        />
        <div className="noise-overlay" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 w-full">
          <div className="grid lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Left column */}
            <BlurFadeIn className="lg:col-span-7">
              <div>
                <div className="flex flex-wrap items-center gap-3 mb-6">
                  <HeroBadge
                    text="skyERPOS · By Skyloom Techno"
                    icon={<Sparkles className="w-4 h-4 text-sky-400" />}
                    className="!bg-[#0050c0]/25 !border-sky-400/35 !text-white backdrop-blur-sm !mb-0"
                  />
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-full bg-emerald-500/15 border border-emerald-400/35 text-emerald-300 backdrop-blur-sm">
                    <Tag className="w-3.5 h-3.5" />
                    25% Off Annual Plans · Affordable LKR
                  </span>
                </div>

                <h1 className="text-4xl sm:text-5xl lg:text-[3.5rem] font-extrabold leading-[1.08] text-white tracking-tight">
                  Complete POS &amp; ERP for{' '}
                  <span className="bg-gradient-to-r from-sky-300 via-blue-400 to-cyan-300 bg-clip-text text-transparent">
                    Sri Lankan Businesses
                  </span>
                </h1>

                <p className="mt-6 text-lg sm:text-xl text-zinc-200 leading-relaxed max-w-2xl">
                  Solve slow billing, stock theft, and messy accounts with one fast system.
                  Works on <strong className="text-white">Touchscreen POS, Laptops &amp; Android Phones</strong> with
                  80mm thermal printers, barcode scanners, and <strong className="text-sky-300">LKR / Sinhala / English</strong> support.
                </p>

                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <Link
                    href="/contact"
                    className="inline-flex items-center gap-2 px-7 py-4 text-base font-bold text-white bg-gradient-to-r from-[#0050c0] to-[#2563eb] hover:from-[#00419e] hover:to-[#1d4ed8] rounded-lg transition-all shadow-lg shadow-[#0050c0]/35 hover:-translate-y-0.5"
                  >
                    Book Free Demo
                    <ArrowRight className="w-5 h-5" />
                  </Link>
                  <a
                    href="https://wa.me/94741228682?text=Hi%20skyERPOS%2C%20I%20would%20like%20a%20free%20demo%20and%20LKR%20pricing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-7 py-4 text-base font-semibold text-white bg-emerald-600/90 hover:bg-emerald-600 rounded-lg transition-all shadow-lg shadow-emerald-600/20 hover:-translate-y-0.5"
                  >
                    <MessageCircle className="w-5 h-5" />
                    WhatsApp +94 74 122 8682
                  </a>
                  <a
                    href={appLoginUrl}
                    className="inline-flex items-center gap-2 px-6 py-4 text-base font-semibold border border-white/25 text-white hover:bg-white/10 rounded-lg transition-all"
                  >
                    Sign In to Store
                  </a>
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-zinc-300">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-sky-400" />
                    Plans from Rs. 1,490/mo
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-sky-400" />
                    Unlimited Staff Users
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Smartphone className="w-4 h-4 text-sky-400" />
                    Offline Android POS Included
                  </div>
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-sky-400" />
                    Kalpitiya, Puttalam · Islandwide Support
                  </div>
                </div>
              </div>
            </BlurFadeIn>

            {/* Right column — Realistic Hardware + Live UI card */}
            <FadeIn className="lg:col-span-5 hidden lg:block" delay={0.2}>
              <FloatingMockup>
                <div className="rounded-2xl overflow-hidden border border-white/15 bg-zinc-950/75 backdrop-blur-md shadow-2xl shadow-[#0050c0]/25">
                  <div className="relative h-60 w-full">
                    <Image
                      src="/images/landing/hero-pos-devices.jpg"
                      alt="All-in-one POS terminal, thermal printer, barcode scanner and Android mobile app"
                      fill
                      className="object-cover"
                      sizes="(max-width: 1024px) 100vw, 42vw"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-transparent to-transparent" />
                    <span className="absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-bold bg-[#0050c0] text-white shadow">
                      Hardware + Cloud Ready
                    </span>
                  </div>
                  <div className="p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-white">Complete Counter &amp; Mobile Setup</span>
                      <span className="text-xs font-semibold text-sky-300">app.skyerpos.com</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-zinc-300">
                      <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2 border border-white/10">
                        <Monitor className="w-4 h-4 text-sky-400 flex-shrink-0" />
                        <span>Touchscreen POS</span>
                      </div>
                      <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2 border border-white/10">
                        <Printer className="w-4 h-4 text-sky-400 flex-shrink-0" />
                        <span>80mm Thermal Print</span>
                      </div>
                      <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2 border border-white/10">
                        <ScanBarcode className="w-4 h-4 text-sky-400 flex-shrink-0" />
                        <span>2D Barcode Scan</span>
                      </div>
                      <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2 border border-white/10">
                        <Smartphone className="w-4 h-4 text-sky-400 flex-shrink-0" />
                        <span>Android POS App</span>
                      </div>
                    </div>
                  </div>
                </div>
              </FloatingMockup>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 2 — Capability Marquee
         ══════════════════════════════════════════════ */}
      <section className="section-bg-white py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <LogoMarquee speed={30}>
            {[
              'LKR & Multi-Currency', 'Sinhala & English Receipts', 'Offline Android POS',
              '80mm & 58mm Thermal Print', 'ZKTeco Biometric Sync', 'WhatsApp Invoices',
              'Multi-Branch Inventory', 'Double-Entry Accounting', '25% Annual Discount',
            ].map((tech) => (
              <span
                key={tech}
                className="inline-flex items-center px-5 py-2 rounded-full bg-[#0050c0]/10 text-sky-200 text-sm font-semibold border border-[#0050c0]/30 whitespace-nowrap"
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
          { value: 'Rs. 1,490', label: 'Starting / Month', icon: <Tag className="w-5 h-5 text-sky-400" /> },
          { value: 'Unlimited', label: 'Staff Users', icon: <Users className="w-5 h-5 text-blue-400" /> },
          { value: '5+', label: 'Business Types', icon: <Store className="w-5 h-5 text-cyan-400" /> },
          { value: '24/7', label: 'Cloud & Offline Sync', icon: <Shield className="w-5 h-5 text-emerald-400" /> },
        ]}
      />

      {/* ══════════════════════════════════════════════
          Section 4 — Business Types: Problem → Solution + Devices
         ══════════════════════════════════════════════ */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Problems Solved"
            title="Real business problems solved with skyERPOS &amp; devices"
            highlight="skyERPOS &amp; devices"
            subtitle="Every business type faces daily bottlenecks. See how skyERPOS software + affordable POS hardware fix them from day one."
          />

          <StaggerContainer staggerDelay={0.08} className="grid md:grid-cols-2 gap-7">
            {businessSolutions.map((biz) => (
              <StaggerItem key={biz.title} className={biz.wide ? 'md:col-span-2' : ''}>
                <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/90 shadow-xl flex flex-col justify-between min-h-[430px]">
                  {/* Background image */}
                  <div className="relative h-52 sm:h-56 w-full overflow-hidden">
                    <Image
                      src={biz.image}
                      alt={biz.title}
                      fill
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                      sizes={biz.wide ? '100vw' : '(max-width: 768px) 100vw, 50vw'}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/45 to-transparent" />
                    <div className="absolute bottom-4 left-6 right-6 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className={`p-2 rounded-lg border ${biz.badgeBg} text-white backdrop-blur-sm`}>
                          <biz.icon className="w-5 h-5" />
                        </span>
                        <h3 className="text-xl sm:text-2xl font-bold text-white">{biz.title}</h3>
                      </div>
                      <Link
                        href={biz.href}
                        className={`inline-flex items-center gap-1 text-sm font-semibold ${biz.accent} hover:text-white transition-colors`}
                      >
                        Preview <ArrowRight className="w-4 h-4" />
                      </Link>
                    </div>
                  </div>

                  {/* Problem + Solution + Devices */}
                  <div className="p-6 space-y-4 flex-1 flex flex-col justify-between">
                    <div className={`grid gap-3 ${biz.wide ? 'md:grid-cols-2' : ''}`}>
                      <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-3.5">
                        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-rose-300 mb-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          The Problem &amp; Need
                        </div>
                        <p className="text-sm text-zinc-300 leading-relaxed">{biz.problem}</p>
                      </div>
                      <div className="rounded-xl bg-[#0050c0]/15 border border-[#0050c0]/35 p-3.5">
                        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-sky-300 mb-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          skyERPOS Solution
                        </div>
                        <p className="text-sm text-zinc-200 leading-relaxed">{biz.solution}</p>
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                        Recommended POS &amp; Devices
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {biz.devices.map((dev) => (
                          <span
                            key={dev}
                            className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-white/5 text-zinc-200 border border-white/10"
                          >
                            {dev}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 5 — Supported POS Hardware & Devices
         ══════════════════════════════════════════════ */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Devices &amp; Hardware"
            title="Works with real POS hardware &amp; Android phones"
            highlight="real POS hardware"
            subtitle="Use your existing laptop or Android phone, or pair skyERPOS with thermal printers, barcode scanners, and biometric devices."
          />

          <StaggerContainer staggerDelay={0.06} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {supportedDevices.map((device) => (
              <StaggerItem key={device.title}>
                <div className="h-full rounded-2xl border border-white/10 bg-white/5 p-6 hover:border-[#0050c0]/50 transition-colors">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#0050c0] to-[#2563eb] text-white flex items-center justify-center mb-4 shadow-lg shadow-[#0050c0]/25">
                    <device.icon className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{device.title}</h3>
                  <p className="text-sm text-zinc-300 leading-relaxed">{device.detail}</p>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 6 — Interactive Software Preview Tabs
         ══════════════════════════════════════════════ */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Live Preview"
            title="Explore skyERPOS by module"
            highlight="by module"
            subtitle="Click any module below to preview how skyERPOS handles billing, stock, kitchen orders, garages, and accounts."
          />
          <FeatureTabSwitcher tabs={featureTabs} />
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 7 — AI Intelligence Showcase
         ══════════════════════════════════════════════ */}
      <section className="cta-mesh-dark py-20 sm:py-24 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <FadeIn>
              <AIBadge />
              <h2 className="mt-4 text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                Smart alerts that protect your cash &amp; stock
              </h2>
              <p className="mt-4 text-lg text-zinc-300 leading-relaxed">
                Get instant low-stock warnings, slow-moving item insights, daily owner summaries, and automated payment due reminders — without needing an IT team.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <Link
                  href="/features"
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-bold text-white bg-[#0050c0] hover:bg-[#00419e] rounded-lg transition-colors"
                >
                  Explore All Features
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </FadeIn>
            <FadeIn delay={0.15}>
              <MockBrowserFrame url="app.skyerpos.com/dashboard">
                <MockDashboard />
              </MockBrowserFrame>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 8 — Complete Feature Grid
         ══════════════════════════════════════════════ */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="All Features"
            title="Everything your business needs"
            highlight="Everything"
            subtitle="All modules included on every plan. No hidden per-user charges."
          />
          <StaggerContainer staggerDelay={0.05} className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {allFeatures.map((group) => (
              <StaggerItem key={group.category}>
                <div className="h-full bg-white/5 rounded-2xl border border-white/10 p-5 shadow-sm hover:border-[#0050c0]/40 transition-colors">
                  <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${group.color}`} />
                    {group.category}
                  </h3>
                  <ul className="space-y-1.5">
                    {group.items.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-sm text-zinc-300">
                        <Check className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
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
          Section 9 — Stats Counter
         ══════════════════════════════════════════════ */}
      <section className="cta-mesh-dark py-20 sm:py-24 relative overflow-hidden">
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <StaggerContainer staggerDelay={0.12} className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { value: 5, label: 'Business Types', suffix: '+' },
              { value: 15, label: 'Role Permissions', suffix: '+' },
              { value: 25, label: 'Annual Discount', suffix: '%' },
              { value: 65, label: 'Secured Modules', suffix: '+' },
            ].map((stat) => (
              <StaggerItem key={stat.label}>
                <div className="text-center">
                  <div className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight">
                    <CountUpOnView value={stat.value} suffix={stat.suffix} />
                  </div>
                  <div className="mt-2 text-sm font-medium text-zinc-300">{stat.label}</div>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 10 — How It Works (3 Steps)
         ══════════════════════════════════════════════ */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Fast Onboarding"
            title="Go live in 3 simple steps"
            highlight="3 simple steps"
          />
          <div className="max-w-3xl mx-auto">
            <StaggerContainer staggerDelay={0.15} className="relative">
              <div className="absolute left-6 top-12 bottom-12 w-0.5 bg-gradient-to-b from-[#0050c0] to-sky-400 hidden sm:block" />
              <div className="space-y-12">
                {[
                  {
                    number: 1,
                    icon: UserPlus,
                    title: 'Book Your Free Demo',
                    description: 'Call or WhatsApp +94 74 122 8682 (or message skyloomtechno@gmail.com). We tailor the demo to your exact shop type.',
                  },
                  {
                    number: 2,
                    icon: Settings,
                    title: 'We Set Up Your Store & Devices',
                    description: 'We configure your business subdomain (<yourshop>.skyerpos.com), import items, connect thermal printers/scanners, and set staff permissions.',
                  },
                  {
                    number: 3,
                    icon: Rocket,
                    title: 'Start Selling & Track Everything',
                    description: 'Bill customers fast on desktop or Android, print LKR/Sinhala receipts, and watch live stock and profits from anywhere.',
                  },
                ].map((step) => (
                  <StaggerItem key={step.number}>
                    <div className="flex gap-6 items-start">
                      <div className="relative z-10 flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-[#0050c0] to-[#2563eb] text-white flex items-center justify-center font-bold text-lg shadow-lg shadow-[#0050c0]/30">
                        {step.number}
                      </div>
                      <div className="pt-1">
                        <div className="flex items-center gap-2 mb-1">
                          <step.icon className="w-5 h-5 text-sky-400" />
                          <h3 className="text-xl font-bold text-white">{step.title}</h3>
                        </div>
                        <p className="mt-1 text-zinc-300 leading-relaxed">{step.description}</p>
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
          Section 11 — Testimonials
         ══════════════════════════════════════════════ */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Trusted Across Sri Lanka"
            title="Built for local shops &amp; growing chains"
            highlight="local shops"
          />
          <TestimonialCarousel />
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 12 — Sri Lankan Affordable LKR Pricing + Discounts
         ══════════════════════════════════════════════ */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Affordable LKR Pricing"
            title="Simple, affordable pricing in Sri Lankan Rupees"
            highlight="Sri Lankan Rupees"
            subtitle="No per-user fees. Switch to Annual billing to save 25% — plus up to 30% extra discount for multi-branch businesses."
          />

          {/* Billing cycle toggle */}
          <FadeIn className="flex flex-col items-center -mt-4 mb-10 gap-4">
            <div className="inline-flex items-center p-1 rounded-full bg-white/5 border border-white/10">
              <button
                type="button"
                onClick={() => setAnnual(false)}
                className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${
                  !annual ? 'bg-[#0050c0] text-white shadow' : 'text-zinc-300 hover:text-white'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setAnnual(true)}
                className={`px-5 py-2 rounded-full text-sm font-semibold transition-all flex items-center gap-2 ${
                  annual ? 'bg-[#0050c0] text-white shadow' : 'text-zinc-300 hover:text-white'
                }`}
              >
                Annual
                <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                  SAVE 25%
                </span>
              </button>
            </div>
          </FadeIn>

          <StaggerContainer staggerDelay={0.1} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {tiers.map((tier) => {
              const monthly = tier.monthlyLkr
              let priceStr = 'Custom'
              let originalStr: string | undefined
              let discountBadge: string | undefined

              if (monthly != null) {
                if (monthly === 0) {
                  priceStr = 'Free'
                } else if (annual) {
                  const discounted = Math.round(monthly * 0.75)
                  priceStr = `Rs. ${discounted.toLocaleString('en-US')}`
                  originalStr = `Rs. ${monthly.toLocaleString('en-US')}/month`
                  discountBadge = '25% Annual Discount'
                } else {
                  priceStr = `Rs. ${monthly.toLocaleString('en-US')}`
                }
              }

              return (
                <StaggerItem key={tier.name}>
                  <PricingCard
                    name={tier.name}
                    price={priceStr}
                    originalPrice={originalStr}
                    discountBadge={discountBadge}
                    period={monthly === 0 ? 'forever' : 'month'}
                    features={tier.features}
                    popular={tier.popular}
                    currencyCode={monthly ? 'Sri Lankan Rupees (LKR) · Billed ' + (annual ? 'annually' : 'monthly') : undefined}
                    isCustom={tier.isCustom}
                  />
                </StaggerItem>
              )
            })}
          </StaggerContainer>

          <FadeIn className="text-center mt-10 flex flex-wrap items-center justify-center gap-6">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-400 hover:text-sky-300 transition-colors"
            >
              View full LKR pricing &amp; volume discounts <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="tel:+94741228682"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-300 hover:text-white transition-colors"
            >
              <Phone className="w-4 h-4 text-sky-400" />
              Call +94 74 122 8682 for hardware bundle quotes
            </a>
          </FadeIn>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          Section 13 — CTA
         ══════════════════════════════════════════════ */}
      <CTASection />
    </PageWrapper>
  )
}
