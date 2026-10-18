'use client'

import Link from 'next/link'
import {
  ArrowRight,
  Car,
  DollarSign,
  Check,
  TrendingUp,
  Store,
  UtensilsCrossed,
  ShoppingCart,
  Wrench,
  Settings,
  Users,
  CalendarCheck,
} from 'lucide-react'
import {
  PageWrapper,
  FadeIn,
  FadeInRight,
  BlurFadeIn,
  StaggerContainer,
  StaggerItem,
  BrowserMockup,
  FloatingMockup,
  SpringCounter,
} from '@/components/landing/motion'
import { MockVehicleInventory } from '@/components/landing/mockups/MockVehicleInventory'
import { MockTestDrives } from '@/components/landing/mockups/MockTestDrives'
import { MockDealPipeline } from '@/components/landing/mockups/MockDealPipeline'
import SectionHeading from '@/components/landing/SectionHeading'
import FeatureShowcase from '@/components/landing/FeatureShowcase'
import FeatureCard from '@/components/landing/FeatureCard'
import CTASection from '@/components/landing/CTASection'
import AIBadge from '@/components/landing/AIBadge'
import BusinessTypeCard from '@/components/landing/BusinessTypeCard'

const featureCategories = [
  {
    category: 'Vehicle Sales',
    items: [
      'New & used vehicle inventory',
      'Vehicle listing with photos',
      'Trade-in management',
      'Sales order workflow',
      'Customer negotiation tracking',
      'Deal sheet generation',
      'Financing & payment plans',
      'Vehicle delivery tracking',
    ],
  },
  {
    category: 'Inventory Management',
    items: [
      'Multi-location stock tracking',
      'Vehicle make/model database',
      'VIN & registration management',
      'Accessory & parts inventory',
      'Supplier purchase orders',
      'Stock aging reports',
      'Barcode & QR code support',
      'Low stock alerts',
    ],
  },
  {
    category: 'Customer Management',
    items: [
      'Customer profiles & history',
      'Test drive scheduling',
      'Follow-up reminders',
      'Loyalty program support',
      'Customer communication log',
      'Vehicle service referrals',
    ],
  },
  {
    category: 'Accounting',
    items: [
      'Chart of accounts',
      'Journal entries & ledger',
      'Accounts receivable & payable',
      'Bank reconciliation',
      'Tax management',
      'Financial reports',
    ],
  },
  {
    category: 'HR & Payroll',
    items: [
      'Employee management',
      'Salary structures & components',
      'Payroll processing',
      'Sales staff commission tracking',
      'Performance metrics',
      'Commission management',
    ],
  },
  {
    category: 'AI & Analytics',
    aiCategory: true,
    items: [
      'Sales performance dashboards',
      'Inventory turnover analytics',
      'Revenue & margin reports',
      'Customer acquisition tracking',
      'AI-powered smart warnings',
      'Market trend insights',
    ],
  },
]

export default function DealershipClient() {
  return (
    <PageWrapper>
      {/* ── Section 1: Hero ── */}
      <section
        className="relative min-h-[85vh] flex items-center overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #09090b 0%, #0a1a1a 50%, #0d0a12 100%)',
        }}
      >
        <div className="mesh-gradient-hero" />
        <div className="noise-overlay" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full py-20 sm:py-24">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left: Text content */}
            <div>
              <BlurFadeIn>
                <div className="flex flex-wrap items-center gap-3 mb-6">
                  <span className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-bold uppercase tracking-widest rounded-full bg-gradient-to-r from-cyan-500/10 to-teal-500/10 text-cyan-400 border border-cyan-500/30">
                    <Car className="w-3.5 h-3.5" />
                    Vehicle Dealership Solution
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    <Check className="w-3.5 h-3.5" />
                    Free Forever
                  </span>
                </div>
              </BlurFadeIn>
              <BlurFadeIn delay={0.1}>
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight text-white">
                  Your Complete{' '}
                  <span className="bg-gradient-to-r from-cyan-400 to-teal-400 bg-clip-text text-transparent">
                    Dealership Platform
                  </span>
                </h1>
              </BlurFadeIn>
              <BlurFadeIn delay={0.2}>
                <p className="mt-6 text-lg sm:text-xl text-zinc-400 leading-relaxed max-w-xl">
                  Manage your entire dealership from vehicle inventory to final
                  sale. Track new and used vehicles, handle trade-ins, schedule
                  test drives, and close deals faster with an all-in-one platform
                  built for vehicle dealerships.
                </p>
              </BlurFadeIn>
              <BlurFadeIn delay={0.3}>
                <div className="mt-8 flex flex-wrap gap-4">
                  <Link
                    href="/register"
                    className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-600 hover:to-teal-600 rounded-md transition-all shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 hover:-translate-y-0.5"
                  >
                    Get Started Free
                    <ArrowRight className="w-5 h-5" />
                  </Link>
                  <Link
                    href="/features"
                    className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-zinc-300 border border-white/10 hover:border-cyan-500/30 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-md transition-all hover:-translate-y-0.5"
                  >
                    View Features
                  </Link>
                </div>
              </BlurFadeIn>
              <BlurFadeIn delay={0.4}>
                <div className="mt-8 flex items-center gap-6 text-sm text-zinc-500">
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-cyan-500" />
                    Free Forever · No Credit Card
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-cyan-500" />
                    Unlimited users
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-cyan-500" />
                    Cars, motorbikes & more
                  </div>
                </div>
              </BlurFadeIn>
            </div>

            {/* Right: Hero mockup */}
            <FadeInRight className="hidden lg:block">
              <FloatingMockup>
                <BrowserMockup url="retailsmarterp.com/vehicles">
                  <MockVehicleInventory />
                </BrowserMockup>
              </FloatingMockup>
            </FadeInRight>
          </div>
        </div>
      </section>

      {/* ── Section 2: Key Metrics ── */}
      <section className="section-bg-white py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <StaggerContainer staggerDelay={0.12} className="grid sm:grid-cols-3 gap-6">
            <StaggerItem>
              <div className="glass-card-v2 p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-cyan-500/20">
                  <Car className="w-7 h-7 text-white" />
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-white">
                  Complete
                </div>
                <div className="mt-2 text-sm font-medium text-zinc-400">
                  Vehicle Inventory
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Track every vehicle from acquisition to delivery
                </p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="glass-card-v2 p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-cyan-500/20">
                  <DollarSign className="w-7 h-7 text-white" />
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-white">
                  <SpringCounter value={100} suffix="%" />
                </div>
                <div className="mt-2 text-sm font-medium text-zinc-400">
                  Deal Tracking
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Full sales pipeline from inquiry to delivery
                </p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="glass-card-v2 p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-cyan-500/20">
                  <CalendarCheck className="w-7 h-7 text-white" />
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-white">
                  Built-in
                </div>
                <div className="mt-2 text-sm font-medium text-zinc-400">
                  Scheduling
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Test drive and appointment scheduling
                </p>
              </div>
            </StaggerItem>
          </StaggerContainer>
        </div>
      </section>

      {/* ── Section 3: Feature Showcase - Vehicle Inventory ── */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FeatureShowcase
            title="Vehicle Inventory Management"
            description="Manage your entire fleet of new and used vehicles in one place. Track each vehicle from acquisition through preparation to final sale with complete visibility into your stock."
            features={[
              'Track new and used vehicle inventory',
              'Vehicle details with VIN, make, model, year',
              'Photo galleries and condition reports',
              'Trade-in valuation and processing',
              'Stock aging and turnover analysis',
              'Multi-location inventory support',
            ]}
            mockup={<MockVehicleInventory />}
            gradient="from-cyan-500 to-teal-500"
          />
        </div>
      </section>

      {/* ── Section 4: Feature Showcase - Sales & CRM (reversed) ── */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FeatureShowcase
            title="Sales & Customer Management"
            description="Close more deals with a streamlined sales workflow. Track customer interactions, schedule test drives, manage negotiations, and generate professional deal sheets all from one dashboard."
            features={[
              'Customer profiles with purchase history',
              'Test drive scheduling and tracking',
              'Sales pipeline with deal stages',
              'Professional deal sheet generation',
              'Financing and payment plan options',
              'Follow-up reminders and task management',
            ]}
            mockup={<MockDealPipeline />}
            reversed
            gradient="from-cyan-500 to-teal-500"
          />
        </div>
      </section>

      {/* ── Section 5: Feature Showcase - Business Dashboard ── */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FeatureShowcase
            title="Test Drive & Scheduling"
            description="Never miss a test drive appointment. Schedule, track, and follow up on every customer interaction. Your sales team stays organized with a clear view of today's schedule and upcoming appointments."
            features={[
              'Test drive scheduling calendar',
              'Customer appointment confirmations',
              'Sales rep assignment & availability',
              'Follow-up task automation',
              'Walk-in vs. appointment tracking',
              'Customer feedback after test drives',
            ]}
            mockup={<MockTestDrives />}
            gradient="from-cyan-500 to-teal-500"
          />
        </div>
      </section>

      {/* ── Section 6: Also Includes - Cross-links ── */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Also Available"
            title="Solutions for every business type"
            highlight="every business type"
            subtitle="RetailSmart ERP adapts to your industry. Explore other purpose-built solutions."
          />

          <StaggerContainer staggerDelay={0.1} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <StaggerItem>
              <BusinessTypeCard
                name="Retail"
                description="Complete POS and inventory management for boutiques, shops, and retail chains."
                href="/retail"
                icon={Store}
                gradient="from-blue-600 to-sky-500"
              />
            </StaggerItem>
            <StaggerItem>
              <BusinessTypeCard
                name="Restaurant"
                description="Kitchen display, table management, and ordering for restaurants and cafes."
                href="/restaurant"
                icon={UtensilsCrossed}
                gradient="from-orange-500 to-red-500"
              />
            </StaggerItem>
            <StaggerItem>
              <BusinessTypeCard
                name="Supermarket"
                description="High-volume checkout, department management, and batch tracking."
                href="/supermarket"
                icon={ShoppingCart}
                gradient="from-emerald-500 to-cyan-500"
              />
            </StaggerItem>
            <StaggerItem>
              <BusinessTypeCard
                name="Auto Service"
                description="Work orders, vehicle tracking, inspections, and parts management."
                href="/auto-service"
                icon={Wrench}
                gradient="from-violet-500 to-pink-500"
              />
            </StaggerItem>
          </StaggerContainer>
        </div>
      </section>

      {/* ── Section 7: Complete Feature Grid ── */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Complete Feature Set"
            title="Everything your dealership needs"
            highlight="dealership needs"
            subtitle="From vehicle intake to final sale, every tool purpose-built for new and used vehicle dealerships."
          />

          <div className="space-y-12">
            {featureCategories.map((category) => (
              <FadeIn key={category.category}>
                <div>
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-teal-500" />
                    {category.category}
                    {category.aiCategory && <AIBadge size="sm" />}
                  </h3>
                  <StaggerContainer className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {category.items.map((item) => (
                      <StaggerItem key={item}>
                        <div className="flex items-center gap-3 p-3 rounded-md bg-white/5 border border-white/[0.06] hover:border-cyan-500/30 hover:bg-cyan-500/10 transition-colors">
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center flex-shrink-0">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                          <span className="text-sm font-medium text-zinc-300">
                            {item}
                          </span>
                        </div>
                      </StaggerItem>
                    ))}
                  </StaggerContainer>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 8: AI Features ── */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="AI-Powered Intelligence"
            title="Smarter dealership operations with AI"
            highlight="AI"
            subtitle="Leverage artificial intelligence to analyze sales patterns, optimize pricing, and provide actionable insights for your dealership."
          />

          <StaggerContainer staggerDelay={0.1} className="grid sm:grid-cols-3 gap-6">
            <StaggerItem>
              <FeatureCard
                icon={Settings}
                title="Sales Pattern Analysis"
                description="AI analyzes your sales data to identify trends in customer preferences, seasonal patterns, and optimal pricing strategies."
                gradient="from-cyan-500 to-teal-500"
                aiPowered
              />
            </StaggerItem>
            <StaggerItem>
              <FeatureCard
                icon={Users}
                title="Customer Insights"
                description="Understand customer buying patterns, follow-up effectiveness, and identify high-value prospects for targeted outreach."
                gradient="from-cyan-500 to-teal-500"
                aiPowered
              />
            </StaggerItem>
            <StaggerItem>
              <FeatureCard
                icon={TrendingUp}
                title="Revenue Optimization"
                description="Track vehicle profitability, staff performance, and inventory turnover to identify opportunities for maximizing dealership revenue."
                gradient="from-cyan-500 to-teal-500"
                aiPowered
              />
            </StaggerItem>
          </StaggerContainer>
        </div>
      </section>

      {/* ── Section 9: CTA ── */}
      <CTASection
        title="Ready to modernize your dealership?"
        subtitle="Get started with dealership management features built for vehicle sales professionals. Free forever plan available."
        ctaText="Start Free Today"
        ctaHref="/register"
        secondaryText="View Pricing"
        secondaryHref="/pricing"
      />
    </PageWrapper>
  )
}
