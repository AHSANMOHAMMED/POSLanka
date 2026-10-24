'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Activity,
  Bell,
  Bug,
  ChevronDown,
  CreditCard,
  FileText,
  LayoutDashboard,
  Layers,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  MessagesSquare,
  Monitor,
  Moon,
  PlusCircle,
  Receipt,
  Search,
  Settings,
  Store,
  Sun,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useTheme } from '@/components/providers/ThemeProvider'
import { cn } from '@/lib/utils'
import { AdminSessionTimer, signOutAdmin } from './AdminSessionTimer'
import { AdminHealthProvider, useAdminHealth } from './AdminHealth'
import { StatusDot } from './kit'
import { LogoMark } from './kit/LogoMark'
import { BrandWordmark } from '@/components/ui/logo'
import { AdminRoleProvider, useAdminRole } from './AdminRoleContext'
import { adminCan, ADMIN_ROLE_LABELS, type AdminPermission, type AdminRole } from '@/lib/admin/roles'

interface SuperAdminLayoutShellProps {
  children: React.ReactNode
  adminEmail?: string
  adminName?: string
  adminRole: AdminRole
}

interface NavLink {
  label: string
  href: string
  icon: LucideIcon
  exact?: boolean
  sub?: boolean
  badgeKey?: 'errors'
  /** hidden when the admin's role lacks this permission */
  need?: AdminPermission
}

const NAV: Array<{ group: string; links: NavLink[] }> = [
  {
    group: 'Platform',
    links: [
      { label: 'Overview', href: '/sys-control', icon: LayoutDashboard, exact: true },
      { label: 'Live sales', href: '/sys-control/sales-wall', icon: Activity },
      { label: 'Vendors', href: '/sys-control/vendors', icon: Store },
      { label: 'New vendor', href: '/sys-control/vendors/create', icon: PlusCircle, sub: true, need: 'vendors.manage' },
      { label: 'Platform users', href: '/sys-control/users', icon: Users },
    ],
  },
  {
    group: 'Billing',
    links: [
      { label: 'Subscriptions', href: '/sys-control/subscriptions', icon: Receipt },
      { label: 'Payments', href: '/sys-control/payments', icon: CreditCard },
      { label: 'Plans & pricing', href: '/sys-control/pricing', icon: Layers },
      { label: 'SMS & WhatsApp', href: '/sys-control/messaging', icon: MessagesSquare },
    ],
  },
  {
    group: 'Support & system',
    links: [
      { label: 'Messages', href: '/sys-control/messages', icon: MessageSquare },
      { label: 'Notifications', href: '/sys-control/notifications', icon: Bell },
      { label: 'Send email', href: '/sys-control/send-email', icon: Mail },
      { label: 'Audit log', href: '/sys-control/audit-logs', icon: FileText },
      { label: 'Error log', href: '/sys-control/error-logs', icon: Bug, badgeKey: 'errors' },
      { label: 'Settings', href: '/sys-control/settings', icon: Settings },
    ],
  },
]

function isActive(pathname: string, link: NavLink) {
  if (link.exact) return pathname === link.href
  if (link.href === '/sys-control/vendors' && pathname.startsWith('/sys-control/vendors/create')) return false
  return pathname === link.href || pathname.startsWith(`${link.href}/`)
}

export function SuperAdminLayoutShell(props: SuperAdminLayoutShellProps) {
  return (
    <AdminRoleProvider role={props.adminRole}>
      <AdminHealthProvider>
        <ShellInner {...props} />
      </AdminHealthProvider>
    </AdminRoleProvider>
  )
}

function ShellInner({ children, adminEmail, adminName }: SuperAdminLayoutShellProps) {
  const pathname = usePathname()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [mobileSearch, setMobileSearch] = useState(false)

  // Close the drawer whenever the route changes
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    setDrawerOpen(false)
    setMobileSearch(false)
  }

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [drawerOpen])

  return (
    <div className="adm-root min-h-[100dvh]">
      <a href="#admin-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-md focus:bg-adm-surface focus:px-3 focus:py-2 focus:text-adm-fg">
        Skip to content
      </a>

      {/* Drawer backdrop (< lg) */}
      {drawerOpen && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setDrawerOpen(false)} aria-hidden />}

      <Sidebar pathname={pathname} open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <div className="min-w-0 lg:pl-[248px]">
        <header className="sticky top-0 z-30 border-b border-adm-border bg-adm-surface/95 backdrop-blur supports-[backdrop-filter]:bg-adm-surface/80">
          <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-5 lg:px-6">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              className="adm-focus flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-adm-muted hover:bg-adm-surface-2 hover:text-adm-fg lg:hidden"
            >
              <Menu size={20} aria-hidden />
            </button>
            <Link href="/sys-control" className="flex shrink-0 items-center gap-2 lg:hidden" aria-label="skyERPOS admin home">
              <LogoMark size={26} />
              <span className="hidden text-[15px] font-semibold text-adm-fg min-[420px]:inline">Admin</span>
            </Link>

            <div className="hidden min-w-0 flex-1 sm:block sm:max-w-md">
              <VendorSearch />
            </div>
            <div className="flex-1" />

            <button
              type="button"
              onClick={() => setMobileSearch((v) => !v)}
              aria-label="Search vendors"
              aria-expanded={mobileSearch}
              className="adm-focus flex h-9 w-9 items-center justify-center rounded-lg text-adm-muted hover:bg-adm-surface-2 hover:text-adm-fg sm:hidden"
            >
              {mobileSearch ? <X size={18} aria-hidden /> : <Search size={18} aria-hidden />}
            </button>
            <HealthPill />
            <AdminSessionTimer className="hidden md:inline-flex" />
            <ThemeToggle />
            <UserMenu email={adminEmail} name={adminName} />
          </div>
          {mobileSearch && (
            <div className="border-t border-adm-border px-3 py-2.5 sm:hidden">
              <VendorSearch autoFocus />
            </div>
          )}
        </header>

        <main id="admin-main" className="min-w-0 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- Sidebar */

function Sidebar({ pathname, open, onClose }: { pathname: string; open: boolean; onClose: () => void }) {
  const { health } = useAdminHealth()
  const role = useAdminRole()
  return (
    <aside
      aria-label="Admin navigation"
      className={cn(
        'fixed inset-y-0 left-0 z-50 flex w-[272px] max-w-[85vw] flex-col border-r border-adm-sidebar-border bg-adm-sidebar text-adm-sidebar-fg transition-transform duration-200 lg:z-40 lg:w-[248px] lg:translate-x-0',
        open ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
      )}
    >
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-adm-sidebar-border px-4">
        <Link href="/sys-control" className="flex items-center gap-2.5">
          <BrandWordmark height={30} onDark />
          <span className="text-[11.5px] leading-tight text-adm-sidebar-muted">Platform<br />admin</span>
        </Link>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close navigation"
          className="flex h-8 w-8 items-center justify-center rounded-md text-adm-sidebar-muted hover:bg-white/5 hover:text-white lg:hidden"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      <nav className="adm-scroll flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {NAV.map((section) => (
          <div key={section.group}>
            <p className="px-2.5 pb-1.5 text-[11.5px] font-medium text-adm-sidebar-muted">{section.group}</p>
            <ul className="space-y-0.5">
              {section.links.filter((link) => !link.need || adminCan(role, link.need)).map((link) => {
                const active = isActive(pathname, link)
                const Icon = link.icon
                const badge = link.badgeKey === 'errors' && health && health.errors24h > 0 ? health.errors24h : null
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-300',
                        link.sub && 'pl-8 text-[13px]',
                        active
                          ? 'bg-adm-sidebar-active font-medium text-adm-sidebar-active-fg'
                          : 'text-adm-sidebar-fg hover:bg-white/[0.05] hover:text-white'
                      )}
                    >
                      <Icon size={link.sub ? 15 : 17} aria-hidden className={active ? '' : 'text-adm-sidebar-muted'} />
                      <span className="flex-1 truncate">{link.label}</span>
                      {badge !== null && (
                        <span className="rounded-full bg-red-500/20 px-1.5 text-[11px] font-semibold leading-5 text-red-300" title="Unresolved errors in the last 24 hours">
                          {badge > 99 ? '99+' : badge}
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-adm-sidebar-border px-4 py-3 text-[12px] text-adm-sidebar-muted">
        {health ? (
          <span>
            Version {health.appVersion} · <span className="capitalize">{health.environment}</span>
          </span>
        ) : (
          <span>&nbsp;</span>
        )}
      </div>
    </aside>
  )
}

/* ---------------------------------------------------------------- Health pill */

function HealthPill() {
  const { health, error } = useAdminHealth()
  const degraded = error || (health && health.status !== 'ok')
  const label = !health && !error ? 'Checking…' : degraded ? 'Degraded' : 'Operational'
  return (
    <Link
      href="/sys-control#platform-health"
      title={
        health
          ? `Database ${health.database.latencyMs ?? '—'} ms · ${health.vendors.activeNow} vendors active in the last ${health.vendors.windowMinutes} min`
          : 'Platform health'
      }
      className="adm-focus hidden h-8 items-center gap-2 rounded-lg border border-adm-border px-2.5 text-[12.5px] text-adm-muted hover:bg-adm-surface-2 md:inline-flex"
    >
      <StatusDot tone={!health && !error ? 'neutral' : degraded ? 'danger' : 'success'} />
      <span className="font-medium text-adm-fg">{label}</span>
      {health?.database.latencyMs != null && (
        <span className="adm-num hidden xl:inline">DB {health.database.latencyMs} ms</span>
      )}
      {health && (
        <span className="adm-num hidden xl:inline">· {health.vendors.activeNow} active now</span>
      )}
    </Link>
  )
}

/* ---------------------------------------------------------------- Theme toggle */

const noopSubscribe = () => () => {}

function ThemeToggle() {
  const { theme: storedTheme, setTheme, resolvedTheme } = useTheme()
  // Theme is read from localStorage on the client only; render as "system" (what the server
  // renders) until hydrated so the icon, title and aria-label match the server HTML.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const theme = mounted ? storedTheme : 'system'
  const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
  const Icon = !mounted || theme === 'system' ? Monitor : resolvedTheme === 'dark' ? Moon : Sun
  const label = theme === 'system' ? 'System theme' : theme === 'dark' ? 'Dark theme' : 'Light theme'
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`${label} — click for ${next}`}
      aria-label={`${label}. Switch to ${next} theme`}
      className="adm-focus flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-adm-muted hover:bg-adm-surface-2 hover:text-adm-fg"
    >
      <Icon size={18} aria-hidden />
    </button>
  )
}

/* ---------------------------------------------------------------- User menu */

function UserMenu({ email, name }: { email?: string; name?: string }) {
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const role = useAdminRole()
  const display = name || email || 'Super admin'
  const initials = display
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="adm-focus flex h-9 items-center gap-2 rounded-lg pl-1 pr-1.5 hover:bg-adm-surface-2"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-adm-primary text-[12px] font-semibold text-adm-primary-fg">
          {initials || 'SA'}
        </span>
        <ChevronDown size={15} className="hidden text-adm-subtle sm:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="adm-fade-in absolute right-0 top-11 z-50 w-64 rounded-xl border border-adm-border bg-adm-surface p-1.5 shadow-[var(--adm-shadow-lg)]">
          <div className="px-2.5 py-2">
            <p className="truncate text-[13.5px] font-medium text-adm-fg">{name || 'Super admin'}</p>
            {email && <p className="truncate text-[12.5px] text-adm-muted">{email}</p>}
            <p className="mt-0.5 text-[12px] text-adm-subtle">Role: {ADMIN_ROLE_LABELS[role]}</p>
          </div>
          <div className="my-1 h-px bg-adm-border" />
          <Link
            role="menuitem"
            href="/sys-control/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] text-adm-fg hover:bg-adm-surface-2"
          >
            <Settings size={16} className="text-adm-muted" aria-hidden /> Settings &amp; two-factor
          </Link>
          <button
            role="menuitem"
            type="button"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true)
              signOutAdmin()
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-adm-danger hover:bg-adm-danger-soft disabled:opacity-60"
          >
            <LogOut size={16} aria-hidden /> {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- Vendor search */

interface VendorHit {
  id: string
  name: string
  slug: string
  status: string
}

function VendorSearch({ autoFocus }: { autoFocus?: boolean }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<VendorHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // "/" focuses the search (desktop)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) return
    const ctrl = new AbortController()
    const t = window.setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/sys-control/vendors?q=${encodeURIComponent(term)}&pageSize=6`, { signal: ctrl.signal })
        if (res.ok) {
          const data = await res.json()
          setHits((data.vendors || []).map((v: VendorHit) => ({ id: v.id, name: v.name, slug: v.slug, status: v.status })))
          setActive(0)
        }
      } catch {
        // aborted / network — keep previous hits
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => {
      ctrl.abort()
      window.clearTimeout(t)
    }
  }, [q])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const go = useCallback(
    (hit: VendorHit) => {
      setOpen(false)
      setQ('')
      router.push(`/sys-control/vendors/${hit.id}`)
    },
    [router]
  )

  const showList = open && q.trim().length >= 2
  return (
    <div ref={boxRef} className="relative w-full">
      <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-adm-subtle" />
      <input
        ref={inputRef}
        type="search"
        // Autofill / temp-mail extensions add style and data-* attributes before React hydrates
        suppressHydrationWarning
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!showList || hits.length === 0) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          if (e.key === 'Enter') { e.preventDefault(); go(hits[active]) }
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Find a vendor by name, Business ID or email"
        aria-label="Find a vendor"
        role="combobox"
        aria-expanded={showList}
        aria-controls="vendor-search-results"
        aria-autocomplete="list"
        className="adm-input block w-full adm-input--sm adm-input--icon-left adm-input--icon-right"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-adm-border bg-adm-surface-2 px-1.5 text-[11px] leading-5 text-adm-subtle lg:block">/</kbd>
      {showList && (
        <div id="vendor-search-results" role="listbox" className="adm-fade-in absolute left-0 right-0 top-10 z-50 overflow-hidden rounded-xl border border-adm-border bg-adm-surface shadow-[var(--adm-shadow-lg)]">
          {loading && hits.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-adm-muted">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-adm-muted">No vendors match “{q.trim()}”.</p>
          ) : (
            <ul className="py-1">
              {hits.map((h, i) => (
                <li key={h.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(h)}
                    className={cn('flex w-full items-center justify-between gap-3 px-3 py-2 text-left', i === active && 'bg-adm-surface-2')}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium text-adm-fg">{h.name}</span>
                      <span className="block truncate text-[12px] text-adm-subtle">/c/{h.slug}</span>
                    </span>
                    {h.status !== 'active' && <span className="text-[12px] capitalize text-adm-warning">{h.status}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
