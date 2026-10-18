'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'
import { Home, ChevronRight, Upload, Loader2, CheckCircle, AlertCircle } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { toast } from '@/components/ui/toast'
import { formatCurrency } from '@/lib/utils/currency'

interface PriceUpdate {
  itemId: string
  costPrice?: number
  sellingPrice?: number
}

interface PreviewRow {
  itemId: string
  name?: string
  sku?: string | null
  currentCostPrice?: string
  newCostPrice?: string
  costPriceChanged?: boolean
  currentSellingPrice?: string
  newSellingPrice?: string
  sellingPriceChanged?: boolean
  error?: string
}

export default function BulkPriceUpdatePage() {
  const { tenantSlug, currency } = useCompany()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [updates, setUpdates] = useState<PriceUpdate[]>([])
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<{ updated: number; total: number; errors: string[] } | null>(null)

  // Manual entry
  const [manualItemId, setManualItemId] = useState('')
  const [manualCost, setManualCost] = useState('')
  const [manualSelling, setManualSelling] = useState('')

  function handleCSVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      const lines = text.trim().split('\n')
      const parsed: PriceUpdate[] = []

      // Skip header row
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''))
        if (cols.length < 2) continue

        const itemId = cols[0]
        if (!itemId) continue

        const update: PriceUpdate = { itemId }
        if (cols[1]) update.costPrice = parseFloat(cols[1])
        if (cols[2]) update.sellingPrice = parseFloat(cols[2])
        if (update.costPrice !== undefined || update.sellingPrice !== undefined) {
          parsed.push(update)
        }
      }

      setUpdates(parsed)
      setPreview([])
      setResult(null)
      toast.success(`Parsed ${parsed.length} price updates from CSV`)
    }
    reader.readAsText(file)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function addManualEntry() {
    if (!manualItemId) return
    const update: PriceUpdate = { itemId: manualItemId }
    if (manualCost) update.costPrice = parseFloat(manualCost)
    if (manualSelling) update.sellingPrice = parseFloat(manualSelling)

    setUpdates(prev => [...prev, update])
    setManualItemId('')
    setManualCost('')
    setManualSelling('')
    setPreview([])
    setResult(null)
  }

  async function handlePreview() {
    if (updates.length === 0) return
    setLoading(true)
    try {
      const res = await fetch('/api/items/bulk-price-update/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
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
    if (updates.length === 0) return
    if (!confirm(`Apply price updates to ${updates.length} items?`)) return
    setApplying(true)
    try {
      const res = await fetch('/api/items/bulk-price-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      setResult(data)
      toast.success(`Updated ${data.updated} of ${data.total} items`)
    } catch {
      toast.error('Failed to apply updates')
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
        <Link href={`/c/${tenantSlug}/items`} className="hover:text-foreground">Items</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">Bulk Price Update</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Bulk Price Update</h1>
        <p className="text-sm text-muted-foreground mt-1">Update cost and selling prices for multiple items at once</p>
      </div>

      {/* CSV Upload */}
      <div className="bg-card rounded border p-4">
        <h3 className="text-sm font-medium text-foreground mb-2">Upload CSV</h3>
        <p className="text-xs text-muted-foreground mb-3">
          CSV format: item_id, cost_price, selling_price (first row is header)
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
          >
            <Upload className="h-4 w-4" /> Upload CSV
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleCSVUpload} />
          <span className="text-sm text-muted-foreground">{updates.length} items queued</span>
        </div>
      </div>

      {/* Manual entry */}
      <div className="bg-card rounded border p-4">
        <h3 className="text-sm font-medium text-foreground mb-2">Manual Entry</h3>
        <div className="flex items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Item ID</label>
            <input value={manualItemId} onChange={e => setManualItemId(e.target.value)} placeholder="UUID" className="block mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground w-64" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Cost Price</label>
            <input type="number" value={manualCost} onChange={e => setManualCost(e.target.value)} step="0.01" min="0" className="block mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground w-32" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Selling Price</label>
            <input type="number" value={manualSelling} onChange={e => setManualSelling(e.target.value)} step="0.01" min="0" className="block mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground w-32" />
          </div>
          <button onClick={addManualEntry} disabled={!manualItemId} className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded disabled:opacity-50">
            Add
          </button>
        </div>
      </div>

      {/* Actions */}
      {updates.length > 0 && (
        <div className="flex items-center gap-3">
          <button onClick={handlePreview} disabled={loading} className="flex items-center gap-2 px-4 py-2 border rounded text-sm hover:bg-muted disabled:opacity-50">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Preview Changes
          </button>
          <button onClick={handleApply} disabled={applying} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50">
            {applying && <Loader2 className="h-4 w-4 animate-spin" />} Apply Updates
          </button>
          <button onClick={() => { setUpdates([]); setPreview([]); setResult(null) }} className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
            Clear All
          </button>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`rounded border p-4 ${result.errors.length > 0 ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200' : 'bg-green-50 dark:bg-green-900/20 border-green-200'}`}>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <span className="font-medium text-foreground">Updated {result.updated} of {result.total} items</span>
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

      {/* Preview table */}
      {preview.length > 0 && (
        <div className="bg-card rounded border">
          <div className="p-4 border-b">
            <h3 className="text-sm font-medium text-foreground">Preview ({preview.length} items)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="table-sticky-header">
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Item</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Current Cost</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">New Cost</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Current Selling</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">New Selling</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-4 py-3">
                      {row.error ? (
                        <span className="text-red-500">{row.itemId} - {row.error}</span>
                      ) : (
                        <div>
                          <span className="font-medium text-foreground">{row.name}</span>
                          {row.sku && <span className="text-xs text-muted-foreground ml-2">{row.sku}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{row.currentCostPrice ? formatCurrency(parseFloat(row.currentCostPrice), currency) : '-'}</td>
                    <td className={`px-4 py-3 text-right font-medium ${row.costPriceChanged ? 'text-blue-600' : 'text-muted-foreground'}`}>
                      {row.newCostPrice ? formatCurrency(parseFloat(row.newCostPrice), currency) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{row.currentSellingPrice ? formatCurrency(parseFloat(row.currentSellingPrice), currency) : '-'}</td>
                    <td className={`px-4 py-3 text-right font-medium ${row.sellingPriceChanged ? 'text-blue-600' : 'text-muted-foreground'}`}>
                      {row.newSellingPrice ? formatCurrency(parseFloat(row.newSellingPrice), currency) : '-'}
                    </td>
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
