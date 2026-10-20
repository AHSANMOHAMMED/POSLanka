'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_LABELS,
  type FeatureFlag,
  type FeatureFlagsMap,
} from '@/lib/features/flags'
import {
  Search,
  Download,
  Radio,
  PlusCircle,
  ToggleLeft,
  Eye,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Sliders,
} from 'lucide-react'

type VendorRow = {
  id: string
  name: string
  slug: string
  email: string
  phone?: string | null
  businessType: string
  status: string
  plan?: string | null
  currency: string
  userCount: number
  subscriptionStatus: string | null
  featureFlags: FeatureFlagsMap
  setupCompletedAt: string | null
  settings?: Record<string, unknown> | null
}

type Pagination = { page: number; pageSize: number; total: number }

const PAGE_SIZE = 50

export default function VendorsAdminPage() {
  const [vendors, setVendors] = useState<VendorRow[]>([])
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: PAGE_SIZE, total: 0 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [selectedVertical, setSelectedVertical] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [savingId, setSavingId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [bulkModalOpen, setBulkModalOpen] = useState(false)
  const [bulkFlags, setBulkFlags] = useState<Partial<FeatureFlagsMap>>({})

  // Debounce search input before hitting the server
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (debouncedQ) params.set('q', debouncedQ)
      const res = await fetch(`/api/sys-control/vendors?${params.toString()}`, { cache: 'no-store' })
      if (res.status === 401) {
        window.location.href = '/sys-control/login'
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage(data.error || 'Failed to load vendors')
        return
      }
      setVendors(data.vendors || [])
      setPagination(data.pagination || { page, pageSize: PAGE_SIZE, total: (data.vendors || []).length })
    } catch {
      setMessage('Network error while loading vendors')
    } finally {
      setLoading(false)
    }
  }, [page, debouncedQ])

  useEffect(() => {
    load()
  }, [load])

  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize))

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
      setBulkModalOpen(false)
      await load()
    } else {
      setMessage('Bulk update failed')
    }
  }

  async function bulkSaveCustomFlags() {
    if (selected.size === 0) return
    setMessage(null)
    const res = await fetch('/api/sys-control/vendors', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantIds: Array.from(selected), featureFlags: bulkFlags }),
    })
    if (res.ok) {
      setMessage(`Updated feature flags for ${selected.size} vendor(s)`)
      setSelected(new Set())
      setBulkModalOpen(false)
      await load()
    } else {
      setMessage('Bulk flag update failed')
    }
  }

  async function impersonate(vendor: VendorRow) {
    const res = await fetch(`/api/sys-control/vendors/${vendor.id}/impersonate`, {
      method: 'POST',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.redirectUrl) {
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

  function selectAll() {
    if (selected.size === filteredVendors.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredVendors.map((v) => v.id)))
    }
  }

  const exportCsv = () => {
    const headers = ['ID', 'Name', 'Slug', 'Email', 'Vertical', 'Status', 'Plan', 'Cashiers']
    const rows = filteredVendors.map((v) => [
      v.id,
      `"${v.name}"`,
      v.slug,
      v.email,
      v.businessType,
      v.status,
      v.plan || 'trial',
      v.userCount,
    ])
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `poslanka_vendors_audit_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Filter vendors
  const filteredVendors = vendors.filter((v) => {
    if (selectedVertical !== 'all' && v.businessType.toLowerCase() !== selectedVertical) return false
    if (selectedStatus !== 'all') {
      const status = (v.subscriptionStatus || v.status).toLowerCase()
      if (selectedStatus === 'live' && status !== 'active') return false
      if (selectedStatus === 'trial' && status !== 'trial') return false
      if (selectedStatus === 'locked' && status !== 'locked') return false
    }
    return true
  })

  const liveCount = vendors.filter((v) => (v.subscriptionStatus || v.status) === 'active').length
  const trialCount = vendors.filter((v) => (v.subscriptionStatus || v.status) === 'trial').length
  const lockedCount = vendors.filter((v) => (v.subscriptionStatus || v.status) === 'locked').length

  return (
    <div className="space-y-6 pb-12">
      {/* Top Context Header Area (Stitch S4) */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Title & Live Tenant Counters */}
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <div className="flex items-center gap-1.5 text-[#879391] font-mono text-[10px] uppercase tracking-wider mb-1">
                <span>REGISTRY</span>
                <span>/</span>
                <span>CORE_TENANCY_LK</span>
                <span>/</span>
                <span className="text-[#6bd8cb] font-semibold">ISOLATION: ROW-LEVEL SEC</span>
              </div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  Vendors &amp; Tenants Management
                </h1>
                <div className="flex items-center gap-1.5 px-2.5 py-0.5 bg-[#171f33] border border-[#2d3449] rounded-lg text-xs font-mono">
                  <span className="w-2 h-2 rounded-full bg-[#4fdbc8]"></span>
                  <span className="text-white font-bold">{pagination.total}</span>
                  <span className="text-[#bcc9c6]">Registered</span>
                </div>
              </div>
            </div>

            {/* Metric Status Badges */}
            <div className="hidden xl:flex items-center gap-2 font-mono text-xs bg-[#060e20] border border-[#2d3449] px-3 py-1.5 rounded-lg">
              <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#131b2e]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#4fdbc8]"></span>
                <span className="text-[#4fdbc8] font-bold">{liveCount}</span>
                <span className="text-[#bcc9c6]">Live</span>
              </div>
              <span className="text-[#3d4947]">·</span>
              <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#131b2e]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ffdad7]"></span>
                <span className="text-[#ffdad7] font-bold">{trialCount}</span>
                <span className="text-[#bcc9c6]">Trial</span>
              </div>
              <span className="text-[#3d4947]">·</span>
              <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#131b2e]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ff5451]"></span>
                <span className="text-[#ff5451] font-bold">{lockedCount}</span>
                <span className="text-[#bcc9c6]">Locked</span>
              </div>
            </div>
          </div>

          {/* Action Suite: Primary & Global Ops */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={() => setBulkModalOpen(true)}
              disabled={selected.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449] text-white text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50"
            >
              <ToggleLeft className="w-4 h-4 text-[#6bd8cb]" />
              <span>Bulk Feature Flags ({selected.size})</span>
            </button>

            <button
              type="button"
              onClick={exportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449] text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
            >
              <Download className="w-4 h-4 text-[#bcc9c6]" />
              <span>Export CSV (Audited)</span>
            </button>

            <Link
              href="/sys-control/messages"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449] text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
            >
              <Radio className="w-4 h-4 text-[#4fdbc8]" />
              <span>Broadcast</span>
            </Link>

            <Link
              href="/sys-control/vendors/create"
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#29a195] hover:bg-[#04b4a2] text-[#00302b] text-xs font-bold rounded-lg shadow-md transition-all active:scale-95"
            >
              <PlusCircle className="w-4 h-4" />
              <span>+ Provision New Vendor</span>
            </Link>
          </div>
        </div>

        {/* Filter & Command Bar */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-3 rounded-xl shadow-sm flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          <div className="flex flex-1 items-center gap-3 flex-wrap">
            {/* Search Query Box */}
            <div className="relative flex-1 min-w-[280px]">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-[#879391]" />
              <input
                type="text"
                placeholder="Search vendor name, slug, TIN (e.g. RAMIS-8941), email..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 bg-[#060e20] border border-[#2d3449] rounded-lg text-white placeholder:text-[#879391] font-mono text-xs focus:border-[#6bd8cb] outline-none transition-colors"
              />
            </div>

            {/* Filter Dropdown 1: Vertical */}
            <div className="flex items-center bg-[#060e20] border border-[#2d3449] px-3 py-1 rounded-lg">
              <span className="text-[#879391] font-mono text-[10px] uppercase tracking-wider mr-2">
                Vertical:
              </span>
              <select
                value={selectedVertical}
                onChange={(e) => setSelectedVertical(e.target.value)}
                className="bg-transparent text-white text-xs outline-none cursor-pointer font-medium"
              >
                <option value="all" className="bg-[#131b2e]">All Verticals</option>
                <option value="supermarket" className="bg-[#131b2e]">Supermarket</option>
                <option value="retail" className="bg-[#131b2e]">Retail</option>
                <option value="restaurant" className="bg-[#131b2e]">Restaurant / F&amp;B</option>
                <option value="auto_service" className="bg-[#131b2e]">Auto Service &amp; Workshop</option>
                <option value="dealership" className="bg-[#131b2e]">Dealership</option>
              </select>
            </div>

            {/* Filter Dropdown 2: Status */}
            <div className="flex items-center bg-[#060e20] border border-[#2d3449] px-3 py-1 rounded-lg">
              <span className="text-[#879391] font-mono text-[10px] uppercase tracking-wider mr-2">
                Status:
              </span>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="bg-transparent text-white text-xs outline-none cursor-pointer font-medium"
              >
                <option value="all" className="bg-[#131b2e]">All Statuses</option>
                <option value="live" className="bg-[#131b2e]">Live / Active</option>
                <option value="trial" className="bg-[#131b2e]">Trial Period</option>
                <option value="locked" className="bg-[#131b2e]">Locked / Overdue</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-[#879391] font-mono">
            <span>
              Showing {filteredVendors.length} of {vendors.length} on this page • {pagination.total} total
            </span>
          </div>
        </div>
      </div>

      {message && (
        <div className="p-3 rounded-lg bg-[#222a3d] border border-[#3d4947] text-xs text-[#dae2fd] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#4fdbc8]" />
          <span>{message}</span>
        </div>
      )}

      {/* Main Vendor Directory Table (Stitch S4) */}
      <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl shadow-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#060e20] text-[#879391] font-mono text-[10px] uppercase border-b border-[#2d3449]">
              <tr>
                <th className="px-4 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === filteredVendors.length && filteredVendors.length > 0}
                    onChange={selectAll}
                    className="rounded bg-[#171f33] border-[#2d3449] text-[#6bd8cb]"
                  />
                </th>
                <th className="px-4 py-3">Vendor / Legal Entity</th>
                <th className="px-3 py-3">Vertical</th>
                <th className="px-3 py-3">RAMIS TIN</th>
                <th className="px-3 py-3">Tills / Users</th>
                <th className="px-3 py-3">Plan / Status</th>
                <th className="px-4 py-3">Feature Flags Matrix</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2d3449]/40 font-mono text-xs">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#bcc9c6]">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-[#6bd8cb]" />
                    <span>Loading tenant registry...</span>
                  </td>
                </tr>
              ) : filteredVendors.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#879391]">
                    No vendors found matching current filters.
                  </td>
                </tr>
              ) : (
                filteredVendors.map((vendor) => {
                  const isSelected = selected.has(vendor.id)
                  const isSaving = savingId === vendor.id
                  const status = (vendor.subscriptionStatus || vendor.status).toLowerCase()

                  return (
                    <tr
                      key={vendor.id}
                      className={`hover:bg-[#171f33] transition-colors ${
                        isSelected ? 'bg-[#171f33]/80' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(vendor.id)}
                          className="rounded bg-[#171f33] border-[#2d3449] text-[#6bd8cb]"
                        />
                      </td>

                      {/* Vendor Entity & Slug */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-[#060e20] border border-[#2d3449] flex items-center justify-center font-bold text-white uppercase text-xs">
                            {vendor.name.slice(0, 2)}
                          </div>
                          <div>
                            <div className="font-sans font-semibold text-white">
                              <Link
                                href={`/sys-control/vendors/${vendor.id}`}
                                className="hover:text-[#6bd8cb] hover:underline"
                              >
                                {vendor.name}
                              </Link>
                            </div>
                            <div className="text-[11px] text-[#879391] font-mono">
                              {vendor.slug}.poslanka.lk • {vendor.email}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Vertical */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="font-sans px-2 py-0.5 rounded bg-[#060e20] text-[#bcc9c6] border border-[#2d3449] text-[11px] capitalize font-medium">
                          {vendor.businessType.replace('_', ' ')}
                        </span>
                      </td>

                      {/* RAMIS TIN */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-xs text-[#bcc9c6]">
                          <ShieldCheck className="w-3.5 h-3.5 text-[#4fdbc8]" />
                          <span>{(vendor.settings?.tin as string) || '—'}</span>
                        </div>
                      </td>

                      {/* Tills / Users */}
                      <td className="px-3 py-3 whitespace-nowrap text-white">
                        <span>{vendor.userCount} Users</span>
                      </td>

                      {/* Plan / Status */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold w-fit ${
                              status === 'active'
                                ? 'bg-[#29a195]/20 text-[#6bd8cb] border border-[#29a195]/40'
                                : status === 'trial'
                                ? 'bg-[#ffdad7]/20 text-[#ffdad7] border border-[#ffdad7]/40'
                                : 'bg-[#93000a]/20 text-[#ffb4ab] border border-[#ff5451]/40'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                status === 'active'
                                  ? 'bg-[#6bd8cb]'
                                  : status === 'trial'
                                  ? 'bg-[#ffdad7]'
                                  : 'bg-[#ff5451]'
                              }`}
                            ></span>
                            <span className="uppercase">{status}</span>
                          </span>
                          <span className="text-[10px] text-[#879391] capitalize font-mono">
                            {vendor.plan || 'Trial'} Tier
                          </span>
                        </div>
                      </td>

                      {/* Feature Flags Matrix (4 Key Flags) */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {(
                            [
                              'accounting',
                              'purchase',
                              'loyalty',
                              'multi_warehouse',
                            ] as FeatureFlag[]
                          ).map((flag) => {
                            const enabled = !!vendor.featureFlags[flag]
                            const shortLabel =
                              flag === 'accounting'
                                ? 'ACC'
                                : flag === 'purchase'
                                ? 'PUR'
                                : flag === 'loyalty'
                                ? 'LOYAL'
                                : 'WH'

                            return (
                              <button
                                key={flag}
                                type="button"
                                disabled={isSaving}
                                onClick={() => toggleFlag(vendor, flag)}
                                title={`${FEATURE_FLAG_LABELS[flag]}: Click to toggle`}
                                className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                                  enabled
                                    ? 'bg-[#29a195]/25 text-[#6bd8cb] border border-[#29a195]/60 hover:bg-[#29a195]/40'
                                    : 'bg-[#060e20] text-[#879391] border border-[#2d3449] hover:text-white'
                                }`}
                              >
                                {shortLabel}
                              </button>
                            )
                          })}
                          {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin text-[#6bd8cb]" />}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => impersonate(vendor)}
                            title="Impersonate and jump into vendor POS"
                            className="p-1.5 rounded-lg bg-[#060e20] hover:bg-[#222a3d] border border-[#2d3449] text-[#bcc9c6] hover:text-[#6bd8cb] transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          <Link
                            href={`/sys-control/vendors/${vendor.id}`}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#171f33] hover:bg-[#222a3d] border border-[#2d3449] text-white hover:text-[#6bd8cb] text-xs font-semibold transition-colors"
                          >
                            <span>360° Dossier</span>
                            <ChevronRight className="w-3 h-3 text-[#879391]" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#2d3449] font-mono text-xs text-[#879391]">
          <span>
            Page {pagination.page} of {totalPages} • {pagination.total} vendors
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#171f33] border border-[#2d3449] text-white disabled:opacity-40"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#171f33] border border-[#2d3449] text-white disabled:opacity-40"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Bulk Feature Flags Modal */}
      {bulkModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#171f33] border border-[#2d3449] rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-[#6bd8cb] pb-2 border-b border-[#2d3449]">
              <Sliders className="w-6 h-6 flex-shrink-0" />
              <div>
                <h3 className="font-bold text-base text-white">Bulk Feature Flags Manager</h3>
                <p className="text-xs text-[#bcc9c6]">
                  Applying changes across {selected.size} selected vendor tenant(s)
                </p>
              </div>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {FEATURE_FLAGS.map((flag) => {
                const checked = !!bulkFlags[flag]
                return (
                  <label
                    key={flag}
                    className="flex items-center justify-between p-2.5 bg-[#060e20] border border-[#2d3449] rounded-lg cursor-pointer hover:bg-[#131b2e] transition-colors"
                  >
                    <div>
                      <div className="text-xs font-semibold text-white">
                        {FEATURE_FLAG_LABELS[flag]}
                      </div>
                      <div className="font-mono text-[10px] text-[#879391]">{flag}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setBulkFlags((prev) => ({ ...prev, [flag]: e.target.checked }))
                      }
                      className="rounded bg-[#171f33] border-[#2d3449] text-[#6bd8cb] w-4 h-4"
                    />
                  </label>
                )
              })}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-[#2d3449]">
              <button
                type="button"
                onClick={bulkApplyDefaults}
                className="px-3 py-1.5 rounded-lg bg-[#222a3d] hover:bg-[#2d3449] text-[#bcc9c6] text-xs font-medium"
              >
                Reset to Platform Defaults
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBulkModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-[#060e20] text-[#bcc9c6] hover:text-white text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={bulkSaveCustomFlags}
                  className="px-4 py-1.5 rounded-lg bg-[#6bd8cb] text-[#003732] hover:bg-[#89f5e7] text-xs font-bold"
                >
                  Apply to {selected.size} Tenants
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
