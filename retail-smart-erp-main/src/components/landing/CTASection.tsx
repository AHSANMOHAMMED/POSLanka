'use client'

import Link from 'next/link'
import { ArrowRight, Shield, Clock, CreditCard } from 'lucide-react'
import { FadeIn } from './motion'

interface CTASectionProps {
  title?: string
  subtitle?: string
  ctaText?: string
  ctaHref?: string
  secondaryText?: string
  secondaryHref?: string
}

export default function CTASection({
  title = 'Ready to upgrade your shop with skyERPOS?',
  subtitle = 'Built for Sri Lankan retail, supermarkets, restaurants, garages & dealerships. Fast LKR billing, Sinhala & English receipts, and offline-ready mobile POS.',
  ctaText = 'Book Free Demo',
  ctaHref = '/contact',
  secondaryText = 'WhatsApp +94 74 122 8682',
  secondaryHref = 'https://wa.me/94741228682?text=Hi%20skyERPOS%2C%20I%20would%20like%20a%20free%20demo',
}: CTASectionProps) {
  return (
    <section className="cta-mesh-dark py-24 sm:py-32 relative overflow-hidden">
      {/* Floating shapes */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="landing-shape-1" style={{ opacity: 0.08 }} />
        <div className="landing-shape-2" style={{ opacity: 0.06 }} />
        <div className="landing-shape-3" style={{ opacity: 0.05 }} />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <FadeIn>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white leading-tight tracking-tight">
            {title}
          </h2>
          <p className="mt-5 text-lg text-gray-300 leading-relaxed max-w-2xl mx-auto">
            {subtitle}
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href={ctaHref}
              className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white bg-gradient-to-r from-[#0050c0] to-[#2563eb] hover:from-[#00419e] hover:to-[#1d4ed8] rounded-md transition-all shadow-lg shadow-[rgba(0,80,192,0.35)] hover:shadow-[rgba(0,80,192,0.5)] hover:-translate-y-0.5"
            >
              {ctaText}
              <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href={secondaryHref}
              target={secondaryHref.startsWith('http') ? '_blank' : undefined}
              rel={secondaryHref.startsWith('http') ? 'noopener noreferrer' : undefined}
              className="inline-flex items-center gap-2 px-8 py-4 text-base font-semibold text-white/90 border border-white/20 hover:border-white/40 hover:bg-white/5 rounded-md transition-all hover:-translate-y-0.5"
            >
              {secondaryText}
            </a>
          </div>
          {/* Trust badges */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-sm text-gray-400">
            <div className="flex items-center gap-1.5">
              <CreditCard className="w-4 h-4" />
              Affordable LKR Plans · 25% Annual Discount
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              Same-Day Onboarding
            </div>
            <div className="flex items-center gap-1.5">
              <Shield className="w-4 h-4" />
              Islandwide Support · Kalpitiya, Puttalam
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  )
}
