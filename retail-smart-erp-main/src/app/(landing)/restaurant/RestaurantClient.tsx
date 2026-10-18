'use client'

import Link from 'next/link'
import {
  Monitor,
  LayoutGrid,
  Calculator,
  ArrowRight,
  UtensilsCrossed,
  Check,
  Sparkles,
  TrendingUp,
  Clock,
  Store,
  ShoppingCart,
  Wrench,
  Car,
  Flame,
  Zap,
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
  GradientOrbsV2,
  HeroBadge,
  TrustBar,
} from '@/components/landing/motion'
import SectionHeading from '@/components/landing/SectionHeading'
import FeatureShowcase from '@/components/landing/FeatureShowcase'
import FeatureCard from '@/components/landing/FeatureCard'
import CTASection from '@/components/landing/CTASection'
import AIBadge from '@/components/landing/AIBadge'
import BusinessTypeCard from '@/components/landing/BusinessTypeCard'
import { MockPOS } from '@/components/landing/mockups/MockPOS'
import { MockKitchenDisplay } from '@/components/landing/mockups/MockKitchenDisplay'
import { MockTables } from '@/components/landing/mockups/MockTables'
import { MockInventory } from '@/components/landing/mockups/MockInventory'
import { MockDashboard } from '@/components/landing/mockups/MockDashboard'
import { MockWorkOrders } from '@/components/landing/mockups/MockWorkOrders'

const featureCategories = [
  {
    category: 'Kitchen Display',
    items: [
      'Real-time kitchen display',
      'Station-based order routing',
      'Priority & course management',
      'Order timing & alerts',
      'Bump screen support',
      'Kitchen performance metrics',
      'Waste tracking & analysis',
      'Multi-station support',
    ],
  },
  {
    category: 'Table Management',
    items: [
      'Visual floor plan editor',
      'Real-time table status',
      'Reservation management',
      'Wait time estimates',
      'Table merge & split',
      'Capacity planning',
      'Waitlist management',
      'Occupancy tracking',
    ],
  },
  {
    category: 'POS & Orders',
    items: [
      'Dine-in ordering',
      'Takeaway management',
      'Delivery order tracking',
      'Tab management',
      'Split bills & partial payments',
      'Tips & service charges',
    ],
  },
  {
    category: 'Menu Management',
    items: [
      'Digital menu creation',
      'Modifiers & add-ons',
      'Recipe costing',
      'Ingredient tracking',
      'Course ordering',
      'Category-based pricing',
    ],
  },
  {
    category: 'Accounting',
    items: [
      'Chart of accounts',
      'Journal entries',
      'Bank reconciliation',
      'Tax management',
      'Profit & loss reports',
      'Budget tracking',
    ],
  },
  {
    category: 'AI & Analytics',
    aiCategory: true,
    items: [
      'Table turnover analysis',
      'Peak hour identification',
      'Menu item performance',
      'Staff productivity metrics',
      'AI chat insights',
      'Waste reduction insights',
    ],
  },
]

export default function RestaurantClient() {
  return (
    <PageWrapper>
      {/* ── Section 1: Hero ── */}
      <section className="relative min-h-[600px] sm:min-h-[700px] flex items-center overflow-hidden bg-gradient-to-br from-zinc-950 via-orange-950/20 to-red-950/10">
        <GradientOrbsV2
          colors={['#f97316', '#ef4444', '#f59e0b']}
          intensity="medium"
        />
        <div className="noise-overlay" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full py-20 sm:py-24">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            {/* Left: Text content */}
            <div>
              <BlurFadeIn>
                <div className="flex flex-wrap items-center gap-3">
                  <HeroBadge
                    text="Restaurant Solution"
                    icon={<UtensilsCrossed className="w-4 h-4 text-orange-600" />}
                    className="bg-gradient-to-r from-orange-500/10 to-red-500/10 text-orange-400 border-orange-500/30 !mb-0"
                  />
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    <Check className="w-3.5 h-3.5" />
                    Free Forever
                  </span>
                </div>
              </BlurFadeIn>
              <BlurFadeIn delay={0.1}>
                <h1 className="mt-6 text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight text-white">
                  Restaurant Management,{' '}
                  <span className="gradient-text-restaurant">Reimagined</span>
                </h1>
              </BlurFadeIn>
              <BlurFadeIn delay={0.2}>
                <p className="mt-6 text-lg sm:text-xl text-zinc-400 leading-relaxed max-w-xl">
                  From order to kitchen to table -- streamline your entire
                  restaurant with a real-time kitchen display system, smart table
                  management, and seamless reservation handling in one powerful platform.
                </p>
              </BlurFadeIn>
              <BlurFadeIn delay={0.3}>
                <div className="mt-8 flex flex-wrap gap-4">
                  <Link
                    href="/register"
                    className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 rounded-md transition-all shadow-lg shadow-orange-500/25 hover:shadow-orange-500/40 hover:-translate-y-0.5"
                  >
                    Get Started Free
                    <ArrowRight className="w-5 h-5" />
                  </Link>
                  <Link
                    href="/features"
                    className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-zinc-300 border border-white/10 hover:border-orange-500/30 hover:text-orange-400 hover:bg-orange-500/10 rounded-md transition-all hover:-translate-y-0.5"
                  >
                    View Features
                  </Link>
                </div>
              </BlurFadeIn>
              <BlurFadeIn delay={0.4}>
                <div className="mt-8 flex items-center gap-6 text-sm text-zinc-500">
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-orange-500" />
                    Free Forever · No Credit Card
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-orange-500" />
                    Unlimited users
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Check className="w-4 h-4 text-orange-500" />
                    Free forever plan
                  </div>
                </div>
              </BlurFadeIn>
            </div>

            {/* Right: Hero mockup */}
            <FadeInRight className="hidden lg:block">
              <FloatingMockup>
                <BrowserMockup url="retailsmarterp.com/kitchen">
                  <MockKitchenDisplay />
                </BrowserMockup>
              </FloatingMockup>
            </FadeInRight>
          </div>
        </div>
      </section>

      {/* ── Trust Bar ── */}
      <TrustBar
        metrics={[
          { label: 'Kitchen Stations', value: 'Multi', icon: <Flame className="w-5 h-5 text-orange-500" /> },
          { label: 'Order Channels', value: '3+', icon: <Zap className="w-5 h-5 text-orange-500" /> },
          { label: 'Real-Time Sync', value: 'Live', icon: <Monitor className="w-5 h-5 text-orange-500" /> },
        ]}
      />

      {/* ── Section 2: Key Metrics ── */}
      <section className="section-bg-white py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <StaggerContainer staggerDelay={0.12} className="grid sm:grid-cols-3 gap-6">
            <StaggerItem>
              <div className="glass-card-v2 p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-orange-500/20">
                  <Monitor className="w-7 h-7 text-white" />
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-white">
                  Real-Time
                </div>
                <div className="mt-2 text-sm font-medium text-zinc-400">Kitchen Display</div>
                <p className="mt-1 text-xs text-zinc-500">Instant order flow from table to kitchen station</p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="glass-card-v2 p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-orange-500/20">
                  <LayoutGrid className="w-7 h-7 text-white" />
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-white">
                  Visual
                </div>
                <div className="mt-2 text-sm font-medium text-zinc-400">Table Management</div>
                <p className="mt-1 text-xs text-zinc-500">Interactive floor plan with live status tracking</p>
              </div>
            </StaggerItem>
            <StaggerItem>
              <div className="glass-card-v2 p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-orange-500/20">
                  <Calculator className="w-7 h-7 text-white" />
                </div>
                <div className="text-3xl sm:text-4xl font-extrabold text-white">
                  Full
                </div>
                <div className="mt-2 text-sm font-medium text-zinc-400">Recipe Costing</div>
                <p className="mt-1 text-xs text-zinc-500">Track ingredient costs for every menu item</p>
              </div>
            </StaggerItem>
          </StaggerContainer>
        </div>
      </section>

      {/* ── Section 3: Feature Showcase - Kitchen Display System ── */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FeatureShowcase
            title="Kitchen Display System"
            description="Seamless order flow from table to kitchen. Priority management, course timing, station routing, and instant status updates keep your kitchen running at peak efficiency with zero paper tickets."
            features={[
              'Real-time order queue display',
              'Status tracking per order item',
              'Priority ordering & rush flags',
              'Cook time monitoring & alerts',
              'Auto-notifications when ready',
              'Multi-station routing support',
            ]}
            mockup={<MockKitchenDisplay />}
            gradient="from-orange-500 to-red-500"
          />
        </div>
      </section>

      {/* ── Section 4: Feature Showcase - Table & Floor Management (reversed) ── */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FeatureShowcase
            title="Table & Floor Management"
            description="Visual floor plan with real-time table status. Manage reservations, track occupancy, merge or split tables, and optimize seating for maximum turnover and guest satisfaction."
            features={[
              'Interactive floor plan editor',
              'Real-time table status updates',
              'Reservation management system',
              'Wait time estimates for guests',
              'Merge & split tables on the fly',
              'Capacity planning & analytics',
            ]}
            mockup={<MockTables />}
            reversed
            gradient="from-orange-500 to-red-500"
          />
        </div>
      </section>

      {/* ── Section 5: Feature Showcase - Complete Restaurant POS ── */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <FeatureShowcase
            title="Complete Restaurant POS"
            description="Handle dine-in, takeaway, and delivery orders from a single unified interface. Full menu management with modifiers, course ordering, tab management, and integrated tips and service charges."
            features={[
              'Full menu management with categories',
              'Modifiers & add-ons per item',
              'Course ordering for fine dining',
              'Delivery order tracking',
              'Tab management & split bills',
              'Tips & service charge handling',
            ]}
            mockup={<MockPOS />}
            gradient="from-orange-500 to-red-500"
          />
        </div>
      </section>

      {/* ── Section 6: Also Includes - Other Business Types ── */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Multi-Business Platform"
            title="Also built for other industries"
            highlight="other industries"
            subtitle="RetailSmart ERP adapts to your business type with specialized modules and features."
            gradientClass="gradient-text-restaurant"
          />

          <StaggerContainer staggerDelay={0.1} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <StaggerItem>
              <BusinessTypeCard
                name="Retail"
                description="Fast checkout, smart inventory, customer loyalty, and AI analytics for retail stores."
                href="/retail"
                icon={Store}
                mockup={<MockInventory />}
                gradient="from-blue-600 to-sky-500"
              />
            </StaggerItem>
            <StaggerItem>
              <BusinessTypeCard
                name="Supermarket"
                description="High-volume checkout, department management, and bulk inventory tracking."
                href="/supermarket"
                icon={ShoppingCart}
                mockup={<MockDashboard />}
                gradient="from-emerald-500 to-cyan-500"
              />
            </StaggerItem>
            <StaggerItem>
              <BusinessTypeCard
                name="Auto Service"
                description="Work orders, vehicle inspections, insurance estimates, and parts management."
                href="/auto-service"
                icon={Wrench}
                mockup={<MockWorkOrders />}
                gradient="from-violet-500 to-pink-500"
              />
            </StaggerItem>
            <StaggerItem>
              <BusinessTypeCard
                name="Vehicle Dealership"
                description="New & used vehicle sales, trade-ins, test drives, and inventory management."
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
            badge="Restaurant Features"
            title="Purpose-built for restaurants"
            highlight="restaurants"
            subtitle="Every tool your restaurant needs, from kitchen operations to front-of-house management and multi-channel ordering."
            gradientClass="gradient-text-restaurant"
          />

          <div className="space-y-12">
            {featureCategories.map((category) => (
              <FadeIn key={category.category}>
                <div>
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-orange-500 to-red-500" />
                    {category.category}
                    {category.aiCategory && <AIBadge size="sm" />}
                  </h3>
                  <StaggerContainer className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {category.items.map((item) => (
                      <StaggerItem key={item}>
                        <div className="flex items-center gap-3 p-3 rounded-md bg-white/5 border border-white/[0.06] hover:border-orange-500/30 hover:bg-orange-500/10 transition-colors shadow-sm">
                          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center flex-shrink-0">
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

      {/* ── Section 8: AI Features ── */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="AI Intelligence"
            title="Smarter decisions with AI"
            highlight="AI"
            subtitle="Let artificial intelligence optimize your restaurant operations with AI-assisted insights, waste tracking, and operational analysis."
            gradientClass="gradient-text-restaurant"
          />

          <StaggerContainer staggerDelay={0.1} className="grid sm:grid-cols-3 gap-6">
            <StaggerItem>
              <FeatureCard
                icon={TrendingUp}
                title="Sales Insights"
                description="AI analyzes your sales data and menu performance to help you understand busy periods and popular items for better planning."
                gradient="from-orange-500 to-red-500"
                aiPowered
              />
            </StaggerItem>
            <StaggerItem>
              <FeatureCard
                icon={Clock}
                title="Waste Reduction Intelligence"
                description="Track food waste patterns and identify which items are frequently wasted. Use data to make better purchasing and prep decisions."
                gradient="from-orange-500 to-red-500"
                aiPowered
              />
            </StaggerItem>
            <StaggerItem>
              <FeatureCard
                icon={Sparkles}
                title="Peak Hour Optimization"
                description="Review your busiest periods through reports and analytics. Use the data to plan staffing, table setups, and prep schedules effectively."
                gradient="from-orange-500 to-red-500"
                aiPowered
              />
            </StaggerItem>
          </StaggerContainer>
        </div>
      </section>

      {/* ── Section 9: CTA ── */}
      <CTASection
        title="Ready to serve faster?"
        subtitle="Get started with restaurant-specific features including kitchen display, table management, and multi-channel orders. Free forever plan available."
        ctaText="Start Free Today"
        ctaHref="/register"
        secondaryText="View Pricing"
        secondaryHref="/pricing"
      />
    </PageWrapper>
  )
}
