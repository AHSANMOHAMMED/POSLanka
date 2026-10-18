'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  Mail, Phone, MessageCircle, MapPin, Building2, Clock,
  Send, Sparkles, Shield, Users,
} from 'lucide-react'
import {
  PageWrapper,
  FadeIn,
  BlurFadeIn,
  StaggerContainer,
  StaggerItem,
  HeroBadge,
} from '@/components/landing/motion'
import ContactForm from '@/components/landing/ContactForm'
import CTASection from '@/components/landing/CTASection'

const defaultContactInfo = {
  email: 'hello@retailsmarterp.com',
  phone: '+94 77 840 7616',
  whatsapp: '+94 77 840 7616',
  address: 'No 31, Akuressa Road, Nupe, Matara, Sri Lanka',
  companyName: 'Retail Smart ERP',
  businessHours: 'Mon-Fri 9:00 AM - 6:00 PM (IST)',
}

const trustItems = [
  { icon: Sparkles, label: 'AI-Powered Platform', gradient: 'from-violet-500 to-purple-500' },
  { icon: Shield, label: 'Advanced Security', gradient: 'from-emerald-500 to-teal-500' },
  { icon: Users, label: 'Unlimited Users', gradient: 'from-blue-500 to-sky-500' },
  { icon: Send, label: 'Free Forever', gradient: 'from-amber-500 to-orange-500' },
]

export default function ContactClient() {
  const [contactData, setContactData] = useState(defaultContactInfo)

  useEffect(() => {
    fetch('/api/public/settings')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.contactInfo) {
          setContactData(prev => ({
            email: data.contactInfo.email || prev.email,
            phone: data.contactInfo.phone || prev.phone,
            whatsapp: data.contactInfo.whatsapp || prev.whatsapp,
            address: data.contactInfo.address || prev.address,
            companyName: data.contactInfo.companyName || prev.companyName,
            businessHours: data.contactInfo.businessHours || prev.businessHours,
          }))
        }
      })
      .catch(() => {})
  }, [])

  const contactInfoCards = useMemo(() => {
    const whatsappDigits = contactData.whatsapp.replace(/[^0-9]/g, '')
    const phoneDigits = contactData.phone.replace(/[^0-9]/g, '')
    return [
      { icon: Mail, label: 'Email', value: contactData.email, href: `mailto:${contactData.email}`, gradient: 'from-blue-500 to-sky-500' },
      { icon: Phone, label: 'Phone', value: contactData.phone, href: `tel:+${phoneDigits}`, gradient: 'from-emerald-500 to-teal-500' },
      { icon: MessageCircle, label: 'WhatsApp', value: contactData.whatsapp, href: `https://wa.me/${whatsappDigits}`, gradient: 'from-green-500 to-emerald-500' },
      { icon: MapPin, label: 'Address', value: contactData.address, href: null, gradient: 'from-amber-500 to-orange-500' },
      { icon: Building2, label: 'Company', value: contactData.companyName, href: null, gradient: 'from-violet-500 to-purple-500' },
      { icon: Clock, label: 'Business Hours', value: contactData.businessHours, href: null, gradient: 'from-pink-500 to-rose-500' },
    ]
  }, [contactData])

  return (
    <PageWrapper>
      {/* ── Hero ── */}
      <section className="relative overflow-hidden pt-32 pb-20" style={{ background: 'linear-gradient(135deg, #09090b 0%, rgba(99,102,241,0.03) 50%, rgba(139,92,246,0.03) 100%)' }}>
        <div className="mesh-gradient-hero" />
        <div className="noise-overlay" />
        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <BlurFadeIn>
            <HeroBadge text="Get In Touch" icon={<Mail className="w-4 h-4 text-violet-600" />} className="mb-5" />
          </BlurFadeIn>
          <BlurFadeIn delay={0.1}>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white leading-tight tracking-tight">
              Get in <span className="gradient-text-animate">Touch</span>
            </h1>
          </BlurFadeIn>
          <BlurFadeIn delay={0.2}>
            <p className="mt-6 text-lg sm:text-xl text-zinc-400 leading-relaxed max-w-2xl mx-auto">
              Have questions about RetailSmart ERP? We&apos;d love to hear from you. Our team is ready to help you get started — your first company is <span className="text-emerald-400 font-semibold">free forever</span>.
            </p>
          </BlurFadeIn>
        </div>
      </section>

      {/* ── Contact Section ── */}
      <section className="section-bg-white pb-20 sm:pb-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-4 relative z-10">
          <div className="grid lg:grid-cols-5 gap-8">
            {/* Left: Form */}
            <FadeIn className="lg:col-span-3">
              <div className="glass-card-v2 rounded-2xl p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 rounded-md bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center">
                    <Send className="w-5 h-5 text-white" />
                  </div>
                  <h2 className="text-xl font-bold text-white">Send us a message</h2>
                </div>
                <ContactForm />
              </div>
            </FadeIn>

            {/* Right: Info Cards */}
            <div className="lg:col-span-2">
              <StaggerContainer staggerDelay={0.08} className="space-y-4">
                {contactInfoCards.map((info) => (
                  <StaggerItem key={info.label}>
                    {info.href ? (
                      <a
                        href={info.href}
                        target={info.href.startsWith('http') ? '_blank' : undefined}
                        rel={info.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                        className="block bg-white/5 rounded-md border border-white/10 p-4 hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5 transition-all group"
                      >
                        <div className="flex items-start gap-4">
                          <div className={`w-10 h-10 rounded-md bg-gradient-to-br ${info.gradient} flex items-center justify-center flex-shrink-0 shadow-lg`}>
                            <info.icon className="w-5 h-5 text-white" />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{info.label}</p>
                            <p className="mt-1 text-sm font-medium text-white group-hover:text-emerald-400 transition-colors">
                              {info.value}
                            </p>
                          </div>
                        </div>
                      </a>
                    ) : (
                      <div className="bg-white/5 rounded-md border border-white/10 p-4">
                        <div className="flex items-start gap-4">
                          <div className={`w-10 h-10 rounded-md bg-gradient-to-br ${info.gradient} flex items-center justify-center flex-shrink-0 shadow-lg`}>
                            <info.icon className="w-5 h-5 text-white" />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{info.label}</p>
                            <p className="mt-1 text-sm font-medium text-white">{info.value}</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </StaggerItem>
                ))}
              </StaggerContainer>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust Bar ── */}
      <section className="section-bg-subtle py-14">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              {trustItems.map((item) => (
                <div key={item.label} className="flex flex-col items-center gap-2 text-center">
                  <div className={`w-10 h-10 rounded-md bg-gradient-to-br ${item.gradient} flex items-center justify-center shadow-lg`}>
                    <item.icon className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-xs font-semibold text-zinc-300">{item.label}</span>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── CTA ── */}
      <CTASection
        title="Ready to transform your business?"
        subtitle="Your first company is free forever. All features included. Unlimited users. No credit card needed."
      />
    </PageWrapper>
  )
}
