'use client'

import {
  Lightbulb, Users, Shield, Zap, Sparkles,
  Globe, BarChart3, Lock, Rocket, Heart,
  Code2, Database,
} from 'lucide-react'
import {
  PageWrapper,
  FadeIn,
  FadeInLeft,
  FadeInRight,
  BlurFadeIn,
  StaggerContainer,
  StaggerItem,
  SpringCounter,
  BrowserMockup,
  HeroBadge,
} from '@/components/landing/motion'
import SectionHeading from '@/components/landing/SectionHeading'
import CTASection from '@/components/landing/CTASection'
import { MockDashboard } from '@/components/landing/mockups/MockDashboard'

const values = [
  { icon: Lightbulb, title: 'Innovation', description: 'AI-powered features that push the boundaries of what business software can do.', gradient: 'from-amber-500 to-orange-500' },
  { icon: Heart, title: 'Customer First', description: 'Every feature is built with our customers\' success in mind. Your growth is our mission.', gradient: 'from-pink-500 to-rose-500' },
  { icon: Shield, title: 'Trust & Security', description: 'Complete data isolation, encrypted connections, and regular backups protect your data.', gradient: 'from-emerald-500 to-teal-500' },
  { icon: Zap, title: 'Simplicity', description: 'Powerful doesn\'t mean complicated. Intuitive design for every business type.', gradient: 'from-blue-500 to-sky-500' },
]

const milestones = [
  { year: '2024', title: 'The Idea', description: 'Identified the gap: SMBs need enterprise tools without enterprise pricing.' },
  { year: '2024', title: 'Core Platform', description: 'Built cloud POS with real-time sync and 4 business types.' },
  { year: '2025', title: 'AI Integration', description: 'Added AI chat assistant, smart warnings, and error analysis.' },
  { year: '2025', title: 'Platform Maturity', description: 'Database-level data isolation, role-based access, accounting, HR, and payroll modules.' },
  { year: '2026', title: 'Global Launch', description: 'Multi-currency pricing and worldwide availability.' },
]

const techStack = [
  { name: 'Modern Stack', icon: Code2, color: 'text-white' },
  { name: 'Real-Time Sync', icon: Zap, color: 'text-amber-500' },
  { name: 'Data Isolation', icon: Shield, color: 'text-emerald-500' },
  { name: 'Managed DB', icon: Database, color: 'text-blue-600' },
  { name: 'AI Analytics', icon: Sparkles, color: 'text-violet-500' },
  { name: 'Cloud Native', icon: Code2, color: 'text-sky-500' },
  { name: 'Multi-Currency', icon: Code2, color: 'text-cyan-500' },
  { name: 'Mobile Ready', icon: Code2, color: 'text-blue-500' },
]

const platformHighlights = [
  { icon: Users, value: 'Unlimited', label: 'Users per plan', gradient: 'from-blue-500 to-violet-500' },
  { icon: Globe, value: '4', label: 'Business types', gradient: 'from-emerald-500 to-teal-500' },
  { icon: Lock, value: 'Full', label: 'Data isolation', gradient: 'from-amber-500 to-orange-500' },
  { icon: BarChart3, value: 'AI', label: 'Powered analytics', gradient: 'from-pink-500 to-rose-500' },
  { icon: Rocket, value: 'Real-time', label: 'Live sync', gradient: 'from-violet-500 to-purple-500' },
  { icon: Shield, value: 'Multi', label: 'Role access', gradient: 'from-blue-600 to-sky-500' },
]

export default function AboutClient() {
  return (
    <PageWrapper>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden pt-32 pb-20" style={{ background: 'linear-gradient(135deg, #09090b 0%, rgba(139,92,246,0.03) 50%, rgba(99,102,241,0.03) 100%)' }}>
        <div className="mesh-gradient-hero" />
        <div className="noise-overlay" />
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <BlurFadeIn>
            <HeroBadge
              text="Our Mission"
              icon={<Sparkles className="w-4 h-4 text-violet-600" />}
              className="mb-5"
            />
          </BlurFadeIn>
          <BlurFadeIn delay={0.1}>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight tracking-tight">
              Building the Future of <span className="gradient-text-animate">Business Management</span>
            </h1>
          </BlurFadeIn>
          <BlurFadeIn delay={0.2}>
            <p className="mt-6 text-lg sm:text-xl text-zinc-400 leading-relaxed max-w-2xl mx-auto">
              We&apos;re on a mission to democratize AI-powered business tools for every entrepreneur, regardless of size or budget.
            </p>
          </BlurFadeIn>
        </div>
      </section>

      {/* ── Mission Quote ── */}
      <section className="section-bg-white py-16 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="relative p-8 sm:p-12 rounded-3xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 border border-indigo-500/20">
              <div className="absolute -top-4 left-8 w-8 h-8 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center">
                <span className="text-white text-lg font-bold">&ldquo;</span>
              </div>
              <blockquote className="text-xl sm:text-2xl font-medium text-zinc-300 leading-relaxed italic text-center">
                Every business, regardless of size, deserves access to professional management tools. Our mission is to democratize business technology with AI at its core.
              </blockquote>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── Our Story ── */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <FadeInLeft>
              <div>
                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-indigo-500/10 to-violet-500/10 text-indigo-400 border border-indigo-500/20 mb-4">
                  Our Story
                </span>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-6 tracking-tight">
                  From a simple idea to a <span className="gradient-text-blue-violet">complete platform</span>
                </h2>
                <div className="space-y-4 text-zinc-400 leading-relaxed">
                  <p>
                    RetailSmart ERP was born from a simple observation: small and medium businesses were struggling with fragmented, expensive, and overly complex software solutions. They needed a unified platform that could handle everything from point of sale to accounting, without the enterprise price tag.
                  </p>
                  <p>
                    We set out to build a truly comprehensive business management platform that adapts to different business types. Whether you run a retail store, restaurant, supermarket, or auto service center, RetailSmart ERP provides the specific tools you need while maintaining a consistent, intuitive experience.
                  </p>
                  <p>
                    Today, our platform supports four distinct business types with specialized modules, database-level data isolation, real-time collaboration, and AI-assisted analytics that help you make smarter decisions.
                  </p>
                  <p>
                    Making enterprise tools truly accessible means more than just building great software — it means removing financial barriers. That&apos;s why your first company on RetailSmart is <span className="text-emerald-400 font-semibold">completely free, forever</span>. No trial period, no credit card required, no feature restrictions.
                  </p>
                </div>
              </div>
            </FadeInLeft>
            <FadeInRight>
              <BrowserMockup url="app.retailsmarterp.com/dashboard">
                <MockDashboard />
              </BrowserMockup>
            </FadeInRight>
          </div>
        </div>
      </section>

      {/* ── Timeline ── */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Our Journey"
            title="Key milestones"
            highlight="milestones"
          />
          <div className="relative">
            <div className="absolute left-[22px] sm:left-1/2 sm:-translate-x-px top-0 bottom-0 w-0.5 bg-gradient-to-b from-indigo-600 via-violet-500 to-pink-500" />
            <div className="space-y-10">
              {milestones.map((m, i) => (
                <FadeIn key={i} delay={i * 0.1}>
                  <div className={`relative flex items-start gap-6 sm:gap-0 ${i % 2 === 0 ? 'sm:flex-row' : 'sm:flex-row-reverse'}`}>
                    <div className="absolute left-[14px] sm:left-1/2 sm:-translate-x-1/2 w-4 h-4 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600 border-4 border-zinc-900 shadow-lg z-10" />
                    <div className={`ml-12 sm:ml-0 sm:w-[calc(50%-2rem)] ${i % 2 === 0 ? 'sm:pr-4 sm:text-right' : 'sm:pl-4'}`}>
                      <div className="bg-white/5 rounded-md border border-white/10 p-5 shadow-sm hover:shadow-lg hover:shadow-black/20 transition-shadow">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-gradient-to-r from-indigo-500/10 to-violet-500/10 text-indigo-400 mb-2">
                          {m.year}
                        </span>
                        <h3 className="text-lg font-bold text-white">{m.title}</h3>
                        <p className="mt-1 text-sm text-zinc-400">{m.description}</p>
                      </div>
                    </div>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Values ── */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Our Values"
            title="What drives us every day"
            highlight="drives us"
          />
          <StaggerContainer staggerDelay={0.1} className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {values.map((v) => (
              <StaggerItem key={v.title}>
                <div className="bg-white/5 rounded-2xl border border-white/[0.06] p-6 h-full shadow-sm hover:shadow-lg hover:shadow-black/20 transition-shadow">
                  <div className={`w-12 h-12 rounded-md bg-gradient-to-br ${v.gradient} flex items-center justify-center shadow-lg mb-4`}>
                    <v.icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{v.title}</h3>
                  <p className="text-sm text-zinc-400 leading-relaxed">{v.description}</p>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="cta-mesh-dark py-20 sm:py-24">
        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
              Platform by the numbers
            </h2>
          </FadeIn>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-6">
            {[
              { value: 100, label: 'Free First Company', suffix: '%' },
              { value: 4, label: 'Business Types', suffix: '' },
              { value: 100, label: 'Data Isolation', suffix: '%' },
              { value: 15, label: 'Access Roles', suffix: '+' },
              { value: 65, label: 'Secured Tables', suffix: '+' },
            ].map((stat, i) => (
              <FadeIn key={stat.label} delay={i * 0.1}>
                <div className="text-center">
                  <div className="text-4xl sm:text-5xl font-extrabold text-white">
                    <SpringCounter value={stat.value} />{stat.suffix}
                  </div>
                  <p className="mt-2 text-sm text-blue-300 font-medium">{stat.label}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── Platform Highlights ── */}
      <section className="section-bg-white py-20 sm:py-28">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Platform"
            title="Built for reliability"
            highlight="reliability"
          />
          <StaggerContainer staggerDelay={0.08} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {platformHighlights.map((h) => (
              <StaggerItem key={h.label}>
                <div className="text-center p-4">
                  <div className={`w-12 h-12 mx-auto rounded-md bg-gradient-to-br ${h.gradient} flex items-center justify-center shadow-lg mb-3`}>
                    <h.icon className="w-6 h-6 text-white" />
                  </div>
                  <div className="text-lg font-extrabold text-white">{h.value}</div>
                  <div className="text-xs text-zinc-500 font-medium">{h.label}</div>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ── Tech Stack ── */}
      <section className="section-bg-subtle py-20 sm:py-28">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeading
            badge="Technology"
            title="Built with modern tech"
            highlight="modern tech"
          />
          <StaggerContainer staggerDelay={0.06} className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {techStack.map((tech) => (
              <StaggerItem key={tech.name}>
                <div className="bg-white/5 rounded-md border border-white/10 p-4 text-center shadow-sm hover:shadow-lg hover:shadow-black/20 hover:-translate-y-1 transition-all">
                  <tech.icon className={`w-6 h-6 mx-auto mb-2 ${tech.color}`} />
                  <span className="text-sm font-semibold text-white">{tech.name}</span>
                </div>
              </StaggerItem>
            ))}
          </StaggerContainer>
        </div>
      </section>

      {/* ── CTA ── */}
      <CTASection
        title="Start your free account"
        subtitle="Start building your business with RetailSmart ERP today. Free forever plan available."
      />
    </PageWrapper>
  )
}
