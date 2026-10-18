'use client'

import * as React from 'react'
import { useState, useCallback, useMemo } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown, MoreHorizontal, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Pagination } from './pagination'
import { FormInput } from './form-elements'
import { EmptyState } from './section-card'

// ============================================
// TYPES
// ============================================

export type SortDirection = 'asc' | 'desc' | null

export interface Column<T> {
  key: string
  header: string | React.ReactNode
  accessor?: keyof T | ((row: T) => React.ReactNode)
  sortable?: boolean
  width?: string | number
  minWidth?: string | number
  align?: 'left' | 'center' | 'right'
  headerAlign?: 'left' | 'center' | 'right'
  className?: string
  headerClassName?: string
  render?: (value: unknown, row: T, index: number) => React.ReactNode
  hidden?: boolean
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyField?: keyof T | ((row: T) => string)

  // Pagination
  pagination?: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  onPageChange?: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void

  // Sorting
  sortable?: boolean
  sortColumn?: string
  sortDirection?: SortDirection
  onSort?: (column: string, direction: SortDirection) => void

  // Selection
  selectable?: boolean
  selectedRows?: T[]
  onSelectionChange?: (rows: T[]) => void

  // Row actions
  onRowClick?: (row: T, index: number) => void
  rowActions?: (row: T, index: number) => React.ReactNode
  isRowActive?: (row: T) => boolean

  // Search
  searchable?: boolean
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (value: string) => void

  // States
  loading?: boolean
  emptyIcon?: React.ReactNode
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: React.ReactNode

  // Styling
  className?: string
  tableClassName?: string
  headerClassName?: string
  rowClassName?: string | ((row: T, index: number) => string)
  stickyHeader?: boolean
  compact?: boolean
  striped?: boolean
  bordered?: boolean
  hoverable?: boolean
}

// ============================================
// DATA TABLE COMPONENT
// ============================================

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  keyField = 'id' as keyof T,

  // Pagination
  pagination,
  onPageChange,
  onPageSizeChange,

  // Sorting
  sortable = false,
  sortColumn,
  sortDirection,
  onSort,

  // Selection
  selectable = false,
  selectedRows = [],
  onSelectionChange,

  // Row actions
  onRowClick,
  rowActions,
  isRowActive,

  // Search
  searchable = false,
  searchPlaceholder = 'Search...',
  searchValue,
  onSearchChange,

  // States
  loading = false,
  emptyIcon,
  emptyTitle = 'No data found',
  emptyDescription,
  emptyAction,

  // Styling
  className,
  tableClassName,
  headerClassName,
  rowClassName,
  stickyHeader = true,
  compact = false,
  striped = false,
  bordered = false,
  hoverable = true,
}: DataTableProps<T>) {
  // Filter out hidden columns
  const visibleColumns = useMemo(
    () => columns.filter((col) => !col.hidden),
    [columns]
  )

  // Get row key
  const getRowKey = useCallback(
    (row: T, index: number): string => {
      if (typeof keyField === 'function') {
        return keyField(row)
      }
      const key = row[keyField]
      return key !== undefined ? String(key) : String(index)
    },
    [keyField]
  )

  // Get cell value
  const getCellValue = useCallback((row: T, column: Column<T>): React.ReactNode => {
    if (column.render) {
      const value = column.accessor
        ? typeof column.accessor === 'function'
          ? column.accessor(row)
          : row[column.accessor]
        : undefined
      return column.render(value, row, data.indexOf(row))
    }

    if (column.accessor) {
      if (typeof column.accessor === 'function') {
        return column.accessor(row)
      }
      return row[column.accessor] as React.ReactNode
    }

    return row[column.key as keyof T] as React.ReactNode
  }, [data])

  // Handle sort
  const handleSort = useCallback(
    (column: Column<T>) => {
      if (!sortable || !column.sortable || !onSort) return

      let newDirection: SortDirection = 'asc'
      if (sortColumn === column.key) {
        if (sortDirection === 'asc') {
          newDirection = 'desc'
        } else if (sortDirection === 'desc') {
          newDirection = null
        }
      }

      onSort(column.key, newDirection)
    },
    [sortable, sortColumn, sortDirection, onSort]
  )

  // Handle selection
  const isRowSelected = useCallback(
    (row: T) => {
      const rowKey = getRowKey(row, data.indexOf(row))
      return selectedRows.some((r) => getRowKey(r, data.indexOf(r)) === rowKey)
    },
    [selectedRows, getRowKey, data]
  )

  const handleSelectAll = useCallback(() => {
    if (!onSelectionChange) return

    if (selectedRows.length === data.length) {
      onSelectionChange([])
    } else {
      onSelectionChange([...data])
    }
  }, [data, selectedRows, onSelectionChange])

  const handleSelectRow = useCallback(
    (row: T) => {
      if (!onSelectionChange) return

      const rowKey = getRowKey(row, data.indexOf(row))
      const isSelected = selectedRows.some(
        (r) => getRowKey(r, data.indexOf(r)) === rowKey
      )

      if (isSelected) {
        onSelectionChange(
          selectedRows.filter((r) => getRowKey(r, data.indexOf(r)) !== rowKey)
        )
      } else {
        onSelectionChange([...selectedRows, row])
      }
    },
    [selectedRows, getRowKey, onSelectionChange, data]
  )

  // Sort icon
  const SortIcon = ({ column }: { column: Column<T> }) => {
    if (!sortable || !column.sortable) return null

    if (sortColumn === column.key) {
      if (sortDirection === 'asc') {
        return <ChevronUp size={14} className="text-blue-600" />
      }
      if (sortDirection === 'desc') {
        return <ChevronDown size={14} className="text-blue-600" />
      }
    }

    return <ChevronsUpDown size={14} className="text-gray-400" />
  }

  // Cell padding based on compact mode
  const cellPadding = compact ? 'px-3 py-2' : 'px-4 py-3'

  return (
    <div className={cn('bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700', className)}>
      {/* Search bar */}
      {searchable && (
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <FormInput
            type="text"
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(e) => onSearchChange?.(e.target.value)}
            leftIcon={<Search size={16} />}
            inputSize="sm"
            className="max-w-xs"
          />
        </div>
      )}

      {/* Table container */}
      <div className="overflow-x-auto">
        <table className={cn('w-full', tableClassName)}>
          <caption className="sr-only">Data table</caption>
          <thead
            className={cn(
              'bg-gray-50 dark:bg-gray-900',
              stickyHeader && 'sticky top-0 z-10',
              headerClassName
            )}
          >
            <tr>
              {/* Selection checkbox */}
              {selectable && (
                <th scope="col" className={cn(cellPadding, 'w-10')}>
                  <input
                    type="checkbox"
                    checked={data.length > 0 && selectedRows.length === data.length}
                    onChange={handleSelectAll}
                    className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    aria-label="Select all rows"
                  />
                </th>
              )}

              {/* Column headers */}
              {visibleColumns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    cellPadding,
                    'text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider',
                    column.headerAlign === 'center' && 'text-center',
                    column.headerAlign === 'right' && 'text-right',
                    (!column.headerAlign || column.headerAlign === 'left') && 'text-left',
                    sortable && column.sortable && 'cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-800',
                    column.headerClassName
                  )}
                  style={{
                    width: column.width,
                    minWidth: column.minWidth,
                  }}
                  onClick={() => handleSort(column)}
                >
                  <div className="flex items-center gap-1">
                    {column.header}
                    <SortIcon column={column} />
                  </div>
                </th>
              ))}

              {/* Actions column */}
              {rowActions && (
                <th scope="col" className={cn(cellPadding, 'w-10')}>
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {loading ? (
              // Loading skeleton
              Array.from({ length: 5 }).map((_, idx) => (
                <tr key={idx}>
                  {selectable && (
                    <td className={cellPadding}>
                      <div className="h-4 w-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                    </td>
                  )}
                  {visibleColumns.map((col) => (
                    <td key={col.key} className={cellPadding}>
                      <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                    </td>
                  ))}
                  {rowActions && (
                    <td className={cellPadding}>
                      <div className="h-4 w-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                    </td>
                  )}
                </tr>
              ))
            ) : data.length === 0 ? (
              // Empty state
              <tr>
                <td
                  colSpan={
                    visibleColumns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)
                  }
                >
                  <EmptyState
                    icon={emptyIcon}
                    title={emptyTitle}
                    description={emptyDescription}
                    action={emptyAction}
                    className="py-12"
                  />
                </td>
              </tr>
            ) : (
              // Data rows
              data.map((row, rowIndex) => {
                const rowKey = getRowKey(row, rowIndex)
                const isActive = isRowActive?.(row)
                const isSelected = selectable && isRowSelected(row)

                return (
                  <tr
                    key={rowKey}
                    className={cn(
                      striped && rowIndex % 2 === 1 && 'bg-gray-50 dark:bg-gray-900/50',
                      hoverable && 'hover:bg-gray-50 dark:hover:bg-gray-700/50',
                      onRowClick && 'cursor-pointer',
                      isActive && 'bg-blue-50 dark:bg-blue-900/20',
                      isSelected && 'bg-blue-50 dark:bg-blue-900/20',
                      typeof rowClassName === 'function'
                        ? rowClassName(row, rowIndex)
                        : rowClassName
                    )}
                    onClick={onRowClick ? () => onRowClick(row, rowIndex) : undefined}
                  >
                    {/* Selection checkbox */}
                    {selectable && (
                      <td
                        className={cellPadding}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSelectRow(row)}
                          className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                          aria-label={`Select row ${rowIndex + 1}`}
                        />
                      </td>
                    )}

                    {/* Data cells */}
                    {visibleColumns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          cellPadding,
                          'text-sm text-gray-900 dark:text-white',
                          column.align === 'center' && 'text-center',
                          column.align === 'right' && 'text-right',
                          bordered && 'border-x border-gray-200 dark:border-gray-700',
                          column.className
                        )}
                      >
                        {getCellValue(row, column)}
                      </td>
                    ))}

                    {/* Row actions */}
                    {rowActions && (
                      <td
                        className={cn(cellPadding, 'text-center')}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {rowActions(row, rowIndex)}
                      </td>
                    )}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && (
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={onPageChange || (() => {})}
          onPageSizeChange={onPageSizeChange || (() => {})}
          className="border-t border-gray-200 dark:border-gray-700 px-4"
        />
      )}
    </div>
  )
}

// ============================================
// ACTION MENU COMPONENT
// ============================================

export interface ActionMenuItem {
  label: string
  onClick: () => void
  icon?: React.ReactNode
  variant?: 'default' | 'danger'
  disabled?: boolean
}

export interface ActionMenuProps {
  items: ActionMenuItem[]
  className?: string
}

export function ActionMenu({ items, className }: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = React.useRef<HTMLDivElement>(null)

  // Close on outside click
  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div className={cn('relative', className)} ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
        aria-label="Actions menu"
      >
        <MoreHorizontal size={16} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-20">
          {items.map((item, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                item.onClick()
                setIsOpen(false)
              }}
              disabled={item.disabled}
              className={cn(
                'w-full px-3 py-2 text-left text-sm flex items-center gap-2',
                'hover:bg-gray-100 dark:hover:bg-gray-700',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                item.variant === 'danger'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-700 dark:text-gray-300'
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
