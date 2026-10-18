'use client'

import { type ReactNode } from 'react'
import {
  BarChart3, Globe, Wifi, Shield, Sparkles, Smartphone,
  ShoppingCart, Package, Calculator, Users, Utensils, Wrench,
  Check, Monitor,
} from 'lucide-react'
import {
  PageWrapper, FadeIn, BlurFadeIn, HeroBadge,
  StaggerContainer, StaggerItem,
} from '@/components/landing/motion'
import SectionHeading from '@/components/landing/SectionHeading'
import FeatureCard from '@/components/landing/FeatureCard'
import FeatureTabSwitcher from '@/components/landing/FeatureTabSwitcher'
import CTASection from '@/components/landing/CTASection'
import { MockPOS } from '@/components/landing/mockups/MockPOS'
import { MockDashboard } from '@/components/landing/mockups/MockDashboard'
import { MockKitchenDisplay } from '@/components/landing/mockups/MockKitchenDisplay'
import { MockWorkOrders } from '@/components/landing/mockups/MockWorkOrders'
import { MockInventory } from '@/components/landing/mockups/MockInventory'
import { MockAccounting } from '@/components/landing/mockups/MockAccounting'
import { MockTables } from '@/components/landing/mockups/MockTables'

interface TabData {
  key: string
  label: string
  icon: typeof ShoppingCart
  gradient: string
  mockup: ReactNode
  description: string
  features: string[]
}

const featureTabs: TabData[] = [
  {
    key: 'pos',
    label: 'Point of Sale',
    icon: ShoppingCart,
    gradient: 'from-emerald-500 to-teal-500',
    mockup: <MockPOS />,
    description: 'Fast, intuitive checkout with barcode scanning, multiple payment methods, and real-time inventory updates.',
    features: ['Barcode & SKU scanning', 'Multiple payment methods', 'Receipt printing & email', 'Returns and exchanges', 'Held sales & layaway', 'Gift card support'],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    icon: Package,
    gradient: 'from-amber-500 to-orange-500',
    mockup: <MockInventory />,
    description: 'Multi-warehouse tracking with smart reorder alerts, stock transfers, and complete movement history.',
    features: ['Multi-warehouse support', 'Smart reorder alerts', 'Stock transfers', 'Batch & serial tracking', 'Min/max stock levels', 'Movement history'],
  },
  {
    key: 'accounting',
    label: 'Accounting',
    icon: Calculator,
    gradient: 'from-sky-500 to-blue-500',
    mockup: <MockAccounting />,
    description: 'Complete double-entry accounting with chart of accounts, journal entries, bank reconciliation, and financial insights.',
    features: ['Chart of accounts', 'Journal entries', 'Bank reconciliation', 'Financial statements', 'Tax management', 'Budget tracking'],
  },
  {
    key: 'hr',
    label: 'HR & Payroll',
    icon: Users,
    gradient: 'from-violet-500 to-purple-500',
    mockup: <MockDashboard />,
    description: 'Employee management, salary structures, payroll runs, advances, attendance tracking, and leave management.',
    features: ['Employee profiles', 'Salary structures', 'Payroll processing', 'Employee advances', 'Attendance tracking', 'Leave management'],
  },
  {
    key: 'restaurant',
    label: 'Restaurant',
    icon: Utensils,
    gradient: 'from-orange-500 to-red-500',
    mockup: <MockKitchenDisplay />,
    description: 'Kitchen display, table management, floor plan, reservations, recipe costing, and multi-channel ordering.',
    features: ['Kitchen display system', 'Table management', 'Floor plan designer', 'Reservations', 'Recipe costing', 'Waste tracking'],
  },
  {
    key: 'tables',
    label: 'Tables',
    icon: Monitor,
    gradient: 'from-rose-500 to-pink-500',
    mockup: <MockTables />,
    description: 'Visual table management with real-time status, reservations, and capacity planning for restaurants.',
    features: ['Floor plan view', 'Real-time status', 'Reservations system', 'Wait time tracking', 'Merge & split tables', 'Capacity planning'],
  },
  {
    key: 'auto',
    label: 'Auto Service',
    icon: Wrench,
    gradient: 'from-stone-600 to-stone-700',
    mockup: <MockWorkOrders />,
    description: 'Work order management, vehicle tracking, inspections, insurance estimates, and parts inventory.',
    features: ['Work orders', 'Vehicle tracking', 'Multi-point inspections', 'Insurance estimates', 'Parts management', 'Labor guides'],
  },
  {
    key: 'ai',
    label: 'AI & Analytics',
    icon: Sparkles,
    gradient: 'from-emerald-600 to-teal-600',
    mockup: <MockDashboard />,
    description: 'AI chat assistant, smart warnings, sales trend analysis, anomaly detection, and real-time dashboards.',
    features: ['AI chat assistant', 'Smart reorder alerts', 'Anomaly detection', 'Trend analysis', 'Custom reports', 'Real-time dashboards'],
  },
]

const comparison = [
  { feature: 'All Features on Every Plan', included: true },
  { feature: 'Unlimited Users', included: true },
  { feature: 'AI Chat Assistant', included: true },
  { feature: 'Multi-Business Types', included: true },
  { feature: 'Free Plan Available', included: true },
  { feature: 'Real-Time Sync', included: true },
  { feature: 'Row-Level Data Isolation', included: true },
  { feature: 'Double-Entry Accounting', included: true },
  { feature: 'HR & Payroll', included: true },
  { feature: 'No Per-User Fees', included: true },
]

export default function FeaturesClient() {
  return (
    <PageWrapper>
      {/* ── Hero ── */}
      <section
        className="relative overflow-hidden pt-32 pb-20"
        style={{ background: 'linear-gradient(135deg, #09090b 0%, rgba(5,150,105,0.05) 50%, rgba(245,158,11,0.03) 100%)' }}
      >
        <div className="mesh-gradient-hero" />
        <div className="noise-overlay" />
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <BlurFadeIn>
            <div className="flex items-center justify-center gap-3 mb-5 flex-wrap">
              <HeroBadge
                text="All Features Included"
                icon={<Sparkles className="w-4 h-4 text-emerald-600" />}
              />
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Free Forever
              </span>
            </div>
          </BlurFadeIn>
          <BlurFadeIn delay={0.1}>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight tracking-tight">
              Every Feature <span className="gradient-text-animate">Included</span> on Every Plan
            </h1>
          </BlurFadeIn>
          <BlurFadeIn delay={0.2}>
            <p className="mt-6 text-lg sm:text-xl text-zinc-400 leading-relaxed max-w-2xl mx-auto">
              No feature gating. No hidden costs. <span className="text-emerald-400 font-semibold">Free Forever.</span> From POS to AI analytics — everything your business needs in one platform.
            </p>
          </BlurFadeIn>
        </div>
      </section>

      {/* ── Interactive Feature Tabs with Mockups ── */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Live Preview"
            title="Explore by category"
            highlight="category"
            subtitle="Click any tab to see the actual interface for each module."
          />
          <FeatureTabSwitcher tabs={featureTabs} />
        </div>
      </section>

      {/* ── Platform Capabilities Grid ── */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Platform Capabilities"
            title="Built for modern businesses"
            highlight="modern businesses"
          />
          <StaggerContainer staggerDelay={0.08} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: BarChart3, title: 'Advanced Analytics', description: 'Real-time dashboards and AI-generated custom reports', gradient: 'from-emerald-500 to-teal-500', aiPowered: true },
              { icon: Globe, title: 'Multi-Currency', description: 'Support for all currencies with automatic location detection', gradient: 'from-amber-500 to-orange-500' },
              { icon: Wifi, title: 'Real-Time Sync', description: 'Real-time live updates across all devices', gradient: 'from-sky-500 to-blue-500' },
              { icon: Shield, title: 'Advanced Security', description: 'Complete data isolation, encryption, and granular role-based access', gradient: 'from-stone-600 to-stone-700' },
              { icon: Sparkles, title: 'AI Intelligence', description: 'AI chat assistant, smart warnings, trend analysis', gradient: 'from-rose-500 to-pink-500', aiPowered: true },
              { icon: Smartphone, title: 'Mobile Responsive', description: 'Fully responsive design for mobile, tablet, and desktop', gradient: 'from-violet-500 to-purple-500' },
            ].map((card) => (
              <StaggerItem key={card.title}>
                <FeatureCard {...card} />
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ── Comparison Table ── */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Feature Checklist"
            title="What you get with RetailSmart"
            highlight="RetailSmart"
          />
          <FadeIn>
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/5 shadow-sm">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10 bg-white/5">
                    <th className="px-6 py-4 text-left text-sm font-semibold text-white">Feature</th>
                    <th className="px-6 py-4 text-center text-sm font-bold text-emerald-400">RetailSmart</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white/5' : 'bg-white/[0.02]'}>
                      <td className="px-6 py-3.5 text-sm text-zinc-300 font-medium">{row.feature}</td>
                      <td className="px-6 py-3.5 text-center">
                        {row.included && <Check className="w-5 h-5 text-emerald-500 mx-auto" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── CTA ── */}
      <CTASection
        title="Experience every feature today"
        subtitle="All features included on every plan. Your first company is free forever — no credit card needed."
      />
    </PageWrapper>
  )
}
