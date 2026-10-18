'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_LABELS,
  type FeatureFlag,
  type FeatureFlagsMap,
} from '@/lib/features/flags'

type VendorRow = {
  id: string
  name: string
  slug: string
  email: string
  businessType: string
  status: string
  currency: string
  userCount: number
  subscriptionStatus: string | null
  featureFlags: FeatureFlagsMap
  setupCompletedAt: string | null
}

export default function VendorsAdminPage() {
  const [vendors, setVendors] = useState<VendorRow[]>([])
  const [defaults, setDefaults] = useState<FeatureFlagsMap | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [savingId, setSavingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sys-control/vendors?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      setVendors(data.vendors || [])
      setDefaults(data.defaults || null)
    } finally {
      setLoading(false)
    }
  }, [q])

  useEffect(() => {
    load()
  }, [load])

  async function toggleFlag(vendor: VendorRow, flag: FeatureFlag) {
    setSavingId(vendor.id)
    setMessage(null)
    const next = { ...vendor.featureFlags, [flag]: !vendor.featureFlags[flag] }
    const res = await fetch(`/api/sys-control/vendors/${vendor.id}/features`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ featureFlags: next }),
    })
    if (res.ok) {
      const data = await res.json()
      setVendors((prev) =>
        prev.map((v) => (v.id === vendor.id ? { ...v, featureFlags: data.featureFlags } : v))
      )
    } else {
      setMessage('Failed to update feature flag')
    }
    setSavingId(null)
  }

  async function bulkApplyDefaults() {
    if (selected.size === 0) return
    setMessage(null)
    const res = await fetch('/api/sys-control/vendors', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantIds: Array.from(selected), applyDefaults: true }),
    })
    if (res.ok) {
      setMessage(`Applied defaults to ${selected.size} vendor(s)`)
      setSelected(new Set())
      await load()
    } else {
      setMessage('Bulk update failed')
    }
  }

  async function impersonate(vendor: VendorRow) {
    const res = await fetch(`/api/sys-control/vendors/${vendor.id}/impersonate`, {
      method: 'POST',
    })
    const data = await res.json()
    if (!res.ok) {
      setMessage(data.error || 'Impersonation failed')
      return
    }
    window.location.href = data.redirectUrl
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendors</h1>
          <p className="text-sm text-gray-600 mt-1">
            Manage shops, feature flags, and support impersonation
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, slug, email…"
            className="border rounded-md px-3 py-2 text-sm w-64"
          />
          <button
            type="button"
            onClick={bulkApplyDefaults}
            disabled={selected.size === 0}
            className="px-3 py-2 text-sm rounded-md bg-teal-700 text-white disabled:opacity-40"
          >
            Apply defaults ({selected.size})
          </button>
        </div>
      </div>

      {defaults && (
        <div className="mb-4 text-xs text-gray-500">
          New vendor default flags:{' '}
          {FEATURE_FLAGS.filter((f) => defaults[f]).map((f) => FEATURE_FLAG_LABELS[f]).join(', ')}
        </div>
      )}

      {message && (
        <div className="mb-4 text-sm rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-amber-900">
          {message}
        </div>
      )}

      {loading ? (
        <p className="text-gray-500">Loading vendors…</p>
      ) : (
        <div className="space-y-4">
          {vendors.map((vendor) => (
            <div key={vendor.id} className="bg-white border rounded-lg p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(vendor.id)}
                    onChange={() => toggleSelect(vendor.id)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-semibold text-gray-900">{vendor.name}</div>
                    <div className="text-sm text-gray-500">
                      {vendor.slug} · {vendor.email} · {vendor.businessType} · {vendor.currency}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      Status: {vendor.status} · Users: {vendor.userCount} · Sub:{' '}
                      {vendor.subscriptionStatus || '—'}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => impersonate(vendor)}
                  className="text-sm px-3 py-1.5 rounded-md border border-gray-300 hover:bg-gray-50"
                >
                  Impersonate owner
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                {FEATURE_FLAGS.map((flag) => (
                  <label
                    key={flag}
                    className="flex items-center gap-2 text-sm border rounded-md px-2 py-1.5 cursor-pointer hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={vendor.featureFlags[flag]}
                      disabled={savingId === vendor.id}
                      onChange={() => toggleFlag(vendor, flag)}
                    />
                    <span>{FEATURE_FLAG_LABELS[flag]}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          {vendors.length === 0 && (
            <p className="text-gray-500">No vendors found.</p>
          )}
        </div>
      )}
    </div>
  )
}
