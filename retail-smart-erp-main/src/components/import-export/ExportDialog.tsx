'use client'

import { useState, useEffect, useCallback } from 'react'
import { Download, FileSpreadsheet, FileText, Check, Filter, Calendar } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { getEntityConfig, getExportFields } from '@/lib/import-export/entity-config'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'

// Entities that support date range filtering
const DATE_FILTERABLE_ENTITIES = new Set([
  'sales', 'purchases', 'purchase-orders', 'sales-orders', 'work-orders',
  'stock-movements', 'appointments', 'activity-logs', 'restaurant-orders',
  'waste-log', 'refunds',
])

// Human-readable labels for filter keys
const FILTER_LABELS: Record<string, string> = {
  search: 'Search',
  status: 'Status',
  categoryId: 'Category',
  supplierId: 'Supplier',
  warehouseId: 'Warehouse',
  type: 'Type',
  referenceType: 'Reference Type',
  orderType: 'Order Type',
  action: 'Action',
  entityType: 'Entity Type',
  startDate: 'From',
  endDate: 'To',
  dateFrom: 'From',
  dateTo: 'To',
}

interface ExportDialogProps {
  isOpen: boolean
  onClose: () => void
  entity: string
  currentFilters?: Record<string, string>
}

export function ExportDialog({ isOpen, onClose, entity, currentFilters }: ExportDialogProps) {
  const [format, setFormat] = useState<'csv' | 'xlsx'>('xlsx')
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set())
  const [applyFilters, setApplyFilters] = useState(true)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [rowCount, setRowCount] = useState<number | null>(null)
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const company = useCompanyOptional()
  const entityConfig = getEntityConfig(entity)
  const exportFields = entityConfig ? getExportFields(entityConfig, company?.businessType) : []
  const hasDateField = DATE_FILTERABLE_ENTITIES.has(entity)

  // Initialize when dialog opens
  useEffect(() => {
    if (isOpen && exportFields.length > 0) {
      setSelectedFields(new Set(exportFields.map(f => f.key)))
      // Pre-fill date range from page filters if available
      setStartDate(currentFilters?.startDate || currentFilters?.dateFrom || '')
      setEndDate(currentFilters?.endDate || currentFilters?.dateTo || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, entity])

  // Build the full set of active filters for the API
  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams({ entity, countOnly: 'true' })

    if (applyFilters && currentFilters) {
      for (const [key, value] of Object.entries(currentFilters)) {
        if (value && key !== 'startDate' && key !== 'endDate' && key !== 'dateFrom' && key !== 'dateTo') {
          params.set(key, value)
        }
      }
    }

    // Date range (from dialog inputs, which may be pre-filled from page)
    if (startDate) params.set('startDate', startDate)
    if (endDate) params.set('endDate', endDate)

    return params
  }, [entity, applyFilters, currentFilters, startDate, endDate])

  const fetchCount = useCallback(async () => {
    if (!entityConfig) return
    setLoading(true)
    try {
      const params = buildFilterParams()
      const res = await fetch(`/api/export?${params}`)
      if (res.ok) {
        const data = await res.json()
        setRowCount(data.count)
        setTotalCount(data.totalCount ?? data.count)
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [entityConfig, buildFilterParams])

  useEffect(() => {
    if (isOpen) fetchCount()
  }, [isOpen, applyFilters, startDate, endDate, fetchCount])

  function toggleField(key: string) {
    const next = new Set(selectedFields)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelectedFields(next)
  }

  function selectAll() {
    setSelectedFields(new Set(exportFields.map(f => f.key)))
  }

  function clearAll() {
    setSelectedFields(new Set())
  }

  async function handleExport() {
    if (selectedFields.size === 0) {
      toast.error('Select at least one column')
      return
    }

    setExporting(true)
    try {
      const params = new URLSearchParams({
        entity,
        format,
        fields: Array.from(selectedFields).join(','),
      })

      if (applyFilters && currentFilters) {
        for (const [key, value] of Object.entries(currentFilters)) {
          if (value && key !== 'startDate' && key !== 'endDate' && key !== 'dateFrom' && key !== 'dateTo') {
            params.set(key, value)
          }
        }
      }

      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)

      const res = await fetch(`/api/export?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Export failed' }))
        toast.error(err.error || 'Export failed')
        return
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disposition = res.headers.get('Content-Disposition')
      const fileNameMatch = disposition?.match(/filename="(.+)"/)
      a.download = fileNameMatch?.[1] || `${entity}_export.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      const exportedCount = res.headers.get('X-Row-Count')
      toast.success(`Exported ${exportedCount || ''} records`)
      onClose()
    } catch {
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  if (!entityConfig) return null

  // Determine active filters for display
  const activePageFilters = currentFilters
    ? Object.entries(currentFilters).filter(([k, v]) => v && k !== 'startDate' && k !== 'endDate' && k !== 'dateFrom' && k !== 'dateTo')
    : []
  const hasPageFilters = activePageFilters.length > 0
  const hasDateRange = !!(startDate || endDate)
  const isFiltered = (applyFilters && hasPageFilters) || hasDateRange

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Export ${entityConfig.label}`}
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {loading ? (
              <span className="flex items-center gap-1.5">
                <div className="w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                Counting...
              </span>
            ) : rowCount !== null ? (
              isFiltered && totalCount !== null && totalCount !== rowCount ? (
                <span>
                  <strong className="text-gray-900 dark:text-white">{rowCount.toLocaleString()}</strong>
                  {' '}of {totalCount.toLocaleString()} records
                  <span className="ml-1 text-xs text-blue-600 dark:text-blue-400">(filtered)</span>
                </span>
              ) : (
                <span>
                  <strong className="text-gray-900 dark:text-white">{rowCount.toLocaleString()}</strong> records
                </span>
              )
            ) : ''}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={exporting || selectedFields.size === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exporting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download size={16} />
                  Export {rowCount !== null ? rowCount.toLocaleString() : ''} Records
                </>
              )}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Format Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Format</label>
          <div className="flex gap-3">
            <button
              onClick={() => setFormat('xlsx')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded border-2 transition-all ${
                format === 'xlsx'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
              }`}
            >
              <FileSpreadsheet size={18} />
              <div className="text-left">
                <div className="text-sm font-medium">Excel (.xlsx)</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Formatted with filters</div>
              </div>
              {format === 'xlsx' && <Check size={16} className="ml-2 text-blue-500" />}
            </button>
            <button
              onClick={() => setFormat('csv')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded border-2 transition-all ${
                format === 'csv'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
              }`}
            >
              <FileText size={18} />
              <div className="text-left">
                <div className="text-sm font-medium">CSV (.csv)</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Universal format</div>
              </div>
              {format === 'csv' && <Check size={16} className="ml-2 text-blue-500" />}
            </button>
          </div>
        </div>

        {/* Column Selection */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Columns ({selectedFields.size} of {exportFields.length})
            </label>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">Select All</button>
              <button onClick={clearAll} className="text-xs text-gray-500 dark:text-gray-400 hover:underline">Clear All</button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-800/50 rounded border border-gray-200 dark:border-gray-700">
            {exportFields.map(field => (
              <label
                key={field.key}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white dark:hover:bg-gray-700 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedFields.has(field.key)}
                  onChange={() => toggleField(field.key)}
                  className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{field.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Filters Section */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-gray-500" />
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Filters</label>
            {isFiltered && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                Active
              </span>
            )}
          </div>

          {/* Page filters toggle */}
          {hasPageFilters && (
            <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded border border-gray-200 dark:border-gray-700">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={applyFilters}
                  onChange={(e) => setApplyFilters(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Apply current page filters</span>
              </label>
              {applyFilters && (
                <div className="mt-2 ml-6 flex flex-wrap gap-1.5">
                  {activePageFilters.map(([key, value]) => (
                    <span key={key} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                      <span className="font-medium">{FILTER_LABELS[key] || key}:</span>
                      <span>{value}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Date Range */}
          {hasDateField && (
            <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-2">
                <Calendar size={14} className="text-gray-500" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Date Range</span>
                {(startDate || endDate) && (
                  <button
                    onClick={() => { setStartDate(''); setEndDate('') }}
                    className="ml-auto text-xs text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-400"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Start date"
                />
                <span className="text-xs text-gray-400">to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="End date"
                />
              </div>
              {!startDate && !endDate && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">Leave empty to export all dates</p>
              )}
            </div>
          )}

          {/* No filters message */}
          {!hasPageFilters && !hasDateField && (
            <p className="text-xs text-gray-400 dark:text-gray-500 pl-5">No filters available — all records will be exported</p>
          )}
        </div>
      </div>
    </Modal>
  )
}
