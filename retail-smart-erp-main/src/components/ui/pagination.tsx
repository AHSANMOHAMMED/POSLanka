'use client'

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  totalPages: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  pageSizeOptions?: number[]
  showPageSize?: boolean
  showInfo?: boolean
  className?: string
}

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
  showPageSize = true,
  showInfo = true,
  className,
}: PaginationProps) {
  const startItem = total === 0 ? 0 : (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, total)

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = []
    const showPages = 5 // Number of page buttons to show

    if (totalPages <= showPages + 2) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      // Always show first page
      pages.push(1)

      if (page > 3) {
        pages.push('ellipsis')
      }

      // Show pages around current page
      const start = Math.max(2, page - 1)
      const end = Math.min(totalPages - 1, page + 1)

      for (let i = start; i <= end; i++) {
        pages.push(i)
      }

      if (page < totalPages - 2) {
        pages.push('ellipsis')
      }

      // Always show last page
      if (totalPages > 1) {
        pages.push(totalPages)
      }
    }

    return pages
  }

  const pageNumbers = getPageNumbers()

  if (!total || total === 0) {
    return null
  }

  return (
    <div className={cn('flex flex-col sm:flex-row items-center justify-between gap-2 py-2', className)}>
      {/* Info text */}
      {showInfo && (
        <div className="text-xs text-[#495057] dark:text-gray-400 order-2 sm:order-1 tabular-nums">
          {startItem.toLocaleString()}-{endItem.toLocaleString()} / {total.toLocaleString()}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center gap-0.5 order-1 sm:order-2">
        {/* First page */}
        <button
          onClick={() => onPageChange(1)}
          disabled={page === 1}
          className="p-1 rounded hover:bg-[#f8f9fa] dark:hover:bg-gray-700 text-[#495057] dark:text-gray-400 disabled:opacity-30 disabled:cursor-not-allowed hidden sm:block transition-colors"
          aria-label="First page"
        >
          <ChevronsLeft size={14} />
        </button>

        {/* Previous page */}
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          className="p-1 rounded hover:bg-[#f8f9fa] dark:hover:bg-gray-700 text-[#495057] dark:text-gray-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </button>

        {/* Page numbers - desktop */}
        <div className="hidden sm:flex items-center gap-0.5">
          {pageNumbers.map((pageNum, idx) =>
            pageNum === 'ellipsis' ? (
              <span key={`ellipsis-${idx}`} className="px-1 text-[#adb5bd] dark:text-gray-500 text-xs">
                ...
              </span>
            ) : (
              <button
                key={pageNum}
                onClick={() => onPageChange(pageNum)}
                className={cn(
                  'min-w-[28px] h-7 px-2 rounded text-xs font-medium transition-colors',
                  page === pageNum
                    ? 'bg-[#0d6efd] text-white'
                    : 'hover:bg-[#f8f9fa] dark:hover:bg-gray-700 text-[#495057] dark:text-gray-300'
                )}
              >
                {pageNum}
              </button>
            )
          )}
        </div>

        {/* Page indicator - mobile */}
        <span className="sm:hidden px-2 text-xs text-[#495057] dark:text-gray-400 tabular-nums">
          {page} / {totalPages}
        </span>

        {/* Next page */}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          className="p-1 rounded hover:bg-[#f8f9fa] dark:hover:bg-gray-700 text-[#495057] dark:text-gray-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </button>

        {/* Last page */}
        <button
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages}
          className="p-1 rounded hover:bg-[#f8f9fa] dark:hover:bg-gray-700 text-[#495057] dark:text-gray-400 disabled:opacity-30 disabled:cursor-not-allowed hidden sm:block transition-colors"
          aria-label="Last page"
        >
          <ChevronsRight size={14} />
        </button>
      </div>

      {/* Page size selector */}
      {showPageSize && onPageSizeChange && (
        <div className="flex items-center gap-1.5 order-3">
          <label htmlFor="page-size" className="text-xs text-[#495057] dark:text-gray-400">
            Per page:
          </label>
          <select
            id="page-size"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="px-1.5 py-0.5 border border-[#ced4da] dark:border-gray-600 rounded text-xs bg-white dark:bg-gray-800 text-[#212529] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#0d6efd] focus:border-[#86b7fe]"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
