'use client'

import Image from 'next/image'
import Link from 'next/link'
import {
  ShoppingCart,
  Package,
  BarChart3,
  Check,
  ArrowRight,
  Sparkles,
  Brain,
  Store,
  Utensils,
  Wrench,
  Users,
  Zap,
  TrendingUp,
  Warehouse,
} from 'lucide-react'
import {
  PageWrapper,
  FadeIn,
  FadeInLeft,
  FadeInRight,
  BlurFadeIn,
  HeroBadge,
  StaggerContainer,
  StaggerItem,
  FloatingMockup,
} from '@/components/landing/motion'
import SectionHeading from '@/components/landing/SectionHeading'
import CTASection from '@/components/landing/CTASection'
import {
  MockPOS,
} from '@/components/landing/mockups'
import { MockBrowserFrame } from '@/components/landing/mockups/MockBrowserFrame'

const featureCategories = [
  {
    category: 'Point of Sale',
    icon: ShoppingCart,
    items: [
      'Barcode & SKU scanning',
      'Quick product search',
      'Held sales & resume',
      'Split & partial payments',
      'Returns & exchanges',
      'Receipt printing & email',
      'Multi-currency checkout',
      'Daily close & summary',
    ],
  },
  {
    category: 'Inventory Management',
    icon: Package,
    items: [
      'Multi-warehouse tracking',
      'Automated reorder alerts',
      'Stock transfer management',
      'Batch & serial tracking',
      'Purchase order automation',
      'Min/max stock levels',
    ],
  },
  {
    category: 'Customer Management',
    icon: Users,
    items: [
      'Customer profiles & groups',
      'Points-based loyalty',
      'Gift card management',
      'Purchase history tracking',
      'Customer credit accounts',
    ],
  },
  {
    category: 'Analytics & Reports',
    icon: BarChart3,
    items: [
      'Real-time sales dashboard',
      'Sales by category reports',
      'Inventory valuation',
      'Staff performance metrics',
      'Export & custom reports',
    ],
  },
]

export default function RetailClient() {
  return (
    <PageWrapper>
      {/* ── Section 1: Hero ── */}
      <section className="relative min-h-[85vh] flex items-center overflow-hidden">
        {/* Background image */}
        <Image
          src="https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1920"
          alt="Modern retail store interior"
          fill
          priority
          quality={90}
          className="object-cover"
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-sky-900/85 via-blue-900/70 to-sky-800/60" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full py-20 sm:py-24">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left: Text content */}
            <div>
              <BlurFadeIn>
                <div className="flex flex-wrap items-center gap-3">
                  <HeroBadge
                    text="Retail POS Solution"
                    icon={<ShoppingCart className="w-4 h-4 text-sky-400" />}
                    className="bg-white/10 text-white border-white/20 backdrop-blur-sm !mb-0"
                  />
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 backdrop-blur-sm">
                    <Check className="w-3.5 h-3.5" />
                    Free Forever
                  </span>
                </div>
              </BlurFadeIn>
              <BlurFadeIn delay={0.1}>
                <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight text-white">
                  Smart Checkout for{' '}
                  <span className="gradient-text-retail">Modern Retail</span>
                </h1>
              </BlurFadeIn>
              <BlurFadeIn delay={0.2}>
                <p className="mt-6 text-lg sm:text-xl text-gray-200 leading-relaxed max-w-xl">
                  Barcode scanning, multi-warehouse inventory, loyalty programs,
                  gift cards, and AI analytics -- all in one platform.
                </p>
              </BlurFadeIn>
              <BlurFadeIn delay={0.3}>
                <div className="mt-8 flex flex-wrap gap-4">
                  <Link
                    href="/register"
                    className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 rounded-md transition-all shadow-lg shadow-sky-600/30 hover:shadow-sky-600/50 hover:-translate-y-0.5"
                  >
                    Get Started Free
                    <ArrowRight className="w-5 h-5" />
                  </Link>
                  <Link
                    href="/pricing"
                    className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white/90 border border-white/25 hover:border-white/50 hover:bg-white/10 rounded-md transition-all hover:-translate-y-0.5 backdrop-blur-sm"
                  >
                    View Pricing
                  </Link>
                </div>
              </BlurFadeIn>
              <BlurFadeIn delay={0.4}>
                <div className="mt-8 flex flex-wrap items-center gap-6 text-sm text-gray-300">
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-sky-400" />
                    Free Forever · No Credit Card
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-sky-400" />
                    Unlimited users
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-sky-400" />
                    Free forever plan
                  </div>
                </div>
              </BlurFadeIn>
            </div>

            {/* Right: Hero mockup */}
            <FadeInRight className="hidden lg:block">
              <FloatingMockup>
                <MockBrowserFrame url="app.retailsmarterp.com/pos">
                  <MockPOS />
                </MockBrowserFrame>
              </FloatingMockup>
            </FadeInRight>
          </div>
        </div>
      </section>

      {/* ── Section 2: Key Metrics ── */}
      <section className="section-bg-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <StaggerContainer staggerDelay={0.12} className="grid sm:grid-cols-3 gap-6">
            <StaggerItem>
              <div className="text-center p-8 rounded-2xl border border-white/[0.06] bg-white/5 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-sky-500/20">
                  <Zap className="w-7 h-7 text-white" />
                </div>
                <div className="text-4xl sm:text-5xl font-extrabold text-white">
                  Real-Time
                </div>
                <div className="mt-2 text-sm font-semibold text-zinc-400">Stock Sync</div>
                <p className="mt-1 text-xs text-zinc-500">Instant inventory updates across locations</p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="text-center p-8 rounded-2xl border border-white/[0.06] bg-white/5 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-sky-500/20">
                  <Warehouse className="w-7 h-7 text-white" />
                </div>
                <div className="text-4xl sm:text-5xl font-extrabold text-white">
                  Multi
                </div>
                <div className="mt-2 text-sm font-semibold text-zinc-400">Warehouse Support</div>
                <p className="mt-1 text-xs text-zinc-500">Track stock across unlimited locations</p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="text-center p-8 rounded-2xl border border-white/[0.06] bg-white/5 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-sky-500/20">
                  <BarChart3 className="w-7 h-7 text-white" />
                </div>
                <div className="text-4xl sm:text-5xl font-extrabold text-white">
                  Real-Time
                </div>
                <div className="mt-2 text-sm font-semibold text-zinc-400">Inventory Sync</div>
                <p className="mt-1 text-xs text-zinc-500">Live updates across all channels</p>
              </div>
            </StaggerItem>
          </StaggerContainer>
        </div>
      </section>

      {/* ── Section 3: Feature Showcase - Point of Sale (mockup left) ── */}
      <section className="section-bg-subtle py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <FadeInLeft>
              <MockBrowserFrame url="app.retailsmarterp.com/pos">
                <MockPOS />
              </MockBrowserFrame>
            </FadeInLeft>
            <FadeInRight>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                Point of Sale
              </h2>
              <p className="mt-4 text-lg text-zinc-400 leading-relaxed">
                Process sales in seconds with barcode scanning, quick item search,
                and an intuitive interface designed for speed. Handle held sales, split
                payments, returns, and gift cards from one powerful screen.
              </p>
              <ul className="mt-8 space-y-3">
                {[
                  'Barcode & SKU scanning',
                  'Multiple payment methods',
                  'Receipt print & email',
                  'Returns & exchanges',
                  'Held sales & layaway',
                  'Gift card support',
                ].map((feature) => (
                  <li key={feature} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                    <span className="text-sm font-medium text-zinc-300">{feature}</span>
                  </li>
                ))}
              </ul>
            </FadeInRight>
          </div>
        </div>
      </section>

      {/* ── Section 4: Feature Showcase - Smart Inventory (mockup right) ── */}
      <section className="section-bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <FadeInLeft className="order-2 lg:order-1">
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                Smart Inventory
              </h2>
              <p className="mt-4 text-lg text-zinc-400 leading-relaxed">
                Track stock across multiple warehouses with real-time updates.
                AI-powered reorder suggestions, automated stock transfers, batch
                tracking, and complete movement history keep you in full control.
              </p>
              <ul className="mt-8 space-y-3">
                {[
                  'Multi-warehouse tracking',
                  'Smart reorder alerts',
                  'Stock transfers',
                  'Batch & serial tracking',
                  'Min/max stock levels',
                  'Movement history',
                ].map((feature) => (
                  <li key={feature} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                    <span className="text-sm font-medium text-zinc-300">{feature}</span>
                  </li>
                ))}
              </ul>
            </FadeInLeft>
            <FadeInRight className="order-1 lg:order-2">
              <div className="relative rounded-2xl overflow-hidden shadow-2xl">
                <Image
                  src="https://images.unsplash.com/photo-1556740738-b6a63e27c4df?w=1200"
                  alt="Retail inventory management"
                  width={1200}
                  height={800}
                  className="w-full h-auto object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-sky-900/40 to-transparent" />
              </div>
            </FadeInRight>
          </div>
        </div>
      </section>

      {/* ── Section 5: Feature Showcase - AI Analytics (mockup left) ── */}
      <section className="section-bg-subtle py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <FadeInLeft>
              <div className="relative rounded-2xl overflow-hidden shadow-2xl">
                <Image
                  src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200"
                  alt="Sales analytics dashboard"
                  width={1200}
                  height={800}
                  className="w-full h-auto object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-blue-900/40 to-transparent" />
              </div>
            </FadeInLeft>
            <FadeInRight>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                AI Analytics
              </h2>
              <p className="mt-4 text-lg text-zinc-400 leading-relaxed">
                Make data-driven decisions with live dashboards powered by AI.
                Analyze sales trends, review customer behavior,
                and spot anomalies with AI-assisted insights.
              </p>
              <ul className="mt-8 space-y-3">
                {[
                  'AI chat insights',
                  'Smart reorder alerts',
                  'Anomaly detection',
                  'Trend analysis',
                  'Custom reports',
                  'Real-time dashboards',
                ].map((feature) => (
                  <li key={feature} className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                    <span className="text-sm font-medium text-zinc-300">{feature}</span>
                  </li>
                ))}
              </ul>
            </FadeInRight>
          </div>
        </div>
      </section>

      {/* ── Section 6: Complete Feature Grid ── */}
      <section className="section-bg-subtle py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="All Features"
            title="Everything for your retail business"
            highlight="retail business"
            subtitle="A comprehensive toolkit covering every aspect of retail operations, from checkout to customer management to AI analytics."
            gradientClass="gradient-text-retail"
          />

          <div className="space-y-12">
            {featureCategories.map((category) => (
              <FadeIn key={category.category}>
                <div>
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-sky-500 to-blue-600" />
                    <category.icon className="w-5 h-5 text-sky-600" />
                    {category.category}
                  </h3>
                  <StaggerContainer className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {category.items.map((item) => (
                      <StaggerItem key={item}>
                        <div className="flex items-center gap-3 p-3 rounded-md bg-white/5 border border-white/[0.06] hover:border-sky-500/30 hover:bg-sky-500/10 transition-colors shadow-sm">
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center flex-shrink-0">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                          <span className="text-sm font-medium text-zinc-300">{item}</span>
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

      {/* ── Section 7: AI Features (dark section) ── */}
      <section className="bg-stone-900 py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="max-w-3xl mx-auto text-center mb-14">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-bold uppercase tracking-widest rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 mb-5">
              <Sparkles className="w-3.5 h-3.5" />
              AI Intelligence
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold leading-tight text-white tracking-tight">
              Powered by{' '}
              <span className="gradient-text-retail">Artificial Intelligence</span>
            </h2>
            <p className="mt-4 text-lg text-gray-400 leading-relaxed max-w-2xl mx-auto">
              Let AI handle the heavy lifting with AI chat assistant, pattern analysis, and smart warning alerts.
            </p>
          </FadeIn>

          <StaggerContainer staggerDelay={0.1} className="grid sm:grid-cols-3 gap-6">
            <StaggerItem>
              <div className="relative p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-sky-500/30 transition-colors group">
                <div className="w-12 h-12 rounded-md bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center mb-4 shadow-lg shadow-sky-500/20">
                  <Package className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Smart Reorder Alerts</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Set min/max stock levels and get alerts when items need reordering, helping prevent both stockouts and overstock.
                </p>
                <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-sky-400">
                  <Brain className="w-3.5 h-3.5" />
                  AI-Powered
                </div>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="relative p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-sky-500/30 transition-colors group">
                <div className="w-12 h-12 rounded-md bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center mb-4 shadow-lg shadow-sky-500/20">
                  <TrendingUp className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Sales Trend Analysis</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  Ask the AI chat assistant about your sales data — get answers about trends, top-performing products, and daily summaries in plain language.
                </p>
                <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-sky-400">
                  <Brain className="w-3.5 h-3.5" />
                  AI-Powered
                </div>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="relative p-6 rounded-2xl bg-white/5 backdrop-blur-sm border border-white/10 hover:border-sky-500/30 transition-colors group">
                <div className="w-12 h-12 rounded-md bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center mb-4 shadow-lg shadow-sky-500/20">
                  <Sparkles className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Customer Behavior Insights</h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  View customer purchase history, track loyalty points, and use customer data to understand your most valuable buyers and their preferences.
                </p>
                <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-sky-400">
                  <Brain className="w-3.5 h-3.5" />
                  AI-Powered
                </div>
              </div>
            </StaggerItem>
          </StaggerContainer>
        </div>
      </section>

      {/* ── Section 8: Cross-links ── */}
      <section className="section-bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Multi-Business Platform"
            title="Also built for other industries"
            highlight="other industries"
            subtitle="RetailSmart ERP adapts to your business type with specialized modules and features."
            gradientClass="gradient-text-retail"
          />

          <StaggerContainer staggerDelay={0.1} className="grid sm:grid-cols-3 gap-6">
            <StaggerItem>
              <Link href="/restaurant" className="group block">
                <div className="rounded-2xl border border-white/[0.06] overflow-hidden hover:border-orange-500/30 hover:shadow-lg transition-all">
                  <div className="relative h-40 overflow-hidden">
                    <Image
                      src="https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600"
                      alt="Restaurant"
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-orange-900/60 to-transparent" />
                    <div className="absolute bottom-3 left-3 flex items-center gap-2">
                      <Utensils className="w-5 h-5 text-white" />
                      <span className="text-white font-bold">Restaurant</span>
                    </div>
                  </div>
                  <div className="p-4">
                    <p className="text-sm text-zinc-400">
                      Kitchen display, table management, reservations, and multi-channel ordering for restaurants of any size.
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-orange-600 group-hover:gap-2 transition-all">
                      Learn more <ArrowRight className="w-4 h-4" />
                    </span>
                  </div>
                </div>
              </Link>
            </StaggerItem>
            <StaggerItem>
              <Link href="/supermarket" className="group block">
                <div className="rounded-2xl border border-white/[0.06] overflow-hidden hover:border-green-500/30 hover:shadow-lg transition-all">
                  <div className="relative h-40 overflow-hidden">
                    <Image
                      src="https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=600"
                      alt="Supermarket"
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-emerald-900/60 to-transparent" />
                    <div className="absolute bottom-3 left-3 flex items-center gap-2">
                      <Store className="w-5 h-5 text-white" />
                      <span className="text-white font-bold">Supermarket</span>
                    </div>
                  </div>
                  <div className="p-4">
                    <p className="text-sm text-zinc-400">
                      High-volume checkout, department management, temperature zones, and bulk inventory tracking.
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-emerald-400 group-hover:gap-2 transition-all">
                      Learn more <ArrowRight className="w-4 h-4" />
                    </span>
                  </div>
                </div>
              </Link>
            </StaggerItem>
            <StaggerItem>
              <Link href="/auto-service" className="group block">
                <div className="rounded-2xl border border-white/[0.06] overflow-hidden hover:border-violet-500/30 hover:shadow-lg transition-all">
                  <div className="relative h-40 overflow-hidden">
                    <Image
                      src="https://images.unsplash.com/photo-1487754180451-c456f719a1fc?w=600"
                      alt="Auto Service"
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-violet-900/60 to-transparent" />
                    <div className="absolute bottom-3 left-3 flex items-center gap-2">
                      <Wrench className="w-5 h-5 text-white" />
                      <span className="text-white font-bold">Auto Service</span>
                    </div>
                  </div>
                  <div className="p-4">
                    <p className="text-sm text-zinc-400">
                      Work orders, vehicle inspections, insurance estimates, parts management, and technician tracking.
                    </p>
                    <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-violet-600 group-hover:gap-2 transition-all">
                      Learn more <ArrowRight className="w-4 h-4" />
                    </span>
                  </div>
                </div>
              </Link>
            </StaggerItem>
          </StaggerContainer>
        </div>
      </section>

      {/* ── Section 9: CTA ── */}
      <CTASection
        title="Ready to modernize your retail store?"
        subtitle="Get started with retail-specific features designed for boutiques, shops, and multi-location chains. Free forever plan available."
        ctaText="Start Free Today"
        ctaHref="/register"
        secondaryText="View Pricing"
        secondaryHref="/pricing"
      />
    </PageWrapper>
  )
}
