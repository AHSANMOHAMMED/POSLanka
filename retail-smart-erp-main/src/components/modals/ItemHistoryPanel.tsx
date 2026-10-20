'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, ArrowRight, Boxes, PencilLine, DollarSign } from 'lucide-react'
import { formatDateTime } from '@/lib/utils/date-format'

type HistoryKind = 'all' | 'stock' | 'fields' | 'price'

interface HistoryUser { id: string; name: string | null }

type HistoryEntry =
  | {
      id: string; kind: 'stock'; date: string; user: HistoryUser | null
      type: string; qtyChange: number; stockBefore: number | null; stockAfter: number | null
      referenceType: string | null; referenceId: string | null; notes: string | null
      warehouseId: string | null; warehouseName: string | null; source: string | null
    }
  | {
      id: string; kind: 'fields' | 'price'; date: string; user: HistoryUser | null
      action: string; source: string; changes: Record<string, { from: unknown; to: unknown }>; notes: string | null
    }
  | {
      id: string; kind: 'cost'; date: string; user: HistoryUser | null
      source: string; previousCostPrice: number; newCostPrice: number; purchasePrice: number | null
      quantity: number | null; referenceNo: string | null; notes: string | null
    }

const FIELD_LABELS: Record<string, string> = {
  name: 'Name', sku: 'SKU', barcode: 'Barcode', pluCode: 'PLU', itemCode: 'Item code',
  categoryId: 'Category', brand: 'Brand', unit: 'Unit', costPrice: 'Cost price',
  sellingPrice: 'Selling price', taxTemplateId: 'Tax template', trackStock: 'Track stock',
  isActive: 'Active', isWeighable: 'Weighable', supplierId: 'Supplier', description: 'Description',
  imageUrl: 'Image',
}

const REFERENCE_LABELS: Record<string, string> = {
  sale: 'Sale', purchase: 'Purchase', stock_take: 'Stock take', manual_adjustment: 'Manual adjustment',
  bulk_adjustment: 'Bulk adjustment', opening_stock: 'Opening stock', transfer: 'Transfer',
  stock_transfer: 'Transfer', return: 'Return', purchase_return: 'Purchase return', work_order: 'Work order',
}

const ID_FIELDS = new Set(['categoryId', 'supplierId', 'taxTemplateId', 'imageUrl'])

function fmtValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (ID_FIELDS.has(field)) return 'set'
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 3 })
  return String(v)
}

function fmtQty(n: number | null | undefined): string {
  if (n === null || n === undefined) return '?'
  return n.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

const KIND_FILTERS: { key: HistoryKind; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'stock', label: 'Stock' },
  { key: 'fields', label: 'Changes' },
  { key: 'price', label: 'Prices' },
]

export function ItemHistoryPanel({ itemId }: { itemId: string }) {
  const [kind, setKind] = useState<HistoryKind>('all')
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (reset: boolean, nextCursor: string | null) => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({ kind, limit: '25' })
      if (!reset && nextCursor) qs.set('cursor', nextCursor)
      const res = await fetch(`/api/items/${itemId}/history?${qs}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to load history')
        return
      }
      const data = await res.json() as { data: HistoryEntry[]; nextCursor: string | null }
      setEntries((prev) => (reset ? data.data : [...prev, ...data.data]))
      setCursor(data.nextCursor)
    } catch {
      setError('Failed to load history')
    } finally {
      setLoading(false)
    }
  }, [itemId, kind])

  useEffect(() => {
    load(true, null)
  }, [load])

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {KIND_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setKind(f.key)}
            className={`px-3 py-1 text-xs rounded-full border transition ${
              kind === f.key
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="p-2 text-sm text-red-600 bg-red-50 rounded dark:bg-red-900/20 dark:text-red-400">{error}</div>}

      {entries.length === 0 && !loading && !error && (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">No history yet.</p>
      )}

      <ul className="divide-y dark:divide-gray-700">
        {entries.map((e) => (
          <li key={`${e.kind}-${e.id}`} className="py-2 flex gap-3 text-sm">
            <span className="mt-0.5 text-gray-400">
              {e.kind === 'stock' ? <Boxes size={16} /> : e.kind === 'fields' ? <PencilLine size={16} /> : <DollarSign size={16} />}
            </span>
            <div className="flex-1 min-w-0">
              {e.kind === 'stock' && (
                <div>
                  <span className={`font-medium ${e.qtyChange >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {e.qtyChange > 0 ? '+' : ''}{fmtQty(e.qtyChange)}
                  </span>{' '}
                  <span className="text-gray-700 dark:text-gray-200">
                    {REFERENCE_LABELS[e.referenceType || ''] || e.referenceType || e.type}
                  </span>
                  {e.stockBefore !== null && e.stockAfter !== null && (
                    <span className="inline-flex items-center gap-1 ml-2 text-gray-500 dark:text-gray-400">
                      {fmtQty(e.stockBefore)} <ArrowRight size={12} /> {fmtQty(e.stockAfter)}
                    </span>
                  )}
                  {e.warehouseName && <span className="ml-2 text-xs text-gray-400">@ {e.warehouseName}</span>}
                  {e.notes && <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{e.notes}</div>}
                </div>
              )}
              {(e.kind === 'fields' || e.kind === 'price') && (
                <div>
                  {e.action === 'create' ? (
                    <span className="text-gray-700 dark:text-gray-200">Item created</span>
                  ) : e.action === 'delete' ? (
                    <span className="text-gray-700 dark:text-gray-200">Item deleted</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {Object.entries(e.changes).map(([field, c]) => (
                        <li key={field} className="text-gray-700 dark:text-gray-200">
                          {FIELD_LABELS[field] || field}{' '}
                          <span className="text-gray-500 dark:text-gray-400">{fmtValue(field, c.from)}</span>
                          {' → '}
                          <span className="font-medium">{fmtValue(field, c.to)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {e.source !== 'manual' && <span className="text-xs text-gray-400">via {e.source}</span>}
                </div>
              )}
              {e.kind === 'cost' && (
                <div className="text-gray-700 dark:text-gray-200">
                  Cost price {fmtQty(e.previousCostPrice)} → <span className="font-medium">{fmtQty(e.newCostPrice)}</span>
                  <span className="ml-2 text-xs text-gray-400">
                    {e.source.replace(/_/g, ' ')}{e.referenceNo ? ` ${e.referenceNo}` : ''}
                    {e.quantity !== null ? ` · qty ${fmtQty(e.quantity)}` : ''}
                  </span>
                </div>
              )}
              <div className="text-xs text-gray-400">
                {formatDateTime(e.date)}{e.user?.name ? ` by ${e.user.name}` : ''}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {loading && (
        <div className="flex justify-center py-2"><Loader2 className="animate-spin text-gray-400" size={18} /></div>
      )}
      {!loading && cursor && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => load(false, cursor)}
            className="px-3 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  )
}
