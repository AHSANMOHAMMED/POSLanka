'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import {
  Check, Lock, ShieldCheck, LogIn, X,
} from 'lucide-react'
import { Logo } from '@/components/ui/logo'
import { MockDashboard } from '@/components/landing/mockups/MockDashboard'
import { MockBrowserFrame } from '@/components/landing/mockups/MockBrowserFrame'
import { detectCountryFromTimezone } from '@/lib/utils/countries'
import { ProgressSteps } from './_components/ProgressSteps'
import { StepCountry } from './_components/StepCountry'
import { StepPersonalInfo } from './_components/StepPersonalInfo'
import { StepEmailVerification } from './_components/StepEmailVerification'
import { StepPassword } from './_components/StepPassword'

const stepLabels = ['Country', 'Details', 'Verify', 'Password']

export default function RegisterClient() {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [loggedInUser, setLoggedInUser] = useState<{ fullName?: string; email?: string } | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phone: '',
    country: '',
    tosAccepted: false,
    verificationToken: '',
  })

  useEffect(() => {
    fetch('/api/auth/session')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.user) setLoggedInUser(data.user) })
      .catch(() => {})

    const detected = detectCountryFromTimezone()
    if (detected) {
      setFormData(prev => ({ ...prev, country: prev.country || detected }))
    }
  }, [])

  const handleFieldChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (password: string) => {
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: formData.fullName,
          email: formData.email,
          phone: formData.phone,
          password,
          country: formData.country,
          verificationToken: formData.verificationToken,
          tosAcceptedAt: formData.tosAccepted ? new Date().toISOString() : null,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Registration failed')
      }

      router.push('/login?registered=true')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left side — Image + gradient hero panel */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden">
        {/* Background image */}
        <Image
          src="https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200"
          alt=""
          fill
          className="object-cover"
          priority
          quality={85}
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/90 via-emerald-800/80 to-stone-900/70" />

        {/* Floating decorative shapes */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
          <div className="absolute top-[12%] right-[12%] w-20 h-20 rounded-2xl bg-white/10 backdrop-blur-sm rotate-12 sparkle-1" />
          <div className="absolute bottom-[25%] left-[8%] w-16 h-16 rounded-full bg-white/10 backdrop-blur-sm sparkle-2" />
          <div className="absolute top-[50%] right-[5%] w-12 h-12 rounded-md bg-white/10 backdrop-blur-sm -rotate-12 sparkle-3" />
          <div className="absolute top-[75%] left-[20%] w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm rotate-45 sparkle-1" />
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <div>
            <Logo variant="full" size={44} subtitle="Point of Sale System" />
          </div>

          <div>
            <h2 className="text-4xl xl:text-5xl font-extrabold leading-tight text-white mb-4 tracking-tight">
              Start your business<br />
              journey <span className="bg-gradient-to-r from-amber-300 to-emerald-300 bg-clip-text text-transparent">today.</span>
            </h2>
            <p className="text-lg text-emerald-200 mb-10 max-w-md">
              Create your free account and add your first business in minutes.
            </p>

            {/* App mockup preview */}
            <div className="my-6 rounded-md overflow-hidden shadow-2xl shadow-black/30 border border-white/20">
              <MockBrowserFrame url="app.retailsmarterp.com/dashboard">
                <div className="max-h-[220px] overflow-hidden">
                  <MockDashboard />
                </div>
              </MockBrowserFrame>
            </div>

            {/* Benefits list */}
            <div className="space-y-3">
              {[
                'All features included on every plan',
                'Unlimited users — no per-user fees',
                'AI-powered analytics & predictions',
                'Enterprise-grade security',
              ].map((benefit) => (
                <div key={benefit} className="flex items-center gap-3">
                  <div className="w-7 h-7 bg-white/15 backdrop-blur-sm rounded flex items-center justify-center border border-white/20 flex-shrink-0">
                    <Check size={14} className="text-emerald-300" />
                  </div>
                  <span className="text-sm text-emerald-100">{benefit}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <ShieldCheck size={20} className="text-emerald-300 flex-shrink-0" />
            <div>
              <p className="text-sm text-emerald-200">Trusted by businesses everywhere</p>
              <p className="text-base font-bold text-white">Your First Company is Free Forever</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right side — Form panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 relative overflow-hidden bg-[#09090b]">
        {/* Subtle orbs */}
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl" />

        <div className="w-full max-w-md relative z-10">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center mb-8">
            <Logo variant="full" size={44} subtitle="Point of Sale System" />
          </div>

          {/* Logged-in banner */}
          {loggedInUser && !bannerDismissed && (
            <div className="mb-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-md relative">
              <button
                onClick={() => setBannerDismissed(true)}
                className="absolute top-2 right-2 p-1 text-emerald-500 hover:text-emerald-300 transition-colors"
              >
                <X size={16} />
              </button>
              <p className="text-emerald-300 text-sm font-medium mb-2">
                You&apos;re signed in as <strong>{loggedInUser.fullName || loggedInUser.email}</strong>
              </p>
              <Link
                href="/account"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white text-sm font-medium rounded hover:from-emerald-700 hover:to-emerald-600 transition-all shadow-sm"
              >
                <LogIn size={16} />
                Go to My Account
              </Link>
              <p className="text-emerald-400 text-xs mt-2">
                Or continue below to create a new account
              </p>
            </div>
          )}

          {/* Form card */}
          <div className="glass-card-v2 rounded-2xl p-8">
            <ProgressSteps steps={stepLabels} currentStep={currentStep} />

            {currentStep === 0 && (
              <StepCountry
                country={formData.country}
                tosAccepted={formData.tosAccepted}
                onCountryChange={(country) => handleFieldChange('country', country)}
                onTosChange={(accepted) => setFormData(prev => ({ ...prev, tosAccepted: accepted }))}
                onNext={() => setCurrentStep(1)}
              />
            )}

            {currentStep === 1 && (
              <StepPersonalInfo
                fullName={formData.fullName}
                email={formData.email}
                phone={formData.phone}
                onChange={handleFieldChange}
                onNext={() => setCurrentStep(2)}
                onBack={() => setCurrentStep(0)}
              />
            )}

            {currentStep === 2 && (
              <StepEmailVerification
                email={formData.email}
                onVerified={(token) => {
                  setFormData(prev => ({ ...prev, verificationToken: token }))
                  setCurrentStep(3)
                }}
                onBack={() => setCurrentStep(1)}
              />
            )}

            {currentStep === 3 && (
              <StepPassword
                onSubmit={handleSubmit}
                loading={loading}
                error={error}
                onBack={() => setCurrentStep(2)}
              />
            )}

            <div className="mt-5 text-center">
              <p className="text-zinc-400">
                Already have an account?{' '}
                <Link href="/login" className="text-emerald-400 hover:underline font-semibold">
                  Sign in
                </Link>
              </p>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 text-zinc-500">
            <Lock size={14} />
            <span className="text-xs">Secure &amp; encrypted &middot; Enterprise security</span>
          </div>
        </div>
      </div>
    </div>
  )
}
