'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date-format'
import { Loader2, History, Building2, Calendar, FileText, TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface ItemHistoryRecord {
  id: string
  supplierName: string | null
  lastCostPrice: string
  lastPurchaseDate: string | null
  lastPurchaseNo: string | null
  totalPurchasedQty: string | null
  supplierPartNumber: string | null
  updatedAt: string | null
}

interface ItemPurchaseHistoryModalProps {
  isOpen: boolean
  onClose: () => void
  itemId: string | null
  itemName: string
  currentCostPrice?: number
}

export function ItemPurchaseHistoryModal({
  isOpen,
  onClose,
  itemId,
  itemName,
  currentCostPrice,
}: ItemPurchaseHistoryModalProps) {
  const [loading, setLoading] = useState(false)
  const [records, setRecords] = useState<ItemHistoryRecord[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !itemId) {
      return
    }

    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) {
        setLoading(true)
        setError(null)
      }
    })

    fetch(`/api/items/${itemId}/supplier-costs`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('Failed to load item purchase history')
        }
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setRecords(Array.isArray(data) ? data : [])
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Error fetching purchase history:', err)
          setError('Could not load purchase history for this item.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, itemId])

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Purchase History: ${itemName}`} size="lg">
      <div className="space-y-4 py-2">
        {/* Current Cost Banner */}
        {currentCostPrice != null && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-sm">
            <span className="font-medium text-blue-900 dark:text-blue-200">Current Base Cost Price:</span>
            <span className="font-mono font-bold text-blue-700 dark:text-blue-300">
              {formatCurrency(currentCostPrice)}
            </span>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 text-gray-500">
            <Loader2 className="w-7 h-7 animate-spin mb-2 text-blue-600" />
            <p className="text-sm">Fetching past supplier purchases...</p>
          </div>
        ) : error ? (
          <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 text-sm">
            {error}
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <History className="w-10 h-10 mx-auto mb-2 text-gray-400 opacity-60" />
            <p className="font-medium">No previous supplier purchases found for this item.</p>
            <p className="text-xs mt-1 text-gray-400">This might be a newly added item or has no recorded purchase invoices yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/80 text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Supplier</th>
                  <th className="px-4 py-2.5 font-semibold">Invoice #</th>
                  <th className="px-4 py-2.5 font-semibold">Date</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Cost Price</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Qty</th>
                  <th className="px-4 py-2.5 font-semibold text-center">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {records.map((rec) => {
                  const cost = parseFloat(rec.lastCostPrice || '0')
                  const diff = currentCostPrice != null ? cost - currentCostPrice : 0

                  return (
                    <tr key={rec.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white flex items-center gap-2">
                        <Building2 size={15} className="text-gray-400 shrink-0" />
                        <span>{rec.supplierName || 'Unknown Supplier'}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300 font-mono text-xs">
                        <span className="flex items-center gap-1.5">
                          <FileText size={14} className="text-gray-400" />
                          {rec.lastPurchaseNo || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                        <span className="flex items-center gap-1">
                          <Calendar size={13} className="text-gray-400" />
                          {rec.lastPurchaseDate ? formatDate(rec.lastPurchaseDate) : rec.updatedAt ? formatDate(rec.updatedAt) : '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-gray-900 dark:text-white">
                        {formatCurrency(cost)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-gray-600 dark:text-gray-300">
                        {rec.totalPurchasedQty ? parseFloat(rec.totalPurchasedQty).toLocaleString() : '-'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {Math.abs(diff) < 0.01 ? (
                          <span className="inline-flex items-center text-gray-400 text-xs" title="Same as current base cost">
                            <Minus size={14} />
                          </span>
                        ) : diff > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-xs text-red-600 dark:text-red-400 font-medium" title="Higher than current base cost">
                            <TrendingUp size={14} /> +{formatCurrency(diff)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 text-xs text-green-600 dark:text-green-400 font-medium" title="Lower than current base cost">
                            <TrendingDown size={14} /> -{formatCurrency(Math.abs(diff))}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end pt-3 border-t border-gray-100 dark:border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
