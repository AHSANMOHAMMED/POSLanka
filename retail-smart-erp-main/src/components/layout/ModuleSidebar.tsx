'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import { useSidebar } from './Sidebar'
import { getModuleFromPathname, getModuleSidebar, isDetailPage } from '@/lib/navigation/module-sidebar'
import { useModuleAccess } from '@/hooks/useModuleAccess'
import { useEffectivePermissions } from '@/hooks/useEffectivePermissions'
import type { Permission } from '@/lib/auth/roles'
import { useFeatureFlags } from '@/hooks/useFeatureFlag'
import { isHrefAllowedByFeatures, isModuleAllowedByFeatures } from '@/lib/features/nav-gate'
import { ICON_MAP } from '@/components/workspace/icon-map'
import { ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight, X } from 'lucide-react'

interface ModuleSidebarProps {
  companySlug: string
}

export function ModuleSidebar({ companySlug }: ModuleSidebarProps) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const company = useCompanyOptional()
  const { mobileOpen, setMobileOpen, collapsed, setCollapsed } = useSidebar()
  // Accordion: user toggles per `${module}:${section}`; untouched sections follow the route
  const [sectionOverrides, setSectionOverrides] = useState<Record<string, boolean>>({})
  const { isModuleEnabled } = useModuleAccess()
  // Server-effective permissions (custom roles, overrides, module toggles); role defaults until loaded
  const { permissions: effective } = useEffectivePermissions()
  const can = effective ? (p: Permission) => effective[p] ?? false : undefined
  const { flags } = useFeatureFlags()

  const businessType = company?.businessType || session?.user?.businessType
  const userRole = session?.user?.role
  const basePath = `/c/${companySlug}`

  // Determine which module we're in
  const currentModule = getModuleFromPathname(pathname, businessType)

  // Dashboard and detail pages have no sidebar
  if (!currentModule || currentModule === 'dashboard' || isDetailPage(pathname)) {
    return null
  }

  if (!isModuleAllowedByFeatures(currentModule, flags)) {
    return null
  }

  // Get sidebar sections for this module, filtered by role, module access, and feature flags
  const sections = getModuleSidebar(currentModule, businessType, userRole, isModuleEnabled, can)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isHrefAllowedByFeatures(item.href, flags)),
    }))
    .filter((section) => section.items.length > 0)

  if (sections.length === 0) {
    return null
  }

  const isItemActive = (href: string) => {
    const fullHref = `${basePath}${href}`
    // Query-string links (e.g. /items?filter=low-stock) match on their path
    const itemPath = href.split('?')[0]
    const full = `${basePath}${itemPath}`
    return pathname === fullHref || pathname === full || pathname.startsWith(full + '/')
  }

  // Section containing the current route (falls back to the first, e.g. "Masters" on the workspace page)
  const activeSectionTitle = sections.find((sec) => sec.items.some((it) => isItemActive(it.href)))?.title ?? sections[0].title
  const sectionKey = (title: string) => `${currentModule}:${title}`
  const isSectionOpen = (title: string) => sectionOverrides[sectionKey(title)] ?? title === activeSectionTitle
  const toggleSection = (title: string) =>
    setSectionOverrides((prev) => ({ ...prev, [sectionKey(title)]: !isSectionOpen(title) }))

  const renderLink = (item: (typeof sections)[number]['items'][number], rail: boolean) => {
    const fullHref = `${basePath}${item.href}`
    const isActiveWithQuery = isItemActive(item.href)
    const Icon = ICON_MAP[item.icon]
    return (
      <li key={item.href} className="mb-0.5">
        <Link
          href={fullHref}
          title={rail ? item.label : undefined}
          aria-label={rail ? item.label : undefined}
          className={`flex items-center rounded transition-colors duration-100 ${rail ? 'justify-center' : 'gap-2.5'}`}
          style={{
            padding: rail ? '8px 0' : '8px 12px',
            fontSize: '14px',
            fontWeight: isActiveWithQuery ? 500 : 400,
            borderRadius: '4px',
            backgroundColor: isActiveWithQuery ? 'var(--sidebar-active-bg)' : 'transparent',
            color: isActiveWithQuery ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)',
          }}
          onMouseEnter={(e) => {
            if (!isActiveWithQuery) {
              e.currentTarget.style.backgroundColor = 'var(--sidebar-hover-bg)'
            }
          }}
          onMouseLeave={(e) => {
            if (!isActiveWithQuery) {
              e.currentTarget.style.backgroundColor = 'transparent'
            }
          }}
          onClick={() => setMobileOpen(false)}
        >
          {Icon ? (
            <Icon
              size={rail ? 18 : 16}
              style={{
                color: isActiveWithQuery ? 'var(--sidebar-text-active)' : 'var(--sidebar-text-muted)',
              }}
            />
          ) : rail ? (
            <span className="text-[11px] font-semibold">{item.label.slice(0, 2)}</span>
          ) : null}
          {!rail && <span>{item.label}</span>}
        </Link>
      </li>
    )
  }

  const sidebarContent = (
    <nav className="sidebar-nav flex-1 overflow-y-auto py-3 px-3">
      {sections.map((section, sectionIdx) => {
        const open = isSectionOpen(section.title)
        const Chevron = open ? ChevronDown : ChevronRight
        const hasActive = section.items.some((it) => isItemActive(it.href))
        return (
          <div key={section.title} style={{ marginTop: sectionIdx > 0 ? '6px' : 0 }}>
            {/* Section header (accordion toggle) */}
            <button
              type="button"
              onClick={() => toggleSection(section.title)}
              aria-expanded={open}
              className="w-full flex items-center justify-between px-3 py-1.5 rounded text-[11px] font-semibold uppercase tracking-wider transition-colors duration-100"
              style={{ color: hasActive ? 'var(--sidebar-text-active)' : 'var(--sidebar-section-text)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--sidebar-hover-bg)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <span>{section.title}</span>
              <span className="flex items-center gap-1 normal-case tracking-normal font-normal" style={{ color: 'var(--sidebar-text-muted)' }}>
                {!open && <span className="text-[11px]">{section.items.length}</span>}
                <Chevron size={14} />
              </span>
            </button>

            {/* Section items */}
            {open && <ul className="mt-0.5 mb-2">{section.items.map((item) => renderLink(item, false))}</ul>}
          </div>
        )
      })}
    </nav>
  )

  // Desktop icon-only rail (all links, sections separated by a rule)
  const railContent = (
    <nav className="sidebar-nav flex-1 overflow-y-auto py-3 px-1.5">
      {sections.map((section, sectionIdx) => (
        <div key={section.title}>
          {sectionIdx > 0 && <div className="my-2 mx-2" style={{ borderTop: '1px solid var(--sidebar-border)' }} />}
          <ul>{section.items.map((item) => renderLink(item, true))}</ul>
        </div>
      ))}
    </nav>
  )

  const collapseToggle = (
    <button
      type="button"
      onClick={() => setCollapsed(!collapsed)}
      className={`flex items-center gap-2 text-xs py-2 transition-colors ${collapsed ? 'justify-center px-0' : 'px-4'}`}
      style={{ color: 'var(--sidebar-text-muted)', borderTop: '1px solid var(--sidebar-border)' }}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
    >
      {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
      {!collapsed && <span>Collapse</span>}
    </button>
  )

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          style={{ top: '48px' }}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile sidebar (slides in below navbar) */}
      <aside
        className={`fixed left-0 bottom-0 z-50 w-[220px] flex flex-col text-sm transform transition-transform duration-200 ease-in-out md:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          top: '48px',
          backgroundColor: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--sidebar-border)',
        }}
      >
        {/* Mobile close button */}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="absolute top-2 right-2 p-1 rounded-md transition-colors"
          style={{ color: 'var(--sidebar-text-muted)' }}
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
        {sidebarContent}
      </aside>

      {/* Desktop sidebar (below navbar, sticky) */}
      <aside
        className={`hidden md:flex flex-col text-sm shrink-0 transition-[width] duration-150 ${collapsed ? 'w-[56px]' : 'w-[220px]'}`}
        style={{
          position: 'sticky',
          top: '48px',
          height: 'calc(100vh - 48px)',
          backgroundColor: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--sidebar-border)',
        }}
      >
        {collapsed ? railContent : sidebarContent}
        {collapseToggle}
      </aside>
    </>
  )
}
