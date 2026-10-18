'use client'

import { RetailConfig } from './RetailConfig'
import { RestaurantConfig } from './RestaurantConfig'
import { SupermarketConfig } from './SupermarketConfig'
import { AutoServiceConfig } from './AutoServiceConfig'
import { DealershipConfig } from './DealershipConfig'
import { useStepSuggestions } from './useStepSuggestions'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'

interface StepBusinessConfigProps {
  data: SetupWizardData
  businessType: string
  companySlug: string
  country: string
  countryName: string
  currency: string
  aiEnabled?: boolean
  onChange: (updates: Partial<SetupWizardData>) => void
}

interface BusinessConfigSuggestion {
  suggestedCategories?: string[]
  numberOfTables?: number
  tableNote?: string
  defaultLaborRate?: number
  laborRateNote?: string
}

import { getBusinessTypeLabel } from '@/lib/constants/business-types'

export function StepBusinessConfig({
  data,
  businessType,
  companySlug,
  country,
  countryName,
  currency,
  aiEnabled,
  onChange,
}: StepBusinessConfigProps) {
  const { suggestions, loading, dismissed, dismiss } = useStepSuggestions<BusinessConfigSuggestion>({
    step: 'business_config',
    context: { businessType, country, countryName, currency },
    companySlug,
    enabled: aiEnabled,
  })

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">
          {getBusinessTypeLabel(businessType) || 'Business'} Setup
        </h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
          Configure defaults for your {getBusinessTypeLabel(businessType)?.toLowerCase() || 'business'}.
        </p>
      </div>

      {businessType === 'retail' && (
        <RetailConfig
          data={data}
          onChange={onChange}
          suggestions={suggestions}
          suggestionsLoading={loading}
          dismissed={dismissed}
          onDismiss={dismiss}
        />
      )}
      {businessType === 'restaurant' && (
        <RestaurantConfig
          data={data}
          onChange={onChange}
          currency={currency}
          suggestions={suggestions}
          suggestionsLoading={loading}
          dismissed={dismissed}
          onDismiss={dismiss}
        />
      )}
      {businessType === 'supermarket' && (
        <SupermarketConfig
          data={data}
          onChange={onChange}
          suggestions={suggestions}
          suggestionsLoading={loading}
          dismissed={dismissed}
          onDismiss={dismiss}
        />
      )}
      {businessType === 'auto_service' && (
        <AutoServiceConfig
          data={data}
          onChange={onChange}
          currency={currency}
          suggestions={suggestions}
          suggestionsLoading={loading}
          dismissed={dismissed}
          onDismiss={dismiss}
        />
      )}
      {businessType === 'dealership' && (
        <DealershipConfig
          data={data}
          onChange={onChange}
          currency={currency}
          suggestions={suggestions}
          suggestionsLoading={loading}
          dismissed={dismissed}
          onDismiss={dismiss}
        />
      )}
    </div>
  )
}
