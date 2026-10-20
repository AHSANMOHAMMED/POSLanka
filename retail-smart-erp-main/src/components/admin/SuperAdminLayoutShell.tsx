'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Shield,
  AlertTriangle,
  Lock,
  Search,
  Activity,
  Store,
  Users,
  CreditCard,
  Receipt,
  ToggleLeft,
  FileText,
  Radio,
  Settings,
  PlusCircle,
  Eye,
  LogOut,
  Bell,
  Mail,
  Bug,
  type LucideIcon,
} from 'lucide-react'
import { AdminSessionTimer } from './AdminSessionTimer'

interface SuperAdminLayoutShellProps {
  children: React.ReactNode
  adminEmail?: string
}

interface NavLink {
  label: string
  href: string
  icon: LucideIcon
  exact?: boolean
  pulse?: boolean
  badge?: string
  sub?: boolean
}

interface NavGroup {
  group: string
  links: NavLink[]
}

export function SuperAdminLayoutShell({ children, adminEmail }: SuperAdminLayoutShellProps) {
  const pathname = usePathname()
  const [lockdownOpen, setLockdownOpen] = useState(false)
  const [quickImpersonateOpen, setQuickImpersonateOpen] = useState(false)
  const [impersonateSlug, setImpersonateSlug] = useState('')

  const navItems: NavGroup[] = [
    {
      group: 'Operational Rails',
      links: [
        { label: 'Overview', href: '/sys-control', icon: Activity, exact: true },
        { label: 'Live Sales Wall', href: '/sys-control/sales-wall', icon: Radio, pulse: true },
        { label: 'Vendors & Tenants', href: '/sys-control/vendors', icon: Store },
        { label: 'Provision Tenant', href: '/sys-control/vendors/create', icon: PlusCircle, sub: true },
        { label: 'Platform Users', href: '/sys-control/users', icon: Users },
      ],
    },
    {
      group: 'Settlement & Control',
      links: [
        { label: 'Subscriptions & Billing', href: '/sys-control/subscriptions', icon: Receipt },
        { label: 'Payments & PayHere', href: '/sys-control/payments', icon: CreditCard },
        { label: 'Feature Matrix & Flags', href: '/sys-control/pricing', icon: ToggleLeft },
      ],
    },
    {
      group: 'Deep Infrastructure',
      links: [
        { label: 'Audit Logs', href: '/sys-control/audit-logs', icon: FileText },
        { label: 'Error Logs', href: '/sys-control/error-logs', icon: Bug },
        { label: 'Broadcasts & Support', href: '/sys-control/messages', icon: Radio },
        { label: 'Notifications', href: '/sys-control/notifications', icon: Bell },
        { label: 'Send Email', href: '/sys-control/send-email', icon: Mail },
        { label: 'Platform Settings', href: '/sys-control/settings', icon: Settings },
      ],
    },
  ]

  const isLinkActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    if (href === '/sys-control/vendors' && pathname.startsWith('/sys-control/vendors/create')) return false
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  return (
    <div className="min-h-screen bg-[#0b1326] text-[#dae2fd] antialiased">
      {/* 36px Top Security Elevation Stripe (Stitch S2 Standard) */}
      <div className="fixed top-0 left-0 right-0 z-50 h-9 bg-[#93000a]/90 backdrop-blur-md border-b border-[#ff5451]/40 px-4 flex items-center justify-between text-[#ffdad6] shadow-[0_1px_8px_rgba(0,0,0,0.5)]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#ff5451] animate-ping"></span>
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-white">
              [SUPER ADMIN: STRICT AUDIT ENCLAVE]
            </span>
          </div>
          <span className="text-[#ffdad6]/40 hidden sm:inline">|</span>
          <span className="font-mono text-[11px] text-[#ffdad6]/80 hidden sm:inline">
            AUDIT ID: <strong className="text-white">LK-SYS-9942-SEC</strong>
          </span>
          <span className="text-[#ffdad6]/40 hidden md:inline">|</span>
          <span className="font-mono text-[11px] text-[#ffdad6]/80 hidden md:inline">
            IP: <strong className="text-white">124.43.19.78 (SLT Telecom LK)</strong>
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#ffdad6]">
            <AdminSessionTimer />
          </div>
          <button
            type="button"
            onClick={() => setLockdownOpen(true)}
            className="flex items-center gap-1 px-2.5 py-0.5 rounded bg-[#ff5451] hover:bg-[#ff897d] text-[#690005] font-bold text-[11px] uppercase tracking-wider transition-colors shadow-sm"
          >
            <Lock className="w-3 h-3" />
            <span>Emergency Lockdown</span>
          </button>
        </div>
      </div>

      {/* Global Header (Top 9 to 23, Height 14 / 56px) */}
      <header className="fixed top-9 left-64 right-0 h-14 bg-[#131b2e]/95 backdrop-blur-xl border-b border-[#2d3449]/80 z-30 px-6 flex items-center justify-between">
        {/* Search */}
        <div className="relative w-80 lg:w-96">
          <Search className="absolute left-3 top-2.5 text-[#879391] w-4 h-4 pointer-events-none" />
          <input
            type="text"
            placeholder="Query vendors, users, receipts, trace_ids... (⌘K)"
            className="w-full pl-9 pr-12 py-1.5 bg-[#060e20] border border-[#2d3449] rounded-lg text-white font-mono text-xs placeholder:text-[#879391] focus:border-[#6bd8cb] focus:ring-1 focus:ring-[#6bd8cb] outline-none transition-all"
          />
          <span className="absolute right-2 top-2 px-1.5 py-0.5 rounded bg-[#222a3d] text-[#bcc9c6] font-mono text-[10px]">
            ⌘K
          </span>
        </div>

        {/* Telemetry Status Pills */}
        <div className="flex items-center gap-4">
          <div className="hidden xl:flex items-center gap-2 font-mono text-[11px] px-3 py-1 rounded-full bg-[#171f33] border border-[#2d3449]">
            <div className="flex items-center gap-1.5 text-[#4fdbc8]">
              <span className="w-2 h-2 rounded-full bg-[#4fdbc8] animate-pulse"></span>
              99.98% Uptime
            </div>
            <span className="text-[#3d4947]">•</span>
            <span className="text-[#bcc9c6]">42ms p95</span>
          </div>

          <div className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#171f33] border border-[#2d3449] text-xs">
            <Store className="w-3.5 h-3.5 text-[#6bd8cb]" />
            <span className="text-white font-semibold">142</span>
            <span className="text-[#bcc9c6]">Vendors Online</span>
          </div>

          <button
            type="button"
            onClick={() => setQuickImpersonateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-[#2d3449] bg-[#171f33] hover:bg-[#222a3d] text-white text-xs font-medium transition-colors"
          >
            <Eye className="w-3.5 h-3.5 text-[#4fdbc8]" />
            <span>Quick Impersonate</span>
          </button>

          <div className="h-6 w-px bg-[#2d3449]"></div>

          {/* User Profile Badge */}
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-[12px] font-bold text-white leading-tight">SUPER ADMIN ROOT</div>
              <div className="font-mono text-[10px] text-[#6bd8cb] tracking-wider">
                {adminEmail || 'SEC_LVL_0_ESC'}
              </div>
            </div>
            <div className="w-8 h-8 rounded-full bg-[#6bd8cb] text-[#003732] flex items-center justify-center font-bold text-xs ring-2 ring-[#6bd8cb]/30">
              <Shield className="w-4 h-4" />
            </div>
            <form action="/api/sys-control/auth/logout" method="POST">
              <button
                type="submit"
                title="Sign out of Super Admin"
                className="p-1.5 rounded-lg text-[#879391] hover:text-[#ffb4ab] hover:bg-[#93000a]/20 transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Dark Sidebar Navigation (Fixed left, top 9, bottom 0, width 64 / 256px) */}
      <aside className="fixed left-0 top-9 bottom-0 w-64 bg-[#060e20] border-r border-[#2d3449]/70 flex flex-col z-40 shadow-xl">
        {/* Brand Header */}
        <div className="p-4 border-b border-[#2d3449]/50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#29a195] text-[#00302b] flex items-center justify-center font-bold text-base shadow-sm">
              P
            </div>
            <div>
              <div className="font-bold text-sm tracking-tight text-white flex items-center gap-1.5">
                POSLanka
                <span className="font-mono text-[9px] bg-[#6bd8cb]/20 text-[#6bd8cb] px-1 rounded">
                  v4.8
                </span>
              </div>
              <div className="font-mono text-[10px] text-[#879391] uppercase tracking-wider">
                SYS-CONTROL CORE
              </div>
            </div>
          </div>
          <span className="font-mono text-[10px] bg-[#222a3d] text-[#6bd8cb] px-1.5 py-0.5 rounded font-semibold">
            LK-HQ
          </span>
        </div>

        {/* Tenant Cluster Identifier */}
        <div className="px-4 py-2 bg-[#131b2e]/60 border-b border-[#2d3449]/40 flex items-center justify-between">
          <span className="font-mono text-[10px] text-[#879391] uppercase tracking-wider">
            TENANT CLUSTER
          </span>
          <span className="font-mono text-[11px] text-[#4fdbc8] font-bold">LK-CENTRAL-1</span>
        </div>

        {/* Navigation Sections */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {navItems.map((section, idx) => (
            <div key={idx} className="space-y-1">
              <div className="px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-[#879391] font-semibold">
                {section.group}
              </div>
              <div className="space-y-0.5">
                {section.links.map((link, lIdx) => {
                  const active = isLinkActive(link.href, link.exact)
                  const Icon = link.icon
                  return (
                    <Link
                      key={lIdx}
                      href={link.href}
                      className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        active
                          ? 'bg-[#29a195] text-[#00302b] font-bold shadow-sm'
                          : 'text-[#bcc9c6] hover:bg-[#171f33] hover:text-white'
                      } ${link.sub ? 'pl-6 text-[11px]' : ''}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className={`w-4 h-4 ${active ? 'text-[#00302b]' : 'text-[#879391]'}`} />
                        <span>{link.label}</span>
                      </div>
                      {link.pulse && (
                        <span className="w-2 h-2 rounded-full bg-[#6bd8cb] animate-pulse"></span>
                      )}
                      {link.badge && (
                        <span
                          className={`font-mono text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                            active
                              ? 'bg-[#00302b] text-[#6bd8cb]'
                              : 'bg-[#171f33] text-[#4fdbc8] border border-[#2d3449]'
                          }`}
                        >
                          {link.badge}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Cluster Health Footer */}
        <div className="p-3.5 border-t border-[#2d3449]/70 bg-[#131b2e]/80">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-mono text-[10px] text-[#879391] uppercase tracking-wider">
              CLUSTER HEALTH
            </span>
            <span className="font-mono text-[11px] text-[#4fdbc8] font-bold">NOMINAL 94%</span>
          </div>
          <div className="w-full bg-[#222a3d] h-1.5 rounded-full overflow-hidden">
            <div className="bg-[#4fdbc8] h-full w-[94%]"></div>
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-[9px] text-[#879391]">
            <span>SL-CENTRAL POOL</span>
            <span>42ms AVG</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area (Offset for top stripe 36px + header 56px = 92px, left sidebar 256px) */}
      <div className="pl-64 pt-[92px] min-h-screen">
        <main className="max-w-[1720px] mx-auto p-6">{children}</main>
      </div>

      {/* Emergency Lockdown Confirmation Modal */}
      {lockdownOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#171f33] border-2 border-[#ff5451] rounded-xl max-w-lg w-full p-6 text-left shadow-2xl">
            <div className="flex items-center gap-3 text-[#ff5451] mb-3">
              <AlertTriangle className="w-7 h-7 flex-shrink-0 animate-bounce" />
              <div>
                <h3 className="font-bold text-lg text-white">TRIGGER EMERGENCY LOCKDOWN</h3>
                <p className="font-mono text-xs text-[#ffb4ab]">SYSTEM-WIDE LEVEL-0 ISOLATION</p>
              </div>
            </div>
            <p className="text-xs text-[#dae2fd] mb-4 leading-relaxed">
              This action terminates all active tenant sessions, restricts API endpoints to read-only mode, and freezes live transaction settling until the cryptographic dual-keyholder restoration runbook is completed.
            </p>
            <div className="bg-[#060e20] p-3 rounded-lg border border-[#3d4947] font-mono text-xs text-[#bcc9c6] mb-5 space-y-1">
              <div>AFFECTED: 142 Active Tenants • 486 Connected Tills</div>
              <div>FIREWALL: Cloudflare Zero Trust Shield Level MAXIMUM</div>
              <div className="text-[#ff5451] font-bold">CONFIRMATION TOKEN: LK-LOCKDOWN-ARMED</div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setLockdownOpen(false)}
                className="px-4 py-2 rounded-lg bg-[#222a3d] text-white hover:bg-[#2d3449] text-xs font-semibold"
              >
                Cancel / Abort
              </button>
              <button
                type="button"
                onClick={() => {
                  alert('Emergency Lockdown Command Dispatched to all Colombo-1 Cluster Gateways.')
                  setLockdownOpen(false)
                }}
                className="px-4 py-2 rounded-lg bg-[#ff5451] text-white hover:bg-[#93000a] text-xs font-bold shadow-lg"
              >
                Execute System Lockdown
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Impersonate Modal */}
      {quickImpersonateOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#171f33] border border-[#2d3449] rounded-xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-[#6bd8cb] mb-4">
              <Eye className="w-6 h-6 flex-shrink-0" />
              <div>
                <h3 className="font-bold text-base text-white">Quick Vendor Impersonation</h3>
                <p className="text-xs text-[#bcc9c6]">Enter vendor slug to establish tenant context</p>
              </div>
            </div>
            <div className="space-y-3 mb-5">
              <input
                type="text"
                placeholder="e.g. keells-super or cargills"
                value={impersonateSlug}
                onChange={(e) => setImpersonateSlug(e.target.value)}
                className="w-full bg-[#060e20] border border-[#2d3449] rounded-lg px-3 py-2 text-white font-mono text-sm placeholder:text-[#879391] focus:border-[#6bd8cb] outline-none"
              />
              <div className="text-[11px] text-[#879391]">
                Quick jumps:
                <button
                  type="button"
                  onClick={() => setImpersonateSlug('demo-store')}
                  className="ml-2 text-[#4fdbc8] underline"
                >
                  demo-store
                </button>
                <button
                  type="button"
                  onClick={() => setImpersonateSlug('main-retail')}
                  className="ml-2 text-[#4fdbc8] underline"
                >
                  main-retail
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setQuickImpersonateOpen(false)}
                className="px-4 py-2 rounded-lg bg-[#222a3d] text-white hover:bg-[#2d3449] text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (impersonateSlug) {
                    window.location.href = `/c/${impersonateSlug}/pos`
                  }
                }}
                className="px-4 py-2 rounded-lg bg-[#6bd8cb] text-[#003732] hover:bg-[#89f5e7] text-xs font-bold"
              >
                Launch Context →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
