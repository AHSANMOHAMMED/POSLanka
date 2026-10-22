'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import {
  Menu, HelpCircle, ChevronDown, LogOut, Settings, User,
  Keyboard, Info, Bug, Search, X, MoreVertical, Home, MessageCircle,
  Grid3X3,
} from 'lucide-react'
import { useBreakpoint } from '@/hooks/useResponsive'
import { BugReportModal } from '@/components/modals/BugReportModal'
import { useSidebar } from './Sidebar'
import { GlobalSearch } from './GlobalSearch'
import { ConnectionDot } from '@/components/ui/connection-status'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { CompanySwitcher } from './CompanySwitcher'
import { LanguageSwitcher } from './LanguageSwitcher'
import { broadcastAuthEvent } from '@/lib/auth/events'
import { Logo } from '@/components/ui/logo'
import { AlertBell } from './AlertBell'
import { InboxBell } from '@/components/notifications/InboxBell'
import { useChatStore } from '@/lib/stores/chat-store'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import { MODULE_TABS, getModuleFromPathname, getModuleTabHref, isModuleTabVisible } from '@/lib/navigation/module-sidebar'
import { useModuleAccess } from '@/hooks/useModuleAccess'
import { useFeatureFlags } from '@/hooks/useFeatureFlag'
import { isModuleAllowedByFeatures } from '@/lib/features/nav-gate'
import { getTerms } from '@/lib/terminology'
import { ICON_MAP } from '@/components/workspace/icon-map'
import { cn } from '@/lib/utils'

interface NavbarProps {
  tenantName: string
  userEmail: string
  appVersion?: string
  companySlug: string
}

export function Navbar({ tenantName, userEmail, appVersion, companySlug }: NavbarProps) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const company = useCompanyOptional()
  const { mobileOpen, setMobileOpen } = useSidebar()
  const { isModuleEnabled } = useModuleAccess()
  const { flags } = useFeatureFlags()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [helpMenuOpen, setHelpMenuOpen] = useState(false)
  const [bugReportOpen, setBugReportOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [appSwitcherOpen, setAppSwitcherOpen] = useState(false)
  const [searchExpanded, setSearchExpanded] = useState(false)
  const chatStore = useChatStore()
  const userMenuRef = useRef<HTMLDivElement>(null)
  const helpMenuRef = useRef<HTMLDivElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const appSwitcherRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isDesktop = useBreakpoint('lg', 'up')
  const isCompact = !isDesktop

  const businessType = company?.businessType || session?.user?.businessType
  const t = getTerms(businessType)
  const basePath = `/c/${companySlug}`
  const currentModule = getModuleFromPathname(pathname, businessType)

  // Close menus on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false)
      }
      if (helpMenuRef.current && !helpMenuRef.current.contains(event.target as Node)) {
        setHelpMenuOpen(false)
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setMobileMenuOpen(false)
      }
      if (appSwitcherRef.current && !appSwitcherRef.current.contains(event.target as Node)) {
        setAppSwitcherOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Keyboard shortcut: Ctrl+Shift+B to open bug report
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.shiftKey && e.key === 'B') {
        e.preventDefault()
        setBugReportOpen(true)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Focus search input when expanded on compact mode
  useEffect(() => {
    if (searchExpanded && searchInputRef.current && isCompact) {
      searchInputRef.current.focus()
    }
  }, [searchExpanded, isCompact])

  // Persist theme change to API
  const handleThemeChange = useCallback((theme: 'light' | 'dark' | 'system') => {
    fetch('/api/account/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    }).catch(() => {})
  }, [])

  function handleMobileToggle() {
    setMobileOpen(!mobileOpen)
  }

  function handleMobileMenuToggle() {
    setMobileMenuOpen(!mobileMenuOpen)
  }

  function handleSearchToggle() {
    if (isCompact) {
      setSearchExpanded(!searchExpanded)
      if (!searchExpanded && searchInputRef.current) {
        setTimeout(() => searchInputRef.current?.focus(), 100)
      }
    }
  }

  // User initials for avatar
  const userName = session?.user?.name || ''
  const userInitials = userName
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?'

  // Module tab label overrides based on business type
  const moduleTabLabelOverrides: Record<string, string> = {
    stock: t.stockModule,
    selling: t.sellingModule,
  }

  const userRole = session?.user?.role

  // Filter tabs based on business type, permissions, module access, and platform feature flags
  const visibleTabs = MODULE_TABS.filter((tab) => {
    if (!isModuleAllowedByFeatures(tab.key, flags)) return false
    return isModuleTabVisible(tab, businessType, userRole, isModuleEnabled)
  }).map((tab) => ({
    ...tab,
    href: getModuleTabHref(tab, userRole),
    label: moduleTabLabelOverrides[tab.key] || tab.label,
  }))

  // Current module label for the navbar
  const currentModuleLabel = visibleTabs.find(t => t.key === currentModule)?.label || 'Dashboard'

  // Mobile menu items
  interface MobileMenuItemBase {
    label: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icon: any
    danger?: boolean
  }

  interface MobileMenuItemWithHref extends MobileMenuItemBase {
    href: string
    onClick?: () => void
  }

  interface MobileMenuItemWithOnClick extends MobileMenuItemBase {
    onClick: () => void
  }

  type MobileMenuItem = MobileMenuItemWithHref | MobileMenuItemWithOnClick

  const mobileMenuItems: MobileMenuItem[] = [
    { label: 'Dashboard', href: `${basePath}/dashboard`, icon: Home },
    { label: 'Staff Chat', onClick: () => chatStore.toggleWidget(), icon: MessageCircle },
    { label: 'Settings', href: `${basePath}/settings`, icon: Settings },
    { label: 'Activity Log', href: `${basePath}/activity-log`, icon: User },
    { label: 'Report Bug', onClick: () => setBugReportOpen(true), icon: Bug },
    { label: 'Help', onClick: () => setHelpMenuOpen(true), icon: HelpCircle },
    { label: 'Logout', onClick: async () => {
      broadcastAuthEvent('logout', 'company')
      await signOut({ redirect: false })
      window.location.href = `${basePath}/login?logout=true`
    }, icon: LogOut, danger: true },
  ]

  return (
    <header
      className="sticky top-0 z-50 h-12 flex items-center shrink-0"
      style={{
        backgroundColor: 'var(--navbar-bg)',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      {/* Left section: Hamburger + Logo + App Switcher + Company */}
      <div className="flex items-center gap-1 shrink-0 px-3">
        {/* Mobile sidebar toggle (below lg) */}
        <button
          type="button"
          onClick={handleMobileToggle}
          className="p-1.5 rounded transition-colors lg:hidden"
          style={{ color: 'var(--navbar-text-muted)' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
          aria-label="Toggle sidebar"
        >
          <Menu size={18} />
        </button>

        {/* App Switcher Button (Odoo hamburger grid) */}
        <div ref={appSwitcherRef} className="relative">
          <button
            type="button"
            onClick={() => setAppSwitcherOpen(!appSwitcherOpen)}
            className="p-1.5 rounded-xl transition-all duration-150 hover:bg-white/10 active:scale-95 hidden lg:flex items-center text-white/80 hover:text-white"
            aria-label="Open app switcher"
          >
            <Grid3X3 size={18} />
          </button>

          {/* App Switcher Dropdown */}
          {appSwitcherOpen && (
            <div className="absolute left-0 top-full mt-1 w-[320px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-50 p-4 animate-dropdown">
              <div className="grid grid-cols-3 gap-1">
                {visibleTabs.map((tab) => {
                  const isActive = currentModule === tab.key
                  const TabIcon = ICON_MAP[tab.icon]
                  return (
                    <Link
                      key={tab.key}
                      href={`${basePath}${tab.href}`}
                      onClick={() => setAppSwitcherOpen(false)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 p-3 rounded transition-colors text-center",
                        isActive
                          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                          : "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                      )}
                    >
                      {TabIcon && <TabIcon size={22} />}
                      <span className="text-xs font-medium leading-tight">{tab.label}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Logo */}
        <Link href={`${basePath}/dashboard`} className="shrink-0">
          <Logo variant="icon" size={28} onDark />
        </Link>

        {/* Company switcher (desktop only) */}
        <div className="hidden lg:flex items-center">
          <LanguageSwitcher />
          <CompanySwitcher currentSlug={companySlug} />
        </div>

        {/* Divider */}
        <div className="h-5 w-px shrink-0 hidden lg:block" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }} />

        {/* Current module name (desktop) */}
        <span className="hidden lg:inline text-[13px] font-medium ml-1" style={{ color: 'var(--navbar-text)' }}>
          {currentModuleLabel}
        </span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right section */}
      <div className="flex items-center gap-0.5 shrink-0 ml-auto px-3">
        {/* Search - Expanded overlay on compact mode */}
        {isCompact && searchExpanded ? (
          <div className="absolute top-0 left-0 right-0 h-12 flex items-center px-3 z-[60]" style={{ backgroundColor: 'var(--navbar-bg)' }}>
            <div className="relative flex-1">
              <Search
                className="absolute left-3 top-1/2 transform -translate-y-1/2"
                size={18}
                style={{ color: 'var(--navbar-text-muted)' }}
              />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search..."
                className="w-full pl-10 pr-10 py-2 text-sm bg-white/10 border border-white/20 rounded text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                onBlur={() => setSearchExpanded(false)}
              />
              <button
                onClick={() => setSearchExpanded(false)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1"
                style={{ color: 'var(--navbar-text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Desktop search */}
            <div className="hidden lg:block w-52 lg:w-64">
              <GlobalSearch />
            </div>

            {/* Compact search toggle */}
            {isCompact && (
              <button
                type="button"
                onClick={handleSearchToggle}
                className="p-1.5 rounded transition-colors"
                style={{ color: 'var(--navbar-text-muted)' }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                aria-label="Search"
              >
                <Search size={18} />
              </button>
            )}
          </>
        )}

        {/* Connection status (desktop only) */}
        <div className="mx-1 hidden lg:block">
          <ConnectionDot />
        </div>

        {/* Staff Chat (desktop only) */}
        <button
          type="button"
          onClick={() => chatStore.toggleWidget()}
          className="relative p-1.5 rounded transition-colors hidden lg:flex"
          style={{ color: 'var(--navbar-text-muted)' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
          title="Staff Chat"
        >
          <MessageCircle size={18} />
          {chatStore.totalUnreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {chatStore.totalUnreadCount > 9 ? '9+' : chatStore.totalUnreadCount}
            </span>
          )}
        </button>

        {/* Vendor alerts inbox (low stock, refunds, approvals, reminders) */}
        <InboxBell />

        {/* AI Alerts (desktop only) */}
        <div className="hidden lg:block">
          <AlertBell />
        </div>

        {/* Divider */}
        <div className="h-5 w-px mx-1 hidden lg:block" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }} />

        {/* Report Bug button (desktop only) */}
        <button
          type="button"
          onClick={() => setBugReportOpen(true)}
          className="items-center gap-1 p-2 rounded-xl text-white/80 hover:text-white hover:bg-white/10 active:scale-95 transition-all duration-150 hidden lg:flex"
          title="Report a bug (Ctrl+Shift+B)"
        >
          <Bug size={16} />
        </button>

        {/* Help dropdown (desktop only) */}
        <div ref={helpMenuRef} className="relative hidden lg:block">
          <button
            type="button"
            onClick={() => setHelpMenuOpen(!helpMenuOpen)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[13px] font-medium transition-all duration-150 text-white/80 hover:text-white hover:bg-white/10 active:scale-95"
          >
            <HelpCircle size={16} />
            <ChevronDown size={12} />
          </button>
          {helpMenuOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-56 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-2xl shadow-xl z-50 py-1.5 animate-dropdown">
              <div className="px-3.5 py-2 border-b border-gray-100 dark:border-white/10">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">Retail Smart ERP</p>
                {appVersion && (
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">Version {appVersion}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setHelpMenuOpen(false)
                  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
                }}
                className="w-full flex items-center gap-2 px-3.5 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100/70 dark:hover:bg-white/[0.08] transition-colors"
              >
                <Keyboard size={14} className="text-gray-400" />
                Search
                <span className="ml-auto text-xs text-gray-400 font-mono">Ctrl+K</span>
              </button>
              <a
                href="https://github.com/ravindu2012/retail-smart-erp"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setHelpMenuOpen(false)}
                className="w-full flex items-center gap-2 px-3.5 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100/70 dark:hover:bg-white/[0.08] transition-colors"
              >
                <Info size={14} className="text-gray-400" />
                About
              </a>
            </div>
          )}
        </div>

        {/* Theme toggle (desktop only) */}
        <div className="hidden lg:block">
          <ThemeToggle onThemeChange={handleThemeChange} />
        </div>

        {/* Divider */}
        <div className="h-5 w-px mx-1 hidden lg:block bg-white/15" />

        {/* User avatar dropdown (desktop only) */}
        <div ref={userMenuRef} className="relative hidden lg:block">
          <button
            type="button"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-white/10 active:scale-95 transition-all duration-150"
          >
            {session?.user?.avatarUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={session.user.avatarUrl}
                alt={userName}
                className="w-7 h-7 rounded-full object-cover"
              />
            ) : (
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold"
                style={{
                  backgroundColor: 'var(--sidebar-avatar-bg)',
                  color: 'var(--sidebar-avatar-text)',
                }}
              >
                {userInitials}
              </div>
            )}
          </button>
          {userMenuOpen && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-50 py-1 animate-dropdown">
              {/* User info */}
              <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-700">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{userName}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{userEmail}</p>
                {session?.user?.role && (
                  <span className="inline-block mt-1 text-xs capitalize bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                    {session.user.role}
                  </span>
                )}
              </div>
              {/* Menu items */}
              <div className="py-1">
                <Link
                  href={`${basePath}/settings`}
                  onClick={() => setUserMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <Settings size={14} className="text-gray-400" />
                  Settings
                </Link>
                <Link
                  href={`${basePath}/activity-log`}
                  onClick={() => setUserMenuOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <User size={14} className="text-gray-400" />
                  Activity Log
                </Link>
              </div>
              {/* Logout */}
              <div className="border-t border-gray-100 dark:border-gray-700 py-1">
                <button
                  type="button"
                  onClick={async () => {
                    setUserMenuOpen(false)
                    broadcastAuthEvent('logout', 'company')
                    await signOut({ redirect: false })
                    window.location.href = `${basePath}/login?logout=true`
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  <LogOut size={14} />
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Compact menu toggle (mobile + tablet, below lg) */}
        {isCompact && !searchExpanded && (
          <div ref={mobileMenuRef} className="relative">
            <button
              type="button"
              onClick={handleMobileMenuToggle}
              className="flex items-center gap-2 p-1 rounded transition-colors"
              style={{ color: 'var(--navbar-text-muted)' }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.1)'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <MoreVertical size={20} />
            </button>

            {/* Mobile menu dropdown */}
            {mobileMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-50 py-1 animate-dropdown">
                {/* User info */}
                <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-700">
                  <div className="flex items-center gap-3">
                    {session?.user?.avatarUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={session.user.avatarUrl}
                        alt={userName}
                        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                        style={{
                          backgroundColor: 'var(--sidebar-avatar-bg)',
                          color: 'var(--sidebar-avatar-text)',
                        }}
                      >
                        {userInitials}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{userName}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{userEmail}</p>
                    </div>
                  </div>
                  {session?.user?.role && (
                    <span className="inline-block mt-2 text-xs capitalize bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                      {session.user.role}
                    </span>
                  )}
                  <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{tenantName}</p>
                </div>

                {/* App Switcher grid for mobile */}
                <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Modules</p>
                  <div className="grid grid-cols-4 gap-1">
                    {visibleTabs.slice(0, 8).map((tab) => {
                      const isActive = currentModule === tab.key
                      const TabIcon = ICON_MAP[tab.icon]
                      return (
                        <Link
                          key={tab.key}
                          href={`${basePath}${tab.href}`}
                          onClick={() => setMobileMenuOpen(false)}
                          className={cn(
                            "flex flex-col items-center gap-1 p-2 rounded text-center",
                            isActive
                              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                              : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                          )}
                        >
                          {TabIcon && <TabIcon size={18} />}
                          <span className="text-[10px] font-medium leading-tight truncate w-full">{tab.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                </div>

                {/* Connection status and theme toggle for mobile */}
                <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ConnectionDot />
                    <span className="text-xs text-gray-600 dark:text-gray-300">Connection</span>
                  </div>
                  <div>
                    <ThemeToggle onThemeChange={handleThemeChange} />
                  </div>
                </div>

                {/* Mobile menu items */}
                <div className="py-1">
                  {mobileMenuItems.map((item, index) => {
                    const Icon = item.icon
                    if ('href' in item) {
                      return (
                        <Link
                          key={index}
                          href={item.href}
                          onClick={() => {
                            setMobileMenuOpen(false)
                            if (item.onClick) item.onClick()
                          }}
                          className={cn(
                            "flex items-center gap-3 px-3 py-3 text-sm transition-colors",
                            item.danger
                              ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                              : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                          )}
                        >
                          <Icon size={16} className="text-gray-400" />
                          {item.label}
                        </Link>
                      )
                    } else {
                      return (
                        <button
                          key={index}
                          type="button"
                          onClick={() => {
                            setMobileMenuOpen(false)
                            if (item.onClick) item.onClick()
                          }}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-3 text-sm transition-colors",
                            item.danger
                              ? "text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                              : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                          )}
                        >
                          <Icon size={16} className="text-gray-400" />
                          {item.label}
                        </button>
                      )
                    }
                  })}
                </div>

                {/* App version */}
                {appVersion && (
                  <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Version {appVersion}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bug Report Modal */}
      <BugReportModal isOpen={bugReportOpen} onClose={() => setBugReportOpen(false)} />
    </header>
  )
}
