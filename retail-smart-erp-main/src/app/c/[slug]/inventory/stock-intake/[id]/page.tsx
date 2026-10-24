'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  Home, ChevronRight, FileInput, Loader2, ScanLine, CheckCircle, Send, RefreshCw, Trash2, Save, Ban, AlertTriangle, Undo2,
} from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { usePermission, useRealtimeData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { formatDate } from '@/lib/utils/date-format'
import { INTAKE_STATUS_CONFIG } from '@/lib/inventory/stock-intake-status'

interface PreviewItem {
  id: string
  name: string
  itemCode: string
  barcode: string | null
  sellingPrice: string
  currentStock: number
  isActive: boolean
}

interface IntakeLine {
  id: string
  clientLineId: string | null
  lineMode: 'receive' | 'count'
  barcode: string | null
  sku: string | null
  itemId: string | null
  quantity: string
  systemQtySnapshot: string | null
  name: string | null
  categoryId: string | null
  unit: string | null
  costPrice: string | null
  sellingPrice: string | null
  status: 'pending' | 'posted' | 'error' | 'skipped'
  errorMessage: string | null
  createdItem: boolean
  match: { status: string; matchType: string; item: PreviewItem | null; error?: string }
  warnings: string[]
}

interface IntakeBatch {
  id: string
  batchNo: string
  warehouseId: string
  warehouseName: string | null
  status: string
  source: string
  notes: string | null
  updateCost: boolean
  totalLines: number
  postedLines: number
  errorLines: number
  version: number
  createdAt: string
  postedAt: string | null
}

interface Detail {
  batch: IntakeBatch
  lines: IntakeLine[]
  summary: { total: number; pending: number; posted: number; errors: number; newItems: number; conflicts: number }
}

interface Validation {
  willAdd: Array<{ lineId: string; itemName: string; delta: number; after: number }>
  willCreate: Array<{ lineId: string; name: string }>
  conflicts: Array<{ lineId: string; barcode: string | null; sku: string | null; barcodeItem: { name: string }; skuItem: { name: string } }>
  errors: Array<{ lineId: string; error: string }>
  /** selling prices on lines that differ from the item's price: applied only when confirmed */
  priceChanges?: Array<{ lineId: string; itemName: string; currentPrice: number; newPrice: number; decision: 'apply' | 'keep' | null }>
  canSync: boolean
}

interface SyncResult {
  status: string
  posted: number
  errors: Array<{ lineId: string; error: string }>
  createdItems: Array<{ itemId: string; itemCode: string; name: string; barcode: string | null }>
  totals: { total: number; posted: number; errors: number; pending: number }
  replayed?: boolean
  noop?: boolean
}

interface Option { id: string; name: string }

const inputCls = 'border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
const EDITABLE = ['draft', 'submitted', 'partially_posted']

async function readJson(res: Response) {
  return res.json().catch(() => ({} as Record<string, unknown>))
}

export default function StockIntakeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { tenantSlug } = useCompany()
  const canPost = usePermission('postStockIntake')
  const canSubmit = usePermission('submitStockIntake')

  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [categories, setCategories] = useState<Option[]>([])
  const [barcode, setBarcode] = useState('')
  const [qty, setQty] = useState('1')
  const [mode, setMode] = useState<'receive' | 'count'>('receive')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [validation, setValidation] = useState<Validation | null>(null)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [edits, setEdits] = useState<Record<string, Partial<Record<'name' | 'sellingPrice' | 'costPrice' | 'categoryId' | 'quantity', string>>>>({})
  const scanRef = useRef<HTMLInputElement>(null)

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/stock-intake/${id}`)
      if (res.ok) setDetail(await res.json())
      else if (res.status === 404) setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useRealtimeData(fetchDetail, { entityType: 'stock-intake' })

  useEffect(() => {
    fetch('/api/warehouses?all=true').then((r) => (r.ok ? r.json() : [])).then((d) => setWarehouses(Array.isArray(d) ? d : d.data || [])).catch(() => undefined)
    fetch('/api/categories?all=true').then((r) => (r.ok ? r.json() : [])).then((d) => setCategories(Array.isArray(d) ? d : d.data || [])).catch(() => undefined)
  }, [])

  const batch = detail?.batch
  const editable = !!batch && EDITABLE.includes(batch.status) && canSubmit

  async function addLine() {
    const code = barcode.trim()
    const q = Number(qty)
    if (!code) return
    if (!Number.isFinite(q) || q < 0 || (mode === 'receive' && q <= 0)) {
      toast.error(mode === 'receive' ? 'Quantity must be greater than 0' : 'Quantity cannot be negative')
      return
    }
    setAdding(true)
    try {
      const res = await fetch(`/api/stock-intake/${id}/lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: [{ clientLineId: crypto.randomUUID(), mode, barcode: code, quantity: q }] }),
      })
      const data = await readJson(res)
      if (!res.ok) {
        toast.error((data.error as string) || 'Failed to add line')
        return
      }
      const line = (data.lines as IntakeLine[] | undefined)?.[0]
      if (line?.match.status === 'new') toast.info(`${code}: not found, enter the new item details below`)
      else if (line?.match.item) toast.success(`${line.match.item.name} → ${line.quantity}`)
      setBarcode('')
      setQty('1')
      setValidation(null)
      await fetchDetail()
    } catch {
      toast.error('Network error adding line')
    } finally {
      setAdding(false)
      scanRef.current?.focus()
    }
  }

  async function patchBatch(body: Record<string, unknown>, label: string) {
    if (!batch) return
    setBusy(label)
    try {
      const res = await fetch(`/api/stock-intake/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedVersion: batch.version, ...body }),
      })
      const data = await readJson(res)
      if (!res.ok) toast.error((data.error as string) || 'Update failed')
      else toast.success(`${label} done`)
      await fetchDetail()
    } finally {
      setBusy(null)
    }
  }

  async function saveLine(line: IntakeLine) {
    const e = edits[line.id]
    if (!e) return
    const body: Record<string, unknown> = {}
    if (e.name !== undefined) body.name = e.name
    if (e.categoryId !== undefined) body.categoryId = e.categoryId || undefined
    if (e.sellingPrice !== undefined && e.sellingPrice !== '') body.sellingPrice = Number(e.sellingPrice)
    if (e.costPrice !== undefined && e.costPrice !== '') body.costPrice = Number(e.costPrice)
    if (e.quantity !== undefined && e.quantity !== '') body.quantity = Number(e.quantity)
    setBusy(`line:${line.id}`)
    try {
      const res = await fetch(`/api/stock-intake/${id}/lines/${line.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await readJson(res)
      if (!res.ok) {
        toast.error((data.error as string) || 'Failed to save line')
        return
      }
      setEdits((prev) => {
        const next = { ...prev }
        delete next[line.id]
        return next
      })
      setValidation(null)
      await fetchDetail()
    } finally {
      setBusy(null)
    }
  }

  async function deleteLine(line: IntakeLine) {
    if (!confirm('Remove this line?')) return
    setBusy(`line:${line.id}`)
    try {
      const res = await fetch(`/api/stock-intake/${id}/lines/${line.id}`, { method: 'DELETE' })
      const data = await readJson(res)
      if (!res.ok) toast.error((data.error as string) || 'Failed to delete line')
      setValidation(null)
      await fetchDetail()
    } finally {
      setBusy(null)
    }
  }

  async function runValidate() {
    setBusy('validate')
    try {
      const res = await fetch(`/api/stock-intake/${id}/validate`, { method: 'POST' })
      const data = await readJson(res)
      if (!res.ok) toast.error((data.error as string) || 'Validation failed')
      else setValidation(data as unknown as Validation)
    } finally {
      setBusy(null)
    }
  }

  async function runSync(priceChanges?: 'apply' | 'keep') {
    setBusy('sync')
    setSyncResult(null)
    try {
      if (!priceChanges) {
        // Dry run first: a changed selling price is applied only when the user says so
        const vRes = await fetch(`/api/stock-intake/${id}/validate`, { method: 'POST' })
        const v = (await readJson(vRes)) as unknown as Validation
        if (vRes.ok && v.priceChanges?.some((c) => c.decision === null)) {
          setValidation(v)
          toast.info('Some selling prices changed: choose to update them or keep the current prices')
          return
        }
      }
      const res = await fetch(`/api/stock-intake/${id}/sync`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID(), 'Content-Type': 'application/json' },
        body: JSON.stringify(priceChanges ? { priceChanges } : {}),
      })
      const data = await readJson(res)
      if (!res.ok) {
        toast.error((data.error as string) || 'Sync failed')
      } else {
        const r = data as unknown as SyncResult
        setSyncResult(r)
        if (r.errors.length === 0) toast.success(`Synced: ${r.posted} line(s) posted`)
        else toast.error(`${r.posted} posted, ${r.errors.length} line(s) need attention`)
      }
      setValidation(null)
      await fetchDetail()
    } finally {
      setBusy(null)
    }
  }

  const setEdit = (lineId: string, field: 'name' | 'sellingPrice' | 'costPrice' | 'categoryId' | 'quantity', value: string) =>
    setEdits((prev) => ({ ...prev, [lineId]: { ...prev[lineId], [field]: value } }))

  if (loading) return <PageLoading />
  if (!detail || !batch) {
    return (
      <div className="p-8 text-center text-gray-500">
        Batch not found. <Link className="text-blue-600" href={`/c/${tenantSlug}/inventory/stock-intake`}>Back to list</Link>
      </div>
    )
  }

  const st = INTAKE_STATUS_CONFIG[batch.status] || INTAKE_STATUS_CONFIG.draft
  const openLines = detail.summary.pending + detail.summary.errors
  const lineName = (l: IntakeLine) => l.match.item?.name || l.name || l.barcode || l.sku || l.id.slice(0, 8)

  return (
    <div className="space-y-4 p-4 max-w-7xl mx-auto">
      <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400"><Home size={14} /></Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/stock`} className="hover:text-blue-600 dark:hover:text-blue-400">Stock</Link>
        <ChevronRight size={14} />
        <Link href={`/c/${tenantSlug}/inventory/stock-intake`} className="hover:text-blue-600 dark:hover:text-blue-400">Stock Intake</Link>
        <ChevronRight size={14} />
        <span>{batch.batchNo}</span>
      </div>

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded">
              <FileInput size={20} className="text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-gray-900 dark:text-white">{batch.batchNo}</h1>
                <span className={`text-xs px-2 py-0.5 rounded-full ${st.bg} ${st.color}`}>{st.label}</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Created {formatDate(batch.createdAt)} · {batch.source}
                {batch.postedAt && <> · last posted {formatDate(batch.postedAt)}</>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={runValidate} disabled={!!busy || openLines === 0}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm flex items-center gap-2 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50">
              {busy === 'validate' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />} Validate
            </button>
            {batch.status === 'draft' && canSubmit && (
              <button onClick={() => patchBatch({ status: 'submitted' }, 'Submit')} disabled={!!busy || detail.summary.total === 0}
                className="px-3 py-2 bg-blue-600 text-white rounded text-sm flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50">
                <Send size={16} /> Submit
              </button>
            )}
            {batch.status === 'submitted' && canSubmit && (
              <button onClick={() => patchBatch({ status: 'draft' }, 'Reopen')} disabled={!!busy}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded text-sm flex items-center gap-2 text-gray-700 dark:text-gray-200 disabled:opacity-50">
                <Undo2 size={16} /> Reopen
              </button>
            )}
            {canPost && EDITABLE.includes(batch.status) && openLines > 0 && (
              <button onClick={() => void runSync()} disabled={!!busy}
                className="px-3 py-2 bg-green-600 text-white rounded text-sm flex items-center gap-2 hover:bg-green-700 disabled:opacity-50">
                {busy === 'sync' ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                {batch.status === 'partially_posted' ? 'Re-sync remaining' : 'Sync to stock'}
              </button>
            )}
            {canPost && EDITABLE.includes(batch.status) && (
              <button onClick={() => { if (confirm('Cancel this batch? Unposted lines will be skipped.')) patchBatch({ status: 'cancelled' }, 'Cancel') }} disabled={!!busy}
                className="px-3 py-2 border border-red-300 text-red-600 rounded text-sm flex items-center gap-2 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                <Ban size={16} /> Cancel
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Branch</label>
            {editable && batch.postedLines === 0 ? (
              <select value={batch.warehouseId} onChange={(e) => patchBatch({ warehouseId: e.target.value }, 'Branch change')} className={`w-full ${inputCls}`}>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                {!warehouses.some((w) => w.id === batch.warehouseId) && <option value={batch.warehouseId}>{batch.warehouseName}</option>}
              </select>
            ) : <div className="text-gray-900 dark:text-white py-1.5">{batch.warehouseName}</div>}
          </div>
          <Stat label="Lines" value={detail.summary.total} />
          <Stat label="Posted" value={detail.summary.posted} tone="green" />
          <Stat label="Pending" value={detail.summary.pending} />
          <Stat label="Errors" value={detail.summary.errors} tone={detail.summary.errors ? 'red' : undefined} />
        </div>
        <div className="flex items-center gap-4 flex-wrap text-sm">
          <label className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={batch.updateCost} disabled={!editable || !!busy}
              onChange={(e) => patchBatch({ updateCost: e.target.checked }, 'Cost setting')} />
            Update item cost (weighted average) from line costs
          </label>
          {batch.notes && <span className="text-gray-500 dark:text-gray-400">Notes: {batch.notes}</span>}
        </div>
      </div>

      {/* Scan / add line */}
      {editable && (
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
          <form className="flex items-end gap-3 flex-wrap" onSubmit={(e) => { e.preventDefault(); void addLine() }}>
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Scan or type barcode / SKU / item code (Enter adds)</label>
              <div className="relative">
                <ScanLine size={16} className="absolute left-2 top-2.5 text-gray-400" />
                <input ref={scanRef} autoFocus value={barcode} onChange={(e) => setBarcode(e.target.value)}
                  className={`w-full pl-8 ${inputCls} py-2`} placeholder="Scan..." />
              </div>
            </div>
            <div className="w-28">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Quantity</label>
              <input type="number" step="any" min={0} value={qty} onChange={(e) => setQty(e.target.value)} className={`w-full ${inputCls} py-2`} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Mode</label>
              <div className="flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
                {(['receive', 'count'] as const).map((m) => (
                  <button type="button" key={m} onClick={() => setMode(m)}
                    className={`px-3 py-2 ${mode === m ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}>
                    {m === 'receive' ? 'Receive (+)' : 'Count (=)'}
                  </button>
                ))}
              </div>
            </div>
            <button type="submit" disabled={adding || !barcode.trim()}
              className="px-4 py-2 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
              {adding ? <Loader2 size={16} className="animate-spin" /> : <ScanLine size={16} />} Add
            </button>
          </form>
          <p className="text-xs text-gray-400 mt-2">Receive adds to stock; scanning the same item again adds to its line. Count sets the counted quantity (sales after the count are kept).</p>
        </div>
      )}

      {/* Validation summary */}
      {validation && (
        <div className={`rounded border p-4 text-sm ${validation.canSync ? 'border-green-300 bg-green-50 dark:bg-green-900/20' : 'border-orange-300 bg-orange-50 dark:bg-orange-900/20'}`}>
          <div className="font-medium text-gray-900 dark:text-white mb-1">
            Dry run: {validation.willAdd.length} stock update(s), {validation.willCreate.length} new item(s), {validation.conflicts.length} conflict(s), {validation.errors.length} error(s)
          </div>
          {validation.willCreate.length > 0 && <div className="text-gray-700 dark:text-gray-300">Will create: {validation.willCreate.map((c) => c.name).join(', ')}</div>}
          {validation.conflicts.map((c) => (
            <div key={c.lineId} className="text-orange-700 dark:text-orange-300">Conflict: barcode {c.barcode} → {c.barcodeItem.name}, SKU {c.sku} → {c.skuItem.name}</div>
          ))}
          {validation.errors.map((e) => <div key={e.lineId} className="text-red-600">{e.error}</div>)}
          {(validation.priceChanges || []).some((c) => c.decision === null) && (
            <div className="mt-3 rounded border border-blue-300 bg-blue-50 dark:bg-blue-900/20 p-3">
              <div className="font-medium text-gray-900 dark:text-white mb-1">Selling price changes</div>
              {(validation.priceChanges || []).filter((c) => c.decision === null).map((c) => (
                <div key={c.lineId} className="text-gray-700 dark:text-gray-300">
                  {c.itemName}: {c.currentPrice.toFixed(2)} → <span className="font-semibold">{c.newPrice.toFixed(2)}</span>
                </div>
              ))}
              {canPost && (
                <div className="flex flex-wrap gap-2 mt-3">
                  <button onClick={() => void runSync('apply')} disabled={!!busy} className="px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50">Update prices &amp; sync</button>
                  <button onClick={() => void runSync('keep')} disabled={!!busy} className="px-3 py-1.5 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm hover:bg-gray-50 disabled:opacity-50">Keep current prices &amp; sync</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sync result */}
      {syncResult && (
        <div className={`rounded border p-4 text-sm ${syncResult.errors.length ? 'border-orange-300 bg-orange-50 dark:bg-orange-900/20' : 'border-green-300 bg-green-50 dark:bg-green-900/20'}`}>
          <div className="font-medium text-gray-900 dark:text-white">
            {syncResult.noop ? 'Nothing to sync.' : `Posted ${syncResult.posted} line(s).`} Batch is now {INTAKE_STATUS_CONFIG[syncResult.status]?.label || syncResult.status}
            {' '}({syncResult.totals.posted}/{syncResult.totals.total} posted{syncResult.totals.errors ? `, ${syncResult.totals.errors} error(s)` : ''}).
          </div>
          {syncResult.createdItems.length > 0 && (
            <div className="text-gray-700 dark:text-gray-300 mt-1">
              New items: {syncResult.createdItems.map((c) => `${c.name} (${c.itemCode}${c.barcode ? `, ${c.barcode}` : ''})`).join('; ')}
            </div>
          )}
          {syncResult.errors.length > 0 && <div className="text-red-600 mt-1">Fix the lines marked in red and sync again; only those lines will be posted.</div>}
        </div>
      )}

      {/* Lines */}
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-500 dark:text-gray-400 uppercase">
                <th className="text-left px-3 py-2">Scanned</th>
                <th className="text-left px-3 py-2">Mode</th>
                <th className="text-left px-3 py-2">Item</th>
                <th className="text-right px-3 py-2">Current</th>
                <th className="text-right px-3 py-2">Qty</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {detail.lines.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">No lines yet. Scan an item to start.</td></tr>
              ) : detail.lines.map((l) => {
                const open = l.status === 'pending' || l.status === 'error'
                const canEdit = editable && open
                const e = edits[l.id] || {}
                const isNew = l.match.status === 'new'
                return (
                  <tr key={l.id} className={l.status === 'error' ? 'bg-red-50/60 dark:bg-red-900/10' : ''}>
                    <td className="px-3 py-2 align-top">
                      <div className="font-mono text-xs text-gray-900 dark:text-white">{l.barcode || '—'}</div>
                      {l.sku && <div className="text-xs text-gray-400">SKU {l.sku}</div>}
                    </td>
                    <td className="px-3 py-2 align-top text-xs capitalize text-gray-600 dark:text-gray-300">{l.lineMode}</td>
                    <td className="px-3 py-2 align-top">
                      {isNew && canEdit ? (
                        <div className="space-y-1">
                          <span className="text-xs font-semibold text-indigo-600">NEW ITEM</span>
                          <div className="flex gap-1 flex-wrap">
                            <input placeholder="Name *" value={e.name ?? l.name ?? ''} onChange={(ev) => setEdit(l.id, 'name', ev.target.value)} className={`${inputCls} w-44`} />
                            <input placeholder="Price" type="number" step="any" min={0} value={e.sellingPrice ?? l.sellingPrice ?? ''} onChange={(ev) => setEdit(l.id, 'sellingPrice', ev.target.value)} className={`${inputCls} w-24`} />
                            <input placeholder="Cost" type="number" step="any" min={0} value={e.costPrice ?? l.costPrice ?? ''} onChange={(ev) => setEdit(l.id, 'costPrice', ev.target.value)} className={`${inputCls} w-24`} />
                            <select value={e.categoryId ?? l.categoryId ?? ''} onChange={(ev) => setEdit(l.id, 'categoryId', ev.target.value)} className={`${inputCls} w-36`}>
                              <option value="">Category</option>
                              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </div>
                        </div>
                      ) : isNew ? (
                        <div><span className="text-xs font-semibold text-indigo-600">NEW ITEM</span> <span className="text-gray-900 dark:text-white">{l.name || '(no name)'}</span></div>
                      ) : l.match.item ? (
                        <div>
                          <div className="text-gray-900 dark:text-white">{l.match.item.name}</div>
                          <div className="text-xs text-gray-400">{l.match.item.itemCode}{l.createdItem ? ' · created by this batch' : ''}</div>
                        </div>
                      ) : (
                        <span className="text-red-600 text-xs">{l.match.error || 'Unresolved'}</span>
                      )}
                      {open && l.warnings.map((w, i) => (
                        <div key={i} className="text-xs text-orange-600 flex items-center gap-1 mt-0.5"><AlertTriangle size={12} />{w}</div>
                      ))}
                      {l.status === 'error' && l.errorMessage && <div className="text-xs text-red-600 mt-0.5">{l.errorMessage}</div>}
                    </td>
                    <td className="px-3 py-2 align-top text-right text-gray-600 dark:text-gray-300">
                      {l.match.item ? l.match.item.currentStock : '—'}
                      {l.lineMode === 'count' && l.systemQtySnapshot !== null && open && (
                        <div className="text-xs text-gray-400">at count {Number(l.systemQtySnapshot)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      {canEdit ? (
                        <input type="number" step="any" min={0} value={e.quantity ?? String(Number(l.quantity))}
                          onChange={(ev) => setEdit(l.id, 'quantity', ev.target.value)} className={`${inputCls} w-24 text-right`} />
                      ) : <span className="text-gray-900 dark:text-white">{Number(l.quantity)}</span>}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        l.status === 'posted' ? 'bg-green-50 text-green-700 dark:bg-green-900/20'
                          : l.status === 'error' ? 'bg-red-50 text-red-700 dark:bg-red-900/20'
                            : l.status === 'skipped' ? 'bg-gray-100 text-gray-500 dark:bg-gray-700'
                              : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20'}`}>{l.status}</span>
                    </td>
                    <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                      {canEdit && (
                        <>
                          {edits[l.id] && (
                            <button title="Save" onClick={() => saveLine(l)} disabled={busy === `line:${l.id}`} className="p-1.5 text-green-600 hover:bg-green-50 rounded">
                              {busy === `line:${l.id}` ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            </button>
                          )}
                          <button title={`Remove ${lineName(l)}`} onClick={() => deleteLine(l)} disabled={!!busy} className="p-1.5 text-red-600 hover:bg-red-50 rounded">
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'green' | 'red' }) {
  const color = tone === 'green' ? 'text-green-600' : tone === 'red' ? 'text-red-600' : 'text-gray-900 dark:text-white'
  return (
    <div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  )
}
