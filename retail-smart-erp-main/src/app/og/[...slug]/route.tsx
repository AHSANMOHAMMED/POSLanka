import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

const pageConfig: Record<string, { title: string; subtitle: string; gradient: string }> = {
  home: {
    title: 'RetailSmart ERP',
    subtitle: 'AI-Powered POS & Business Management Platform',
    gradient: 'linear-gradient(135deg, #064e3b, #059669, #f59e0b)',
  },
  retail: {
    title: 'Retail POS',
    subtitle: 'AI-Powered Point of Sale for Modern Retail Stores',
    gradient: 'linear-gradient(135deg, #0c4a6e, #0284c7, #0ea5e9)',
  },
  restaurant: {
    title: 'Restaurant Management',
    subtitle: 'Kitchen Display, Table Management & AI-Powered Orders',
    gradient: 'linear-gradient(135deg, #9a3412, #ea580c, #f97316)',
  },
  supermarket: {
    title: 'Supermarket POS',
    subtitle: 'High-Volume Checkout & Smart Department Management',
    gradient: 'linear-gradient(135deg, #14532d, #16a34a, #22c55e)',
  },
  'auto-service': {
    title: 'Auto Service Management',
    subtitle: 'Work Orders, Vehicle Tracking & Insurance Estimates',
    gradient: 'linear-gradient(135deg, #4c1d95, #7c3aed, #a855f7)',
  },
  features: {
    title: 'All Features',
    subtitle: 'Every Feature Included on Every Plan - No Limits',
    gradient: 'linear-gradient(135deg, #064e3b, #059669, #10b981)',
  },
  pricing: {
    title: 'Simple Pricing',
    subtitle: 'All Features. Unlimited Users. Free to Start.',
    gradient: 'linear-gradient(135deg, #059669, #f59e0b, #f43f5e)',
  },
  about: {
    title: 'About Us',
    subtitle: 'Building the Future of AI-Powered Business Management',
    gradient: 'linear-gradient(135deg, #1c1917, #064e3b, #059669)',
  },
  contact: {
    title: 'Contact Us',
    subtitle: 'Get In Touch - We\'d Love To Hear From You',
    gradient: 'linear-gradient(135deg, #064e3b, #059669, #f59e0b)',
  },
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params
  const pageKey = slug?.[0] || 'home'
  const config = pageConfig[pageKey] || pageConfig.home

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'flex-start',
          padding: '80px',
          background: config.gradient,
          fontFamily: 'Inter, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Decorative circles */}
        <div style={{ position: 'absolute', top: '-100px', right: '-100px', width: '400px', height: '400px', borderRadius: '50%', background: 'rgba(255,255,255,0.08)', display: 'flex' }} />
        <div style={{ position: 'absolute', bottom: '-150px', left: '200px', width: '500px', height: '500px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex' }} />

        {/* Logo area */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '40px' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '14px',
            background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '28px', fontWeight: 800, color: 'white',
          }}>
            R
          </div>
          <span style={{ fontSize: '28px', fontWeight: 700, color: 'white', letterSpacing: '-0.02em' }}>
            RetailSmart ERP
          </span>
        </div>

        {/* Title */}
        <div style={{ fontSize: '64px', fontWeight: 800, color: 'white', lineHeight: 1.1, letterSpacing: '-0.03em', marginBottom: '20px', maxWidth: '900px' }}>
          {config.title}
        </div>

        {/* Subtitle */}
        <div style={{ fontSize: '28px', fontWeight: 400, color: 'rgba(255,255,255,0.85)', lineHeight: 1.4, maxWidth: '800px' }}>
          {config.subtitle}
        </div>

        {/* Bottom badges */}
        <div style={{ display: 'flex', gap: '16px', marginTop: '48px' }}>
          {['AI-Powered', 'Unlimited Users', 'Free to Start'].map((badge) => (
            <div key={badge} style={{
              padding: '10px 20px', borderRadius: '50px',
              background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(10px)',
              color: 'white', fontSize: '16px', fontWeight: 600,
              border: '1px solid rgba(255,255,255,0.2)',
            }}>
              {badge}
            </div>
          ))}
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
