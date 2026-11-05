'use client'

import { RetailConfig } from './RetailConfig'
import { RestaurantConfig } from './RestaurantConfig'
import { SupermarketConfig } from './SupermarketConfig'
import { AutoServiceConfig } from './AutoServiceConfig'
import { DealershipConfig } from './DealershipConfig'
import { useStepSuggestions } from './useStepSuggestions'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'
import { getCategoriesForBusinessType } from '@/lib/setup/seed-data'
import { hasBusinessType, isMall, scopeTypes } from '@/lib/business-types/scope'

interface StepBusinessConfigProps {
  data: SetupWizardData
  businessType: string
  /** Mall only: the business types it runs */
  businessSegments?: string[] | null
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
  businessSegments,
  companySlug,
  country,
  countryName,
  currency,
  aiEnabled,
  onChange,
}: StepBusinessConfigProps) {
  const scope = { businessType, businessSegments }
  const mall = isMall(scope)
  // A mall picks its categories once from every department's list; tables / labour rates
  // still come from the restaurant / service sections below
  const runs = (t: string | readonly string[]) => hasBusinessType(scope, t)
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
        {mall && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Includes: {scopeTypes(scope).map((t) => getBusinessTypeLabel(t)).join(', ')}
          </p>
        )}
      </div>

      {mall && (
        <RetailConfig
          data={data}
          onChange={onChange}
          suggestions={suggestions}
          suggestionsLoading={loading}
          dismissed={dismissed}
          onDismiss={dismiss}
          categorySeeds={getCategoriesForBusinessType(scope)}
        />
      )}
      {!mall && ['electronics', 'hardware', 'print_studio', 'office', 'textile'].includes(businessType) && (
        <RetailConfig
          data={data}
          onChange={onChange}
          suggestions={suggestions}
          suggestionsLoading={loading}
          dismissed={dismissed}
          onDismiss={dismiss}
          categorySeeds={getCategoriesForBusinessType(businessType)}
        />
      )}
      {!mall && businessType === 'retail' && (
        <RetailConfig
          data={data}
          onChange={onChange}
          suggestions={suggestions}
          suggestionsLoading={loading}
          dismissed={dismissed}
          onDismiss={dismiss}
        />
      )}
      {runs('restaurant') && (
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
      {!mall && (businessType === 'supermarket' || businessType === 'pharmacy') && (
        <SupermarketConfig
          data={data}
          onChange={onChange}
          suggestions={suggestions}
          suggestionsLoading={loading}
          dismissed={dismissed}
          onDismiss={dismiss}
        />
      )}
      {runs('auto_service') && (
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
      {runs('dealership') && (
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
