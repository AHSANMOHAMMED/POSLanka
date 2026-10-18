'use client'

import { ReactNode, useState } from 'react'
import Link from 'next/link'
import { Home, ChevronRight, Plus, RefreshCw, Search, X, Filter } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useIsMobile } from '@/hooks/useResponsive'
import { cn } from '@/lib/utils'

interface ActionButton {
  label: string
  onClick: () => void
  icon?: ReactNode
}

interface ListPageLayoutProps {
  module: string
  moduleHref: string
  title: string
  actionButton?: ActionButton
  actionContent?: ReactNode
  search?: string
  setSearch?: (value: string) => void
  onRefresh?: () => void
  searchPlaceholder?: string
  filterContent?: ReactNode
  children: ReactNode
}

export function ListPageLayout({
  module,
  moduleHref,
  title,
  actionButton,
  actionContent,
  search,
  setSearch,
  onRefresh,
  searchPlaceholder = 'Search...',
  filterContent,
  children,
}: ListPageLayoutProps) {
  const { tenantSlug } = useCompany()
  const isMobile = useIsMobile()
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false)
  
  const resolvedModuleHref = moduleHref.startsWith('/') ? `/c/${tenantSlug}${moduleHref}` : moduleHref

  const handleActionClick = () => {
    if (actionButton) {
      actionButton.onClick()
    }
  }

  return (
    <div className="h-full flex flex-col -m-5">
      {/* Breadcrumb - Simplified on mobile */}
      <div className="px-4 py-1.5 border-b text-xs" style={{ backgroundColor: 'var(--page-bg)', borderColor: 'var(--sidebar-border)' }}>
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Link 
            href={`/c/${tenantSlug}/dashboard`} 
            className="hover:text-[var(--primary)] flex-shrink-0"
            aria-label="Dashboard"
          >
            <Home size={14} />
          </Link>
          {!isMobile && (
            <>
              <ChevronRight size={14} className="flex-shrink-0" />
              <Link 
                href={resolvedModuleHref} 
                className="hover:text-[var(--primary)] truncate max-w-[120px]"
                title={module}
              >
                {module}
              </Link>
            </>
          )}
          <ChevronRight size={14} className="flex-shrink-0" />
          <span 
            className="text-gray-900 dark:text-white font-medium truncate"
            title={title}
          >
            {isMobile ? title : title}
          </span>
        </div>
      </div>

      {/* Title Bar - Stacked on mobile */}
      <div className="px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className={cn(
          "flex items-center justify-between",
          isMobile ? "flex-col gap-3" : "flex-row"
        )}>
          <div className={cn(
            "flex items-center gap-3",
            isMobile ? "w-full justify-between" : ""
          )}>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-white truncate flex-1">
              {title}
            </h1>
            
            {/* Mobile filter toggle button */}
            {isMobile && filterContent && (
              <button
                onClick={() => setMobileFilterOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors flex-shrink-0"
              >
                <Filter size={14} />
                Filter
              </button>
            )}
          </div>
          
          {/* Action button/Content - Full width on mobile */}
          {(actionContent || actionButton) && (
            <div className={cn(
              "w-full",
              isMobile ? "mt-2" : ""
            )}>
              {actionContent || (actionButton && (
                <button
                  onClick={handleActionClick}
                  className={cn(
                    "flex items-center justify-center gap-1.5 px-3 py-1.5 text-white text-sm font-medium rounded transition-colors hover:opacity-90",
                    isMobile ? "w-full py-3 text-base touch-target" : ""
                  )}
                  style={{ backgroundColor: 'var(--primary)' }}
                >
                  {actionButton.icon || <Plus size={isMobile ? 18 : 16} />}
                  {actionButton.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Toolbar - Stacked vertically on mobile */}
      {(onRefresh || setSearch) && (
        <div className={cn(
          "px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700",
          isMobile ? "flex-col gap-3" : "flex items-center justify-between gap-4"
        )}>
          {onRefresh && (
            <div className={cn(
              "flex",
              isMobile ? "w-full" : ""
            )}>
              <button
                onClick={onRefresh}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors touch-target",
                  isMobile ? "flex-1 justify-center py-2" : ""
                )}
              >
                <RefreshCw size={14} />
                Refresh
              </button>
            </div>
          )}
          
          {setSearch && (
            <div className={cn(
              "relative",
              isMobile ? "w-full" : "flex-1 max-w-md"
            )}>
              <Search 
                className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" 
                size={isMobile ? 18 : 16} 
              />
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={search || ''}
                onChange={(e) => setSearch(e.target.value)}
                className={cn(
                  "w-full pl-10 pr-4 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-[var(--primary)] focus:border-[var(--primary)] dark:bg-gray-700 dark:text-white dark:placeholder-gray-400",
                  isMobile ? "py-3 text-base" : "py-1 text-sm pl-9"
                )}
              />
            </div>
          )}
        </div>
      )}

      {/* Inline Filter Bar - Desktop: horizontal bar, Mobile: drawer */}
      {filterContent && (
        <>
          {/* Desktop inline filter bar */}
          {!isMobile && (
            <div className="px-4 py-2.5 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <div className="flex flex-wrap gap-3 items-end">
                {filterContent}
              </div>
            </div>
          )}

          {/* Mobile filter drawer */}
          {isMobile && (
            <>
              {mobileFilterOpen && (
                <div
                  className="fixed inset-0 bg-black/50 z-40"
                  onClick={() => setMobileFilterOpen(false)}
                />
              )}
              <div className={cn(
                "fixed top-0 left-0 h-full w-[280px] max-w-[85vw] bg-white dark:bg-gray-800 z-50 transform transition-transform duration-300 ease-out shadow-xl",
                mobileFilterOpen ? "translate-x-0" : "-translate-x-full"
              )}>
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Filters
                  </h2>
                  <button
                    onClick={() => setMobileFilterOpen(false)}
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="p-4 overflow-y-auto h-[calc(100%-65px)]">
                  {filterContent}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Content Area */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-hidden flex flex-col" style={{ backgroundColor: 'var(--page-bg)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}