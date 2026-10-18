'use client'

import { useState, useCallback, useEffect } from 'react'
import { Plus, Trash2, Calendar, TrendingDown, DollarSign, AlertTriangle, Download } from 'lucide-react'
import { usePaginatedData, useRealtimeData, useCurrency } from '@/hooks'
import { useExport } from '@/hooks/useExport'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { Pagination } from '@/components/ui/pagination'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormInput, FormLabel, FormSelect, FormTextarea } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { formatCurrency } from '@/lib/utils/currency'
import { EmptyState, Button } from '@/components/ui'
import { ExportDialog } from '@/components/import-export/ExportDialog'

// ============================================
// TYPES
// ============================================

interface WasteEntry {
  id: string
  itemId: string
  itemName: string
  quantity: string
  unit: string
  reason: string
  notes: string | null
  cost: string
  recordedBy: string
  recordedByName: string
  createdAt: string
}

interface WasteSummary {
  todayCount: number
  todayCost: string
  weekCount: number
  weekCost: string
  totalCost: string
}

interface WasteFormData {
  itemId: string
  itemName: string
  quantity: string
  unit: string
  reason: string
  notes: string
}

interface ItemOption {
  value: string
  label: string
  data?: {
    costPrice?: string
    unit?: string
  }
}

const WASTE_REASONS = [
  'Expired',
  'Damaged',
  'Overproduction',
  'Preparation Waste',
  'Quality Issue',
  'Other',
]

const INITIAL_FORM_DATA: WasteFormData = {
  itemId: '',
  itemName: '',
  quantity: '',
  unit: 'piece',
  reason: 'Expired',
  notes: '',
}

const WASTE_UNITS = [
  'piece', 'kg', 'g', 'L', 'mL', 'portion', 'serving', 'batch', 'cup', 'oz', 'lb',
]

// ============================================
// MAIN COMPONENT
// ============================================

export default function WasteLogPage() {
  const { currency } = useCurrency()
  const { showExportDialog, openExport, closeExport } = useExport()
  const [showLogModal, setShowLogModal] = useState(false)
  const [formData, setFormData] = useState<WasteFormData>(INITIAL_FORM_DATA)
  const [saving, setSaving] = useState(false)

  // Summary state
  const [summary, setSummary] = useState<WasteSummary>({
    todayCount: 0,
    todayCost: '0',
    weekCount: 0,
    weekCost: '0',
    totalCost: '0',
  })
  const [loadingSummary, setLoadingSummary] = useState(true)

  // Date range filter
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Item search state
  const [itemSearchQuery, setItemSearchQuery] = useState('')
  const [itemSearchResults, setItemSearchResults] = useState<ItemOption[]>([])
  const [searchingItems, setSearchingItems] = useState(false)
  const [showItemDropdown, setShowItemDropdown] = useState(false)

  // Build additional params for date filtering
  const additionalParams: Record<string, string> = {}
  if (dateFrom) additionalParams.dateFrom = dateFrom
  if (dateTo) additionalParams.dateTo = dateTo

  const {
    data: wasteEntries,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
    setAdditionalParams,
  } = usePaginatedData<WasteEntry>({
    endpoint: '/api/waste-log',
    entityType: 'waste-log',
    storageKey: 'waste-log-page-size',
    additionalParams,
  })

  // ============================================
  // FETCH SUMMARY
  // ============================================

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/waste-log/summary')
      if (res.ok) {
        const data = await res.json()
        setSummary(data)
      }
    } catch (error) {
      console.error('Error fetching waste summary:', error)
    } finally {
      setLoadingSummary(false)
    }
  }, [])

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  // Realtime updates for summary
  useRealtimeData(fetchSummary, {
    entityType: 'waste-log',
    refreshOnMount: false,
  })

  // ============================================
  // ITEM SEARCH
  // ============================================

  const searchItems = useCallback(async (query: string) => {
    if (!query.trim()) {
      setItemSearchResults([])
      return
    }
    setSearchingItems(true)
    try {
      const params = new URLSearchParams({ pageSize: '15', search: query })
      const res = await fetch(`/api/items?${params}`)
      if (res.ok) {
        const result = await res.json()
        const data = result.data || result
        setItemSearchResults(
          data.map((item: { id: string; name: string; costPrice?: string; unit?: string }) => ({
            value: item.id,
            label: item.name,
            data: { costPrice: item.costPrice, unit: item.unit },
          }))
        )
      }
    } catch (error) {
      console.error('Error searching items:', error)
    } finally {
      setSearchingItems(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (itemSearchQuery) {
        searchItems(itemSearchQuery)
        setShowItemDropdown(true)
      } else {
        setItemSearchResults([])
        setShowItemDropdown(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [itemSearchQuery, searchItems])

  // ============================================
  // HANDLERS
  // ============================================

  function handleOpenLog() {
    setFormData(INITIAL_FORM_DATA)
    setItemSearchQuery('')
    setItemSearchResults([])
    setShowItemDropdown(false)
    setShowLogModal(true)
  }

  function handleCloseLog() {
    setShowLogModal(false)
    setFormData(INITIAL_FORM_DATA)
    setItemSearchQuery('')
  }

  function handleSelectItem(option: ItemOption) {
    setFormData(prev => ({
      ...prev,
      itemId: option.value,
      itemName: option.label,
      unit: option.data?.unit || prev.unit,
    }))
    setItemSearchQuery(option.label)
    setShowItemDropdown(false)
  }

  function handleDateFilterApply() {
    const params: Record<string, string> = {}
    if (dateFrom) params.dateFrom = dateFrom
    if (dateTo) params.dateTo = dateTo
    setAdditionalParams(params)
  }

  function handleClearDateFilter() {
    setDateFrom('')
    setDateTo('')
    setAdditionalParams({})
  }

  async function handleLogWaste(e: React.FormEvent) {
    e.preventDefault()

    if (!formData.itemId) {
      toast.error('Please select an item')
      return
    }
    if (!formData.quantity || parseFloat(formData.quantity) <= 0) {
      toast.error('Quantity must be greater than 0')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/waste-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: formData.itemId,
          quantity: parseFloat(formData.quantity),
          unit: formData.unit,
          reason: formData.reason,
          notes: formData.notes.trim() || null,
        }),
      })

      if (res.ok) {
        toast.success('Waste entry logged')
        handleCloseLog()
        refresh()
        fetchSummary()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to log waste entry')
      }
    } catch (error) {
      console.error('Error logging waste:', error)
      toast.error('Failed to log waste entry')
    } finally {
      setSaving(false)
    }
  }

  // ============================================
  // HELPERS
  // ============================================

  function formatDateTime(dateString: string) {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  function getReasonBadgeColor(reason: string): string {
    switch (reason) {
      case 'Expired':
        return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
      case 'Damaged':
        return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
      case 'Overproduction':
        return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
      case 'Preparation Waste':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
      case 'Quality Issue':
        return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
    }
  }

  // ============================================
  // RENDER
  // ============================================

  if (loading && wasteEntries.length === 0 && loadingSummary) {
    return <PageLoading text="Loading waste log..." />
  }

  return (
    <ListPageLayout
      module="Restaurant"
      moduleHref="/restaurant"
      title="Waste Log"
      actionContent={
        <div className="flex items-center gap-2">
          <button
            onClick={openExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Download size={16} />
            Export
          </button>
          <button
            onClick={handleOpenLog}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            Log Waste
          </button>
        </div>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={() => { refresh(); fetchSummary() }}
      searchPlaceholder="Search waste entries..."
    >
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
              <Trash2 size={14} />
              Waste Today
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {summary.todayCount} <span className="text-sm font-normal text-gray-500">entries</span>
            </div>
            <div className="text-sm font-medium text-red-600 dark:text-red-400 mt-1">
              {formatCurrency(summary.todayCost, currency)} lost
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
              <TrendingDown size={14} />
              Waste This Week
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {summary.weekCount} <span className="text-sm font-normal text-gray-500">entries</span>
            </div>
            <div className="text-sm font-medium text-red-600 dark:text-red-400 mt-1">
              {formatCurrency(summary.weekCost, currency)} lost
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
              <DollarSign size={14} />
              Total Cost (All Time)
            </div>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {formatCurrency(summary.totalCost, currency)}
            </div>
          </div>
        </div>

        {/* Date Range Filter */}
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <Calendar size={14} />
            Date Range:
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-gray-400">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={handleDateFilterApply}
            className="px-3 py-1 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
          >
            Apply
          </button>
          {(dateFrom || dateTo) && (
            <button
              onClick={handleClearDateFilter}
              className="px-3 py-1 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {/* Waste Entries Table */}
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl">
          <table className="w-full">
            <caption className="sr-only">Waste log entries</caption>
            <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Date
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Item
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Quantity
                </th>
                <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Reason
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Cost
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Recorded By
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {wasteEntries.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={<AlertTriangle size={24} />}
                      title={search ? 'No waste entries found' : 'No waste entries yet'}
                      description={search ? 'Try adjusting your search or date filter' : 'Log waste to track food costs and reduce losses'}
                      action={
                        !search && (
                          <Button onClick={handleOpenLog} size="sm">
                            <Plus size={16} className="mr-1" />
                            Log Waste
                          </Button>
                        )
                      }
                    />
                  </td>
                </tr>
              ) : (
                wasteEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{entry.itemName}</div>
                      {entry.notes && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs">
                          {entry.notes}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400 text-right whitespace-nowrap">
                      {parseFloat(entry.quantity).toFixed(2)} {entry.unit}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getReasonBadgeColor(entry.reason)}`}>
                        {entry.reason}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400 text-right whitespace-nowrap">
                      {formatCurrency(entry.cost, currency)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {entry.recordedByName}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <Pagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            totalPages={pagination.totalPages}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            className="border-t dark:border-gray-700 px-4"
          />
        </div>
      </div>

      {/* Log Waste Modal */}
      <Modal
        isOpen={showLogModal}
        onClose={handleCloseLog}
        title="Log Waste"
        size="md"
        footer={
          <ModalFooter>
            <button
              type="button"
              onClick={handleCloseLog}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleLogWaste}
              disabled={saving || !formData.itemId || !formData.quantity}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Logging...' : 'Log Waste'}
            </button>
          </ModalFooter>
        }
      >
        <form onSubmit={handleLogWaste} className="space-y-4">
          {/* Item Search */}
          <div className="relative">
            <FormLabel required>Item</FormLabel>
            <FormInput
              value={itemSearchQuery}
              onChange={(e) => {
                setItemSearchQuery(e.target.value)
                if (!e.target.value) {
                  setFormData(prev => ({ ...prev, itemId: '', itemName: '' }))
                }
              }}
              onFocus={() => {
                if (itemSearchResults.length > 0) setShowItemDropdown(true)
              }}
              placeholder="Search items..."
              autoComplete="off"
            />
            {formData.itemId && (
              <div className="mt-1 text-xs text-green-600 dark:text-green-400">
                Selected: {formData.itemName}
              </div>
            )}
            {showItemDropdown && itemSearchResults.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-48 overflow-y-auto">
                {itemSearchResults.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    onClick={() => handleSelectItem(item)}
                  >
                    <span className="text-gray-900 dark:text-white">{item.label}</span>
                    {item.data?.costPrice && (
                      <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                        Cost: {formatCurrency(item.data.costPrice, currency)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {searchingItems && (
              <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg p-3 text-center text-sm text-gray-500">
                Searching...
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FormLabel required>Quantity</FormLabel>
              <FormInput
                type="number"
                min="0.001"
                step="0.001"
                value={formData.quantity}
                onChange={(e) => setFormData(prev => ({ ...prev, quantity: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div>
              <FormLabel required>Unit</FormLabel>
              <FormSelect
                value={formData.unit}
                onChange={(e) => setFormData(prev => ({ ...prev, unit: e.target.value }))}
              >
                {WASTE_UNITS.map(unit => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </FormSelect>
            </div>
          </div>

          <div>
            <FormLabel required>Reason</FormLabel>
            <FormSelect
              value={formData.reason}
              onChange={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
            >
              {WASTE_REASONS.map(reason => (
                <option key={reason} value={reason}>{reason}</option>
              ))}
            </FormSelect>
          </div>

          <div>
            <FormLabel optional>Notes</FormLabel>
            <FormTextarea
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Additional details about this waste..."
              rows={3}
            />
          </div>
        </form>
      </Modal>

      <ExportDialog
        isOpen={showExportDialog}
        onClose={closeExport}
        entity="waste-log"
        currentFilters={{ search: search || '', startDate: dateFrom || '', endDate: dateTo || '' }}
      />
    </ListPageLayout>
  )
}
