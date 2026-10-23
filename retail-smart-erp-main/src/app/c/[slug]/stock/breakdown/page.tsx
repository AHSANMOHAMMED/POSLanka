'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Split, Layers, CheckCircle, Loader2 } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { toast } from '@/components/ui/toast'
import { AsyncCreatableSelect } from '@/components/ui/async-creatable-select'

interface Warehouse {
  id: string
  name: string
}

export default function BulkBreakdownPage() {
  const { tenantSlug } = useCompany()
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseId, setWarehouseId] = useState('')

  const [sourceItemId, setSourceItemId] = useState('')
  const [sourceItemName, setSourceItemName] = useState('')
  const [sourceQty, setSourceQty] = useState('1')

  const [targetItemId, setTargetItemId] = useState('')
  const [targetItemName, setTargetItemName] = useState('')
  const [targetQty, setTargetQty] = useState('')

  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [lastResult, setLastResult] = useState<{
    source: { name: string; deducted: number; stockAfter: number }
    target: { name: string; added: number; stockAfter: number }
  } | null>(null)

  useEffect(() => {
    fetch('/api/warehouses?all=true')
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data.data || []
        setWarehouses(list)
        if (list.length > 0) setWarehouseId(list[0].id)
      })
      .catch(() => {})
  }, [])

  async function searchItems(search: string) {
    const params = new URLSearchParams({ pageSize: '20' })
    if (search) params.set('search', search)
    const res = await fetch(`/api/items?${params}`)
    const result = await res.json()
    const data = result.data || result
    return (data || []).map((item: { id: string; name: string; unit?: string }) => ({
      value: item.id,
      label: `${item.name}${item.unit ? ` (${item.unit})` : ''}`,
    }))
  }

  async function handleConvert(e: React.FormEvent) {
    e.preventDefault()
    if (!warehouseId) {
      toast.error('Select a warehouse')
      return
    }
    if (!sourceItemId) {
      toast.error('Select the bulk/source item to deduct')
      return
    }
    if (!targetItemId) {
      toast.error('Select the smaller/target item to produce')
      return
    }
    if (sourceItemId === targetItemId) {
      toast.error('Source and target item cannot be identical')
      return
    }
    const src = parseFloat(sourceQty)
    const tgt = parseFloat(targetQty)
    if (!src || src <= 0 || !tgt || tgt <= 0) {
      toast.error('Quantities must be positive numbers')
      return
    }

    setLoading(true)
    setLastResult(null)

    try {
      const res = await fetch('/api/stock/repack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouseId,
          sourceItemId,
          sourceQty: src,
          targetItemId,
          targetQty: tgt,
          notes: notes.trim() || undefined,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to complete breakdown')
        return
      }

      toast.success(`Successfully converted ${src} × ${sourceItemName} into ${tgt} × ${targetItemName}!`)
      setLastResult(data)
      setTargetQty('')
      setNotes('')
    } catch {
      toast.error('Something went wrong during conversion')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link
            href={`/c/${tenantSlug}/stock`}
            className="p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft size={18} className="text-slate-600 dark:text-slate-300" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Split className="text-teal-600" size={24} />
              Bulk Repack & Breakdown Studio
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Break down bulk purchases (e.g. 50kg sacks, cases of 24) into smaller retail units (e.g. 1kg bags, individual items) with atomic stock deduction and ledger logging.
            </p>
          </div>
        </div>

        {/* Success Alert */}
        {lastResult && (
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-start gap-3">
            <CheckCircle className="text-emerald-600 mt-0.5" size={20} />
            <div className="text-sm text-emerald-900 dark:text-emerald-200 space-y-1">
              <p className="font-semibold">Stock successfully repacked and balanced:</p>
              <ul className="list-disc list-inside text-xs space-y-0.5">
                <li>Deducted <strong>{lastResult.source.deducted}</strong> from <em>{lastResult.source.name}</em> (Remaining: {lastResult.source.stockAfter})</li>
                <li>Added <strong>{lastResult.target.added}</strong> to <em>{lastResult.target.name}</em> (New stock: {lastResult.target.stockAfter})</li>
              </ul>
            </div>
          </div>
        )}

        {/* Main Card */}
        <form onSubmit={handleConvert} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-6 space-y-6">
          {/* Warehouse Selection */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Select Warehouse / Store
            </label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="w-full h-11 px-3 border border-slate-300 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            {/* Source / Bulk Item */}
            <div className="p-4 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/40 rounded-xl space-y-4">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400 font-bold text-sm">
                <Layers size={18} />
                <span>1. Bulk / Sourced Product (Deduct)</span>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Search Bulk Item
                </label>
                <AsyncCreatableSelect
                  fetchOptions={searchItems}
                  value={sourceItemId}
                  selectedOption={sourceItemId ? { value: sourceItemId, label: sourceItemName } : null}
                  onChange={(val, opt) => {
                    setSourceItemId(val)
                    setSourceItemName(opt ? opt.label : '')
                  }}
                  placeholder="e.g. Rice 50kg Bag, Carton of 24 Cans..."
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Quantity to Open / Deduct
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.001"
                  required
                  value={sourceQty}
                  onChange={(e) => setSourceQty(e.target.value)}
                  placeholder="e.g. 1 (one sack or 1 carton)"
                  className="w-full h-10 px-3 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 font-bold text-slate-900 dark:text-white"
                />
              </div>
            </div>

            {/* Target / Retail Item */}
            <div className="p-4 bg-teal-50/50 dark:bg-teal-950/20 border border-teal-200/70 dark:border-teal-900/40 rounded-xl space-y-4">
              <div className="flex items-center gap-2 text-teal-800 dark:text-teal-400 font-bold text-sm">
                <Split size={18} />
                <span>2. Retail / Repacked Product (Add)</span>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Search Target Retail Item
                </label>
                <AsyncCreatableSelect
                  fetchOptions={searchItems}
                  value={targetItemId}
                  selectedOption={targetItemId ? { value: targetItemId, label: targetItemName } : null}
                  onChange={(val, opt) => {
                    setTargetItemId(val)
                    setTargetItemName(opt ? opt.label : '')
                  }}
                  placeholder="e.g. Rice 1kg Pack, Single Can..."
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Quantity Produced / Added
                </label>
                <input
                  type="number"
                  step="any"
                  min="0.001"
                  required
                  value={targetQty}
                  onChange={(e) => setTargetQty(e.target.value)}
                  placeholder="e.g. 50 (for 50 × 1kg packs) or 24"
                  className="w-full h-10 px-3 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 font-bold text-slate-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
              Internal Notes / Reference (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Repacked at morning prep shift batch #04"
              className="w-full h-10 px-3 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
            />
          </div>

          {/* Submit Button */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-2.5 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-bold rounded-xl shadow-md transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <Split size={18} />}
              Convert & Update Stock
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

