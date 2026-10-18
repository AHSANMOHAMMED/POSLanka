'use client'

import { useState } from 'react'
import { Gift, Star, ChevronDown, ChevronUp } from 'lucide-react'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'

interface StepLoyaltyProps {
  data: SetupWizardData
  companyName: string
  currency: string
  onChange: (updates: Partial<SetupWizardData>) => void
  onNext: () => void
  onBack: () => void
}

const DEFAULT_TIERS = [
  { name: 'Bronze', minPoints: 0, earnRate: 1.0, redeemRate: 1.0 },
  { name: 'Silver', minPoints: 500, earnRate: 1.25, redeemRate: 1.1 },
  { name: 'Gold', minPoints: 2000, earnRate: 1.5, redeemRate: 1.25 },
  { name: 'Platinum', minPoints: 5000, earnRate: 2.0, redeemRate: 1.5 },
]

const TIER_COLORS: Record<string, string> = {
  Bronze: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/30 dark:border-amber-800',
  Silver: 'text-gray-600 bg-gray-50 border-gray-200 dark:text-gray-300 dark:bg-gray-800/50 dark:border-gray-600',
  Gold: 'text-yellow-700 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-950/30 dark:border-yellow-800',
  Platinum: 'text-purple-700 bg-purple-50 border-purple-200 dark:text-purple-400 dark:bg-purple-950/30 dark:border-purple-800',
}

export function StepLoyalty({ data, companyName, currency, onChange, onNext, onBack }: StepLoyaltyProps) {
  const enabled = data.enableLoyalty || false
  const [showTiers, setShowTiers] = useState(false)

  const programName = data.loyaltyProgramName || `${companyName || 'My Business'} Rewards`
  const collectionFactor = data.loyaltyCollectionFactor ?? 1
  const conversionFactor = data.loyaltyConversionFactor ?? 0.01
  const minRedemption = data.loyaltyMinRedemption ?? 100
  const pointsExpire = data.loyaltyExpire || false
  const expiryDays = data.loyaltyExpiryDays ?? 365

  return (
    <div>
      {/* ==================== Enable Toggle ==================== */}
      <div className="mb-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Gift size={24} className="text-blue-600" />
            Loyalty Program
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Reward your customers with points on every purchase. This step is optional.
          </p>
        </div>

        <label className="flex items-center gap-3 p-4 border border-gray-200 dark:border-gray-600 rounded cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onChange({ enableLoyalty: e.target.checked })}
            className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <div>
            <p className="font-medium text-gray-900 dark:text-white">Enable Loyalty Program</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Customers earn points on purchases and redeem them for discounts
            </p>
          </div>
        </label>
      </div>

      {/* ==================== Configuration (shown when enabled) ==================== */}
      {enabled && (
        <>
          <div className="mb-8 space-y-4">
            {/* Program Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Program Name
              </label>
              <input
                type="text"
                value={programName}
                onChange={(e) => onChange({ loyaltyProgramName: e.target.value })}
                className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g. My Store Rewards"
              />
            </div>

            {/* Points Configuration */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Points per {currency} spent
                </label>
                <input
                  type="number"
                  value={collectionFactor}
                  onChange={(e) => onChange({ loyaltyCollectionFactor: parseFloat(e.target.value) || 0 })}
                  min="0.01"
                  step="0.1"
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-400 mt-1">e.g. 1 = one point per {currency}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {currency} per point redeemed
                </label>
                <input
                  type="number"
                  value={conversionFactor}
                  onChange={(e) => onChange({ loyaltyConversionFactor: parseFloat(e.target.value) || 0 })}
                  min="0.001"
                  step="0.01"
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-400 mt-1">e.g. 0.01 = 100 pts = 1 {currency}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Min. points to redeem
                </label>
                <input
                  type="number"
                  value={minRedemption}
                  onChange={(e) => onChange({ loyaltyMinRedemption: parseInt(e.target.value) || 0 })}
                  min="1"
                  step="10"
                  className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Points Expiry */}
            <div className="flex items-center gap-4 p-3 border border-gray-200 dark:border-gray-600 rounded">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pointsExpire}
                  onChange={(e) => onChange({ loyaltyExpire: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Points expire after</span>
              </label>
              {pointsExpire && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={expiryDays}
                    onChange={(e) => onChange({ loyaltyExpiryDays: parseInt(e.target.value) || 365 })}
                    min="30"
                    max="3650"
                    className="w-24 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <span className="text-sm text-gray-500 dark:text-gray-400">days</span>
                </div>
              )}
            </div>
          </div>

          {/* ==================== Tier Preview ==================== */}
          <div className="mb-8 pt-6 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setShowTiers(!showTiers)}
              className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors mb-4"
            >
              <Star size={18} className="text-blue-600" />
              Loyalty Tiers (Pre-configured)
              {showTiers ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showTiers && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {DEFAULT_TIERS.map((tier) => (
                  <div
                    key={tier.name}
                    className={`p-3 rounded border ${TIER_COLORS[tier.name] || 'border-gray-200'}`}
                  >
                    <p className="font-semibold text-sm mb-2">{tier.name}</p>
                    <div className="space-y-1 text-xs opacity-80">
                      <p>{tier.minPoints}+ points</p>
                      <p>{tier.earnRate}x earn rate</p>
                      <p>{tier.redeemRate}x redeem rate</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!showTiers && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Bronze, Silver, Gold, and Platinum tiers will be created with default earn/redeem multipliers.
              </p>
            )}
          </div>
        </>
      )}

      {/* ==================== Navigation Buttons ==================== */}
      <div className="mt-8 flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors font-medium"
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="px-6 py-2.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
