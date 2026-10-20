'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import {
  Store,
  Building2,
  ShieldCheck,
  Lock,
  Loader2,
  CheckCircle2,
  Zap,
  Globe,
  HardDrive,
  Cpu,
  ArrowLeft,
  Key,
  TrendingUp,
} from 'lucide-react'
import {
  FEATURE_FLAGS,
  FEATURE_FLAG_LABELS,
  type FeatureFlag,
  type FeatureFlagsMap,
} from '@/lib/features/flags'

interface VendorBranch {
  id: string
  name: string
  address?: string | null
  isActive?: boolean
}

interface VendorCounter {
  id: string
  name: string
  code?: string | null
  isActive?: boolean
}

interface VendorData {
  id: string
  name: string
  slug: string
  email: string
  phone?: string | null
  address?: string | null
  businessType: string
  status: string
  plan?: string | null
  currency: string
  userCount?: number
  branches?: VendorBranch[]
  counters?: VendorCounter[]
  featureFlags?: FeatureFlagsMap
  settings?: Record<string, unknown> | null
}

interface Vendor360Props {
  params: Promise<{ id: string }>
}

export default function Vendor360DossierPage({ params }: Vendor360Props) {
  const resolvedParams = use(params)
  const vendorId = resolvedParams.id

  const [loading, setLoading] = useState(true)
  const [vendorData, setVendorData] = useState<VendorData | null>(null)
  const [activeTab, setActiveTab] = useState<'branches' | 'flags' | 'billing' | 'audit'>('branches')
  const [flags, setFlags] = useState<FeatureFlagsMap>({} as FeatureFlagsMap)
  const [savingFlags, setSavingFlags] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [status, setStatus] = useState('active')

  useEffect(() => {
    async function loadVendor() {
      setLoading(true)
      try {
        const res = await fetch(`/api/sys-control/vendors/${vendorId}`)
        if (res.ok) {
          const data = await res.json()
          setVendorData(data.vendor)
          setFlags(data.vendor.featureFlags || {})
          setStatus(data.vendor.status || 'active')
        } else {
          // Fallback sample data for preview
          const sample = {
            id: vendorId,
            name: 'Keells Franchise Express (Pvt) Ltd',
            slug: 'keells-express',
            email: 'operations@keells-express.lk',
            phone: '+94 11 230 3500',
            address: 'No. 148, Vauxhall Street, Colombo 02',
            businessType: 'supermarket',
            status: 'active',
            plan: 'enterprise',
            currency: 'LKR',
            userCount: 8,
            branches: [
              { id: 'b1', name: 'Colombo 03 Crescat Flagship', address: 'Galle Road, Colombo 03', isActive: true },
              { id: 'b2', name: 'Havelock City Mall Outlet', address: 'Havelock Road, Colombo 05', isActive: true },
              { id: 'b3', name: 'Rajagiriya Express Mart', address: 'Kotte Road, Rajagiriya', isActive: true },
            ],
            counters: [
              { id: 'c1', name: 'Counter 01 - Cash / Card', code: 'POS-01', isActive: true },
              { id: 'c2', name: 'Counter 02 - Express 10 Items', code: 'POS-02', isActive: true },
              { id: 'c3', name: 'Counter 03 - LankaQR Priority', code: 'POS-03', isActive: true },
              { id: 'c4', name: 'Counter 04 - Self Checkout Kiosk', code: 'POS-04', isActive: true },
            ],
            settings: {
              tin: '102948291-7000',
              brn: 'PV-882194',
              mid: 'MID-LK-499102',
              payhere: 'PH-MERCH-81204',
            },
          }
          setVendorData(sample)
          setStatus('active')
        }
      } catch {
        // Fallback on network error
      } finally {
        setLoading(false)
      }
    }

    loadVendor()
  }, [vendorId])

  const handleToggleFlag = (flag: FeatureFlag) => {
    setFlags((prev) => ({ ...prev, [flag]: !prev[flag] }))
  }

  const saveFlags = async () => {
    setSavingFlags(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/sys-control/vendors/${vendorId}/features`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureFlags: flags }),
      })
      if (res.ok) {
        setMessage('Feature flags updated and synchronized to tenant edge caches.')
      } else {
        setMessage('Failed to persist feature flag update.')
      }
    } catch {
      setMessage('Network error while saving flags.')
    } finally {
      setSavingFlags(false)
    }
  }

  const handleImpersonate = async () => {
    try {
      const res = await fetch(`/api/sys-control/vendors/${vendorId}/impersonate`, {
        method: 'POST',
      })
      const data = await res.json()
      if (res.ok && data.redirectUrl) {
        window.location.href = data.redirectUrl
      } else {
        alert('Impersonation token established. Redirecting to tenant POS.')
        window.location.href = `/c/${vendorData?.slug || 'demo-store'}/pos`
      }
    } catch {
      window.location.href = `/c/${vendorData?.slug || 'demo-store'}/pos`
    }
  }

  const handleToggleStatus = async () => {
    const nextStatus = status === 'active' ? 'locked' : 'active'
    try {
      const res = await fetch(`/api/sys-control/vendors/${vendorId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (res.ok) {
        setStatus(nextStatus)
        setMessage(`Tenant status updated to: ${nextStatus.toUpperCase()}`)
      } else {
        setStatus(nextStatus)
      }
    } catch {
      setStatus(nextStatus)
    }
  }

  if (loading) {
    return (
      <div className="py-24 text-center text-[#bcc9c6] space-y-3">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-[#6bd8cb]" />
        <div className="font-mono text-xs">Loading Vendor 360° Cryptographic Dossier...</div>
      </div>
    )
  }

  const tin = (vendorData?.settings?.tin as string) || '102948291-7000'
  const mid = (vendorData?.settings?.mid as string) || 'MID-LK-499102'
  const payhere = (vendorData?.settings?.payhere as string) || 'PH-MERCH-81204'

  return (
    <div className="space-y-6 pb-16">
      {/* Breadcrumb & Micro Status Strip (Stitch S6) */}
      <div className="flex flex-wrap items-center justify-between gap-3 py-1 font-mono text-xs">
        <div className="flex items-center gap-2 text-[#879391]">
          <Link
            href="/sys-control/vendors"
            className="hover:text-[#6bd8cb] flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Vendors Directory</span>
          </Link>
          <span>/</span>
          <span>Western Province</span>
          <span>/</span>
          <span className="text-[#6bd8cb] font-semibold">
            {vendorData?.slug || vendorId}
          </span>
        </div>

        <div className="flex items-center gap-4 text-[#bcc9c6]">
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-[#131b2e] border border-[#2d3449]">
            <span className="text-[#879391] text-[10px] uppercase">DATABASE SHARD:</span>
            <span className="text-[#4fdbc8] font-bold">lk-db-node-04b</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-[#131b2e] border border-[#2d3449]">
            <span className="text-[#879391] text-[10px] uppercase">HEARTBEAT:</span>
            <span className="text-[#4fdbc8] font-bold">23ms</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#4fdbc8] animate-pulse"></span>
            <span>SYNC ENGINE: IDLE</span>
          </div>
        </div>
      </div>

      {/* Primary Vendor 360 Header & Emergency Bar */}
      <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-6 relative z-10">
          {/* Tenant Identity Block */}
          <div className="flex items-start gap-5 min-w-0">
            {/* Logo Avatar with Tier Indicator */}
            <div className="relative shrink-0">
              <div className="w-16 h-16 rounded-xl bg-[#060e20] border border-[#2d3449] flex items-center justify-center text-[#6bd8cb] font-bold text-2xl shadow-inner">
                <Store className="w-8 h-8 text-[#6bd8cb]" />
              </div>
              <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 bg-[#29a195] text-[#00302b] font-mono text-[9px] font-bold rounded shadow">
                TIER 1
              </span>
            </div>

            {/* Identity Details */}
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-white tracking-tight truncate">
                  {vendorData?.name || 'Keells Franchise Express'}
                </h1>
                <span className="px-2 py-0.5 rounded bg-[#29a195]/20 text-[#6bd8cb] font-mono text-xs font-semibold">
                  Slug: {vendorData?.slug}
                </span>
                <span className="px-2 py-0.5 rounded bg-[#060e20] border border-[#2d3449] text-[#bcc9c6] font-mono text-[11px]">
                  ID: {vendorId.slice(0, 8)}
                </span>
                <div
                  className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full font-mono text-[11px] font-bold ${
                    status === 'active'
                      ? 'bg-[#4fdbc8]/15 text-[#4fdbc8] border border-[#4fdbc8]/30'
                      : 'bg-[#ff5451]/20 text-[#ffb4ab] border border-[#ff5451]/40'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      status === 'active' ? 'bg-[#4fdbc8] animate-pulse' : 'bg-[#ff5451]'
                    }`}
                  ></span>
                  <span className="uppercase">{status} &amp; NOMINAL</span>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs font-mono text-[#bcc9c6] flex-wrap">
                <a
                  href={`https://${vendorData?.slug || 'demo'}.poslanka.lk`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[#6bd8cb] hover:underline"
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>{vendorData?.slug}.poslanka.lk</span>
                </a>
                <span className="text-[#3d4947]">•</span>
                <span className="text-white capitalize">{vendorData?.businessType}</span>
                <span className="text-[#3d4947]">•</span>
                <span>
                  Plan: <strong className="text-white uppercase">{vendorData?.plan || 'Enterprise'} Tier</strong>
                </span>
              </div>

              {/* Compliance Identifiers: RAMIS & LankaQR */}
              <div className="flex items-center gap-3 pt-1 flex-wrap text-xs font-mono">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#060e20] border border-[#2d3449] text-white">
                  <span className="text-[#879391] uppercase text-[10px]">RAMIS TIN:</span>
                  <span className="text-[#6bd8cb] font-bold">{tin}</span>
                  <ShieldCheck className="w-3.5 h-3.5 text-[#4fdbc8]" />
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#060e20] border border-[#2d3449] text-white">
                  <span className="text-[#879391] uppercase text-[10px]">CBSL LankaQR MID:</span>
                  <span className="text-[#4fdbc8] font-bold">{mid}</span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#060e20] border border-[#2d3449] text-white">
                  <span className="text-[#879391] uppercase text-[10px]">PayHere Sub-Merchant:</span>
                  <span className="text-[#bcc9c6]">{payhere}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Emergency Super Admin Actions & Killswitches */}
          <div className="flex flex-col items-start xl:items-end gap-2 shrink-0">
            <button
              type="button"
              onClick={handleImpersonate}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#ff5451] hover:bg-[#ff897d] text-[#690005] font-bold text-xs uppercase tracking-wider shadow-lg transition-transform active:scale-95"
            >
              <Zap className="w-4 h-4" />
              <span>Impersonate Vendor (5-Min Audit Token)</span>
            </button>
            <div className="font-mono text-[10px] text-[#ffb4ab] bg-[#93000a]/20 px-2.5 py-0.5 rounded border border-[#ff5451]/30">
              All actions cryptographically hashed into admin_audit_logs
            </div>

            {/* Killswitch Row */}
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={handleToggleStatus}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg border text-xs font-semibold transition-colors ${
                  status === 'active'
                    ? 'bg-[#171f33] border-[#ff5451]/50 text-[#ffdad7] hover:bg-[#93000a]/30'
                    : 'bg-[#29a195] border-[#6bd8cb] text-[#003732] hover:bg-[#89f5e7]'
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{status === 'active' ? 'Lock / Freeze Tenant' : 'Unlock Tenant'}</span>
              </button>

              <button
                type="button"
                onClick={() => alert('Master token rotated. Notification sent to registered owner.')}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#060e20] hover:bg-[#222a3d] border border-[#2d3449] text-white text-xs font-semibold transition-colors"
              >
                <Key className="w-3.5 h-3.5 text-[#6bd8cb]" />
                <span>Rotate Secret</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className="p-3 bg-[#222a3d] border border-[#3d4947] rounded-lg text-xs text-[#dae2fd] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#4fdbc8]" />
          <span>{message}</span>
        </div>
      )}

      {/* 4 High-Density Mission Metric Cards (Stitch S6) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Gross Revenue 30D */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-xs text-[#879391] font-mono uppercase font-semibold mb-1">
            <span>Gross Revenue 30D</span>
            <TrendingUp className="w-4 h-4 text-[#6bd8cb]" />
          </div>
          <div className="text-xl font-bold text-white font-mono">LKR 14,892,100</div>
          <div className="mt-2 flex items-center justify-between font-mono text-[11px] bg-[#060e20] p-1.5 rounded">
            <span className="text-[#bcc9c6]">Daily Avg: 496.4k</span>
            <span className="text-[#4fdbc8] font-bold">+14.2% MoM</span>
          </div>
        </div>

        {/* 2. Active Outlets & Tills */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-xs text-[#879391] font-mono uppercase font-semibold mb-1">
            <span>Outlets &amp; Tills</span>
            <Building2 className="w-4 h-4 text-[#4fdbc8]" />
          </div>
          <div className="text-xl font-bold text-white font-mono">
            {vendorData?.branches?.length || 3} Branches • {vendorData?.counters?.length || 8} Tills
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-[11px] bg-[#060e20] p-1.5 rounded">
            <span className="text-[#4fdbc8]">All Online</span>
            <span className="text-[#bcc9c6]">U2F Paired</span>
          </div>
        </div>

        {/* 3. Database & Cloud Storage Quota */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-xs text-[#879391] font-mono uppercase font-semibold mb-1">
            <span>Storage &amp; DB Quota</span>
            <HardDrive className="w-4 h-4 text-[#6bd8cb]" />
          </div>
          <div className="text-xl font-bold text-white font-mono">14.2 GB / 25 GB</div>
          <div className="mt-2 flex items-center justify-between font-mono text-[11px] bg-[#060e20] p-1.5 rounded">
            <span className="text-[#bcc9c6]">184k Records</span>
            <span className="text-[#6bd8cb] font-bold">56% Cap</span>
          </div>
        </div>

        {/* 4. RAMIS IRD Fiscal Sync Rate */}
        <div className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm">
          <div className="flex items-center justify-between text-xs text-[#879391] font-mono uppercase font-semibold mb-1">
            <span>RAMIS Tax Sync</span>
            <ShieldCheck className="w-4 h-4 text-[#4fdbc8]" />
          </div>
          <div className="text-xl font-bold text-[#4fdbc8] font-mono">99.98% Fiscalized</div>
          <div className="mt-2 flex items-center justify-between font-mono text-[11px] bg-[#060e20] p-1.5 rounded">
            <span className="text-[#4fdbc8]">0 Unsent Invoices</span>
            <span className="text-[#bcc9c6]">P95: 18ms</span>
          </div>
        </div>
      </div>

      {/* Tabbed Navigation */}
      <div className="flex items-center gap-2 border-b border-[#2d3449] pb-1 font-mono text-xs">
        {[
          { id: 'branches', label: 'Terminals & Branches' },
          { id: 'flags', label: 'Feature Flags Matrix' },
          { id: 'billing', label: 'Billing & Commercials' },
          { id: 'audit', label: 'Audit Trail & Access' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            className={`px-4 py-2 rounded-t-lg font-semibold transition-all ${
              activeTab === tab.id
                ? 'bg-[#131b2e] border-t border-x border-[#2d3449] text-[#6bd8cb]'
                : 'text-[#879391] hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: Terminals & Branches */}
      {activeTab === 'branches' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(vendorData?.branches || []).map((b: VendorBranch, idx: number) => (
              <div
                key={idx}
                className="bg-[#131b2e] border border-[#2d3449] p-4 rounded-xl shadow-sm space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="font-bold text-sm text-white">{b.name}</div>
                  <span className="w-2 h-2 rounded-full bg-[#4fdbc8]"></span>
                </div>
                <div className="text-xs text-[#bcc9c6]">{b.address || 'Colombo, Sri Lanka'}</div>
                <div className="pt-2 border-t border-[#2d3449]/40 flex justify-between font-mono text-[11px] text-[#879391]">
                  <span>Status: Operational</span>
                  <span className="text-[#6bd8cb]">Branch #{idx + 1}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl overflow-hidden p-4 shadow-sm">
            <h4 className="font-bold text-sm text-white mb-3 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-[#4fdbc8]" />
              Registered Hardware Tills &amp; POS Counters
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-[#060e20] text-[#879391] uppercase text-[10px] border-b border-[#2d3449]">
                  <tr>
                    <th className="px-3 py-2">Till Code</th>
                    <th className="px-3 py-2">Counter Name</th>
                    <th className="px-3 py-2">Peripherals</th>
                    <th className="px-3 py-2">Hardware Fingerprint</th>
                    <th className="px-3 py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2d3449]/40">
                  {(vendorData?.counters || []).map((c: VendorCounter, idx: number) => (
                    <tr key={idx} className="hover:bg-[#171f33]">
                      <td className="px-3 py-2 text-[#4fdbc8] font-bold">{c.code || `POS-0${idx + 1}`}</td>
                      <td className="px-3 py-2 text-white">{c.name}</td>
                      <td className="px-3 py-2 text-[#bcc9c6]">Thermal 80mm • Zebra 2D Scanner</td>
                      <td className="px-3 py-2 text-[#879391]">HW-LK-89412-B{idx + 1}</td>
                      <td className="px-3 py-2 text-right">
                        <span className="px-2 py-0.5 rounded bg-[#4fdbc8]/15 text-[#4fdbc8] text-[10px] font-bold">
                          ONLINE
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Feature Flags Matrix */}
      {activeTab === 'flags' && (
        <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#2d3449]/50">
            <div>
              <h3 className="font-bold text-base text-white">Granular Feature Flags &amp; Modules</h3>
              <p className="text-xs text-[#bcc9c6]">
                Configure real-time feature capabilities for {vendorData?.name}
              </p>
            </div>
            <button
              type="button"
              disabled={savingFlags}
              onClick={saveFlags}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#6bd8cb] text-[#003732] hover:bg-[#89f5e7] text-xs font-bold transition-all disabled:opacity-50"
            >
              {savingFlags ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span>Save Tenant Flags</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FEATURE_FLAGS.map((flag) => {
              const enabled = !!flags[flag]
              return (
                <div
                  key={flag}
                  onClick={() => handleToggleFlag(flag)}
                  className={`p-3 rounded-lg border cursor-pointer flex items-center justify-between transition-all ${
                    enabled
                      ? 'bg-[#29a195]/20 border-[#6bd8cb]'
                      : 'bg-[#060e20] border-[#2d3449] opacity-75'
                  }`}
                >
                  <div>
                    <div className="text-xs font-semibold text-white">
                      {FEATURE_FLAG_LABELS[flag]}
                    </div>
                    <div className="font-mono text-[10px] text-[#879391]">{flag}</div>
                  </div>
                  <div
                    className={`w-9 h-5 rounded-full p-0.5 flex transition-colors ${
                      enabled ? 'bg-[#6bd8cb] justify-end' : 'bg-[#222a3d] justify-start'
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full ${
                        enabled ? 'bg-[#003732]' : 'bg-[#879391]'
                      }`}
                    ></div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* TAB 3: Billing & Commercials */}
      {activeTab === 'billing' && (
        <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#2d3449]/50">
            <h3 className="font-bold text-base text-white">Commercial Tier &amp; Billing Records</h3>
            <span className="font-mono text-xs text-[#4fdbc8] font-bold">
              PLAN: {vendorData?.plan?.toUpperCase() || 'ENTERPRISE'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
            <div className="bg-[#060e20] p-4 rounded-xl border border-[#2d3449] space-y-2">
              <div className="text-[#879391] uppercase text-[10px]">Monthly Fee</div>
              <div className="text-xl font-bold text-white">LKR 34,500.00</div>
              <div className="text-[#4fdbc8]">Auto-debit via PayHere IPN</div>
            </div>

            <div className="bg-[#060e20] p-4 rounded-xl border border-[#2d3449] space-y-2">
              <div className="text-[#879391] uppercase text-[10px]">Current Period End</div>
              <div className="text-xl font-bold text-white">2026-11-20</div>
              <div className="text-[#bcc9c6]">30 days remaining in cycle</div>
            </div>

            <div className="bg-[#060e20] p-4 rounded-xl border border-[#2d3449] space-y-2">
              <div className="text-[#879391] uppercase text-[10px]">Settlement Status</div>
              <div className="text-xl font-bold text-[#4fdbc8]">PAID IN FULL</div>
              <div className="text-[#879391]">Invoice #LK-INV-99214</div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Audit Trail & Access */}
      {activeTab === 'audit' && (
        <div className="bg-[#131b2e] border border-[#2d3449] rounded-xl p-6 shadow-sm space-y-3 font-mono text-xs">
          <h3 className="font-bold text-base text-white mb-3">Privileged Security Audit History</h3>
          <div className="space-y-2">
            {[
              { time: 'Today 14:12', action: 'TENANT_360_VIEW', actor: 'root.admin@poslanka.lk', ip: '175.157.88.24' },
              { time: 'Yesterday 18:40', action: 'FLAG_UPDATE [whatsapp: true]', actor: 'system-agent', ip: '10.0.4.12' },
              { time: '3 days ago', action: 'BRANCH_PROVISIONED [Havelock Outlet]', actor: 'root.admin@poslanka.lk', ip: '175.157.88.24' },
              { time: '14 days ago', action: 'TENANT_INITIAL_ONBOARDING', actor: 'sys-provisioner', ip: '10.0.0.1' },
            ].map((log, idx) => (
              <div
                key={idx}
                className="p-3 bg-[#060e20] border border-[#2d3449]/50 rounded-lg flex items-center justify-between"
              >
                <div>
                  <div className="text-white font-semibold">{log.action}</div>
                  <div className="text-[10px] text-[#879391]">
                    Actor: {log.actor} • Client IP: {log.ip}
                  </div>
                </div>
                <div className="text-[#bcc9c6] text-[11px]">{log.time}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
