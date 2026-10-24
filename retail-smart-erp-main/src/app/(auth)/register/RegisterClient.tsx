'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Check, X } from 'lucide-react'
import { Alert, AuthBrandPanel, AuthShell } from '@/components/admin/kit'
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
    <AuthShell
      width="md"
      aside={
        <AuthBrandPanel>
          <div className="max-w-md">
            <h2 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-white xl:text-[34px]">
              Set up your business on skyERPOS.
            </h2>
            <ul className="mt-7 space-y-3">
              {[
                'Create your owner account, then add your first company',
                'Invite cashiers and managers with their own sign-in',
                'Your first company is free — upgrade only when you need more',
              ].map((p) => (
                <li key={p} className="flex items-start gap-3 text-[14.5px] text-white/85">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/15">
                    <Check size={13} aria-hidden />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </AuthBrandPanel>
      }
      footer={
        <>
          Already have an account?{' '}
          <Link href="/login?tab=account" className="font-medium text-adm-primary hover:underline">Sign in</Link>
        </>
      }
    >
      {loggedInUser && !bannerDismissed && (
        <Alert
          tone="info"
          className="mb-6"
          title={<>You’re signed in as {loggedInUser.fullName || loggedInUser.email}</>}
          action={
            <button type="button" onClick={() => setBannerDismissed(true)} aria-label="Dismiss" className="adm-focus -m-1 rounded p-1 opacity-70 hover:opacity-100">
              <X size={16} aria-hidden />
            </button>
          }
        >
          <Link href="/account" className="font-medium underline underline-offset-2">Go to my account</Link> or continue below to create a new one.
        </Alert>
      )}

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
    </AuthShell>
  )
}
