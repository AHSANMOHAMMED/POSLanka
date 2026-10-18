'use client'

import { useState } from 'react'
import { Globe } from 'lucide-react'
import { countries } from '@/lib/utils/countries'
import { LegalModal } from './LegalModal'

interface StepCountryProps {
  country: string
  tosAccepted: boolean
  onCountryChange: (country: string) => void
  onTosChange: (accepted: boolean) => void
  onNext: () => void
}

export function StepCountry({ country, tosAccepted, onCountryChange, onTosChange, onNext }: StepCountryProps) {
  const canContinue = country && tosAccepted
  const [legalModal, setLegalModal] = useState<'terms' | 'privacy' | null>(null)

  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-2xl font-extrabold text-white">Select Your Country</h2>
        <p className="text-zinc-500 mt-1">This helps us set the right defaults</p>
      </div>

      <div className="space-y-5">
        <div>
          <label htmlFor="country" className="block text-sm font-medium text-zinc-300 mb-1.5">
            Country
          </label>
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" size={18} />
            <select
              id="country"
              value={country}
              onChange={(e) => onCountryChange(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-md text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500 transition-all appearance-none"
            >
              <option value="">Select your country</option>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            id="tos-checkbox"
            checked={tosAccepted}
            onChange={(e) => onTosChange(e.target.checked)}
            className="mt-1 rounded border-white/20 text-emerald-500 focus:ring-emerald-500 bg-white/5 cursor-pointer"
          />
          <label htmlFor="tos-checkbox" className="text-sm text-zinc-400 cursor-pointer select-none">
            I agree to the{' '}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.preventDefault(); setLegalModal('terms') }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setLegalModal('terms') } }}
              className="text-emerald-400 hover:underline font-medium cursor-pointer"
            >
              Terms of Service
            </span>
            {' '}and{' '}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.preventDefault(); setLegalModal('privacy') }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setLegalModal('privacy') } }}
              className="text-emerald-400 hover:underline font-medium cursor-pointer"
            >
              Privacy Policy
            </span>
          </label>
        </div>
      </div>

      <button
        onClick={onNext}
        disabled={!canContinue}
        className="w-full py-3 px-4 mt-6 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-semibold rounded-md transition-all shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Continue
      </button>

      <LegalModal
        isOpen={legalModal !== null}
        onClose={() => setLegalModal(null)}
        type={legalModal || 'terms'}
      />
    </div>
  )
}
