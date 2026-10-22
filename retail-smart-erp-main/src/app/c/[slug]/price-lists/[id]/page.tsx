'use client'

// H5: price list rules — item, unit, quantity tier, fixed price or % off; CSV export / import.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { Plus, Trash2, Download, Upload, Save, Pencil, Loader2 } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { PageLoading } from '@/components/ui/loading-spinner'
import { StatusBadge } from '@/components/ui'
import { toast } from '@/components/ui/toast'
import { EntityMultiPicker } from '@/components/pricing/EntityMultiPicker'
import { PriceListFormModal, type PriceListRow } from '@/components/pricing/PriceListFormModal'

interface RuleRow {
  key: string
  itemId: string
  itemCode: string
  itemName: string
  baseUnit: string | null
  basePrice: string
  uom: string
  minQty: string
  mode: 'price' | 'percent'
  value: string
}

interface ApiRule {
  id: string; itemId: string; itemCode: string; itemName: string; baseUnit: string | null; basePrice: string
  uom: string | null; minQty: string; price: string | null; discountPercent: string | null
}

const cell = 'px-2 py-1 text-sm border rounded bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white w-full'

function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cur); cur = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cur += c
  }
  row.push(cur)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

export default function PriceListDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [list, setList] = useState<PriceListRow | null>(null)
  const [rules, setRules] = useState<RuleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [errors, setErrors] = useState<Array<{ row: number; error: string }>>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/price-lists/${id}`)
      if (!res.ok) { setList(null); return }
      const data = await res.json()
      setList(data)
      setRules((data.items as ApiRule[]).map((r) => ({
        key: r.id, itemId: r.itemId, itemCode: r.itemCode, itemName: r.itemName, baseUnit: r.baseUnit, basePrice: r.basePrice,
        uom: r.uom || '', minQty: String(Number(r.minQty)), mode: r.price !== null ? 'price' : 'percent',
        value: r.price !== null ? r.price : (r.discountPercent || ''),
      })))
      setDirty(false)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  function update(i: number, patch: Partial<RuleRow>) {
    setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setDirty(true)
  }

  async function save(items: Array<Record<string, unknown>>, mode: 'replace' | 'merge') {
    setSaving(true)
    setErrors([])
    try {
      const res = await fetch(`/api/price-lists/${id}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, items }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrors(data.errors || [])
        toast.error(data.details?.[0]?.message || data.error || 'Failed to save prices')
        return false
      }
      toast.success(`Saved ${data.saved} price(s)`)
      await load()
      return true
    } catch {
      toast.error('Failed to save prices')
      return false
    } finally {
      setSaving(false)
    }
  }

  function saveGrid() {
    const bad = rules.findIndex((r) => !r.itemId || r.value === '' || Number(r.value) < 0 || (r.mode === 'percent' && Number(r.value) > 100))
    if (bad >= 0) { toast.error(`Row ${bad + 1}: choose an item and a valid price / %`); return }
    save(rules.map((r) => ({
      itemId: r.itemId,
      uom: r.uom || undefined,
      minQty: Number(r.minQty) || 0,
      ...(r.mode === 'price' ? { price: Number(r.value) } : { discountPercent: Number(r.value) }),
    })), 'replace')
  }

  function exportCsv() {
    const lines = [['item_code', 'item_name', 'uom', 'min_qty', 'price', 'discount_percent'].join(',')]
    for (const r of rules) {
      lines.push([r.itemCode, r.itemName, r.uom, r.minQty, r.mode === 'price' ? r.value : '', r.mode === 'percent' ? r.value : ''].map((v) => csvEscape(String(v ?? ''))).join(','))
    }
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${(list?.name || 'price-list').replace(/[^\w-]+/g, '_')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function importCsv(file: File) {
    const rows = parseCsv(await file.text())
    if (rows.length < 2) { toast.error('The file has no rows'); return }
    const head = rows[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'))
    const col = (names: string[]) => head.findIndex((h) => names.includes(h))
    const ci = { code: col(['item_code', 'code', 'barcode', 'sku']), uom: col(['uom', 'unit']), min: col(['min_qty', 'min_quantity', 'qty']), price: col(['price']), pct: col(['discount_percent', 'discount', 'percent']) }
    if (ci.code < 0 || (ci.price < 0 && ci.pct < 0)) { toast.error('Need columns item_code and price or discount_percent'); return }
    const items = rows.slice(1).map((r) => {
      const price = ci.price >= 0 ? r[ci.price]?.trim() : ''
      const pct = ci.pct >= 0 ? r[ci.pct]?.trim() : ''
      return {
        itemCode: r[ci.code]?.trim(),
        uom: ci.uom >= 0 ? r[ci.uom]?.trim() || undefined : undefined,
        minQty: ci.min >= 0 && r[ci.min]?.trim() ? Number(r[ci.min]) : undefined,
        ...(price !== '' && price !== undefined ? { price: Number(price) } : { discountPercent: Number(pct) }),
      }
    })
    const replace = confirm(`Import ${items.length} row(s).\nOK = replace the whole list, Cancel = add / update these rows only.`)
    await save(items, replace ? 'replace' : 'merge')
  }

  if (loading && !list) return <PageLoading text="Loading price list..." />
  if (!list) return <div className="p-6 text-sm text-gray-500">Price list not found.</div>

  return (
    <ListPageLayout
      module="Price Lists"
      moduleHref="/price-lists"
      title={list.name}
      actionContent={
        <div className="flex items-center gap-2">
          <button onClick={() => setShowEdit(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded dark:border-gray-600 dark:text-gray-300">
            <Pencil size={14} /> Settings
          </button>
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded dark:border-gray-600 dark:text-gray-300">
            <Upload size={14} /> Import CSV
          </button>
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded dark:border-gray-600 dark:text-gray-300">
            <Download size={14} /> Export CSV
          </button>
          <button onClick={saveGrid} disabled={saving || !dirty}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importCsv(f) }} />
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
        <StatusBadge status={list.isActive ? 'active' : 'inactive'} size="sm" />
        <span>Priority {list.priority}</span>
        <span>{list.validFrom || list.validTo ? `Valid ${list.validFrom || '…'} → ${list.validTo || '…'}` : 'Always valid'}</span>
        <span>{list.appliesTo === 'all' ? 'Applies to everyone' : list.appliesTo === 'customer_group' ? `Groups: ${list.customerTypes.join(', ')}` : list.appliesTo === 'customers' ? `${list.customerIds.length} customer(s)` : `${list.posProfileIds.length} POS profile(s)`}</span>
      </div>
      {errors.length > 0 && (
        <div className="mb-3 p-3 text-sm text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-300 rounded max-h-40 overflow-auto">
          {errors.map((e) => <div key={e.row}>Row {e.row}: {e.error}</div>)}
        </div>
      )}
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
              <th className="px-3 py-2 text-left w-1/3">Item</th>
              <th className="px-3 py-2 text-left">Unit</th>
              <th className="px-3 py-2 text-left">Min qty</th>
              <th className="px-3 py-2 text-left">Rule</th>
              <th className="px-3 py-2 text-left">Value</th>
              <th className="px-3 py-2 text-right">Base</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {rules.map((r, i) => (
              <tr key={r.key}>
                <td className="px-3 py-1.5">
                  {r.itemId ? (
                    <div><div className="text-sm font-medium dark:text-white">{r.itemName}</div><div className="text-xs text-gray-500">{r.itemCode}</div></div>
                  ) : (
                    <EntityMultiPicker entity="items" single value={[]} placeholder="Search item…"
                      onChange={(v) => {
                        const o = v[0]
                        if (o) update(i, { itemId: o.id, itemName: o.label, itemCode: o.sub?.split(' · ')[0] || '', basePrice: (o.sub?.match(/Rs ([\d.]+)/)?.[1]) || '' })
                      }} />
                  )}
                </td>
                <td className="px-3 py-1.5 w-28"><input className={cell} value={r.uom} placeholder={r.baseUnit || 'base'} onChange={(e) => update(i, { uom: e.target.value })} /></td>
                <td className="px-3 py-1.5 w-24"><input className={cell} type="number" min="0" step="any" value={r.minQty} onChange={(e) => update(i, { minQty: e.target.value })} /></td>
                <td className="px-3 py-1.5 w-32">
                  <select className={cell} value={r.mode} onChange={(e) => update(i, { mode: e.target.value as RuleRow['mode'] })}>
                    <option value="price">Fixed price</option>
                    <option value="percent">% off base</option>
                  </select>
                </td>
                <td className="px-3 py-1.5 w-28"><input className={cell} type="number" min="0" step="0.01" value={r.value} onChange={(e) => update(i, { value: e.target.value })} /></td>
                <td className="px-3 py-1.5 text-right text-sm text-gray-500">{r.basePrice ? Number(r.basePrice).toFixed(2) : ''}</td>
                <td className="px-3 py-1.5 text-right">
                  <button aria-label="Remove row" onClick={() => { setRules(rules.filter((_, j) => j !== i)); setDirty(true) }} className="text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="p-3 border-t dark:border-gray-700 flex items-center justify-between">
          <button onClick={() => { setRules([...rules, { key: `new-${Date.now()}`, itemId: '', itemCode: '', itemName: '', baseUnit: null, basePrice: '', uom: '', minQty: '0', mode: 'price', value: '' }]); setDirty(true) }}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"><Plus size={14} /> Add price</button>
          <span className="text-xs text-gray-500">Several rows for one item with different min qty = quantity breaks. Leave unit blank for the base unit.</span>
        </div>
      </div>
      <PriceListFormModal isOpen={showEdit} editList={list} onClose={() => setShowEdit(false)} onSaved={() => { setShowEdit(false); load() }} />
    </ListPageLayout>
  )
}
