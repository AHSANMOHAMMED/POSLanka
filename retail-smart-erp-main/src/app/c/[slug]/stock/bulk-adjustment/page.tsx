'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Home, ChevronRight, Loader2, CheckCircle, AlertCircle, Plus, Trash2 } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { toast } from '@/components/ui/toast'
import { AsyncCreatableSelect } from '@/components/ui/async-creatable-select'

interface Warehouse {
  id: string
  name: string
}

interface AdjustmentRow {
  itemId: string
  itemName: string
  newQuantity: number
  reason: string
}

interface PreviewRow {
  itemId: string
  name?: string
  sku?: string | null
  currentQuantity?: number
  newQuantity?: number
  variance?: number
  reason?: string
  error?: string
}

export default function BulkStockAdjustmentPage() {
  const { tenantSlug } = useCompany()

  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [rows, setRows] = useState<AdjustmentRow[]>([])
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<{ adjusted: number; total: number; errors: string[] } | null>(null)

  // New row state
  const [addItemName, setAddItemName] = useState('')
  const [addItemId, setAddItemId] = useState('')
  const [addQty, setAddQty] = useState('')
  const [addReason, setAddReason] = useState('')

  useEffect(() => {
    fetch('/api/warehouses?all=true').then(r => r.json()).then(data => {
      const list = Array.isArray(data) ? data : data.data || []
      setWarehouses(list)
      if (list.length === 1) setWarehouseId(list[0].id)
    }).catch(() => {})
  }, [])

  async function searchItems(search: string) {
    const params = new URLSearchParams({ pageSize: '15' })
    if (search) params.set('search', search)
    const res = await fetch(`/api/items?${params}`)
    const result = await res.json()
    const data = result.data || result
    return data.map((item: { id: string; name: string }) => ({
      value: item.id,
      label: item.name,
    }))
  }

  function handleAddRow() {
    if (!addItemId || !addQty) return
    setRows(prev => [...prev, {
      itemId: addItemId,
      itemName: addItemName,
      newQuantity: parseFloat(addQty) || 0,
      reason: addReason,
    }])
    setAddItemId('')
    setAddItemName('')
    setAddQty('')
    setAddReason('')
    setPreview([])
    setResult(null)
  }

  function removeRow(index: number) {
    setRows(prev => prev.filter((_, i) => i !== index))
    setPreview([])
  }

  async function handlePreview() {
    if (!warehouseId || rows.length === 0) return
    setLoading(true)
    try {
      const res = await fetch('/api/stock-adjustments/bulk/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId,
          adjustments: rows.map(r => ({ itemId: r.itemId, newQuantity: r.newQuantity, reason: r.reason })),
        }),
      })
      if (!res.ok) throw new Error('Preview failed')
      const data = await res.json()
      setPreview(data)
    } catch {
      toast.error('Failed to generate preview')
    } finally {
      setLoading(false)
    }
  }

  async function handleApply() {
    if (!warehouseId || rows.length === 0) return
    if (!confirm(`Apply stock adjustments to ${rows.length} items?`)) return
    setApplying(true)
    try {
      const res = await fetch('/api/stock-adjustments/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId,
          adjustments: rows.map(r => ({ itemId: r.itemId, newQuantity: r.newQuantity, reason: r.reason })),
        }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setResult(data)
      toast.success(`Adjusted ${data.adjusted} of ${data.total} items`)
    } catch {
      toast.error('Failed to apply adjustments')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-foreground"><Home className="h-4 w-4" /></Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">Bulk Stock Adjustment</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Bulk Stock Adjustment</h1>
        <p className="text-sm text-muted-foreground mt-1">Adjust stock quantities for multiple items at once</p>
      </div>

      {/* Warehouse selection */}
      <div className="bg-card rounded border p-4">
        <label className="text-xs text-muted-foreground">Warehouse *</label>
        <select
          value={warehouseId}
          onChange={e => { setWarehouseId(e.target.value); setPreview([]); setResult(null) }}
          className="block mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground w-full max-w-md"
        >
          <option value="">Select warehouse...</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>

      {/* Add items */}
      {warehouseId && (
        <div className="bg-card rounded border p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">Add Items</h3>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className="text-xs text-muted-foreground">Item</label>
              <AsyncCreatableSelect
                fetchOptions={searchItems}
                value={addItemId}
                onChange={(value, option) => {
                  if (option) {
                    setAddItemId(value)
                    setAddItemName(option.label)
                  }
                }}
                placeholder="Search items..."
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">New Quantity</label>
              <input type="number" value={addQty} onChange={e => setAddQty(e.target.value)} min="0" step="any" className="block mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground w-full" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Reason</label>
              <input value={addReason} onChange={e => setAddReason(e.target.value)} placeholder="Reason for adjustment..." className="block mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground w-full" />
            </div>
            <button onClick={handleAddRow} disabled={!addItemId || !addQty} className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded text-sm disabled:opacity-50 h-10">
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
        </div>
      )}

      {/* Items table */}
      {rows.length > 0 && (
        <div className="bg-card rounded border">
          <div className="p-4 border-b flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">Items ({rows.length})</h3>
            <div className="flex gap-2">
              <button onClick={handlePreview} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded hover:bg-muted disabled:opacity-50">
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Preview
              </button>
              <button onClick={handleApply} disabled={applying} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
                {applying && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Apply
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="table-sticky-header">
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Item</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">New Qty</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Reason</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-4 py-3 font-medium text-foreground">{row.itemName}</td>
                    <td className="px-4 py-3 text-right">{row.newQuantity}</td>
                    <td className="px-4 py-3 text-muted-foreground">{row.reason || '-'}</td>
                    <td className="px-2 py-3">
                      <button onClick={() => removeRow(i)} className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded">
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`rounded border p-4 ${result.errors.length > 0 ? 'bg-orange-50 dark:bg-orange-900/20' : 'bg-green-50 dark:bg-green-900/20'}`}>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <span className="font-medium text-foreground">Adjusted {result.adjusted} of {result.total} items</span>
          </div>
          {result.errors.length > 0 && (
            <div className="mt-2 space-y-1">
              {result.errors.map((err, i) => (
                <div key={i} className="flex items-center gap-2 text-sm text-orange-700 dark:text-orange-300">
                  <AlertCircle className="h-3.5 w-3.5" /> {err}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Preview */}
      {preview.length > 0 && (
        <div className="bg-card rounded border">
          <div className="p-4 border-b">
            <h3 className="text-sm font-medium text-foreground">Preview</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="table-sticky-header">
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Item</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Current</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">New</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Variance</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Reason</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-4 py-3">
                      {row.error ? (
                        <span className="text-red-500">{row.itemId} - {row.error}</span>
                      ) : (
                        <span className="font-medium text-foreground">{row.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{row.currentQuantity ?? '-'}</td>
                    <td className="px-4 py-3 text-right font-medium">{row.newQuantity ?? '-'}</td>
                    <td className="px-4 py-3 text-right">
                      {row.variance !== undefined && (
                        <span className={row.variance > 0 ? 'text-green-600' : row.variance < 0 ? 'text-red-600' : 'text-muted-foreground'}>
                          {row.variance > 0 ? '+' : ''}{row.variance}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.reason || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
