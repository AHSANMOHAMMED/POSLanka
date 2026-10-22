'use client'

// H5: an item's unit conversions (box = 12 pcs …) and additional barcodes, saved together through
// PUT /api/items/[id]/uoms { uoms, barcodes } (one transaction). items.barcode stays the primary code.
import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2, Loader2, Save } from 'lucide-react'
import { FormLabel } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'

interface UomRow { uom: string; factor: string; barcode: string; sellingPrice: string }
interface BarcodeRow { barcode: string; uom: string; packQty: string; priceOverride: string; label: string }
interface Unit { code: string; name: string; isActive: boolean }

interface Props {
  itemId: string
  baseUnit: string
  basePrice: number
}

const cell = 'px-2 py-1.5 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white w-full'

export function ItemUnitsBarcodesEditor({ itemId, baseUnit, basePrice }: Props) {
  const [units, setUnits] = useState<Unit[]>([])
  const [uoms, setUoms] = useState<UomRow[]>([])
  const [barcodes, setBarcodes] = useState<BarcodeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [u, c, b] = await Promise.all([
        fetch('/api/units').then((r) => (r.ok ? r.json() : [])),
        fetch(`/api/items/${itemId}/uoms`).then((r) => (r.ok ? r.json() : [])),
        fetch(`/api/items/${itemId}/barcodes`).then((r) => (r.ok ? r.json() : [])),
      ])
      setUnits((u as Unit[]).filter((x) => x.isActive))
      setUoms((c as Array<{ uom: string; factor: string; barcode: string | null; sellingPrice: string | null }>).map((r) => ({
        uom: r.uom, factor: String(Number(r.factor)), barcode: r.barcode || '', sellingPrice: r.sellingPrice || '',
      })))
      setBarcodes((b as Array<{ barcode: string; uom: string | null; packQty: string; priceOverride: string | null; label: string | null }>).map((r) => ({
        barcode: r.barcode, uom: r.uom || '', packQty: String(Number(r.packQty)), priceOverride: r.priceOverride || '', label: r.label || '',
      })))
    } finally {
      setLoading(false)
    }
  }, [itemId])

  useEffect(() => { load() }, [load])

  async function save() {
    setError('')
    for (const u of uoms) {
      if (!u.uom || !(Number(u.factor) > 0)) { setError('Every unit needs a unit and a factor greater than zero'); return }
    }
    for (const b of barcodes) {
      if (!b.barcode.trim()) { setError('Barcode cannot be blank'); return }
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/items/${itemId}/uoms`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uoms: uoms.map((u) => ({
            uom: u.uom, factor: Number(u.factor), barcode: u.barcode.trim() || undefined,
            sellingPrice: u.sellingPrice === '' ? undefined : Number(u.sellingPrice),
          })),
          barcodes: barcodes.map((b) => ({
            barcode: b.barcode.trim(), uom: b.uom || undefined, packQty: b.packQty === '' ? undefined : Number(b.packQty),
            priceOverride: b.priceOverride === '' ? undefined : Number(b.priceOverride), label: b.label.trim() || undefined,
          })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.code === 'DUPLICATE'
          ? `Barcode${data.value ? ` "${data.value}"` : ''} is already used by another item`
          : data.details?.[0]?.message || data.error || 'Failed to save units and barcodes')
        return
      }
      toast.success('Units and barcodes saved')
      await load()
    } catch {
      setError('Failed to save units and barcodes')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading units…</div>
  }

  const otherUnits = units.filter((u) => u.code.toLowerCase() !== (baseUnit || '').toLowerCase())

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-2">
          <FormLabel>Units of measure</FormLabel>
          <button type="button" onClick={() => setUoms([...uoms, { uom: '', factor: '', barcode: '', sellingPrice: '' }])}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
            <Plus size={14} /> Add unit
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Stock is kept in the base unit ({baseUnit || 'pcs'}). Selling 1 box of a factor-12 unit takes 12 {baseUnit || 'pcs'} out of stock.
        </p>
        {uoms.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Sold in {baseUnit || 'pcs'} only.</p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
              <span className="col-span-3">Unit</span><span className="col-span-2">= {baseUnit || 'pcs'}</span>
              <span className="col-span-3">Barcode</span><span className="col-span-3">Price</span><span />
            </div>
            {uoms.map((u, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <select className={`${cell} col-span-3`} value={u.uom} onChange={(e) => setUoms(uoms.map((x, j) => (j === i ? { ...x, uom: e.target.value } : x)))}>
                  <option value="">Select…</option>
                  {otherUnits.map((x) => <option key={x.code} value={x.code}>{x.name} ({x.code})</option>)}
                </select>
                <input className={`${cell} col-span-2`} type="number" min="0" step="any" value={u.factor} placeholder="12"
                  onChange={(e) => setUoms(uoms.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)))} />
                <input className={`${cell} col-span-3`} value={u.barcode} placeholder="Optional"
                  onChange={(e) => setUoms(uoms.map((x, j) => (j === i ? { ...x, barcode: e.target.value } : x)))} />
                <input className={`${cell} col-span-3`} type="number" min="0" step="0.01" value={u.sellingPrice}
                  placeholder={Number(u.factor) > 0 ? (basePrice * Number(u.factor)).toFixed(2) : 'Base × factor'}
                  onChange={(e) => setUoms(uoms.map((x, j) => (j === i ? { ...x, sellingPrice: e.target.value } : x)))} />
                <button type="button" aria-label="Remove unit" onClick={() => setUoms(uoms.filter((_, j) => j !== i))}
                  className="text-gray-400 hover:text-red-600 justify-self-center"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <FormLabel>Additional barcodes</FormLabel>
          <button type="button" onClick={() => setBarcodes([...barcodes, { barcode: '', uom: '', packQty: '1', priceOverride: '', label: '' }])}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
            <Plus size={14} /> Add barcode
          </button>
        </div>
        {barcodes.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Only the primary barcode.</p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 dark:text-gray-400">
              <span className="col-span-3">Barcode</span><span className="col-span-2">Unit</span><span className="col-span-2">Qty / scan</span>
              <span className="col-span-2">Unit price</span><span className="col-span-2">Label</span><span />
            </div>
            {barcodes.map((b, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input className={`${cell} col-span-3`} value={b.barcode}
                  onChange={(e) => setBarcodes(barcodes.map((x, j) => (j === i ? { ...x, barcode: e.target.value } : x)))} />
                <select className={`${cell} col-span-2`} value={b.uom} onChange={(e) => setBarcodes(barcodes.map((x, j) => (j === i ? { ...x, uom: e.target.value } : x)))}>
                  <option value="">{baseUnit || 'pcs'}</option>
                  {uoms.filter((u) => u.uom).map((u) => <option key={u.uom} value={u.uom}>{u.uom}</option>)}
                </select>
                <input className={`${cell} col-span-2`} type="number" min="0" step="any" value={b.packQty}
                  onChange={(e) => setBarcodes(barcodes.map((x, j) => (j === i ? { ...x, packQty: e.target.value } : x)))} />
                <input className={`${cell} col-span-2`} type="number" min="0" step="0.01" value={b.priceOverride} placeholder="Default"
                  onChange={(e) => setBarcodes(barcodes.map((x, j) => (j === i ? { ...x, priceOverride: e.target.value } : x)))} />
                <input className={`${cell} col-span-2`} value={b.label} placeholder="e.g. Old pack"
                  onChange={(e) => setBarcodes(barcodes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <button type="button" aria-label="Remove barcode" onClick={() => setBarcodes(barcodes.filter((_, j) => j !== i))}
                  className="text-gray-400 hover:text-red-600 justify-self-center"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <div className="p-2 text-sm text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-300 rounded">{error}</div>}
      <div className="flex justify-end">
        <button type="button" onClick={save} disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save units &amp; barcodes
        </button>
      </div>
    </div>
  )
}
