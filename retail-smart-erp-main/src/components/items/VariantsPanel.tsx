'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { useCurrency } from '@/hooks/useCurrency'

interface Variant {
  id: string
  name: string
  itemCode: string
  barcode: string | null
  sellingPrice: string
  currentStock: string
  variantAttributes: Record<string, string> | null
}

type AttrRow = { name: string; values: string }

/** Quick starts for the common shop cases */
const PRESETS: Array<{ label: string; name: string; values: string }> = [
  { label: 'Clothing sizes', name: 'Size', values: 'XS, S, M, L, XL, XXL' },
  { label: 'Kids sizes', name: 'Size', values: '1-2Y, 3-4Y, 5-6Y, 7-8Y, 9-10Y, 11-12Y' },
  { label: 'Footwear / slipper sizes', name: 'Size', values: '5, 6, 7, 8, 9, 10, 11' },
  { label: 'Colours', name: 'Colour', values: 'Black, White, Red, Blue, Brown' },
  { label: 'Bag sizes', name: 'Size', values: 'Small, Medium, Large' },
]

/**
 * Size / colour variants of a product (clothing, footwear, bags …): each combination is its own
 * item with an item code, barcode, price and stock; the POS asks which one when the product is
 * scanned or tapped. POST /api/items/[id]/variants creates the missing combinations.
 */
export function VariantsPanel({ itemId, defaultPrice }: { itemId: string; defaultPrice: string }) {
  const { fCurrency } = useCurrency()
  const [variants, setVariants] = useState<Variant[] | null>(null)
  const [rows, setRows] = useState<AttrRow[]>([{ name: 'Size', values: '' }])
  const [price, setPrice] = useState(defaultPrice)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/items/${itemId}/variants`)
      const body = await res.json()
      setVariants(res.ok ? body.variants : [])
    } catch {
      setVariants([])
    }
  }, [itemId])

  useEffect(() => { load() }, [load])

  const attrs = Object.fromEntries(
    rows.map((r) => [r.name.trim(), r.values.split(',').map((v) => v.trim()).filter(Boolean)] as const).filter(([n, v]) => n && v.length > 0),
  )
  const count = Object.values(attrs).reduce((n, v) => n * v.length, Object.keys(attrs).length ? 1 : 0)

  async function create() {
    if (count === 0) return toast.error('Add at least one attribute with values, e.g. Size: S, M, L')
    setSaving(true)
    try {
      const res = await fetch(`/api/items/${itemId}/variants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributes: attrs, sellingPrice: price === '' ? undefined : Number(price) }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not create the variants')
      toast.success(`${body.created.length} variant${body.created.length === 1 ? '' : 's'} created${body.skipped ? `, ${body.skipped} already existed` : ''}`)
      load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the variants')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-800 dark:text-gray-200">Variants {variants ? `(${variants.length})` : ''}</h3>
        {!variants ? (
          <Loader2 className="animate-spin text-gray-400" size={18} />
        ) : variants.length === 0 ? (
          <p className="text-sm text-gray-500">No variants yet. Create sizes / colours below; each gets its own barcode, price and stock.</p>
        ) : (
          <div className="max-h-56 overflow-y-auto rounded border dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-900">
                <tr><th className="px-3 py-1.5">Variant</th><th className="px-3 py-1.5">Code / barcode</th><th className="px-3 py-1.5 text-right">Price</th><th className="px-3 py-1.5 text-right">Stock</th></tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <tr key={v.id} className="border-t dark:border-gray-700">
                    <td className="px-3 py-1.5">{Object.values(v.variantAttributes || {}).join(' / ') || v.name}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{v.itemCode}{v.barcode ? ` · ${v.barcode}` : ''}</td>
                    <td className="px-3 py-1.5 text-right">{fCurrency(v.sellingPrice)}</td>
                    <td className="px-3 py-1.5 text-right">{Number(v.currentStock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-1 text-xs text-gray-500">Edit a variant’s price, barcode or stock from the items list like any other item. Print its labels from Barcode → Print.</p>
      </div>

      <div className="rounded-lg border p-4 dark:border-gray-700">
        <h3 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-200">Add variants</h3>
        <div className="mb-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="rounded-full border px-3 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
              onClick={() => setRows((rs) => {
                const i = rs.findIndex((r) => r.name.trim().toLowerCase() === p.name.toLowerCase() || !r.values.trim())
                const next = [...rs]
                if (i >= 0) next[i] = { name: p.name, values: p.values }
                else if (next.length < 3) next.push({ name: p.name, values: p.values })
                return next
              })}
            >
              + {p.label}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input aria-label="Attribute" value={r.name} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Size" className="w-28 rounded border px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700" />
              <input aria-label="Values" value={r.values} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} placeholder="S, M, L, XL" className="flex-1 rounded border px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700" />
              {rows.length > 1 && (
                <button type="button" aria-label="Remove attribute" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="rounded p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"><Trash2 size={14} /></button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {rows.length < 3 && (
            <button type="button" onClick={() => setRows((rs) => [...rs, { name: rs.some((r) => r.name === 'Colour') ? '' : 'Colour', values: '' }])} className="flex items-center gap-1 text-sm text-blue-600 hover:underline">
              <Plus size={14} /> Add attribute
            </button>
          )}
          <label className="ml-auto flex items-center gap-2 text-sm">
            Price for new variants
            <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className="w-28 rounded border px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700" />
          </label>
          <button type="button" onClick={create} disabled={saving || count === 0} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Creating…' : `Create ${count || ''} variant${count === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
