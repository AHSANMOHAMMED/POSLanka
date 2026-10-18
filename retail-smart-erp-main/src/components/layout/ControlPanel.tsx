'use client'

import { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Search, List, LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================
// BREADCRUMB
// ============================================

export interface BreadcrumbItem {
  label: string
  href?: string
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[]
  className?: string
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav className={cn('flex items-center gap-1 text-sm min-w-0', className)} aria-label="Breadcrumb">
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <span key={index} className="flex items-center gap-1 min-w-0">
            {index > 0 && <span className="text-[#adb5bd] mx-0.5">/</span>}
            {isLast || !item.href ? (
              <span className={cn(
                'truncate',
                isLast ? 'font-semibold text-[#212529] dark:text-white' : 'text-[#6c757d] dark:text-gray-400'
              )}>
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="text-[#0d6efd] hover:text-[#0b5ed7] dark:text-[#6ea8fe] dark:hover:text-[#9ec5fe] truncate"
              >
                {item.label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}

// ============================================
// PAGER
// ============================================

interface PagerProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  className?: string
}

export function Pager({ page, pageSize, total, onPageChange, className }: PagerProps) {
  const start = Math.min((page - 1) * pageSize + 1, total)
  const end = Math.min(page * pageSize, total)
  const totalPages = Math.ceil(total / pageSize)
  const hasPrev = page > 1
  const hasNext = page < totalPages

  if (total === 0) return null

  return (
    <div className={cn('flex items-center gap-1 text-sm text-[#495057] dark:text-gray-400', className)}>
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={!hasPrev}
        className="p-1 rounded hover:bg-[#f8f9fa] dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Previous page"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="tabular-nums whitespace-nowrap text-xs font-medium">
        {start}-{end} / {total}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={!hasNext}
        className="p-1 rounded hover:bg-[#f8f9fa] dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        aria-label="Next page"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

// ============================================
// VIEW SWITCHER
// ============================================

type ViewMode = 'list' | 'kanban'

interface ViewSwitcherProps {
  mode: ViewMode
  onModeChange: (mode: ViewMode) => void
  className?: string
}

export function ViewSwitcher({ mode, onModeChange, className }: ViewSwitcherProps) {
  return (
    <div className={cn('flex items-center border border-[#dee2e6] dark:border-gray-600 rounded overflow-hidden', className)}>
      <button
        type="button"
        onClick={() => onModeChange('list')}
        className={cn(
          'p-1.5 transition-colors',
          mode === 'list'
            ? 'bg-[#0d6efd] text-white'
            : 'bg-white text-[#6c757d] hover:bg-[#f8f9fa] dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
        )}
        aria-label="List view"
      >
        <List size={14} />
      </button>
      <button
        type="button"
        onClick={() => onModeChange('kanban')}
        className={cn(
          'p-1.5 transition-colors border-l border-[#dee2e6] dark:border-gray-600',
          mode === 'kanban'
            ? 'bg-[#0d6efd] text-white'
            : 'bg-white text-[#6c757d] hover:bg-[#f8f9fa] dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
        )}
        aria-label="Kanban view"
      >
        <LayoutGrid size={14} />
      </button>
    </div>
  )
}

// ============================================
// CONTROL PANEL
// ============================================

interface ControlPanelProps {
  /** Breadcrumb items (first = module, last = current page) */
  breadcrumbs?: BreadcrumbItem[]
  /** Search value */
  searchValue?: string
  /** Search change handler */
  onSearchChange?: (value: string) => void
  /** Search placeholder */
  searchPlaceholder?: string
  /** Current view mode */
  viewMode?: ViewMode
  /** View mode change handler */
  onViewModeChange?: (mode: ViewMode) => void
  /** Pager props */
  pager?: {
    page: number
    pageSize: number
    total: number
    onPageChange: (page: number) => void
  }
  /** Action buttons (right side) */
  actions?: ReactNode
  className?: string
  children?: ReactNode
}

/**
 * Odoo-style Control Panel — appears above list/form views.
 *
 * ```
 * [← Breadcrumbs / Page Title]      [Search] [List|Kanban] [← 1-20/156 →] [Create]
 * ```
 */
export function ControlPanel({
  breadcrumbs,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  viewMode,
  onViewModeChange,
  pager,
  actions,
  className,
  children,
}: ControlPanelProps) {
  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-2 bg-white dark:bg-gray-800 border-b border-[#dee2e6] dark:border-gray-700 min-h-[44px] flex-wrap',
      className
    )}>
      {/* Left: Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumbs items={breadcrumbs} className="shrink-0" />
      )}

      {/* Spacer */}
      <div className="flex-1 min-w-0" />

      {/* Center/Right controls */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Search */}
        {onSearchChange && (
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#adb5bd]" />
            <input
              type="text"
              value={searchValue || ''}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-7 pl-8 pr-3 text-xs border border-[#ced4da] dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-[#212529] dark:text-gray-200 placeholder-[#adb5bd] focus:outline-none focus:ring-1 focus:ring-[#0d6efd] focus:border-[#86b7fe] w-44"
            />
          </div>
        )}

        {/* View switcher */}
        {viewMode && onViewModeChange && (
          <ViewSwitcher mode={viewMode} onModeChange={onViewModeChange} />
        )}

        {/* Pager */}
        {pager && (
          <Pager {...pager} />
        )}

        {/* Custom children */}
        {children}

        {/* Action buttons */}
        {actions}
      </div>
    </div>
  )
}
