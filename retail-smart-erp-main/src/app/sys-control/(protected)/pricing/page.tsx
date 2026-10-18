'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, Plus, Edit2, Save, X, Database, HardDrive, Users } from 'lucide-react'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'

interface PricingTier {
  id: string
  name: string
  displayName: string
  priceMonthly: string | null
  priceYearly: string | null
  currency: string
  maxUsers: number | null
  maxSalesMonthly: number | null
  maxDatabaseBytes: number | null
  maxFileStorageBytes: number | null
  features: Record<string, unknown>
  isActive: boolean
  sortOrder: number
  subscriberCount?: number
}


function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function bytesToGB(bytes: number): string {
  if (!bytes) return ''
  return (bytes / (1024 * 1024 * 1024)).toFixed(2).replace(/\.?0+$/, '')
}

function gbToBytes(gb: string): number | null {
  if (!gb) return null
  return Math.round(parseFloat(gb) * 1024 * 1024 * 1024)
}

export default function PricingPage() {
  const [tiers, setTiers] = useState<PricingTier[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Record<string, unknown>>({})
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const [formData, setFormData] = useState({
    name: '',
    displayName: '',
    priceMonthly: '',
    priceYearly: '',
    maxDatabaseGB: '',
    maxFileStorageGB: '',
    sortOrder: 0,
  })

  const fetchTiers = useCallback(async () => {
    try {
      const res = await fetch('/api/sys-control/pricing-tiers')
      if (res.ok) {
        const data = await res.json()
        setTiers(data)
      }
    } catch (error) {
      console.error('Failed to fetch pricing tiers:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTiers()
  }, [fetchTiers])

  const handleCreate = async () => {
    if (!formData.name || !formData.displayName) {
      alert('Name and display name are required')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/sys-control/pricing-tiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          priceMonthly: formData.priceMonthly ? parseFloat(formData.priceMonthly) : null,
          priceYearly: formData.priceYearly ? parseFloat(formData.priceYearly) : (formData.priceMonthly ? parseFloat(formData.priceMonthly) * 10 : null),
          currency: 'LKR',
          maxUsers: null,
          maxSalesMonthly: null,
          maxDatabaseBytes: gbToBytes(formData.maxDatabaseGB),
          maxFileStorageBytes: gbToBytes(formData.maxFileStorageGB),
        }),
      })

      if (res.ok) {
        setShowForm(false)
        setFormData({
          name: '',
          displayName: '',
          priceMonthly: '',
          priceYearly: '',
          maxDatabaseGB: '',
          maxFileStorageGB: '',
          sortOrder: 0,
        })
        fetchTiers()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to create tier')
      }
    } catch (error) {
      console.error('Failed to create tier:', error)
      alert('Failed to create tier')
    } finally {
      setSaving(false)
    }
  }

  const startEditing = (tier: PricingTier) => {
    setEditingId(tier.id)
    setEditData({
      displayName: tier.displayName,
      priceMonthly: tier.priceMonthly || '',
      priceYearly: tier.priceYearly || '',
      maxDatabaseGB: tier.maxDatabaseBytes ? bytesToGB(tier.maxDatabaseBytes) : '',
      maxFileStorageGB: tier.maxFileStorageBytes ? bytesToGB(tier.maxFileStorageBytes) : '',
      sortOrder: tier.sortOrder,
      isActive: tier.isActive,
    })
  }

  const cancelEditing = () => {
    setEditingId(null)
    setEditData({})
  }

  const handleUpdate = async (id: string) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/sys-control/pricing-tiers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: editData.displayName,
          priceMonthly: editData.priceMonthly ? parseFloat(String(editData.priceMonthly)) : null,
          priceYearly: editData.priceYearly ? parseFloat(String(editData.priceYearly)) : null,
          currency: 'LKR',
          maxDatabaseBytes: editData.maxDatabaseGB ? gbToBytes(String(editData.maxDatabaseGB)) : null,
          maxFileStorageBytes: editData.maxFileStorageGB ? gbToBytes(String(editData.maxFileStorageGB)) : null,
          sortOrder: editData.sortOrder,
          isActive: editData.isActive,
        }),
      })

      if (res.ok) {
        setEditingId(null)
        setEditData({})
        fetchTiers()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to update tier')
      }
    } catch (error) {
      console.error('Failed to update tier:', error)
      alert('Failed to update tier')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (tier: PricingTier) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/sys-control/pricing-tiers/${tier.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !tier.isActive }),
      })

      if (res.ok) {
        fetchTiers()
      } else {
        const data = await res.json()
        alert(data.error || 'Failed to update tier')
      }
    } catch (error) {
      console.error('Failed to update tier:', error)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            Pricing Tiers
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Manage subscription plans and storage limits (all prices in LKR)</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Tier
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Create New Pricing Tier</h3>
          <div className="grid gap-4 md:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Internal Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value.toLowerCase().replace(/\s/g, '_') })}
                placeholder="e.g., starter"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Display Name *
              </label>
              <input
                type="text"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                placeholder="e.g., Starter Plan"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Sort Order
              </label>
              <input
                type="number"
                value={formData.sortOrder}
                onChange={(e) => setFormData({ ...formData, sortOrder: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Monthly Price (LKR)
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.priceMonthly}
                onChange={(e) => setFormData({ ...formData, priceMonthly: e.target.value })}
                placeholder="Leave blank for custom"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Yearly Price (LKR)
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.priceYearly}
                onChange={(e) => setFormData({ ...formData, priceYearly: e.target.value })}
                placeholder="Auto or blank for custom"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                DB Storage (GB)
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.maxDatabaseGB}
                onChange={(e) => setFormData({ ...formData, maxDatabaseGB: e.target.value })}
                placeholder="e.g., 3"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                File Storage (GB)
              </label>
              <input
                type="number"
                step="0.1"
                value={formData.maxFileStorageGB}
                onChange={(e) => setFormData({ ...formData, maxFileStorageGB: e.target.value })}
                placeholder="e.g., 2"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
              />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create Tier
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tiers Table */}
      <div className="bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                Plan
              </th>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                Monthly (LKR)
              </th>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                Yearly (LKR)
              </th>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                DB Storage
              </th>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                File Storage
              </th>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                Subscribers
              </th>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                Status
              </th>
              <th className="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider px-6 py-3">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {tiers.map((tier) => (
              <tr key={tier.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700 ${!tier.isActive ? 'opacity-50' : ''}`}>
                {editingId === tier.id ? (
                  // Edit Mode
                  <>
                    <td className="px-6 py-4">
                      <input
                        type="text"
                        value={String(editData.displayName || '')}
                        onChange={(e) => setEditData({ ...editData, displayName: e.target.value })}
                        className="w-full px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-700 dark:text-white"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{tier.name}</p>
                    </td>
                    <td className="px-6 py-4">
                      <input
                        type="number"
                        step="0.01"
                        value={String(editData.priceMonthly || '')}
                        onChange={(e) => setEditData({ ...editData, priceMonthly: e.target.value })}
                        className="w-28 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-700 dark:text-white"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <input
                        type="number"
                        step="0.01"
                        value={String(editData.priceYearly || '')}
                        onChange={(e) => setEditData({ ...editData, priceYearly: e.target.value })}
                        className="w-28 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-700 dark:text-white"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.1"
                          value={String(editData.maxDatabaseGB || '')}
                          onChange={(e) => setEditData({ ...editData, maxDatabaseGB: e.target.value })}
                          placeholder="GB"
                          className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-700 dark:text-white"
                        />
                        <span className="text-xs text-gray-500 dark:text-gray-400">GB</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.1"
                          value={String(editData.maxFileStorageGB || '')}
                          onChange={(e) => setEditData({ ...editData, maxFileStorageGB: e.target.value })}
                          placeholder="GB"
                          className="w-20 px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-700 dark:text-white"
                        />
                        <span className="text-xs text-gray-500 dark:text-gray-400">GB</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-900 dark:text-white font-medium">{tier.subscriberCount ?? 0}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={editData.isActive ? 'active' : 'inactive'}
                        onChange={(e) => setEditData({ ...editData, isActive: e.target.value === 'active' })}
                        className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded text-sm dark:bg-gray-700 dark:text-white"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleUpdate(tier.id)}
                          disabled={saving}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded"
                        >
                          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </>
                ) : (
                  // View Mode
                  <>
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{tier.displayName}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{tier.name}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-gray-900 dark:text-white font-medium">
                        {tier.priceMonthly != null ? formatCurrencyWithSymbol(Number(tier.priceMonthly), tier.currency) : <span className="text-amber-600 italic">Custom</span>}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-gray-900 dark:text-white font-medium">
                        {tier.priceYearly != null ? formatCurrencyWithSymbol(Number(tier.priceYearly), tier.currency) : <span className="text-amber-600 italic">Custom</span>}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <Database className="w-4 h-4 text-purple-500" />
                        <span className="text-gray-900 dark:text-white font-medium">
                          {tier.maxDatabaseBytes ? formatBytes(tier.maxDatabaseBytes) : 'Unlimited'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <HardDrive className="w-4 h-4 text-green-500" />
                        <span className="text-gray-900 dark:text-white font-medium">
                          {tier.maxFileStorageBytes ? formatBytes(tier.maxFileStorageBytes) : 'Unlimited'}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-gray-400" />
                        <span className="text-gray-900 dark:text-white font-medium">{tier.subscriberCount ?? 0}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${
                        tier.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                      }`}>
                        {tier.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => startEditing(tier)}
                          className="p-1.5 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                          title="Edit"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleToggleActive(tier)}
                          disabled={saving}
                          className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                            tier.isActive
                              ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200'
                              : 'bg-green-100 text-green-700 hover:bg-green-200'
                          }`}
                        >
                          {tier.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
