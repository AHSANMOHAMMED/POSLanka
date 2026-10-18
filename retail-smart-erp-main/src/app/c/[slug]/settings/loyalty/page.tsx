'use client'

import { useState, useEffect, useCallback } from 'react'
import { Star, Save, Loader2, ChevronLeft } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import Link from 'next/link'

interface LoyaltyTier {
  name: string
  tier: string
  minPoints: number
  earnRate: number
  redeemRate: number
  isActive: boolean
}

const DEFAULT_TIERS: LoyaltyTier[] = [
  { name: 'Bronze', tier: 'bronze', minPoints: 0, earnRate: 1, redeemRate: 1, isActive: true },
  { name: 'Silver', tier: 'silver', minPoints: 500, earnRate: 1.25, redeemRate: 1.1, isActive: true },
  { name: 'Gold', tier: 'gold', minPoints: 2000, earnRate: 1.5, redeemRate: 1.25, isActive: true },
  { name: 'Platinum', tier: 'platinum', minPoints: 5000, earnRate: 2, redeemRate: 1.5, isActive: true },
]

export default function LoyaltySettingsPage() {
  const { tenantSlug } = useCompany()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [, setProgramId] = useState<string | null>(null)

  // Program settings
  const [name, setName] = useState('Loyalty Rewards')
  const [collectionFactor, setCollectionFactor] = useState('1')
  const [conversionFactor, setConversionFactor] = useState('0.01')
  const [minRedemptionPoints, setMinRedemptionPoints] = useState('100')
  const [pointsExpire, setPointsExpire] = useState(false)
  const [expiryDays, setExpiryDays] = useState('365')

  // Tiers
  const [tiers, setTiers] = useState<LoyaltyTier[]>(DEFAULT_TIERS)

  const fetchProgram = useCallback(async () => {
    try {
      const res = await fetch('/api/loyalty-programs')
      if (res.ok) {
        const data = await res.json()
        if (data && data.id) {
          setProgramId(data.id)
          setName(data.name || 'Loyalty Rewards')
          setCollectionFactor(data.collectionFactor || '1')
          setConversionFactor(data.conversionFactor || '0.01')
          setMinRedemptionPoints(String(data.minRedemptionPoints || 100))
          setPointsExpire(data.pointsExpire || false)
          setExpiryDays(String(data.expiryDays || 365))
          if (data.tiers && data.tiers.length > 0) {
            setTiers(data.tiers.map((t: LoyaltyTier & { id?: string }) => ({
              name: t.name,
              tier: t.tier,
              minPoints: t.minPoints,
              earnRate: parseFloat(String(t.earnRate)),
              redeemRate: parseFloat(String(t.redeemRate)),
              isActive: t.isActive,
            })))
          }
        }
      }
    } catch (error) {
      console.error('Error fetching loyalty program:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProgram()
  }, [fetchProgram])

  useRealtimeData(fetchProgram, { entityType: 'loyalty-program', refreshOnMount: false })

  async function handleSave() {
    if (!name.trim()) {
      toast.error('Program name is required')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/loyalty-programs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          collectionFactor: parseFloat(collectionFactor) || 1,
          conversionFactor: parseFloat(conversionFactor) || 0.01,
          minRedemptionPoints: parseInt(minRedemptionPoints) || 100,
          pointsExpire,
          expiryDays: parseInt(expiryDays) || 365,
          tiers,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        setProgramId(data.id)
        toast.success('Loyalty program saved')
      } else {
        const error = await res.json()
        toast.error(error.error || 'Failed to save')
      }
    } catch (error) {
      console.error('Error saving loyalty program:', error)
      toast.error('Failed to save loyalty program')
    } finally {
      setSaving(false)
    }
  }

  function updateTier(index: number, field: keyof LoyaltyTier, value: string | number | boolean) {
    setTiers(tiers.map((t, i) => i === index ? { ...t, [field]: value } : t))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/c/${tenantSlug}/selling`} className="p-2 hover:bg-gray-100 rounded">
            <ChevronLeft size={20} />
          </Link>
          <div className="w-10 h-10 bg-purple-100 rounded-md flex items-center justify-center">
            <Star className="text-purple-600" size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Loyalty Program</h1>
            <p className="text-gray-500 text-sm">Configure customer loyalty rewards</p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
          Save
        </button>
      </div>

      {/* Program Settings */}
      <div className="bg-white rounded border p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Program Settings</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Program Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Collection Factor
              <span className="text-xs text-gray-400 ml-1">(points per currency unit spent)</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={collectionFactor}
              onChange={(e) => setCollectionFactor(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Conversion Factor
              <span className="text-xs text-gray-400 ml-1">(currency value per point)</span>
            </label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={conversionFactor}
              onChange={(e) => setConversionFactor(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Min Redemption Points
            </label>
            <input
              type="number"
              min="1"
              value={minRedemptionPoints}
              onChange={(e) => setMinRedemptionPoints(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-6 pt-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={pointsExpire}
              onChange={(e) => setPointsExpire(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">Points expire</span>
          </label>
          {pointsExpire && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">after</span>
              <input
                type="number"
                min="1"
                value={expiryDays}
                onChange={(e) => setExpiryDays(e.target.value)}
                className="w-20 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-600">days</span>
            </div>
          )}
        </div>
      </div>

      {/* Tiers */}
      <div className="bg-white rounded border p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Loyalty Tiers</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left py-3 px-4 font-medium text-gray-600">Tier</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">Min Points</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">
                  Earn Rate
                  <span className="text-xs text-gray-400 block">multiplier</span>
                </th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">
                  Redeem Rate
                  <span className="text-xs text-gray-400 block">multiplier</span>
                </th>
                <th className="text-center py-3 px-4 font-medium text-gray-600">Active</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier, index) => (
                <tr key={tier.tier} className="border-b last:border-b-0 hover:bg-gray-50">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <Star
                        size={16}
                        className={
                          tier.tier === 'platinum' ? 'text-gray-700' :
                          tier.tier === 'gold' ? 'text-yellow-500' :
                          tier.tier === 'silver' ? 'text-gray-400' :
                          'text-amber-700'
                        }
                      />
                      <span className="font-medium capitalize">{tier.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <input
                      type="number"
                      min="0"
                      value={tier.minPoints}
                      onChange={(e) => updateTier(index, 'minPoints', parseInt(e.target.value) || 0)}
                      className="w-24 px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </td>
                  <td className="py-3 px-4">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={tier.earnRate}
                      onChange={(e) => updateTier(index, 'earnRate', parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </td>
                  <td className="py-3 px-4">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={tier.redeemRate}
                      onChange={(e) => updateTier(index, 'redeemRate', parseFloat(e.target.value) || 0)}
                      className="w-20 px-2 py-1.5 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </td>
                  <td className="py-3 px-4 text-center">
                    <input
                      type="checkbox"
                      checked={tier.isActive}
                      onChange={(e) => updateTier(index, 'isActive', e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 p-4 bg-blue-50 rounded text-sm text-blue-700 space-y-1">
          <p><strong>How it works:</strong></p>
          <p>Points earned = Sale amount x Collection Factor x Earn Rate</p>
          <p>Redemption value = Points x Conversion Factor x Redeem Rate</p>
          <p>Example: A {tiers[0].earnRate}x earn rate Silver customer spending 1000 earns {Math.floor(1000 * (parseFloat(collectionFactor) || 1) * tiers[0].earnRate)} points</p>
        </div>
      </div>
    </div>
  )
}
