'use client'

import { useState } from 'react'
import { ArrowLeft, Mail, Phone, User } from 'lucide-react'
import { AuthHeading, Button, Field, Input } from '@/components/admin/kit'

interface StepPersonalInfoProps {
  fullName: string
  email: string
  phone: string
  onChange: (field: string, value: string) => void
  onNext: () => void
  onBack: () => void
}

export function StepPersonalInfo({ fullName, email, phone, onChange, onNext, onBack }: StepPersonalInfoProps) {
  const [checking, setChecking] = useState(false)
  const [emailError, setEmailError] = useState('')

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const canContinue = fullName.trim() && email.trim() && emailRegex.test(email) && phone.trim()

  const handleNext = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canContinue) return
    setChecking(true)
    setEmailError('')
    try {
      const res = await fetch('/api/register/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!data.available) {
        setEmailError('This email already has an account. Sign in instead.')
        return
      }
      onNext()
    } catch {
      setEmailError('We couldn’t check this email. Please try again.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <form onSubmit={handleNext}>
      <AuthHeading title="Your details" description="You’ll use this email to sign in as the business owner." />

      <div className="space-y-4">
        <Field label="Full name" htmlFor="fullName">
          <Input id="fullName" leftIcon={User} size="lg" value={fullName} onChange={(e) => onChange('fullName', e.target.value)} placeholder="Nimal Perera" autoComplete="name" required />
        </Field>
        <Field label="Email" htmlFor="email" error={emailError}>
          <Input
            id="email"
            type="email"
            leftIcon={Mail}
            size="lg"
            value={email}
            onChange={(e) => { onChange('email', e.target.value); setEmailError('') }}
            placeholder="you@business.lk"
            autoComplete="email"
            invalid={!!emailError}
            required
          />
        </Field>
        <Field label="Mobile number" htmlFor="phone">
          <Input id="phone" type="tel" leftIcon={Phone} size="lg" value={phone} onChange={(e) => onChange('phone', e.target.value)} placeholder="+94 77 123 4567" autoComplete="tel" required />
        </Field>
      </div>

      <div className="mt-6 flex gap-3">
        <Button size="lg" icon={ArrowLeft} onClick={onBack} aria-label="Back" className="px-3.5" />
        <Button type="submit" variant="primary" size="lg" className="flex-1" disabled={!canContinue} loading={checking}>
          {checking ? 'Checking…' : 'Continue'}
        </Button>
      </div>
    </form>
  )
}
