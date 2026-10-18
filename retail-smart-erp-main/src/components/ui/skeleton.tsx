'use client'

import { cn } from '@/lib/utils'

// ============================================
// BASE SKELETON COMPONENT
// ============================================

interface SkeletonProps {
  className?: string
  /** Animation style: pulse (default) or shimmer */
  animation?: 'pulse' | 'shimmer'
  /** Inline styles */
  style?: React.CSSProperties
}

export function Skeleton({ className, animation = 'pulse', style }: SkeletonProps) {
  return (
    <div
      className={cn(
        'rounded-md bg-gray-200 dark:bg-gray-700',
        animation === 'pulse' && 'animate-pulse',
        animation === 'shimmer' && 'skeleton-shimmer',
        className
      )}
      style={style}
    />
  )
}

// ============================================
// SKELETON TEXT LINE
// ============================================

interface SkeletonTextProps {
  /** Number of lines to display */
  lines?: number
  /** Width of the last line (percentage or 'full') */
  lastLineWidth?: 'full' | '3/4' | '1/2' | '1/4'
  className?: string
}

export function SkeletonText({
  lines = 1,
  lastLineWidth = '3/4',
  className
}: SkeletonTextProps) {
  const widthMap = {
    'full': 'w-full',
    '3/4': 'w-3/4',
    '1/2': 'w-1/2',
    '1/4': 'w-1/4',
  }

  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            'h-4',
            i === lines - 1 ? widthMap[lastLineWidth] : 'w-full'
          )}
        />
      ))}
    </div>
  )
}

// ============================================
// SKELETON AVATAR / CIRCLE
// ============================================

interface SkeletonAvatarProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const avatarSizes = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
  xl: 'h-16 w-16',
}

export function SkeletonAvatar({ size = 'md', className }: SkeletonAvatarProps) {
  return (
    <Skeleton className={cn('rounded-full', avatarSizes[size], className)} />
  )
}

// ============================================
// SKELETON CARD
// ============================================

interface SkeletonCardProps {
  /** Show header section */
  hasHeader?: boolean
  /** Number of content lines */
  lines?: number
  /** Show footer/actions section */
  hasFooter?: boolean
  className?: string
}

export function SkeletonCard({
  hasHeader = true,
  lines = 3,
  hasFooter = false,
  className
}: SkeletonCardProps) {
  return (
    <div className={cn('bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4', className)}>
      {hasHeader && (
        <div className="flex items-center gap-3 mb-4">
          <SkeletonAvatar size="md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      )}
      <SkeletonText lines={lines} lastLineWidth="3/4" />
      {hasFooter && (
        <div className="flex gap-2 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-20" />
        </div>
      )}
    </div>
  )
}

// ============================================
// SKELETON TABLE
// ============================================

interface SkeletonTableProps {
  /** Number of columns */
  columns?: number
  /** Number of rows */
  rows?: number
  /** Show header row */
  hasHeader?: boolean
  /** Column widths as percentages or 'auto' */
  columnWidths?: string[]
  className?: string
}

export function SkeletonTable({
  columns = 4,
  rows = 5,
  hasHeader = true,
  columnWidths,
  className,
}: SkeletonTableProps) {
  const defaultWidths = Array(columns).fill('auto')
  const widths = columnWidths || defaultWidths

  return (
    <div className={cn('w-full', className)}>
      {hasHeader && (
        <div className="flex gap-4 pb-3 mb-3 border-b border-gray-200 dark:border-gray-700">
          {widths.map((width, i) => (
            <Skeleton
              key={`header-${i}`}
              className="h-4"
              style={{ flex: width === 'auto' ? 1 : 'none', width: width !== 'auto' ? width : undefined }}
            />
          ))}
        </div>
      )}
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={rowIdx} className="flex gap-4 items-center">
            {widths.map((width, colIdx) => (
              <Skeleton
                key={`row-${rowIdx}-col-${colIdx}`}
                className="h-4"
                style={{ flex: width === 'auto' ? 1 : 'none', width: width !== 'auto' ? width : undefined }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================
// SKELETON FORM
// ============================================

interface SkeletonFormProps {
  /** Number of form fields */
  fields?: number
  /** Layout: single column or two columns */
  columns?: 1 | 2
  /** Show submit button */
  hasSubmit?: boolean
  className?: string
}

export function SkeletonForm({
  fields = 4,
  columns = 1,
  hasSubmit = true,
  className,
}: SkeletonFormProps) {
  const gridClass = columns === 2 ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'space-y-4'

  return (
    <div className={cn(className)}>
      <div className={gridClass}>
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-1/4" /> {/* Label */}
            <Skeleton className="h-9 w-full" /> {/* Input */}
          </div>
        ))}
      </div>
      {hasSubmit && (
        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Skeleton className="h-9 w-20" /> {/* Cancel button */}
          <Skeleton className="h-9 w-24" /> {/* Submit button */}
        </div>
      )}
    </div>
  )
}

// ============================================
// SKELETON LIST ITEM
// ============================================

interface SkeletonListItemProps {
  /** Show avatar/icon on left */
  hasAvatar?: boolean
  /** Show action buttons on right */
  hasActions?: boolean
  /** Number of text lines */
  lines?: number
  className?: string
}

export function SkeletonListItem({
  hasAvatar = true,
  hasActions = true,
  lines = 2,
  className,
}: SkeletonListItemProps) {
  return (
    <div className={cn('flex items-center gap-3 p-3', className)}>
      {hasAvatar && <SkeletonAvatar size="md" />}
      <div className="flex-1 space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn('h-4', i === 0 ? 'w-1/2' : 'w-1/3')}
          />
        ))}
      </div>
      {hasActions && (
        <div className="flex gap-2">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      )}
    </div>
  )
}

// ============================================
// SKELETON LIST
// ============================================

interface SkeletonListProps {
  /** Number of items */
  items?: number
  /** Props for each list item */
  itemProps?: Omit<SkeletonListItemProps, 'className'>
  /** Show dividers between items */
  dividers?: boolean
  className?: string
}

export function SkeletonList({
  items = 5,
  itemProps,
  dividers = true,
  className,
}: SkeletonListProps) {
  return (
    <div className={cn(dividers && 'divide-y divide-gray-200 dark:divide-gray-700', className)}>
      {Array.from({ length: items }).map((_, i) => (
        <SkeletonListItem key={i} {...itemProps} />
      ))}
    </div>
  )
}

// ============================================
// PAGE SKELETON - Full page loading state
// ============================================

interface PageSkeletonProps {
  /** Page layout type */
  layout?: 'list' | 'detail' | 'form' | 'dashboard'
  className?: string
}

export function PageSkeleton({ layout = 'list', className }: PageSkeletonProps) {
  if (layout === 'list') {
    return (
      <div className={cn('space-y-4', className)}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-32" />
        </div>
        {/* Filters */}
        <div className="flex gap-2">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-32" />
        </div>
        {/* Table */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
          <SkeletonTable rows={8} columns={5} />
        </div>
      </div>
    )
  }

  if (layout === 'detail') {
    return (
      <div className={cn('space-y-6', className)}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        {/* Content cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <SkeletonCard hasHeader={false} lines={6} />
          </div>
          <div>
            <SkeletonCard hasHeader={false} lines={4} />
          </div>
        </div>
      </div>
    )
  }

  if (layout === 'form') {
    return (
      <div className={cn('max-w-2xl', className)}>
        {/* Header */}
        <div className="mb-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </div>
        {/* Form */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-6">
          <SkeletonForm fields={6} columns={2} />
        </div>
      </div>
    )
  }

  if (layout === 'dashboard') {
    return (
      <div className={cn('space-y-6', className)}>
        {/* Stats row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
            <Skeleton className="h-6 w-32 mb-4" />
            <Skeleton className="h-64 w-full" />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
            <Skeleton className="h-6 w-32 mb-4" />
            <Skeleton className="h-64 w-full" />
          </div>
        </div>
      </div>
    )
  }

  return null
}
