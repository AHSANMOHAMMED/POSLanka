'use client'

import { useState } from 'react'
import { User, Mail, Phone, Loader2, ArrowLeft } from 'lucide-react'

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

  const handleNext = async () => {
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
        setEmailError('This email is already registered')
        setChecking(false)
        return
      }

      onNext()
    } catch {
      setEmailError('Failed to verify email. Please try again.')
    } finally {
      setChecking(false)
    }
  }

  const inputClass = 'w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-md text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all'

  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-2xl font-extrabold text-white">Create Your Account</h2>
        <p className="text-zinc-500 mt-1">Enter your personal details</p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="fullName" className="block text-sm font-medium text-zinc-300 mb-1.5">
            Full Name
          </label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
            <input
              id="fullName"
              value={fullName}
              onChange={(e) => onChange('fullName', e.target.value)}
              placeholder="John Doe"
              required
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-zinc-300 mb-1.5">
            Email Address
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => { onChange('email', e.target.value); setEmailError('') }}
              placeholder="you@example.com"
              required
              className={inputClass}
            />
          </div>
          {emailError && (
            <p className="text-xs text-red-400 mt-1.5">{emailError}</p>
          )}
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-zinc-300 mb-1.5">
            Mobile Number
          </label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => onChange('phone', e.target.value)}
              placeholder="+94 77 123 4567"
              required
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={onBack}
          className="px-4 py-3 border border-white/10 text-zinc-300 rounded-md hover:bg-white/5 transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <button
          onClick={handleNext}
          disabled={!canContinue || checking}
          className="flex-1 py-3 px-4 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-semibold rounded-md transition-all shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {checking ? (
            <>
              <Loader2 size={20} className="animate-spin" />
              Checking...
            </>
          ) : (
            'Continue'
          )}
        </button>
      </div>
    </div>
  )
}
