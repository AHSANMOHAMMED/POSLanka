'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import { useSidebar } from './Sidebar'
import { getModuleFromPathname, getModuleSidebar, isDetailPage } from '@/lib/navigation/module-sidebar'
import { useModuleAccess } from '@/hooks/useModuleAccess'
import { ICON_MAP } from '@/components/workspace/icon-map'
import { X } from 'lucide-react'

interface ModuleSidebarProps {
  companySlug: string
}

export function ModuleSidebar({ companySlug }: ModuleSidebarProps) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const company = useCompanyOptional()
  const { mobileOpen, setMobileOpen } = useSidebar()
  const { isModuleEnabled } = useModuleAccess()

  const businessType = company?.businessType || session?.user?.businessType
  const userRole = session?.user?.role
  const basePath = `/c/${companySlug}`

  // Determine which module we're in
  const currentModule = getModuleFromPathname(pathname, businessType)

  // Dashboard and detail pages have no sidebar
  if (!currentModule || currentModule === 'dashboard' || isDetailPage(pathname)) {
    return null
  }

  // Get sidebar sections for this module, filtered by role and module access
  const sections = getModuleSidebar(currentModule, businessType, userRole, isModuleEnabled)

  if (sections.length === 0) {
    return null
  }

  const sidebarContent = (
    <nav className="sidebar-nav flex-1 overflow-y-auto py-3 px-3">
      {sections.map((section, sectionIdx) => (
        <div key={section.title} style={{ marginTop: sectionIdx > 0 ? '20px' : 0 }}>
          {/* Section header */}
          <div
            className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--sidebar-section-text)' }}
          >
            {section.title}
          </div>

          {/* Section items */}
          <ul>
            {section.items.map((item) => {
              const fullHref = `${basePath}${item.href}`
              const isActive = pathname === fullHref || pathname.startsWith(fullHref + '/')
              // Handle query string matching (e.g., /items?filter=low-stock)
              const [itemPath, itemQuery] = item.href.split('?')
              const isActiveWithQuery = itemQuery
                ? pathname === `${basePath}${itemPath}` || pathname.startsWith(`${basePath}${itemPath}/`)
                : isActive

              const Icon = ICON_MAP[item.icon]

              return (
                <li key={item.href} className="mb-0.5">
                  <Link
                    href={fullHref}
                    className="flex items-center gap-2.5 rounded transition-colors duration-100"
                    style={{
                      padding: '8px 12px',
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
                    {Icon && (
                      <Icon
                        size={16}
                        style={{
                          color: isActiveWithQuery ? 'var(--sidebar-text-active)' : 'var(--sidebar-text-muted)',
                        }}
                      />
                    )}
                    <span>{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          style={{ top: '48px' }}
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile sidebar (slides in below navbar) */}
      <aside
        className={`fixed left-0 bottom-0 z-50 w-[220px] flex flex-col text-sm transform transition-transform duration-200 ease-in-out lg:hidden ${
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
        className="hidden lg:flex flex-col text-sm shrink-0 w-[220px]"
        style={{
          position: 'sticky',
          top: '48px',
          height: 'calc(100vh - 48px)',
          backgroundColor: 'var(--sidebar-bg)',
          borderRight: '1px solid var(--sidebar-border)',
        }}
      >
        {sidebarContent}
      </aside>
    </>
  )
}
