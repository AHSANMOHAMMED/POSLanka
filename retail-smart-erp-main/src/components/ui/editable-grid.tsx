'use client'

import { useState, useRef, useCallback, useEffect, KeyboardEvent } from 'react'
import { Plus, Trash2, ChevronDown, ChevronRight, Save, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LinkField, LinkFieldOption } from './link-field'

// ============================================
// TYPES
// ============================================

export type ColumnType = 'text' | 'number' | 'currency' | 'select' | 'link' | 'readonly' | 'checkbox'

export interface ColumnDef<T> {
  key: keyof T | string
  label: string
  type: ColumnType
  width?: string
  minWidth?: string
  align?: 'left' | 'center' | 'right'
  editable?: boolean
  required?: boolean
  placeholder?: string
  // For select type
  options?: { value: string; label: string }[]
  // For link type (async search)
  fetchOptions?: (search: string) => Promise<LinkFieldOption[]>
  onCreateNew?: (name: string) => void
  createLabel?: string
  // For number/currency
  min?: number
  max?: number
  step?: number | 'any'
  precision?: number
  // Custom render
  render?: (value: unknown, row: T, rowIndex: number) => React.ReactNode
  // Calculated field
  calculate?: (row: T) => number | string
  // On change callback (option is passed for link type columns)
  onChange?: (value: unknown, row: T, rowIndex: number, option?: LinkFieldOption) => Partial<T> | void
  // Hidden column (used for data but not displayed)
  hidden?: boolean
}

export interface EditableGridProps<T extends Record<string, unknown>> {
  columns: ColumnDef<T>[]
  data: T[]
  onChange: (data: T[]) => void
  onRowAdd?: () => T | Promise<T>
  onRowDelete?: (row: T, index: number) => void | Promise<void>
  onRowChange?: (row: T, index: number, field: string, value: unknown, option?: LinkFieldOption) => void | Promise<void>
  emptyRow?: Partial<T>
  idField?: keyof T
  className?: string
  maxHeight?: string
  showRowNumbers?: boolean
  showDeleteButton?: boolean
  showAddButton?: boolean
  addButtonLabel?: string
  emptyMessage?: string
  disabled?: boolean
  loading?: boolean
  // Footer totals
  footerTotals?: { key: string; label?: string }[]
  // Row grouping (for bundles)
  groupBy?: keyof T
  groupHeader?: (groupValue: unknown, rows: T[]) => React.ReactNode
  isGroupCollapsible?: boolean
  // Highlight new rows
  highlightNewRows?: boolean
  // Manual save mode (no auto-save on blur)
  manualSave?: boolean
  // Callback when user wants to save all changes (manual save mode)
  // deletedRows contains rows marked for deletion (only saved rows, not temp rows)
  onSaveChanges?: (
    dirtyRows: { row: T; index: number; changes: Record<string, unknown> }[],
    deletedRows?: T[]
  ) => void | Promise<void>
  // External dirty state control
  dirtyRowIds?: Set<string>
  onDirtyChange?: (dirtyRowIds: Set<string>) => void
  // Business type for context-aware rendering
  businessType?: string
}

// ============================================
// EDITABLE CELL COMPONENT
// ============================================

interface EditableCellProps<T> {
  column: ColumnDef<T>
  value: unknown
  row: T
  rowIndex: number
  onChange: (value: unknown, option?: LinkFieldOption) => void
  onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => void
  disabled?: boolean
  isEditing: boolean
  onStartEdit: () => void
  onEndEdit: () => void
  inputRef?: React.RefObject<HTMLInputElement | HTMLSelectElement | null>
}

function EditableCell<T extends Record<string, unknown>>({
  column,
  value,
  row,
  rowIndex,
  onChange,
  onKeyDown,
  disabled,
  isEditing,
  onStartEdit,
  onEndEdit,
  inputRef,
}: EditableCellProps<T>) {
  const [localValue, setLocalValue] = useState(value)
  // For link columns, initialize displayValue from the current cell value (e.g. serviceName, itemName)
  // so that existing rows loaded from the API show their display text instead of the placeholder.
  const [linkDisplayValue, setLinkDisplayValue] = useState(
    column.type === 'link' ? String(value ?? '') : ''
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalValue(value)
    // Keep linkDisplayValue in sync when value changes externally (e.g. after refetch)
    if (column.type === 'link') {
      setLinkDisplayValue(String(value ?? ''))
    }
  }, [value, column.type])

  const handleBlur = () => {
    if (localValue !== value) {
      onChange(localValue)
    }
    onEndEdit()
  }

  const handleKeyDownLocal = (e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleBlur()
    }
    onKeyDown(e)
  }

  // Render calculated or readonly
  if (column.type === 'readonly' || column.calculate) {
    const displayValue = column.calculate ? column.calculate(row) : value
    return (
      <div className={cn(
        'px-2 py-1.5 text-sm',
        column.align === 'right' && 'text-right',
        column.align === 'center' && 'text-center',
        'text-gray-700 dark:text-gray-300'
      )}>
        {column.render ? column.render(displayValue, row, rowIndex) : (
          column.type === 'readonly' && typeof displayValue === 'number'
            ? displayValue.toLocaleString('en-US', { minimumFractionDigits: column.precision || 2, maximumFractionDigits: column.precision || 2 })
            : String(displayValue ?? '')
        )}
      </div>
    )
  }

  // Custom render
  if (column.render && !isEditing) {
    return (
      <div
        className={cn(
          'px-2 py-1.5 text-sm cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded',
          column.align === 'right' && 'text-right',
          column.align === 'center' && 'text-center',
        )}
        onClick={!disabled && column.editable !== false ? onStartEdit : undefined}
      >
        {column.render(value, row, rowIndex)}
      </div>
    )
  }

  // Checkbox
  if (column.type === 'checkbox') {
    return (
      <div className="flex justify-center">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled || column.editable === false}
          className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
        />
      </div>
    )
  }

  // Select dropdown
  if (column.type === 'select' && column.options) {
    return (
      <select
        ref={inputRef as React.RefObject<HTMLSelectElement>}
        value={String(localValue ?? '')}
        onChange={(e) => {
          setLocalValue(e.target.value)
          onChange(e.target.value)
        }}
        onBlur={onEndEdit}
        onKeyDown={handleKeyDownLocal}
        disabled={disabled || column.editable === false}
        className={cn(
          'w-full px-2 py-1.5 text-sm bg-transparent border-0 focus:ring-2 focus:ring-blue-500 rounded',
          'dark:bg-gray-800 dark:text-white',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <option value="">{column.placeholder || 'Select...'}</option>
        {column.options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    )
  }

  // Link field (async search)
  if (column.type === 'link' && column.fetchOptions) {
    return (
      <LinkField
        value={String(localValue ?? '')}
        onChange={(val, option) => {
          setLocalValue(val)
          setLinkDisplayValue(option?.label || '')
          // Pass option through onChange for link fields
          onChange(val, option)
          // Also trigger column-level onChange if defined (pass option for link fields)
          if (column.onChange) {
            column.onChange(val, row, rowIndex, option)
          }
        }}
        fetchOptions={column.fetchOptions}
        onCreateNew={column.onCreateNew}
        createLabel={column.createLabel}
        placeholder={column.placeholder}
        displayValue={linkDisplayValue}
        disabled={disabled || column.editable === false}
      />
    )
  }

  // Number or currency input
  if (column.type === 'number' || column.type === 'currency') {
    if (!isEditing) {
      const numValue = typeof value === 'number' ? value : parseFloat(String(value)) || 0
      return (
        <div
          className={cn(
            'px-2 py-1.5 text-sm cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded',
            column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
            'text-gray-900 dark:text-white'
          )}
          onClick={!disabled && column.editable !== false ? onStartEdit : undefined}
        >
          {column.type === 'currency'
            ? numValue.toLocaleString('en-US', { minimumFractionDigits: column.precision || 2, maximumFractionDigits: column.precision || 2 })
            : numValue.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: column.precision || 3 })
          }
        </div>
      )
    }

    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="number"
        value={localValue !== undefined && localValue !== null ? String(localValue) : ''}
        onChange={(e) => setLocalValue(e.target.value === '' ? '' : parseFloat(e.target.value))}
        onBlur={handleBlur}
        onKeyDown={handleKeyDownLocal}
        min={column.min}
        max={column.max}
        step={column.step || 'any'}
        disabled={disabled || column.editable === false}
        placeholder={column.placeholder}
        className={cn(
          'w-full px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500',
          'dark:bg-gray-800 dark:text-white dark:border-blue-400',
          column.align === 'right' && 'text-right',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
        autoFocus
      />
    )
  }

  // Text input
  if (!isEditing) {
    return (
      <div
        className={cn(
          'px-2 py-1.5 text-sm cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded min-h-[28px]',
          column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left',
          'text-gray-900 dark:text-white'
        )}
        onClick={!disabled && column.editable !== false ? onStartEdit : undefined}
      >
        {String(value ?? '') || <span className="text-gray-400">{column.placeholder || '-'}</span>}
      </div>
    )
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type="text"
      value={String(localValue ?? '')}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={handleKeyDownLocal}
      disabled={disabled || column.editable === false}
      placeholder={column.placeholder}
      className={cn(
        'w-full px-2 py-1 text-sm border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500',
        'dark:bg-gray-800 dark:text-white dark:border-blue-400',
        column.align === 'right' && 'text-right',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
      autoFocus
    />
  )
}

// ============================================
// EDITABLE GRID COMPONENT
// ============================================

export function EditableGrid<T extends Record<string, unknown>>({
  columns,
  data,
  onChange,
  onRowAdd,
  onRowDelete,
  onRowChange,
  emptyRow,
  idField = 'id' as keyof T,
  className,
  maxHeight = '400px',
  showRowNumbers = true,
  showDeleteButton = true,
  showAddButton = true,
  addButtonLabel = 'Add Row',
  emptyMessage = 'No items. Click "Add Row" to add one.',
  disabled = false,
  loading = false,
  footerTotals,
  groupBy,
  groupHeader,
  isGroupCollapsible = true,
  highlightNewRows = true,
  manualSave = false,
  onSaveChanges,
  dirtyRowIds: externalDirtyRowIds,
  onDirtyChange,
  businessType,
}: EditableGridProps<T>) {
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [newRowIds, setNewRowIds] = useState<Set<string>>(new Set())
  // Internal dirty tracking for manual save mode
  const [internalDirtyRowIds, setInternalDirtyRowIds] = useState<Set<string>>(new Set())
  const [pendingChanges, setPendingChanges] = useState<Map<string, Record<string, unknown>>>(new Map())
  // Track rows marked for deletion (in manual save mode)
  const [pendingDeletions, setPendingDeletions] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null)
  const tableRef = useRef<HTMLTableElement>(null)

  // Use external or internal dirty state
  const dirtyRowIds = externalDirtyRowIds ?? internalDirtyRowIds
  const setDirtyRowIds = onDirtyChange ?? setInternalDirtyRowIds
  // Include pending deletions in dirty count so Save button appears
  const hasDirtyRows = dirtyRowIds.size > 0 || pendingDeletions.size > 0

  const visibleColumns = columns.filter(col => !col.hidden)

  // Focus input when editing starts
  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus()
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select()
      }
    }
  }, [editingCell])

  // Track new rows for highlight animation
  useEffect(() => {
    if (highlightNewRows && newRowIds.size > 0) {
      const timer = setTimeout(() => {
        setNewRowIds(new Set())
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [newRowIds, highlightNewRows])

  const handleCellChange = useCallback((rowIndex: number, columnKey: string, value: unknown, option?: LinkFieldOption) => {
    const column = columns.find(c => c.key === columnKey)
    const row = data[rowIndex]
    const rowId = String(row[idField])

    // Apply column-level onChange if exists (pass option for link fields)
    let updates: Partial<T> = { [columnKey]: value } as Partial<T>
    if (column?.onChange) {
      const extraUpdates = column.onChange(value, row, rowIndex, option)
      if (extraUpdates) {
        updates = { ...updates, ...extraUpdates }
      }
    }

    // Update local data
    const newData = [...data]
    newData[rowIndex] = { ...row, ...updates }
    onChange(newData)

    // In manual save mode, track dirty rows instead of calling onRowChange
    if (manualSave) {
      // Mark row as dirty
      const newDirtyIds = new Set(dirtyRowIds)
      newDirtyIds.add(rowId)
      setDirtyRowIds(newDirtyIds)

      // Track changes for this row
      setPendingChanges(prev => {
        const newMap = new Map(prev)
        const existingChanges = newMap.get(rowId) || {}
        newMap.set(rowId, { ...existingChanges, [columnKey]: value })
        return newMap
      })

      // For link fields, still call onRowChange so parent can populate related fields
      // (e.g., itemName, itemSku, unitPrice when itemId is selected)
      if (column?.type === 'link' && onRowChange && option) {
        onRowChange(newData[rowIndex], rowIndex, columnKey, value, option)
      }
    } else {
      // Auto-save mode: call external handler immediately
      if (onRowChange) {
        onRowChange(newData[rowIndex], rowIndex, columnKey, value, option)
      }
    }
  }, [data, columns, onChange, onRowChange, manualSave, idField, dirtyRowIds, setDirtyRowIds])

  const handleAddRow = useCallback(async () => {
    let newRow: T
    if (onRowAdd) {
      newRow = await onRowAdd()
    } else if (emptyRow) {
      newRow = { ...emptyRow, [idField]: `temp-${Date.now()}` } as T
    } else {
      newRow = { [idField]: `temp-${Date.now()}` } as T
    }

    const newData = [...data, newRow]
    onChange(newData)

    // Track for highlight
    if (highlightNewRows) {
      setNewRowIds(new Set([String(newRow[idField])]))
    }

    // Start editing first editable cell in new row
    const firstEditableCol = visibleColumns.findIndex(col => col.editable !== false && col.type !== 'readonly' && !col.calculate)
    if (firstEditableCol >= 0) {
      setTimeout(() => {
        setEditingCell({ row: newData.length - 1, col: firstEditableCol })
      }, 50)
    }
  }, [data, onChange, onRowAdd, emptyRow, idField, visibleColumns, highlightNewRows])

  const handleDeleteRow = useCallback(async (rowIndex: number) => {
    const row = data[rowIndex]
    const rowId = String(row[idField])
    const isNewRow = rowId.startsWith('temp-') || (row as Record<string, unknown>).isNew

    // In manual save mode, defer deletion for saved rows
    if (manualSave && !isNewRow) {
      // Mark row for deletion - will be deleted when Save is clicked
      setPendingDeletions(prev => new Set(prev).add(rowId))
      // Remove from dirty tracking (changes don't matter if being deleted)
      const newDirtyIds = new Set(dirtyRowIds)
      newDirtyIds.delete(rowId)
      setDirtyRowIds(newDirtyIds)
      setPendingChanges(prev => {
        const newMap = new Map(prev)
        newMap.delete(rowId)
        return newMap
      })
      return // Don't remove from data yet - show with strikethrough
    }

    // For new/temp rows or non-manual-save mode, delete immediately
    if (onRowDelete && !isNewRow) {
      await onRowDelete(row, rowIndex)
    }
    const newData = data.filter((_, i) => i !== rowIndex)
    onChange(newData)

    // Remove from dirty tracking
    if (manualSave) {
      const newDirtyIds = new Set(dirtyRowIds)
      newDirtyIds.delete(rowId)
      setDirtyRowIds(newDirtyIds)
      setPendingChanges(prev => {
        const newMap = new Map(prev)
        newMap.delete(rowId)
        return newMap
      })
    }
  }, [data, onChange, onRowDelete, manualSave, idField, dirtyRowIds, setDirtyRowIds])

  // Handle saving all changes (manual save mode)
  const handleSaveChanges = useCallback(async () => {
    if (!onSaveChanges || (dirtyRowIds.size === 0 && pendingDeletions.size === 0)) return

    const dirtyRows = data
      .map((row, index) => ({
        row,
        index,
        changes: pendingChanges.get(String(row[idField])) || {},
      }))
      .filter(({ row }) => dirtyRowIds.has(String(row[idField])))

    // Get rows marked for deletion
    const deletedRows = data.filter(row => pendingDeletions.has(String(row[idField])))

    await onSaveChanges(dirtyRows, deletedRows.length > 0 ? deletedRows : undefined)

    // Clear dirty state after successful save
    setDirtyRowIds(new Set())
    setPendingChanges(new Map())
    // Clear pending deletions - parent should remove them from data after API calls
    setPendingDeletions(new Set())
  }, [data, dirtyRowIds, pendingDeletions, pendingChanges, onSaveChanges, idField, setDirtyRowIds])

  // Discard all changes (manual save mode)
  const handleDiscardChanges = useCallback(() => {
    setDirtyRowIds(new Set())
    setPendingChanges(new Map())
    setPendingDeletions(new Set())
    // Note: This doesn't revert data - parent should handle that if needed
  }, [setDirtyRowIds])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>, rowIndex: number, colIndex: number) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const nextCol = e.shiftKey ? colIndex - 1 : colIndex + 1

      if (nextCol >= 0 && nextCol < visibleColumns.length) {
        // Check if next column is editable
        const nextColumn = visibleColumns[nextCol]
        if (nextColumn.editable !== false && nextColumn.type !== 'readonly' && !nextColumn.calculate) {
          setEditingCell({ row: rowIndex, col: nextCol })
        } else {
          // Find next editable column
          const direction = e.shiftKey ? -1 : 1
          let searchCol = nextCol + direction
          while (searchCol >= 0 && searchCol < visibleColumns.length) {
            const col = visibleColumns[searchCol]
            if (col.editable !== false && col.type !== 'readonly' && !col.calculate) {
              setEditingCell({ row: rowIndex, col: searchCol })
              return
            }
            searchCol += direction
          }
          // Move to next/prev row
          const nextRow = e.shiftKey ? rowIndex - 1 : rowIndex + 1
          if (nextRow >= 0 && nextRow < data.length) {
            const firstEditableIdx = e.shiftKey
              ? visibleColumns.length - 1 - [...visibleColumns].reverse().findIndex(col => col.editable !== false && col.type !== 'readonly' && !col.calculate)
              : visibleColumns.findIndex(col => col.editable !== false && col.type !== 'readonly' && !col.calculate)
            if (firstEditableIdx >= 0) {
              setEditingCell({ row: nextRow, col: firstEditableIdx })
            }
          }
        }
      }
    } else if (e.key === 'Escape') {
      setEditingCell(null)
    } else if (e.key === 'ArrowDown' && e.altKey) {
      e.preventDefault()
      if (rowIndex < data.length - 1) {
        setEditingCell({ row: rowIndex + 1, col: colIndex })
      }
    } else if (e.key === 'ArrowUp' && e.altKey) {
      e.preventDefault()
      if (rowIndex > 0) {
        setEditingCell({ row: rowIndex - 1, col: colIndex })
      }
    }
  }, [visibleColumns, data.length])

  const toggleGroup = (groupValue: string) => {
    setCollapsedGroups(prev => {
      const newSet = new Set(prev)
      if (newSet.has(groupValue)) {
        newSet.delete(groupValue)
      } else {
        newSet.add(groupValue)
      }
      return newSet
    })
  }

  // Group data if groupBy is specified
  const groupedData = groupBy
    ? data.reduce((acc, row, index) => {
        const groupValue = String(row[groupBy] ?? '__ungrouped__')
        if (!acc[groupValue]) {
          acc[groupValue] = []
        }
        acc[groupValue].push({ row, originalIndex: index })
        return acc
      }, {} as Record<string, { row: T; originalIndex: number }[]>)
    : null

  // Calculate footer totals
  const totals = footerTotals?.reduce((acc, { key }) => {
    const column = columns.find(c => c.key === key)
    let total = 0
    data.forEach(row => {
      const value = column?.calculate ? column.calculate(row) : row[key as keyof T]
      const numValue = typeof value === 'number' ? value : parseFloat(String(value)) || 0
      total += numValue
    })
    acc[key] = total
    return acc
  }, {} as Record<string, number>)

  return (
    <div className={cn('border dark:border-gray-700 rounded overflow-hidden', className)}>
      <div className="overflow-auto" style={{ maxHeight }}>
        <table ref={tableRef} className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
            <tr>
              {showRowNumbers && (
                <th className="w-10 px-2 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                  #
                </th>
              )}
              {visibleColumns.map((col) => (
                <th
                  key={String(col.key)}
                  className={cn(
                    'px-2 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 border-b dark:border-gray-700',
                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                  )}
                  style={{ width: col.width, minWidth: col.minWidth }}
                >
                  {col.label}
                  {col.required && <span className="text-red-500 ml-0.5">*</span>}
                </th>
              ))}
              {showDeleteButton && (
                <th className="w-10 px-2 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">

                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {data.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + (showRowNumbers ? 1 : 0) + (showDeleteButton ? 1 : 0)}
                  className="px-4 py-8 text-center text-gray-500 dark:text-gray-400"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : groupedData ? (
              // Render grouped data
              Object.entries(groupedData).map(([groupValue, rows]) => {
                const isCollapsed = collapsedGroups.has(groupValue)
                const isUngrouped = groupValue === '__ungrouped__'

                return (
                  <tbody key={groupValue}>
                    {!isUngrouped && (
                      <tr className="bg-blue-50 dark:bg-blue-900/20">
                        <td
                          colSpan={visibleColumns.length + (showRowNumbers ? 1 : 0) + (showDeleteButton ? 1 : 0)}
                          className="px-2 py-2"
                        >
                          <button
                            type="button"
                            onClick={() => isGroupCollapsible && toggleGroup(groupValue)}
                            className="flex items-center gap-2 text-sm font-medium text-blue-700 dark:text-blue-300"
                          >
                            {isGroupCollapsible && (
                              isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />
                            )}
                            {groupHeader ? groupHeader(groupValue, rows.map(r => r.row)) : groupValue}
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              ({rows.length} items)
                            </span>
                          </button>
                        </td>
                      </tr>
                    )}
                    {!isCollapsed && rows.map(({ row, originalIndex }) => (
                      <tr
                        key={String(row[idField]) || originalIndex}
                        className={cn(
                          'hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors',
                          !isUngrouped && 'bg-blue-50/30 dark:bg-blue-900/10',
                          highlightNewRows && newRowIds.has(String(row[idField])) && 'animate-pulse bg-green-50 dark:bg-green-900/20'
                        )}
                      >
                        {showRowNumbers && (
                          <td className="px-2 py-1 text-center text-xs text-gray-400 dark:text-gray-500">
                            {originalIndex + 1}
                          </td>
                        )}
                        {visibleColumns.map((col, colIdx) => (
                          <td
                            key={String(col.key)}
                            className={cn(
                              'px-1 py-0.5',
                              col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                            )}
                          >
                            <EditableCell
                              column={col}
                              value={row[col.key as keyof T]}
                              row={row}
                              rowIndex={originalIndex}
                              onChange={(value, option) => handleCellChange(originalIndex, String(col.key), value, option)}
                              onKeyDown={(e) => handleKeyDown(e, originalIndex, colIdx)}
                              disabled={disabled || loading}
                              isEditing={editingCell?.row === originalIndex && editingCell?.col === colIdx}
                              onStartEdit={() => setEditingCell({ row: originalIndex, col: colIdx })}
                              onEndEdit={() => setEditingCell(null)}
                              inputRef={editingCell?.row === originalIndex && editingCell?.col === colIdx ? inputRef : undefined}
                            />
                          </td>
                        ))}
                        {showDeleteButton && (
                          <td className="px-1 py-0.5 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeleteRow(originalIndex)}
                              disabled={disabled || loading}
                              className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
                              title="Delete row"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                )
              })
            ) : (
              // Render flat data
              data.map((row, rowIndex) => {
                const rowId = String(row[idField])
                const isDirty = manualSave && dirtyRowIds.has(rowId)
                const isPendingDeletion = manualSave && pendingDeletions.has(rowId)
                return (
                <tr
                  key={rowId || String(rowIndex)}
                  className={cn(
                    'hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors',
                    highlightNewRows && newRowIds.has(rowId) && 'animate-pulse bg-green-50 dark:bg-green-900/20',
                    isDirty && !isPendingDeletion && 'bg-amber-50 dark:bg-amber-900/20 border-l-2 border-l-amber-400',
                    isPendingDeletion && 'bg-red-50 dark:bg-red-900/20 opacity-60 border-l-2 border-l-red-400'
                  )}
                >
                  {showRowNumbers && (
                    <td className={cn(
                      "px-2 py-1 text-center text-xs text-gray-400 dark:text-gray-500",
                      isPendingDeletion && 'line-through'
                    )}>
                      {rowIndex + 1}
                    </td>
                  )}
                  {visibleColumns.map((col, colIdx) => (
                    <td
                      key={String(col.key)}
                      className={cn(
                        'px-1 py-0.5',
                        col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                        isPendingDeletion && 'line-through text-gray-400 dark:text-gray-500'
                      )}
                    >
                      <EditableCell
                        column={col}
                        value={row[col.key as keyof T]}
                        row={row}
                        rowIndex={rowIndex}
                        onChange={(value, option) => handleCellChange(rowIndex, String(col.key), value, option)}
                        onKeyDown={(e) => handleKeyDown(e, rowIndex, colIdx)}
                        disabled={disabled || loading || isPendingDeletion}
                        isEditing={editingCell?.row === rowIndex && editingCell?.col === colIdx}
                        onStartEdit={() => setEditingCell({ row: rowIndex, col: colIdx })}
                        onEndEdit={() => setEditingCell(null)}
                        inputRef={editingCell?.row === rowIndex && editingCell?.col === colIdx ? inputRef : undefined}
                      />
                    </td>
                  ))}
                  {showDeleteButton && (
                    <td className="px-1 py-0.5 text-center">
                      {!isPendingDeletion && (
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(rowIndex)}
                          disabled={disabled || loading}
                          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-50"
                          title="Delete row"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )})
            )}
          </tbody>
          {/* Footer totals */}
          {footerTotals && totals && data.length > 0 && (
            <tfoot className="bg-gray-50 dark:bg-gray-800 border-t dark:border-gray-700">
              <tr>
                {showRowNumbers && <td className="px-2 py-2"></td>}
                {visibleColumns.map((col) => {
                  const totalConfig = footerTotals.find(t => t.key === col.key)
                  const totalValue = totals[String(col.key)]
                  return (
                    <td
                      key={String(col.key)}
                      className={cn(
                        'px-2 py-2 text-sm font-medium',
                        col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                        'text-gray-900 dark:text-white'
                      )}
                    >
                      {totalConfig ? (
                        totalValue !== undefined ? (
                          col.type === 'currency' || col.type === 'number'
                            ? totalValue.toLocaleString('en-US', { minimumFractionDigits: col.precision || 2, maximumFractionDigits: col.precision || 2 })
                            : totalValue
                        ) : (totalConfig.label || '')
                      ) : ''}
                    </td>
                  )
                })}
                {showDeleteButton && <td className="px-2 py-2"></td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Footer: Add row button and Save Changes (manual save mode) */}
      {(showAddButton || (manualSave && hasDirtyRows)) && (
        <div className="px-2 py-2 bg-gray-50 dark:bg-gray-800 border-t dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {showAddButton && (
              <button
                type="button"
                onClick={handleAddRow}
                disabled={disabled || loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors disabled:opacity-50"
              >
                <Plus size={16} />
                {addButtonLabel}
              </button>
            )}
          </div>

          {/* Manual Save Mode: Save/Discard buttons */}
          {manualSave && hasDirtyRows && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-amber-600 dark:text-amber-400">
                {dirtyRowIds.size > 0 && `${dirtyRowIds.size} unsaved ${dirtyRowIds.size === 1 ? 'change' : 'changes'}`}
                {dirtyRowIds.size > 0 && pendingDeletions.size > 0 && ', '}
                {pendingDeletions.size > 0 && <span className="text-red-600 dark:text-red-400">{pendingDeletions.size} pending {pendingDeletions.size === 1 ? 'deletion' : 'deletions'}</span>}
              </span>
              <button
                type="button"
                onClick={handleDiscardChanges}
                disabled={disabled || loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
              >
                <RotateCcw size={14} />
                Discard
              </button>
              <button
                type="button"
                onClick={handleSaveChanges}
                disabled={disabled || loading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white hover:bg-green-700 rounded transition-colors disabled:opacity-50"
              >
                <Save size={14} />
                Save Changes
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
