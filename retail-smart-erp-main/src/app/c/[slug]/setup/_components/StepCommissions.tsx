'use client'

import { useState } from 'react'
import { Percent, TrendingUp, Calculator, Target } from 'lucide-react'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'

interface StepCommissionsProps {
  data: SetupWizardData
  companySlug: string
  businessType: string
  country: string
  countryName: string
  currency: string
  companyName: string
  onChange: (updates: Partial<SetupWizardData>) => void
  onNext: () => void
  onBack: () => void
}

export function StepCommissions({
  data,
  companySlug: _companySlug,
  businessType,
  country: _country,
  countryName: _countryName,
  currency,
  companyName: _companyName,
  onChange,
  onNext,
  onBack,
}: StepCommissionsProps) {
  const [enabled, setEnabled] = useState(data.commissionEnabled || false)
  const [structure, setStructure] = useState(data.commissionStructure || 'percentage')
  const [rate, setRate] = useState(data.defaultCommissionRate || 10)
  const [calculation, setCalculation] = useState(data.commissionCalculation || 'revenue')

  const handleEnabledChange = (checked: boolean) => {
    setEnabled(checked)
    // When enabling commissions, reset fields to defaults if they're undefined
    if (checked) {
      if (!structure) setStructure('percentage')
      if (!rate) setRate(10)
      if (!calculation) setCalculation('revenue')
    }
  }

  const handleNext = () => {
    if (enabled) {
      onChange({
        commissionEnabled: true,
        commissionStructure: structure,
        defaultCommissionRate: rate,
        commissionCalculation: calculation,
      })
    } else {
      // Clear all commission fields when disabled
      onChange({ 
        commissionEnabled: false,
        commissionStructure: undefined,
        defaultCommissionRate: undefined,
        commissionCalculation: undefined,
      })
    }
    onNext()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Sales Commissions</h2>
        <p className="text-gray-600 dark:text-gray-400 mt-2">
          Configure commission structures for your sales team.
        </p>
      </div>

      <div className="space-y-4">
        <div className="bg-gray-50 dark:bg-slate-700/50 p-4 rounded border">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => handleEnabledChange(e.target.checked)}
              className="h-4 w-4 text-blue-600"
            />
            <div>
              <div className="font-medium">Enable sales commissions</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Allow commission tracking and payments for sales staff
              </div>
            </div>
          </label>
        </div>

        {enabled && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="bg-gray-50 dark:bg-slate-700/50 p-4 rounded border">
                  <div className="flex items-center gap-3 mb-3">
                    <Percent className="h-5 w-5 text-blue-600" />
                    <h3 className="font-semibold text-gray-900 dark:text-white">Commission Structure</h3>
                  </div>
                  <div className="space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="structure"
                        value="percentage"
                        checked={structure === 'percentage'}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        onChange={(e) => setStructure(e.target.value as any)}
                        className="h-4 w-4 text-blue-600"
                      />
                      <div>
                        <div className="font-medium">Percentage Based</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          Commission as % of sale value
                        </div>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="structure"
                        value="fixed"
                        checked={structure === 'fixed'}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        onChange={(e) => setStructure(e.target.value as any)}
                        className="h-4 w-4 text-blue-600"
                      />
                      <div>
                        <div className="font-medium">Fixed Amount</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          Fixed commission per sale/unit
                        </div>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="radio"
                        name="structure"
                        value="tiered"
                        checked={structure === 'tiered'}
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        onChange={(e) => setStructure(e.target.value as any)}
                        className="h-4 w-4 text-blue-600"
                      />
                      <div>
                        <div className="font-medium">Tiered Structure</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          Higher rates for higher sales volumes
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-slate-700/50 p-4 rounded border">
                  <div className="flex items-center gap-3 mb-3">
                    <Calculator className="h-5 w-5 text-green-600" />
                    <h3 className="font-semibold text-gray-900 dark:text-white">Commission Calculation</h3>
                  </div>
                  <select
                    value={calculation}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onChange={(e) => setCalculation(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700"
                  >
                    <option value="revenue">Based on Revenue (Gross Sales)</option>
                    <option value="profit">Based on Profit (Margin)</option>
                    <option value="quantity">Based on Quantity Sold</option>
                  </select>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-gray-50 dark:bg-slate-700/50 p-4 rounded border">
                  <div className="flex items-center gap-3 mb-3">
                    <TrendingUp className="h-5 w-5 text-green-600" />
                    <h3 className="font-semibold text-gray-900 dark:text-white">Default Commission Rate</h3>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        {structure === 'percentage' ? 'Percentage (%)' : 'Fixed Amount'}
                      </label>
                      <input
                        type="number"
                        min="0"
                        max={structure === 'percentage' ? '100' : undefined}
                        step="0.1"
                        value={rate}
                        onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700"
                        placeholder={structure === 'percentage' ? 'e.g., 10' : `e.g., 50 ${currency}`}
                      />
                    </div>
                    {structure === 'percentage' && (
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        Example: {rate}% of {calculation === 'revenue' ? 'revenue' : calculation === 'profit' ? 'profit' : 'quantity sold'}
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-slate-700/50 p-4 rounded border">
                  <div className="flex items-center gap-3 mb-3">
                    <Target className="h-5 w-5 text-red-600" />
                    <h3 className="font-semibold text-gray-900 dark:text-white">Commission Notes</h3>
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                    <p>• Commissions will be calculated automatically based on sales</p>
                    <p>• You can set different rates for different products or employees</p>
                    <p>• Commission reports will be available in the dashboard</p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {!enabled && (
          <div className="bg-gray-50 dark:bg-slate-700/50 p-6 rounded border text-center">
            <Percent className="h-12 w-12 text-gray-400 mx-auto mb-3" />
            <h3 className="font-medium text-gray-900 dark:text-white mb-2">Commissions Disabled</h3>
            <p className="text-gray-500 dark:text-gray-400">
              You can enable commissions later from the settings page if needed.
            </p>
          </div>
        )}
      </div>

      <div className="flex justify-between pt-6 border-t">
        <button
          type="button"
          onClick={onBack}
          className="px-6 py-2.5 border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleNext}
          className="px-6 py-2.5 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {['retail', 'restaurant', 'supermarket', 'dealership'].includes(businessType)
            ? 'Next: Loyalty Program'
            : 'Next: Notifications'}
        </button>
      </div>
    </div>
  )
}
