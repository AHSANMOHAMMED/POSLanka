'use client'

import { useEffect } from 'react'
import { CreditCard, Receipt, Target } from 'lucide-react'
import { defaultPaymentMethods } from '@/lib/setup/seed-data'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'
import { useStepSuggestions } from './useStepSuggestions'
import { AISuggestionChip } from './AISuggestionChip'
import { FormInput, FormField, FormSelect } from '@/components/ui/form-elements'

interface StepPOSProps {
  data: SetupWizardData
  companySlug: string
  businessType: string
  country: string
  countryName: string
  currency: string
  aiEnabled?: boolean
  onChange: (updates: Partial<SetupWizardData>) => void
}

interface POSSuggestion {
  receiptFormat?: string
  receiptNote?: string
  paymentMethods?: string[]
  paymentNote?: string
}

const receiptFormats = [
  { value: '58mm', label: '58mm (Thermal)' },
  { value: '80mm', label: '80mm (Thermal)' },
  { value: 'A4', label: 'A4 (Full page)' },
]

export function StepPOS({ data, companySlug, businessType, country, countryName, currency, aiEnabled, onChange }: StepPOSProps) {
  const { suggestions, loading, dismissed, dismiss } = useStepSuggestions<POSSuggestion>({
    step: 'pos',
    context: { businessType, country, countryName, currency },
    companySlug,
    enabled: aiEnabled,
  })

  // Auto-set warehouse/cost center when data is available but values are undefined
  // This fixes the bug where the dropdown shows a pre-selected value but the
  // underlying data stays undefined unless the user interacts with the dropdown
  useEffect(() => {
    const updates: Partial<SetupWizardData> = {}
    if (!data.posWarehouseName && data.warehouses?.length) {
      updates.posWarehouseName = data.warehouses.find(w => w.isDefault)?.name || data.warehouses[0]?.name
    }
    if (!data.posCostCenter && data.costCenters?.length) {
      updates.posCostCenter = data.defaultCostCenter || data.costCenters.filter(Boolean)[0]
    }
    if (Object.keys(updates).length > 0) onChange(updates)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.warehouses, data.costCenters])

  const togglePaymentMethod = (method: string) => {
    const current = data.paymentMethods
    if (current.includes(method)) {
      if (current.length > 1) {
        onChange({ paymentMethods: current.filter(m => m !== method) })
      }
    } else {
      onChange({ paymentMethods: [...current, method] })
    }
  }

  // Helper to get receipt format label
  const getFormatLabel = (value: string) => {
    return receiptFormats.find(f => f.value === value)?.label || value
  }

  // Check if payment methods match suggestions
  const paymentMethodsMatch = suggestions?.paymentMethods
    && data.paymentMethods.length === suggestions.paymentMethods.length
    && data.paymentMethods.every(m => suggestions.paymentMethods!.includes(m))

  return (
    <div className="space-y-5">
      {/* Step Header */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">
          POS & Payments
        </h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
          Configure your point of sale and accepted payment methods.
        </p>
      </div>

      {/* Payment Methods Section */}
      <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white dark:bg-slate-800/40 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-green-50 dark:bg-green-900/30">
            <CreditCard size={16} className="text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Payment Methods</h3>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Select which payment methods to accept</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {defaultPaymentMethods.map((pm) => (
            <label
              key={pm.method}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border cursor-pointer transition-all duration-200 text-sm ${
                data.paymentMethods.includes(pm.method)
                  ? 'border-blue-200 bg-blue-50/80 dark:bg-blue-950/30 dark:border-blue-800/60 text-blue-700 dark:text-blue-300 shadow-sm shadow-blue-500/5'
                  : 'border-gray-200/60 dark:border-gray-700/50 hover:border-gray-300 dark:hover:border-gray-600 text-gray-600 dark:text-gray-400'
              }`}
            >
              <input
                type="checkbox"
                checked={data.paymentMethods.includes(pm.method)}
                onChange={() => togglePaymentMethod(pm.method)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="font-medium">{pm.label}</span>
            </label>
          ))}
        </div>
        {!dismissed.has('paymentMethods') && (
          <AISuggestionChip
            label={suggestions?.paymentMethods ? suggestions.paymentMethods.map(m => defaultPaymentMethods.find(p => p.method === m)?.label || m).join(', ') : ''}
            reason={suggestions?.paymentNote}
            loading={loading}
            onApply={() => {
              if (suggestions?.paymentMethods) {
                onChange({ paymentMethods: suggestions.paymentMethods })
              }
            }}
            onDismiss={() => dismiss('paymentMethods')}
            alreadyApplied={!!paymentMethodsMatch}
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Receipt Format Section */}
        <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white dark:bg-slate-800/40 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-900/30">
              <Receipt size={16} className="text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Receipt Format</h3>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">Printer paper size</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {receiptFormats.map((fmt) => (
              <label
                key={fmt.value}
                className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border cursor-pointer transition-all duration-200 text-sm ${
                  data.receiptFormat === fmt.value
                    ? 'border-blue-200 bg-blue-50/80 dark:bg-blue-950/30 dark:border-blue-800/60 text-blue-700 dark:text-blue-300 shadow-sm shadow-blue-500/5'
                    : 'border-gray-200/60 dark:border-gray-700/50 hover:border-gray-300 dark:hover:border-gray-600 text-gray-600 dark:text-gray-400'
                }`}
              >
                <input
                  type="radio"
                  name="receiptFormat"
                  checked={data.receiptFormat === fmt.value}
                  onChange={() => onChange({ receiptFormat: fmt.value })}
                  className="text-blue-600 focus:ring-blue-500"
                />
                <span className="font-medium">{fmt.label}</span>
              </label>
            ))}
          </div>
          {!dismissed.has('receiptFormat') && (
            <AISuggestionChip
              label={suggestions?.receiptFormat ? getFormatLabel(suggestions.receiptFormat) : ''}
              reason={suggestions?.receiptNote}
              loading={loading}
              onApply={() => {
                if (suggestions?.receiptFormat) {
                  onChange({ receiptFormat: suggestions.receiptFormat })
                }
              }}
              onDismiss={() => dismiss('receiptFormat')}
              alreadyApplied={suggestions?.receiptFormat === data.receiptFormat}
            />
          )}
        </div>

        {/* POS Profile Section */}
        <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white dark:bg-slate-800/40 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-900/30">
              <Target size={16} className="text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">POS Profile</h3>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">Default profile configuration</p>
            </div>
          </div>
          <div className="space-y-3">
            <FormField label="Profile Name">
              <FormInput
                value={data.posProfileName}
                onChange={(e) => onChange({ posProfileName: e.target.value })}
                placeholder="Default POS"
              />
            </FormField>

            {data.warehouses && data.warehouses.length > 0 && (
              <FormField label="Warehouse">
                <FormSelect
                  value={data.posWarehouseName || data.warehouses.find(w => w.isDefault)?.name || data.warehouses[0]?.name || ''}
                  onChange={(e) => onChange({ posWarehouseName: e.target.value })}
                >
                  {data.warehouses.map((wh) => (
                    <option key={wh.name} value={wh.name}>
                      {wh.name}{wh.isDefault ? ' (Default)' : ''}
                    </option>
                  ))}
                </FormSelect>
              </FormField>
            )}

            {data.costCenters && data.costCenters.length > 0 && (
              <FormField label="Cost Center">
                <FormSelect
                  value={data.posCostCenter || data.defaultCostCenter || data.costCenters[0] || ''}
                  onChange={(e) => onChange({ posCostCenter: e.target.value })}
                >
                  {data.costCenters.filter(Boolean).map((cc) => (
                    <option key={cc} value={cc}>
                      {cc}{cc === data.defaultCostCenter ? ' (Default)' : ''}
                    </option>
                  ))}
                </FormSelect>
              </FormField>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
