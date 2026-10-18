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
  ShieldCheck,
  Store,
  Utensils,
  Wrench,
  Car,
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
  CountUpOnView,
} from '@/components/landing/motion'
import SectionHeading from '@/components/landing/SectionHeading'
import CTASection from '@/components/landing/CTASection'
import {
  MockPOS,
  MockInventory,
} from '@/components/landing/mockups'
import { MockBrowserFrame } from '@/components/landing/mockups/MockBrowserFrame'

/* ── Feature Grid Data ── */
const featureCategories = [
  {
    category: 'Checkout & POS',
    items: [
      'Multiple POS sessions',
      'High-speed barcode scanning',
      'Weight-based items',
      'Quick checkout mode',
      'Customer-facing receipts',
      'Gift cards & store credit',
    ],
  },
  {
    category: 'Inventory & Stock',
    items: [
      'Batch & expiry date tracking',
      'Department organization',
      'Automated reorder points',
      'Shelf-life & FIFO rotation',
      'Multi-warehouse transfers',
      'Shrinkage & waste tracking',
    ],
  },
  {
    category: 'Department Operations',
    items: [
      'Department hierarchy management',
      'Barcode label support',
      'Daily close & reconciliation',
      'Supplier management',
      'Purchase order automation',
    ],
  },
  {
    category: 'Analytics & Reporting',
    items: [
      'Department performance analytics',
      'Peak hour analysis',
      'Customer basket analysis',
      'Margin & profitability reports',
      'Real-time sales dashboards',
    ],
  },
]

/* ── AI Feature Data ── */
const aiFeatures = [
  {
    icon: Brain,
    title: 'AI Sales Insights',
    description:
      'AI analyzes your sales data and stock levels to help you understand buying patterns and make better restocking decisions across all departments.',
  },
  {
    icon: ShieldCheck,
    title: 'Expiry & Waste Tracking',
    description:
      'Track products approaching expiry with batch management. Use expiry reports to plan markdowns and transfers before items go to waste.',
  },
  {
    icon: Sparkles,
    title: 'Dynamic Pricing Suggestions',
    description:
      'View department-level and category-level analytics to understand which areas drive the most revenue and identify underperforming products.',
  },
]

/* ── Feature Showcase Data ── */
const showcases = [
  {
    title: 'High-Volume POS',
    description:
      'Handle peak-hour rush across multiple POS stations with fast checkout. From barcode scanning to weighted items, every lane stays moving at top speed.',
    features: [
      'Fast checkout with multi-lane support',
      'Barcode & PLU scanning',
      'Weight-based items',
      'Loyalty points at checkout',
      'Multiple payment methods',
      'Customer-facing receipts',
    ],
  },
  {
    title: 'Department Management',
    description:
      'Track stock across departments and warehouses with real-time visibility. Monitor batch numbers, expiry dates, and department categories to keep every product fresh and accounted for.',
    features: [
      'Multi-department hierarchy',
      'Department organization',
      'Batch & expiry tracking',
      'Auto reorder alerts',
      'Barcode label support',
      'Waste & shrinkage tracking',
    ],
    image: 'https://images.unsplash.com/photo-1534723452862-4c874018d66d?w=1200',
  },
  {
    title: 'Analytics & Insights',
    description:
      'Make data-driven decisions with real-time dashboards and AI-powered analytics. Track department performance, identify trends, and optimize operations across your entire store.',
    features: [
      'Department performance breakdown',
      'Peak hour analysis',
      'Shrinkage tracking & alerts',
      'AI sales insights',
      'Customer analytics & baskets',
      'Supplier performance reports',
    ],
    image: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=1200',
  },
]

export default function SupermarketClient() {
  return (
    <PageWrapper>
      {/* ── Section 1: Hero ── */}
      <section className="relative overflow-hidden min-h-[85vh] flex items-center">
        {/* Background Image */}
        <Image
          src="https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=1920"
          alt="Supermarket interior"
          fill
          priority
          quality={90}
          className="object-cover"
        />
        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-green-900/85 via-emerald-900/70 to-green-800/60" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full py-20 sm:py-24">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left: Text content */}
            <div>
              <BlurFadeIn>
                <div className="flex flex-wrap items-center gap-3">
                  <HeroBadge
                    text="Supermarket Solution"
                    icon={<ShoppingCart className="w-4 h-4 text-green-600" />}
                    className="bg-white/10 text-green-400 border-green-500/30 !mb-0"
                  />
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 backdrop-blur-sm">
                    <Check className="w-3.5 h-3.5" />
                    Free Forever
                  </span>
                </div>
              </BlurFadeIn>
              <BlurFadeIn delay={0.1}>
                <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight text-white">
                  High-Volume Checkout for{' '}
                  <span className="gradient-text-supermarket">Supermarkets</span>
                </h1>
              </BlurFadeIn>
              <BlurFadeIn delay={0.2}>
                <p className="mt-6 text-lg sm:text-xl text-green-100 leading-relaxed max-w-xl">
                  Department management, batch inventory, expiry tracking,
                  loyalty programs, and AI-assisted insights for grocery
                  operations.
                </p>
              </BlurFadeIn>
              <BlurFadeIn delay={0.3}>
                <div className="mt-8 flex flex-wrap gap-4">
                  <Link
                    href="/register"
                    className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 rounded-md transition-all shadow-lg shadow-green-500/25 hover:shadow-green-500/40 hover:-translate-y-0.5"
                  >
                    Get Started Free
                    <ArrowRight className="w-5 h-5" />
                  </Link>
                  <Link
                    href="/features"
                    className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white border border-white/30 hover:border-white/60 hover:bg-white/10 rounded-md transition-all hover:-translate-y-0.5"
                  >
                    View Features
                  </Link>
                </div>
              </BlurFadeIn>
              <BlurFadeIn delay={0.4}>
                <div className="mt-8 flex items-center gap-6 text-sm text-green-200">
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-green-400" />
                    Free Forever · No Credit Card
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-green-400" />
                    Unlimited users
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-green-400" />
                    Free forever plan
                  </div>
                </div>
              </BlurFadeIn>
            </div>

            {/* Right: Hero mockup */}
            <FadeInRight className="hidden lg:block">
              <FloatingMockup>
                <MockBrowserFrame url="app.retailsmarterp.com/inventory">
                  <MockInventory />
                </MockBrowserFrame>
              </FloatingMockup>
            </FadeInRight>
          </div>
        </div>
      </section>

      {/* ── Section 2: Key Metrics ── */}
      <section className="py-16 sm:py-20" style={{ backgroundColor: '#09090b' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <StaggerContainer staggerDelay={0.12} className="grid sm:grid-cols-3 gap-6">
            <StaggerItem>
              <div className="bg-white/5 rounded-2xl border border-white/10 p-6 text-center shadow-sm">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-green-500/20">
                  <ShoppingCart className="w-7 h-7 text-white" />
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-white">
                  Multi
                </div>
                <div className="mt-2 text-sm font-semibold text-white">
                  POS Lanes
                </div>
                <p className="mt-1 text-xs text-zinc-400">
                  Support multiple checkout stations simultaneously
                </p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="bg-white/5 rounded-2xl border border-white/10 p-6 text-center shadow-sm">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-green-500/20">
                  <Package className="w-7 h-7 text-white" />
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-white">
                  <CountUpOnView value={30} suffix="+" />
                </div>
                <div className="mt-2 text-sm font-semibold text-white">
                  Department
                </div>
                <p className="mt-1 text-xs text-zinc-400">
                  Organize products with category hierarchy
                </p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="bg-white/5 rounded-2xl border border-white/10 p-6 text-center shadow-sm">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-green-500/20">
                  <BarChart3 className="w-7 h-7 text-white" />
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-white">
                  Full
                </div>
                <div className="mt-2 text-sm font-semibold text-white">
                  Batch
                </div>
                <p className="mt-1 text-xs text-zinc-400">
                  Complete batch & expiry tracking
                </p>
              </div>
            </StaggerItem>
          </StaggerContainer>
        </div>
      </section>

      {/* ── Section 3: Feature Showcase - High-Volume POS ── */}
      <section className="py-20 sm:py-28 section-bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <FadeInLeft>
              <FloatingMockup>
                <MockBrowserFrame url="app.retailsmarterp.com/pos">
                  <MockPOS />
                </MockBrowserFrame>
              </FloatingMockup>
            </FadeInLeft>
            <FadeInRight>
              <div>
                <span className="inline-block px-3 py-1 text-xs font-bold uppercase tracking-widest rounded-full bg-green-500/10 text-green-400 border border-green-500/30 mb-4">
                  Point of Sale
                </span>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight">
                  {showcases[0].title}
                </h2>
                <p className="mt-4 text-lg text-zinc-400 leading-relaxed">
                  {showcases[0].description}
                </p>
                <ul className="mt-6 space-y-3">
                  {showcases[0].features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-3 text-zinc-300"
                    >
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center flex-shrink-0">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                      <span className="text-sm font-medium">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </FadeInRight>
          </div>
        </div>
      </section>

      {/* ── Section 4: Feature Showcase - Department Management ── */}
      <section className="py-20 sm:py-28" style={{ backgroundColor: '#09090b' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <FadeInLeft className="order-2 lg:order-1">
              <div>
                <span className="inline-block px-3 py-1 text-xs font-bold uppercase tracking-widest rounded-full bg-green-500/10 text-green-400 border border-green-500/30 mb-4">
                  Inventory
                </span>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight">
                  {showcases[1].title}
                </h2>
                <p className="mt-4 text-lg text-zinc-400 leading-relaxed">
                  {showcases[1].description}
                </p>
                <ul className="mt-6 space-y-3">
                  {showcases[1].features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-3 text-zinc-300"
                    >
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center flex-shrink-0">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                      <span className="text-sm font-medium">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </FadeInLeft>
            <FadeInRight className="order-1 lg:order-2">
              <div className="relative rounded-2xl overflow-hidden shadow-2xl">
                <Image
                  src={showcases[1].image!}
                  alt="Department Management"
                  width={1200}
                  height={800}
                  className="object-cover w-full h-auto"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-green-900/30 to-transparent" />
              </div>
            </FadeInRight>
          </div>
        </div>
      </section>

      {/* ── Section 5: Feature Showcase - Analytics & Insights ── */}
      <section className="py-20 sm:py-28 section-bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <FadeInLeft>
              <div className="relative rounded-2xl overflow-hidden shadow-2xl">
                <Image
                  src={showcases[2].image!}
                  alt="Analytics & Insights"
                  width={1200}
                  height={800}
                  className="object-cover w-full h-auto"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-green-900/30 to-transparent" />
              </div>
            </FadeInLeft>
            <FadeInRight>
              <div>
                <span className="inline-block px-3 py-1 text-xs font-bold uppercase tracking-widest rounded-full bg-green-500/10 text-green-400 border border-green-500/30 mb-4">
                  Analytics
                </span>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white leading-tight">
                  {showcases[2].title}
                </h2>
                <p className="mt-4 text-lg text-zinc-400 leading-relaxed">
                  {showcases[2].description}
                </p>
                <ul className="mt-6 space-y-3">
                  {showcases[2].features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-3 text-zinc-300"
                    >
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center flex-shrink-0">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                      <span className="text-sm font-medium">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </FadeInRight>
          </div>
        </div>
      </section>

      {/* ── Section 6: Complete Feature Grid ── */}
      <section className="py-20 sm:py-28" style={{ backgroundColor: '#09090b' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Complete Feature Set"
            title="Everything your supermarket needs"
            highlight="supermarket needs"
            subtitle="From checkout lanes to back office, every tool built for high-volume grocery and supermarket operations."
            gradientClass="gradient-text-supermarket"
          />

          <div className="space-y-12">
            {featureCategories.map((category) => (
              <FadeIn key={category.category}>
                <div>
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-green-500 to-emerald-500" />
                    {category.category}
                  </h3>
                  <StaggerContainer className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {category.items.map((item) => (
                      <StaggerItem key={item}>
                        <div className="flex items-center gap-3 p-3 rounded-md bg-white/5 border border-white/10 hover:border-green-500/30 hover:bg-green-500/10 transition-colors shadow-sm">
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center flex-shrink-0">
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

      {/* ── Section 7: AI Features (Dark Section) ── */}
      <section className="py-20 sm:py-28 bg-stone-900 relative overflow-hidden">
        {/* Decorative gradient accents */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-green-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-emerald-500/10 rounded-full blur-[100px]" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <BlurFadeIn>
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-green-500/10 text-green-400 border border-green-500/20 mb-6">
                <Sparkles className="w-4 h-4" />
                AI-Powered Intelligence
              </span>
            </BlurFadeIn>
            <BlurFadeIn delay={0.1}>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white leading-tight">
                Smarter operations with{' '}
                <span className="gradient-text-supermarket">AI</span>
              </h2>
            </BlurFadeIn>
            <BlurFadeIn delay={0.2}>
              <p className="mt-4 text-lg text-stone-400 max-w-2xl mx-auto">
                Leverage artificial intelligence to analyze sales, track waste,
                and optimize every department in your supermarket.
              </p>
            </BlurFadeIn>
          </div>

          <StaggerContainer staggerDelay={0.1} className="grid sm:grid-cols-3 gap-6">
            {aiFeatures.map((feature) => (
              <StaggerItem key={feature.title}>
                <div className="bg-stone-800/50 border border-stone-700/50 rounded-2xl p-6 backdrop-blur-sm hover:border-green-500/30 transition-colors h-full">
                  <div className="w-12 h-12 rounded-md bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center mb-4 shadow-lg shadow-green-500/20">
                    <feature.icon className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="text-lg font-bold text-white">
                      {feature.title}
                    </h3>
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                      AI
                    </span>
                  </div>
                  <p className="text-sm text-stone-400 leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ── Section 8: Cross-links to Other Business Types ── */}
      <section className="py-20 sm:py-28 section-bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Multi-Business Platform"
            title="Solutions for every business type"
            highlight="every business type"
            subtitle="RetailSmart ERP adapts to your industry. Explore other purpose-built solutions."
            gradientClass="gradient-text-supermarket"
          />

          <StaggerContainer staggerDelay={0.1} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <StaggerItem>
              <Link
                href="/retail"
                className="group block bg-white/5 rounded-2xl border border-white/10 p-6 hover:border-blue-500/30 hover:shadow-lg transition-all"
              >
                <div className="w-12 h-12 rounded-md bg-gradient-to-br from-blue-600 to-sky-500 flex items-center justify-center mb-4 shadow-lg shadow-blue-500/20">
                  <Store className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors">
                  Retail
                </h3>
                <p className="mt-2 text-sm text-zinc-400">
                  Complete POS and inventory management for retail stores.
                </p>
                <div className="mt-4 flex items-center gap-1 text-sm font-semibold text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  Learn more <ArrowRight className="w-4 h-4" />
                </div>
              </Link>
            </StaggerItem>
            <StaggerItem>
              <Link
                href="/restaurant"
                className="group block bg-white/5 rounded-2xl border border-white/10 p-6 hover:border-orange-500/30 hover:shadow-lg transition-all"
              >
                <div className="w-12 h-12 rounded-md bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center mb-4 shadow-lg shadow-orange-500/20">
                  <Utensils className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white group-hover:text-orange-400 transition-colors">
                  Restaurant
                </h3>
                <p className="mt-2 text-sm text-zinc-400">
                  Kitchen display, table management, and ordering.
                </p>
                <div className="mt-4 flex items-center gap-1 text-sm font-semibold text-orange-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  Learn more <ArrowRight className="w-4 h-4" />
                </div>
              </Link>
            </StaggerItem>
            <StaggerItem>
              <Link
                href="/auto-service"
                className="group block bg-white/5 rounded-2xl border border-white/10 p-6 hover:border-violet-500/30 hover:shadow-lg transition-all"
              >
                <div className="w-12 h-12 rounded-md bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center mb-4 shadow-lg shadow-violet-500/20">
                  <Wrench className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white group-hover:text-violet-400 transition-colors">
                  Auto Service
                </h3>
                <p className="mt-2 text-sm text-zinc-400">
                  Work orders, vehicle tracking, and insurance estimates.
                </p>
                <div className="mt-4 flex items-center gap-1 text-sm font-semibold text-violet-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  Learn more <ArrowRight className="w-4 h-4" />
                </div>
              </Link>
            </StaggerItem>
            <StaggerItem>
              <Link
                href="/dealership"
                className="group block bg-white/5 rounded-2xl border border-white/10 p-6 hover:border-cyan-500/30 hover:shadow-lg transition-all"
              >
                <div className="w-12 h-12 rounded-md bg-gradient-to-br from-cyan-500 to-teal-500 flex items-center justify-center mb-4 shadow-lg shadow-cyan-500/20">
                  <Car className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-bold text-white group-hover:text-cyan-400 transition-colors">
                  Vehicle Dealership
                </h3>
                <p className="mt-2 text-sm text-zinc-400">
                  New & used vehicle sales, trade-ins, and test drives.
                </p>
                <div className="mt-4 flex items-center gap-1 text-sm font-semibold text-cyan-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  Learn more <ArrowRight className="w-4 h-4" />
                </div>
              </Link>
            </StaggerItem>
          </StaggerContainer>
        </div>
      </section>

      {/* ── Section 9: CTA ── */}
      <CTASection
        title="Ready to scale your supermarket?"
        subtitle="Get started with supermarket-specific features designed for high-volume grocery operations. Free forever plan available."
        ctaText="Start Free Today"
        ctaHref="/register"
        secondaryText="View Pricing"
        secondaryHref="/pricing"
      />
    </PageWrapper>
  )
}
