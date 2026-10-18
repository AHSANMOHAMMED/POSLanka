'use client'

import Link from 'next/link'
import {
  ArrowRight,
  ClipboardList,
  Car,
  FileText,
  Wrench,
  Check,
  Package,
  TrendingUp,
  Store,
  UtensilsCrossed,
  ShoppingCart,
  Settings,
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
import { MockWorkOrders } from '@/components/landing/mockups/MockWorkOrders'
import { MockInventory } from '@/components/landing/mockups/MockInventory'
import { MockDashboard } from '@/components/landing/mockups/MockDashboard'
import SectionHeading from '@/components/landing/SectionHeading'
import FeatureShowcase from '@/components/landing/FeatureShowcase'
import FeatureCard from '@/components/landing/FeatureCard'
import CTASection from '@/components/landing/CTASection'
import AIBadge from '@/components/landing/AIBadge'
import BusinessTypeCard from '@/components/landing/BusinessTypeCard'

const featureCategories = [
  {
    category: 'Work Orders',
    items: [
      'Full lifecycle work order tracking',
      'Service line items with labor rates',
      'Technician assignment & scheduling',
      'Labor time clock in/out',
      'Customer approval workflow',
      'Status updates & notifications',
      'Professional invoice generation',
      'Appointment booking',
    ],
  },
  {
    category: 'Vehicle Management',
    items: [
      'Complete vehicle profiles & VIN',
      'Make, model & year database',
      'Multi-point inspection checklists',
      'Photo documentation & damage marking',
      'Complete service history timeline',
      'Service history tracking',
    ],
  },
  {
    category: 'Parts & Inventory',
    items: [
      'OEM & aftermarket parts tracking',
      'Supplier part number cross-reference',
      'Core returns management',
      'Supplier ordering & receiving',
      'Low stock alerts & auto-reorder',
      'Parts markup & pricing rules',
      'Multi-warehouse support',
      'Barcode & SKU scanning',
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
      'Technician performance tracking',
      'Attendance & time tracking',
      'Commission management',
    ],
  },
  {
    category: 'AI & Analytics',
    aiCategory: true,
    items: [
      'Workshop revenue dashboards',
      'Technician performance analytics',
      'Parts usage & cost reports',
      'Service type breakdown',
      'Customer retention analysis',
      'AI-powered smart warnings',
    ],
  },
]

export default function AutoServiceClient() {
  return (
    <PageWrapper>
      {/* ── Section 1: Hero ── */}
      <section
        className="relative min-h-[85vh] flex items-center overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #09090b 0%, #0c0a1a 50%, #0d0a12 100%)',
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
                  <span className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-bold uppercase tracking-widest rounded-full bg-gradient-to-r from-violet-500/10 to-pink-500/10 text-violet-400 border border-violet-500/30">
                    <Wrench className="w-3.5 h-3.5" />
                    Auto Service Solution
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    <Check className="w-3.5 h-3.5" />
                    Free Forever
                  </span>
                </div>
              </BlurFadeIn>
              <BlurFadeIn delay={0.1}>
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight text-white">
                  The Complete{' '}
                  <span className="gradient-text-auto">
                    Auto Service Platform
                  </span>
                </h1>
              </BlurFadeIn>
              <BlurFadeIn delay={0.2}>
                <p className="mt-6 text-lg sm:text-xl text-zinc-400 leading-relaxed max-w-xl">
                  From work order creation to final invoice, manage every job
                  with precision. Vehicle tracking, parts management, and
                  insurance estimates -- all in one powerful platform built for
                  workshops.
                </p>
              </BlurFadeIn>
              <BlurFadeIn delay={0.3}>
                <div className="mt-8 flex flex-wrap gap-4">
                  <Link
                    href="/register"
                    className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-violet-500 to-pink-500 hover:from-violet-600 hover:to-pink-600 rounded-md transition-all shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:-translate-y-0.5"
                  >
                    Get Started Free
                    <ArrowRight className="w-5 h-5" />
                  </Link>
                  <Link
                    href="/features"
                    className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-zinc-300 border border-white/10 hover:border-violet-500/30 hover:text-violet-400 hover:bg-violet-500/10 rounded-md transition-all hover:-translate-y-0.5"
                  >
                    View Features
                  </Link>
                </div>
              </BlurFadeIn>
              <BlurFadeIn delay={0.4}>
                <div className="mt-8 flex items-center gap-6 text-sm text-zinc-500">
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-violet-500" />
                    Free Forever · No Credit Card
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-violet-500" />
                    Unlimited users
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-violet-500" />
                    Free forever plan
                  </div>
                </div>
              </BlurFadeIn>
            </div>

            {/* Right: Hero mockup */}
            <FadeInRight className="hidden lg:block">
              <FloatingMockup>
                <BrowserMockup url="retailsmarterp.com/work-orders">
                  <MockWorkOrders />
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
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-500/20">
                  <ClipboardList className="w-7 h-7 text-white" />
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-white">
                  Streamlined
                </div>
                <div className="mt-2 text-sm font-medium text-zinc-400">
                  Work Orders
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Complete lifecycle management from quote to invoice
                </p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="glass-card-v2 p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-500/20">
                  <Car className="w-7 h-7 text-white" />
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-white">
                  <SpringCounter value={100} suffix="%" />
                </div>
                <div className="mt-2 text-sm font-medium text-zinc-400">
                  Vehicle Tracking
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Complete digital vehicle history and service records
                </p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="glass-card-v2 p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-violet-500/20">
                  <FileText className="w-7 h-7 text-white" />
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-white">
                  Built-in
                </div>
                <div className="mt-2 text-sm font-medium text-zinc-400">
                  Estimates
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Professional insurance estimate generation
                </p>
              </div>
            </StaggerItem>
          </StaggerContainer>
        </div>
      </section>

      {/* ── Section 3: Feature Showcase - Work Order Management ── */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FeatureShowcase
            title="Work Order Management"
            description="Create detailed work orders with services, parts, and labor tracking. Manage the entire job lifecycle from intake to invoice with real-time status updates and customer notifications."
            features={[
              'Create and track work orders end-to-end',
              'Complete service history per vehicle',
              'Parts allocation with pricing & markup',
              'Labor time tracking & technician assignment',
              'Real-time status updates & workflows',
              'Customer notifications & approval process',
            ]}
            mockup={<MockWorkOrders />}
            gradient="from-violet-500 to-pink-500"
          />
        </div>
      </section>

      {/* ── Section 4: Feature Showcase - Vehicle & Parts Management (reversed) ── */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FeatureShowcase
            title="Vehicle & Parts Management"
            description="Build a complete digital vehicle database with service history, inspections, and photo documentation. Track every part by OEM number, supplier reference, and manage core returns seamlessly."
            features={[
              'Comprehensive vehicle database with VIN',
              'Complete service history timeline',
              'Parts inventory with OEM part numbers',
              'Supplier parts cross-reference search',
              'Multi-supplier ordering & receiving',
              'Core returns tracking & credits',
            ]}
            mockup={<MockInventory />}
            reversed
            gradient="from-violet-500 to-pink-500"
          />
        </div>
      </section>

      {/* ── Section 5: Feature Showcase - Business Dashboard ── */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FeatureShowcase
            title="Business Dashboard"
            description="Get a real-time overview of your workshop performance. Track revenue, monitor technician productivity, analyze parts usage, and let AI surface insights that drive better business decisions."
            features={[
              'Revenue tracking & financial overview',
              'Technician performance & utilization',
              'Parts usage analytics & cost tracking',
              'Customer insights & retention metrics',
              'Financial reports & margin analysis',
              'AI-assisted insights & smart warnings',
            ]}
            mockup={<MockDashboard />}
            gradient="from-violet-500 to-pink-500"
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
            gradientClass="gradient-text-auto"
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
                name="Vehicle Dealership"
                description="New & used vehicle sales, trade-ins, test drives, and inventory."
                href="/dealership"
                icon={Car}
                gradient="from-cyan-500 to-teal-500"
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
            title="Everything your workshop needs"
            highlight="workshop needs"
            subtitle="From work order intake to final invoice, every tool purpose-built for auto service and collision repair workshops."
            gradientClass="gradient-text-auto"
          />

          <div className="space-y-12">
            {featureCategories.map((category) => (
              <FadeIn key={category.category}>
                <div>
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-violet-500 to-pink-500" />
                    {category.category}
                    {category.aiCategory && <AIBadge size="sm" />}
                  </h3>
                  <StaggerContainer className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {category.items.map((item) => (
                      <StaggerItem key={item}>
                        <div className="flex items-center gap-3 p-3 rounded-md bg-white/5 border border-white/[0.06] hover:border-violet-500/30 hover:bg-violet-500/10 transition-colors">
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center flex-shrink-0">
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
            title="Smarter workshop operations with AI"
            highlight="AI"
            subtitle="Leverage artificial intelligence to analyze service patterns, track parts usage, and provide actionable insights for your workshop."
            gradientClass="gradient-text-auto"
          />

          <StaggerContainer staggerDelay={0.1} className="grid sm:grid-cols-3 gap-6">
            <StaggerItem>
              <FeatureCard
                icon={Settings}
                title="Service Pattern Analysis"
                description="AI analyzes vehicle service history to help identify common maintenance patterns — useful for planning customer follow-ups and service reminders."
                gradient="from-violet-500 to-pink-500"
                aiPowered
              />
            </StaggerItem>
            <StaggerItem>
              <FeatureCard
                icon={Package}
                title="Parts Usage Insights"
                description="Review parts consumption patterns based on past jobs and seasonal trends to help plan your inventory and reduce emergency orders."
                gradient="from-violet-500 to-pink-500"
                aiPowered
              />
            </StaggerItem>
            <StaggerItem>
              <FeatureCard
                icon={TrendingUp}
                title="Revenue Optimization"
                description="Track job profitability, technician workload, and service history to identify opportunities for improving workshop efficiency."
                gradient="from-violet-500 to-pink-500"
                aiPowered
              />
            </StaggerItem>
          </StaggerContainer>
        </div>
      </section>

      {/* ── Section 9: CTA ── */}
      <CTASection
        title="Ready to streamline your workshop?"
        subtitle="Get started with auto service features built for workshops and collision repair centers. Free forever plan available."
        ctaText="Start Free Today"
        ctaHref="/register"
        secondaryText="View Pricing"
        secondaryHref="/pricing"
      />
    </PageWrapper>
  )
}
