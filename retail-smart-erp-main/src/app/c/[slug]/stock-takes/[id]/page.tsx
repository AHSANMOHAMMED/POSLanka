'use client'

import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { Home, ChevronRight, ClipboardCheck, Save, Play, Send, CheckCircle, ArrowLeft, Ban } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils/date-format'
import { formatCurrency } from '@/lib/utils/currency'
import { PageLoading } from '@/components/ui/loading-spinner'
import { DetailPageActions, type ActionConfig } from '@/components/ui/detail-page-actions'
import { CancellationReasonModal } from '@/components/modals'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'

interface StockTakeItem {
  id: string
  itemId: string
  itemName: string
  itemSku: string | null
  binLocation: string | null
  expectedQuantity: string
  countedQuantity: string | null
  variance: string | null
  varianceValue: string | null
  costPrice: string
  countedBy: string | null
  countedAt: string | null
  notes: string | null
}

interface StockTakeDetail {
  id: string
  countNo: string
  warehouseId: string
  warehouseName: string | null
  status: string
  countType: string
  categoryName: string | null
  notes: string | null
  createdByName: string | null
  approvedBy: string | null
  approvedAt: string | null
  startedAt: string | null
  completedAt: string | null
  totalItems: number
  itemsCounted: number
  varianceCount: number
  totalVarianceValue: string
  cancellationReason: string | null
  createdAt: string
  updatedAt: string
  items: StockTakeItem[]
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' },
  in_progress: { label: 'In Progress', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' },
  pending_review: { label: 'Pending Review', color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800' },
  completed: { label: 'Completed', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' },
  cancelled: { label: 'Cancelled', color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600' },
}

export default function StockTakeDetailPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()
  const { tenantSlug, currency } = useCompany()

  const [stockTake, setStockTake] = useState<StockTakeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [hasChanges, setHasChanges] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)

  const fetchStockTake = useCallback(async () => {
    try {
      const res = await fetch(`/api/stock-takes/${id}`)
      if (res.ok) {
        const data = await res.json()
        setStockTake(data)
        // Initialize count values
        const initial: Record<string, string> = {}
        for (const item of data.items) {
          if (item.countedQuantity !== null) {
            initial[item.id] = item.countedQuantity
          }
        }
        setCounts(initial)
      } else {
        toast.error('Stock take not found')
        router.push(`/c/${tenantSlug}/stock-takes`)
      }
    } catch {
      toast.error('Error loading stock take')
    } finally {
      setLoading(false)
    }
  }, [id, router, tenantSlug])

  useEffect(() => { fetchStockTake() }, [fetchStockTake])
  useRealtimeData(fetchStockTake, { entityType: 'stock-take' })

  function handleCountChange(itemId: string, value: string) {
    setCounts(prev => ({ ...prev, [itemId]: value }))
    setHasChanges(true)
  }

  async function handleSaveCounts() {
    const updates = Object.entries(counts)
      .filter(([, val]) => val !== '')
      .map(([itemId, val]) => ({
        itemId,
        countedQuantity: parseFloat(val),
      }))

    if (updates.length === 0) {
      toast.error('No counts to save')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/stock-takes/${id}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: updates }),
      })
      if (res.ok) {
        toast.success('Counts saved')
        setHasChanges(false)
        fetchStockTake()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to save counts')
      }
    } catch {
      toast.error('Error saving counts')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(newStatus: string) {
    setSaving(true)
    try {
      const res = await fetch(`/api/stock-takes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        toast.success(`Status updated to ${statusConfig[newStatus]?.label || newStatus}`)
        fetchStockTake()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to update status')
      }
    } catch {
      toast.error('Error updating status')
    } finally {
      setSaving(false)
    }
  }

  async function handleComplete() {
    const res = await fetch(`/api/stock-takes/${id}/complete`, {
      method: 'POST',
    })
    if (res.ok) {
      const result = await res.json()
      toast.success(result.message)
      fetchStockTake()
    } else {
      const err = await res.json()
      toast.error(err.error || 'Failed to complete stock take')
    }
  }

  async function handleCancel(reason: string) {
    setSaving(true)
    try {
      const res = await fetch(`/api/stock-takes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', cancellationReason: reason }),
      })
      if (res.ok) {
        toast.success('Stock take cancelled')
        setShowCancelModal(false)
        fetchStockTake()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to cancel')
      }
    } catch {
      toast.error('Error cancelling stock take')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageLoading />
  if (!stockTake) return null

  const status = statusConfig[stockTake.status] || statusConfig.draft
  const isEditable = ['draft', 'in_progress'].includes(stockTake.status)
  const progress = stockTake.totalItems > 0 ? Math.round((stockTake.itemsCounted / stockTake.totalItems) * 100) : 0

  return (
    <div className="space-y-4 p-4 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400"><Home size={14} /></Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/stock-takes`} className="hover:text-blue-600 dark:hover:text-blue-400">Stock Takes</Link>
        <ChevronRight size={14} />
        <span>{stockTake.countNo}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push(`/c/${tenantSlug}/stock-takes`)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
            <ArrowLeft size={18} className="text-gray-500" />
          </button>
          <div className="p-2 bg-teal-100 dark:bg-teal-900/30 rounded">
            <ClipboardCheck size={20} className="text-teal-600 dark:text-teal-400" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">{stockTake.countNo}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${status.bg} ${status.color}`}>{status.label}</span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">{stockTake.warehouseName} &bull; {stockTake.countType} count</p>
          </div>
        </div>
        <div className="flex items-center gap-2" />

      </div>

      {/* Progress Bar */}
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Counting Progress</span>
          <span className="text-sm text-gray-500">{stockTake.itemsCounted} / {stockTake.totalItems} items ({progress}%)</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
          <div className="bg-teal-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex items-center gap-6 mt-3 text-xs text-gray-500 dark:text-gray-400">
          {stockTake.varianceCount > 0 && (
            <span className="text-orange-600 dark:text-orange-400">
              {stockTake.varianceCount} variance(s) &bull; {formatCurrency(parseFloat(stockTake.totalVarianceValue), currency)} value
            </span>
          )}
          {stockTake.startedAt && <span>Started: {formatDate(stockTake.startedAt)}</span>}
          {stockTake.completedAt && <span>Completed: {formatDate(stockTake.completedAt)}</span>}
        </div>
      </div>

      {/* Items Table */}
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
        <div className="overflow-x-auto list-container-xl">
          <table className="w-full text-sm">
            <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900/50">
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Item</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">SKU</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Bin</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Expected</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase w-32">Counted</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Variance</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Cost Price</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {stockTake.items.map((item) => {
                const countVal = counts[item.id] ?? (item.countedQuantity || '')
                const expectedQty = parseFloat(item.expectedQuantity)
                const countedQty = countVal !== '' ? parseFloat(countVal) : null
                const variance = countedQty !== null ? countedQty - expectedQty : null
                const costPrice = parseFloat(item.costPrice || '0')
                const varianceValue = variance !== null ? variance * costPrice : null

                return (
                  <tr key={item.id} className={`${variance !== null && variance !== 0 ? 'bg-orange-50/50 dark:bg-orange-900/10' : ''}`}>
                    <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{item.itemName}</td>
                    <td className="px-4 py-2 text-gray-500">{item.itemSku || '-'}</td>
                    <td className="px-4 py-2 text-gray-500">{item.binLocation || '-'}</td>
                    <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{expectedQty}</td>
                    <td className="px-4 py-2 text-right">
                      {isEditable ? (
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={countVal}
                          onChange={(e) => handleCountChange(item.id, e.target.value)}
                          className="w-24 text-right border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-teal-500"
                          placeholder="--"
                        />
                      ) : (
                        <span className="text-gray-900 dark:text-white">{item.countedQuantity !== null ? parseFloat(item.countedQuantity) : '--'}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {variance !== null ? (
                        <span className={variance > 0 ? 'text-green-600' : variance < 0 ? 'text-red-600' : 'text-gray-500'}>
                          {variance > 0 ? '+' : ''}{variance}
                        </span>
                      ) : (
                        <span className="text-gray-400">--</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">
                      {costPrice > 0 ? formatCurrency(costPrice, currency) : <span className="text-gray-400">--</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {varianceValue !== null ? (
                        <span className={varianceValue > 0 ? 'text-green-600' : varianceValue < 0 ? 'text-red-600' : 'text-gray-500'}>
                          {formatCurrency(varianceValue, currency)}
                        </span>
                      ) : (
                        <span className="text-gray-400">--</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cancellation Reason */}
      {stockTake.status === 'cancelled' && stockTake.cancellationReason && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-4">
          <h3 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-1">Cancellation Reason</h3>
          <p className="text-sm text-red-600 dark:text-red-300">{stockTake.cancellationReason}</p>
        </div>
      )}

      {/* Comments & Activity */}
      <DocumentCommentsAndActivity
        documentType="stock_take"
        documentId={id}
        entityType="stock-take"
      />

      <DetailPageActions actions={(() => {
        const a: ActionConfig[] = []
        if (isEditable && hasChanges) {
          a.push({
            key: 'save',
            label: 'Save Counts',
            icon: <Save size={14} />,
            variant: 'primary',
            loading: saving,
            onClick: handleSaveCounts,
          })
        }
        if (stockTake.status === 'draft') {
          a.push({
            key: 'start',
            label: 'Start Counting',
            icon: <Play size={14} />,
            variant: 'primary',
            loading: saving,
            onClick: () => handleStatusChange('in_progress'),
          })
        }
        if (stockTake.status === 'in_progress') {
          a.push({
            key: 'submit',
            label: 'Submit for Review',
            icon: <Send size={14} />,
            variant: 'warning',
            onClick: () => handleStatusChange('pending_review'),
            confirmation: {
              title: 'Submit for Review',
              message: 'Submit this stock take for review? Make sure all counts have been recorded.',
              variant: 'warning',
            },
          })
        }
        if (['draft', 'in_progress'].includes(stockTake.status)) {
          a.push({
            key: 'cancel',
            label: 'Cancel',
            icon: <Ban size={14} />,
            variant: 'danger',
            onClick: () => setShowCancelModal(true),
          })
        }
        if (stockTake.status === 'pending_review') {
          a.push({
            key: 'complete',
            label: 'Approve & Reconcile',
            icon: <CheckCircle size={14} />,
            variant: 'success',
            onClick: handleComplete,
            confirmation: {
              title: 'Approve & Reconcile Stock',
              message: 'This will adjust stock levels for all items with variance. This action cannot be undone.',
              variant: 'success',
            },
          })
        }
        return a
      })()} />

      <CancellationReasonModal
        isOpen={showCancelModal}
        onClose={() => setShowCancelModal(false)}
        onConfirm={handleCancel}
        title="Cancel Stock Take"
        itemName={`Stock Take ${stockTake.countNo}`}
        processing={saving}
      />
    </div>
  )
}
