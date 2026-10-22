'use client'

import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { countries } from '@/lib/utils/countries'
import { AuthHeading, Button, Field, Select } from '@/components/admin/kit'
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
      <AuthHeading title="Where is your business?" description="We use this to set your currency, tax and date defaults." />

      <div className="space-y-5">
        <Field label="Country" htmlFor="country">
          <Select id="country" size="lg" value={country} onChange={(e) => onCountryChange(e.target.value)}>
            <option value="">Select your country</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </Select>
        </Field>

        <div className="flex items-start gap-2.5">
          <input
            type="checkbox"
            id="tos-checkbox"
            checked={tosAccepted}
            onChange={(e) => onTosChange(e.target.checked)}
            className="adm-checkbox mt-0.5 shrink-0 cursor-pointer"
          />
          <p className="text-[13.5px] text-adm-muted">
            <label htmlFor="tos-checkbox" className="cursor-pointer select-none">I agree to the</label>{' '}
            <button type="button" onClick={() => setLegalModal('terms')} className="adm-focus font-medium text-adm-primary hover:underline">
              Terms of Service
            </button>{' '}
            and{' '}
            <button type="button" onClick={() => setLegalModal('privacy')} className="adm-focus font-medium text-adm-primary hover:underline">
              Privacy Policy
            </button>
          </p>
        </div>
      </div>

      <Button variant="primary" size="lg" fullWidth className="mt-6" onClick={onNext} disabled={!canContinue} iconRight={ArrowRight}>
        Continue
      </Button>

      <LegalModal isOpen={legalModal !== null} onClose={() => setLegalModal(null)} type={legalModal || 'terms'} />
    </div>
  )
}
