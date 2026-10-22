'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Home, ChevronRight, AlertTriangle, Package, Truck, ShoppingCart, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { toast } from '@/components/ui/toast'
import { formatCurrency } from '@/lib/utils/currency'
import { useRealtimeData } from '@/hooks'

interface ReorderItem {
  itemId: string
  itemName: string
  itemSku: string
  categoryName: string
  supplierId: string | null
  supplierName: string
  warehouseId: string
  warehouseName: string
  currentStock: number
  reservedStock: number
  onOrder: number
  onRequisition: number
  projectedStock: number
  minStock: number
  maxStock: number | null
  unitCost: number
  suggestedQty: number
  estimatedCost: number
  leadTimeDays: number | null
}

interface SupplierGroup {
  key: string
  supplierId: string
  supplierName: string
  warehouseId: string
  warehouseName: string
  items: ReorderItem[]
  totalCost: number
}

interface ReorderData {
  data: ReorderItem[]
  supplierGroups: SupplierGroup[]
  summary: {
    totalItemsBelowReorder: number
    suppliersAffected: number
    estimatedReorderValue: number
  }
}

export default function ReorderDashboardPage() {
  const router = useRouter()
  const { tenantSlug, currency } = useCompany()
  const [data, setData] = useState<ReorderData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [creatingPO, setCreatingPO] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/reports/reorder-suggestions')
      if (res.ok) {
        const result = await res.json()
        setData(result)
        // Auto-expand all groups
        setExpandedGroups(new Set(result.supplierGroups.map((g: SupplierGroup) => g.key)))
      } else {
        toast.error('Failed to load reorder data')
      }
    } catch {
      toast.error('Error loading reorder data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useRealtimeData(fetchData, { entityType: ['item', 'purchase', 'purchase-order', 'purchase-requisition', 'warehouse-stock'], refreshOnMount: false })

  function toggleGroup(supplierId: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(supplierId)) next.delete(supplierId)
      else next.add(supplierId)
      return next
    })
  }

  // H3: one draft PO per supplier + warehouse (the suggestion's own warehouse), or a draft
  // purchase requisition; open POs / requisitions count as on order afterwards.
  async function handleCreate(group: SupplierGroup, mode: 'purchase_order' | 'requisition') {
    if (mode === 'purchase_order' && group.supplierId === 'no-supplier') {
      toast.error('Cannot create PO for items without a supplier')
      return
    }

    setCreatingPO(`${group.key}:${mode}`)
    try {
      const res = await fetch('/api/purchase-orders/from-reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          lines: group.items.map(item => ({
            itemId: item.itemId,
            warehouseId: item.warehouseId,
            supplierId: item.supplierId,
            quantity: item.suggestedQty,
            unitPrice: item.unitCost,
          })),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Failed to create document')
        return
      }
      const doc = body.documents?.[0]
      if (mode === 'purchase_order' && doc) {
        toast.success(`Purchase Order ${doc.number} created`)
        router.push(`/c/${tenantSlug}/purchase-orders/${doc.id}`)
      } else if (doc) {
        toast.success(`Purchase Requisition ${doc.number} created`)
        router.push(`/c/${tenantSlug}/purchase-requisitions/${doc.id}`)
      }
    } catch {
      toast.error('Error creating document')
    } finally {
      setCreatingPO(null)
    }
  }

  return (
    <div className="space-y-4 p-4 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400"><Home size={14} /></Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/stock`} className="hover:text-blue-600 dark:hover:text-blue-400">Stock</Link>
        <ChevronRight size={14} />
        <span>Reorder Dashboard</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded">
          <AlertTriangle size={20} className="text-red-600 dark:text-red-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Reorder Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Items below minimum stock level that need reordering</p>
        </div>
      </div>

      {loading ? (
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-8 text-center">
          <Loader2 size={24} className="animate-spin mx-auto text-gray-400" />
          <p className="text-sm text-gray-500 mt-2">Analyzing stock levels...</p>
        </div>
      ) : data && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center gap-3">
                <Package size={20} className="text-red-500" />
                <div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{data.summary.totalItemsBelowReorder}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Items Below Reorder</div>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center gap-3">
                <Truck size={20} className="text-orange-500" />
                <div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{data.summary.suppliersAffected}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Suppliers Affected</div>
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center gap-3">
                <ShoppingCart size={20} className="text-blue-500" />
                <div>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(data.summary.estimatedReorderValue, currency)}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Estimated Reorder Value</div>
                </div>
              </div>
            </div>
          </div>

          {/* Supplier Groups */}
          {data.supplierGroups.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-8 text-center">
              <Package size={32} className="mx-auto text-gray-300 dark:text-gray-600" />
              <p className="text-gray-500 dark:text-gray-400 mt-2">All items are above their minimum stock levels</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.supplierGroups.map((group) => (
                <div key={group.key} className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <div className="flex items-center gap-3">
                      <Truck size={16} className="text-gray-400" />
                      <span className="font-medium text-gray-900 dark:text-white">{group.supplierName}</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">→ {group.warehouseName}</span>
                      <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 px-2 py-0.5 rounded-full">
                        {group.items.length} item{group.items.length !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-gray-500">Est: {formatCurrency(group.totalCost, currency)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCreate(group, 'requisition') }}
                        disabled={creatingPO !== null}
                        className="px-3 py-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded text-xs hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 flex items-center gap-1"
                      >
                        {creatingPO === `${group.key}:requisition` ? <Loader2 size={12} className="animate-spin" /> : null}
                        Create Requisition
                      </button>
                      {group.supplierId !== 'no-supplier' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCreate(group, 'purchase_order') }}
                          disabled={creatingPO !== null}
                          className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                        >
                          {creatingPO === `${group.key}:purchase_order` ? <Loader2 size={12} className="animate-spin" /> : <ShoppingCart size={12} />}
                          Create PO
                        </button>
                      )}
                      {expandedGroups.has(group.key) ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                    </div>
                  </button>
                  {expandedGroups.has(group.key) && (
                    <div className="border-t border-gray-100 dark:border-gray-700">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-700">
                            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">Item</th>
                            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">SKU</th>
                            <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">Current</th>
                            <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">Reserved</th>
                            <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">On Order</th>
                            <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">Min Level</th>
                            <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">Max Level</th>
                            <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">Suggested Qty</th>
                            <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">Est. Cost</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                          {group.items.map((item) => (
                            <tr key={`${item.itemId}:${item.warehouseId}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                              <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{item.itemName}</td>
                              <td className="px-4 py-2 text-gray-500">{item.itemSku}</td>
                              <td className="px-4 py-2 text-right">
                                <span className={item.currentStock === 0 ? 'text-red-600 font-bold' : 'text-orange-600'}>
                                  {item.currentStock}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{item.reservedStock || '-'}</td>
                              <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{(item.onOrder + item.onRequisition) || '-'}</td>
                              <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{item.minStock}</td>
                              <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">{item.maxStock ?? '-'}</td>
                              <td className="px-4 py-2 text-right font-medium text-blue-600">{item.suggestedQty}</td>
                              <td className="px-4 py-2 text-right text-gray-700 dark:text-gray-300">{formatCurrency(item.estimatedCost, currency)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
