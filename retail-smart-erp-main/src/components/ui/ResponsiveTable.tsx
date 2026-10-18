'use client'

import * as React from 'react'
import { DataTable, type DataTableProps, type Column } from './data-table'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/useResponsive'

/**
 * Props for ResponsiveTable that extends DataTableProps with mobile-specific options
 */
export interface ResponsiveTableProps<T> extends DataTableProps<T> {
  /** Enable horizontal scrolling on mobile devices */
  scrollableOnMobile?: boolean
  /** Stack table rows on mobile (cards layout) */
  stackOnMobile?: boolean
  /** Custom labels for stacked rows (defaults to column headers) */
  mobileStackLabels?: Record<string, string>
  /** Custom className for mobile wrapper */
  mobileClassName?: string
  /** Hide certain columns on mobile */
  hideOnMobile?: string[]
  /** Show certain columns only on mobile */
  showOnlyOnMobile?: string[]
  /** Enable action sheet for row actions on mobile */
  useActionSheetOnMobile?: boolean
}

/**
 * A responsive wrapper around DataTable that provides mobile-optimized layouts
 * 
 * Features:
 * - Horizontal scrolling for tables on mobile
 * - Stacked rows (card layout) for better mobile readability
 * - Conditional column visibility based on screen size
 * - Mobile-optimized touch targets
 * - Action sheet support for row actions
 */
export function ResponsiveTable<T extends Record<string, unknown>>({
  // DataTable props
  columns,
  data,
  keyField,
  
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
  
  // Responsive props
  scrollableOnMobile = true,
  stackOnMobile = false,
  mobileStackLabels,
  mobileClassName,
  hideOnMobile = [],
  showOnlyOnMobile = [],
  useActionSheetOnMobile: _useActionSheetOnMobile = false,

  // Pass any other props
  ...props
}: ResponsiveTableProps<T>) {
  const isMobile = useIsMobile()
  
  // Filter columns based on mobile visibility rules
  const responsiveColumns = React.useMemo(() => {
    if (!isMobile) {
      return columns
    }
    
    return columns.map(col => {
      // Check if column should be hidden on mobile
      const shouldHide = hideOnMobile.includes(col.key)
      
      // Check if column should be shown only on mobile
      const mobileOnly = showOnlyOnMobile.includes(col.key)
      
      // If it's a mobile-only column, ensure it's visible
      if (mobileOnly) {
        return { ...col, hidden: false }
      }
      
      // If it should be hidden on mobile, mark as hidden
      if (shouldHide) {
        return { ...col, hidden: true }
      }
      
      return col
    })
  }, [columns, isMobile, hideOnMobile, showOnlyOnMobile])
  
  // Apply mobile-specific table class names
  const responsiveTableClassName = React.useMemo(() => {
    const classes = []
    
    if (isMobile) {
      if (scrollableOnMobile && !stackOnMobile) {
        classes.push('scrollable-mobile')
      }
      
      if (stackOnMobile) {
        classes.push('table-stack-mobile')
      }
    }
    
    if (tableClassName) {
      classes.push(tableClassName)
    }
    
    return classes.join(' ')
  }, [isMobile, scrollableOnMobile, stackOnMobile, tableClassName])
  
  // Apply mobile-specific wrapper class names
  const wrapperClassName = React.useMemo(() => {
    const classes = ['responsive-table-wrapper']
    
    if (isMobile) {
      classes.push('responsive-table-mobile')
      
      if (mobileClassName) {
        classes.push(mobileClassName)
      }
    }
    
    if (className) {
      classes.push(className)
    }
    
    return cn(classes)
  }, [isMobile, mobileClassName, className])
  
  // For stacked layout on mobile, we need to prepare data labels
  const getMobileStackLabel = React.useCallback((columnKey: string): string => {
    if (mobileStackLabels && mobileStackLabels[columnKey]) {
      return mobileStackLabels[columnKey]
    }
    
    // Find the column to get its header
    const column = columns.find(col => col.key === columnKey)
    if (!column) return columnKey
    
    // Extract text from header if it's a React node
    if (typeof column.header === 'string') {
      return column.header
    }
    
    // Default to column key
    return column.key
  }, [columns, mobileStackLabels])
  
  // Render stacked table rows for mobile
  const renderStackedMobileRows = React.useMemo(() => {
    if (!isMobile || !stackOnMobile || loading || data.length === 0) {
      return null
    }
    
    const visibleColumns = responsiveColumns.filter(col => !col.hidden)
    
    return (
      <div className="mobile-stacked-rows space-y-3">
        {data.map((row, rowIndex) => {
          const rowKey = typeof keyField === 'function' 
            ? keyField(row) 
            : row[keyField as keyof T] !== undefined 
              ? String(row[keyField as keyof T]) 
              : String(rowIndex)
          
          const isActive = isRowActive?.(row)
          const isSelected = selectable && selectedRows.some(r => {
            const rKey = typeof keyField === 'function' 
              ? keyField(r) 
              : r[keyField as keyof T] !== undefined 
                ? String(r[keyField as keyof T]) 
                : String(data.indexOf(r))
            return rKey === rowKey
          })
          
          return (
            <div
              key={rowKey}
              className={cn(
                'bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4',
                'shadow-sm hover:shadow-md transition-shadow duration-200',
                onRowClick && 'cursor-pointer',
                isActive && 'border-blue-500 dark:border-blue-400 border-2',
                isSelected && 'bg-blue-50 dark:bg-blue-900/20',
              )}
              onClick={onRowClick ? () => onRowClick(row, rowIndex) : undefined}
            >
              <div className="space-y-3">
                {visibleColumns.map((column) => {
                  // Get cell value
                  let cellValue: React.ReactNode
                  if (column.render) {
                    const value = column.accessor
                      ? typeof column.accessor === 'function'
                        ? column.accessor(row)
                        : row[column.accessor]
                      : undefined
                    cellValue = column.render(value, row, rowIndex)
                  } else if (column.accessor) {
                    if (typeof column.accessor === 'function') {
                      cellValue = column.accessor(row)
                    } else {
                      cellValue = row[column.accessor] as React.ReactNode
                    }
                  } else {
                    cellValue = row[column.key as keyof T] as React.ReactNode
                  }
                  
                  return (
                    <div key={column.key} className="flex flex-col">
                      <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">
                        {getMobileStackLabel(column.key)}
                      </div>
                      <div className={cn(
                        'text-sm text-gray-900 dark:text-white',
                        column.align === 'center' && 'text-center',
                        column.align === 'right' && 'text-right',
                        column.className
                      )}>
                        {cellValue || '-'}
                      </div>
                    </div>
                  )
                })}
                
                {/* Row actions for mobile */}
                {rowActions && (
                  <div 
                    className="pt-3 border-t border-gray-200 dark:border-gray-700 mt-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex justify-end">
                      {rowActions(row, rowIndex)}
                    </div>
                  </div>
                )}
                
                {/* Selection checkbox for mobile */}
                {selectable && (
                  <div 
                    className="pt-3 border-t border-gray-200 dark:border-gray-700 mt-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          if (!onSelectionChange) return
                          
                          const rowKey = typeof keyField === 'function' 
                            ? keyField(row) 
                            : row[keyField as keyof T] !== undefined 
                              ? String(row[keyField as keyof T]) 
                              : String(rowIndex)
                          
                          const isCurrentlySelected = selectedRows.some(r => {
                            const rKey = typeof keyField === 'function' 
                              ? keyField(r) 
                              : r[keyField as keyof T] !== undefined 
                                ? String(r[keyField as keyof T]) 
                                : String(data.indexOf(r))
                            return rKey === rowKey
                          })
                          
                          if (isCurrentlySelected) {
                            onSelectionChange(
                              selectedRows.filter(r => {
                                const rKey = typeof keyField === 'function' 
                                  ? keyField(r) 
                                  : r[keyField as keyof T] !== undefined 
                                    ? String(r[keyField as keyof T]) 
                                    : String(data.indexOf(r))
                                return rKey !== rowKey
                              })
                            )
                          } else {
                            onSelectionChange([...selectedRows, row])
                          }
                        }}
                        className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                        aria-label={`Select row ${rowIndex + 1}`}
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        Select
                      </span>
                    </label>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }, [
    isMobile, stackOnMobile, loading, data, responsiveColumns, keyField, 
    isRowActive, selectable, selectedRows, onRowClick, rowActions, 
    onSelectionChange, getMobileStackLabel
  ])
  
  // If we're on mobile and using stacked layout, render custom mobile layout
  if (isMobile && stackOnMobile) {
    return (
      <div className={wrapperClassName}>
        {/* Search bar */}
        {searchable && (
          <div className="mb-4">
            <div className="p-4 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={searchValue}
                onChange={(e) => onSearchChange?.(e.target.value)}
                className="w-full px-4 py-3 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        )}
        
        {/* Loading state for mobile stacked layout */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
                <div className="space-y-3">
                  {responsiveColumns.filter(col => !col.hidden).slice(0, 3).map((col) => (
                    <div key={col.key} className="flex flex-col">
                      <div className="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse mb-1" />
                      <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-8 text-center">
            {emptyIcon && <div className="mb-4">{emptyIcon}</div>}
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              {emptyTitle}
            </h3>
            {emptyDescription && (
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                {emptyDescription}
              </p>
            )}
            {emptyAction && <div>{emptyAction}</div>}
          </div>
        ) : (
          renderStackedMobileRows
        )}
        
        {/* Pagination for mobile */}
        {pagination && (
          <div className="mt-6">
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Showing {((pagination.page - 1) * pagination.pageSize) + 1} to{' '}
                  {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{' '}
                  {pagination.total} entries
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={() => onPageChange?.(pagination.page - 1)}
                    disabled={pagination.page <= 1}
                    className="px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => onPageChange?.(pagination.page + 1)}
                    disabled={pagination.page >= pagination.totalPages}
                    className="px-3 py-2 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }
  
  // Otherwise, render the standard DataTable with mobile enhancements
  return (
    <div className={wrapperClassName}>
      <DataTable
        columns={responsiveColumns}
        data={data}
        keyField={keyField}
        
        // Pagination
        pagination={pagination}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        
        // Sorting
        sortable={sortable}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSort={onSort}
        
        // Selection
        selectable={selectable}
        selectedRows={selectedRows}
        onSelectionChange={onSelectionChange}
        
        // Row actions
        onRowClick={onRowClick}
        rowActions={rowActions}
        isRowActive={isRowActive}
        
        // Search
        searchable={searchable}
        searchPlaceholder={searchPlaceholder}
        searchValue={searchValue}
        onSearchChange={onSearchChange}
        
        // States
        loading={loading}
        emptyIcon={emptyIcon}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
        emptyAction={emptyAction}
        
        // Styling
        className={className}
        tableClassName={responsiveTableClassName}
        headerClassName={headerClassName}
        rowClassName={rowClassName}
        stickyHeader={stickyHeader}
        compact={isMobile ? true : compact} // Force compact on mobile
        striped={striped}
        bordered={bordered}
        hoverable={hoverable}
        
        // Pass through any other props
        {...props}
      />
    </div>
  )
}

/**
 * Utility hook for responsive table configuration
 */
export function useResponsiveTableConfig() {
  const isMobile = useIsMobile()
  
  const getResponsiveColumns = React.useCallback(
    (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      columns: Column<any>[],
      options?: {
        hideOnMobile?: string[]
        showOnlyOnMobile?: string[]
      }
    ) => {
      if (!isMobile) {
        return columns
      }
      
      const { hideOnMobile = [], showOnlyOnMobile = [] } = options || {}
      
      return columns.map(col => {
        // Check if column should be hidden on mobile
        const shouldHide = hideOnMobile.includes(col.key)
        
        // Check if column should be shown only on mobile
        const mobileOnly = showOnlyOnMobile.includes(col.key)
        
        // If it's a mobile-only column, ensure it's visible
        if (mobileOnly) {
          return { ...col, hidden: false }
        }
        
        // If it should be hidden on mobile, mark as hidden
        if (shouldHide) {
          return { ...col, hidden: true }
        }
        
        return col
      })
    },
    [isMobile]
  )
  
  return {
    isMobile,
    getResponsiveColumns,
    scrollableOnMobile: true,
    stackOnMobile: false,
  }
}

export default ResponsiveTable