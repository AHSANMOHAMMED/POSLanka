'use client'

/**
 * Quotation editor (new + edit). Lines carry the unit quoted (LineUnitSelect: item conversions +
 * standard units, lazy GET /api/items/[id]/uoms), a tax rate (default: the item's tax template) and
 * warranty months (default: items.warranty_months). Totals shown here use the same formula the
 * API recomputes with (src/lib/quotations/lines.ts).
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, FileText } from 'lucide-react'
import { LineUnitSelect } from '@/components/items/LineUnitSelect'
import { fetchTenantInfo } from '@/lib/print/receipt-loader'

interface QuotationLine {
  id: string
  itemId?: string | null
  itemName: string
  quantity: number
  unitPrice: number
  discount: number
  taxRate: number
  warrantyMonths: number
  /** unit fields ('' uom = base unit) */
  baseUnit: string | null
  basePrice: number
  uom: string
  uomFactor: number
}

interface CatalogItem {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  sellingPrice: string
  unit?: string | null
  taxTemplateId?: string | null
  warrantyMonths?: number | null
}

interface TaxTemplate {
  id: string
  name: string
  isActive?: boolean
  items?: Array<{ rate: string | number; includedInPrice?: boolean }>
}

interface ExistingQuotation {
  id: string
  quotationNo: string
  status: string
  customerName: string | null
  customerPhone: string | null
  customerEmail: string | null
  validUntil: string | null
  notes: string | null
  discount: string | number
  items: Array<{
    itemId: string | null
    itemName: string
    quantity: string | number
    unitPrice: string | number
    discount: string | number
    taxRate?: string | number | null
    uom?: string | null
    uomFactor?: string | number | null
    warrantyMonths?: number | null
  }>
}

const r2 = (n: number) => Math.round(n * 100) / 100
let lineSeq = 0
const newLineId = () => `l${Date.now()}-${++lineSeq}`

const emptyLine = (): QuotationLine => ({
  id: newLineId(), itemId: null, itemName: '', quantity: 1, unitPrice: 0, discount: 0, taxRate: 0, warrantyMonths: 0,
  baseUnit: null, basePrice: 0, uom: '', uomFactor: 1,
})

export function QuotationStudio({ slug, editId }: { slug: string; editId?: string }) {
  const router = useRouter()

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState(editId ? '' : 'Thank you for choosing us! Quotation valid for 14 days.')
  const [quotationNo, setQuotationNo] = useState<string | null>(null)

  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  const [taxRates, setTaxRates] = useState<Map<string, number>>(new Map())
  const [taxInclusive, setTaxInclusive] = useState(false)
  const [items, setItems] = useState<QuotationLine[]>([emptyLine()])

  const [loading, setLoading] = useState(!!editId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/items?all=true&activeOnly=true')
      .then(res => res.ok ? res.json() : [])
      .then(data => {
        const list = Array.isArray(data) ? data : data.data || []
        setCatalogItems(list)
      })
      .catch(() => {})
    // Item tax templates → default line tax rate (sum of the template's tax rates)
    fetch('/api/accounting/tax-templates?all=true')
      .then(res => res.ok ? res.json() : [])
      .then((data: TaxTemplate[]) => {
        const m = new Map<string, number>()
        if (Array.isArray(data)) {
          for (const t of data) m.set(t.id, r2((t.items || []).reduce((s, i) => s + (Number(i.rate) || 0), 0)))
        }
        setTaxRates(m)
      })
      .catch(() => {})
    fetchTenantInfo().then(t => setTaxInclusive(!!t.taxInclusive)).catch(() => {})
  }, [])

  // Edit: load the quotation
  useEffect(() => {
    if (!editId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/quotations/${editId}`)
        const data = await res.json()
        if (!res.ok) { if (!cancelled) setError(data.error || 'Failed to load quotation'); return }
        const q = data.quotation as ExistingQuotation
        if (cancelled) return
        setQuotationNo(q.quotationNo)
        setCustomerName(q.customerName || '')
        setCustomerPhone(q.customerPhone || '')
        setCustomerEmail(q.customerEmail || '')
        setValidUntil(q.validUntil ? String(q.validUntil).slice(0, 10) : '')
        setNotes(q.notes || '')
        setItems(q.items.length ? q.items.map(i => {
          const factor = Number(i.uomFactor) || 1
          const price = Number(i.unitPrice) || 0
          return {
            id: newLineId(),
            itemId: i.itemId,
            itemName: i.itemName,
            quantity: Number(i.quantity) || 1,
            unitPrice: price,
            discount: Number(i.discount) || 0,
            taxRate: Number(i.taxRate) || 0,
            warrantyMonths: i.warrantyMonths || 0,
            baseUnit: null,
            basePrice: factor > 0 ? r2(price / factor) : price,
            uom: i.uom || '',
            uomFactor: factor,
          }
        }) : [emptyLine()])
      } catch {
        if (!cancelled) setError('Error fetching quotation')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [editId])

  function lineFromCatalog(c: CatalogItem, base?: QuotationLine): QuotationLine {
    const price = parseFloat(c.sellingPrice) || 0
    return {
      ...(base || emptyLine()),
      itemId: c.id,
      itemName: c.name,
      unitPrice: price,
      basePrice: price,
      baseUnit: c.unit || 'pcs',
      uom: '',
      uomFactor: 1,
      taxRate: c.taxTemplateId ? taxRates.get(c.taxTemplateId) ?? 0 : 0,
      warrantyMonths: Number(c.warrantyMonths) || 0,
    }
  }

  function addItem(catalogItem?: CatalogItem) {
    setItems(prev => {
      // Replace the untouched blank first line instead of appending under it
      const rest = prev.length === 1 && !prev[0].itemName.trim() ? [] : prev
      return [...rest, catalogItem ? lineFromCatalog(catalogItem) : emptyLine()]
    })
  }

  function removeItem(id: string) {
    if (items.length <= 1) return
    setItems(prev => prev.filter(i => i.id !== id))
  }

  function updateItem(id: string, patch: Partial<QuotationLine>) {
    setItems(prev => prev.map(i => {
      if (i.id !== id) return i
      if (patch.itemName !== undefined) {
        const typed = String(patch.itemName)
        // Typed name exactly matching a catalog item picks it (price, unit, tax, warranty)
        const matched = catalogItems.find(c => c.name.toLowerCase() === typed.toLowerCase())
        if (matched && matched.id !== i.itemId) return lineFromCatalog(matched, i)
      }
      return { ...i, ...patch }
    }))
  }

  const catalogById = new Map(catalogItems.map(c => [c.id, c]))

  const calc = items.map(i => {
    const gross = r2((Number(i.quantity) || 0) * (Number(i.unitPrice) || 0))
    const discount = Math.min(r2(Number(i.discount) || 0), gross)
    const net = r2(gross - discount)
    const rate = Number(i.taxRate) || 0
    const tax = rate > 0 ? (taxInclusive ? r2(net - net / (1 + rate / 100)) : r2(net * rate / 100)) : 0
    return { gross, discount, net, tax, total: taxInclusive ? net : r2(net + tax) }
  })
  const subtotal = r2(calc.reduce((s, c) => s + c.gross, 0))
  const totalDiscount = r2(calc.reduce((s, c) => s + c.discount, 0))
  const totalTax = r2(calc.reduce((s, c) => s + c.tax, 0))
  const grandTotal = Math.max(0, r2(subtotal - totalDiscount + (taxInclusive ? 0 : totalTax)))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!customerName.trim()) {
      setError('Please specify customer name')
      return
    }
    const validLines = items.filter(i => i.itemName.trim() && i.quantity > 0)
    if (validLines.length === 0) {
      setError('Please add at least one line item with a name and quantity')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const res = await fetch(editId ? `/api/quotations/${editId}` : '/api/quotations', {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerPhone,
          customerEmail: customerEmail.trim() || undefined,
          validUntil: validUntil || undefined,
          notes,
          discount: totalDiscount,
          items: validLines.map(i => ({
            itemId: i.itemId || undefined,
            itemName: i.itemName,
            quantity: Number(i.quantity) || 1,
            unitPrice: Number(i.unitPrice) || 0,
            discount: Number(i.discount) || 0,
            taxRate: Number(i.taxRate) || 0,
            uom: i.uom || undefined,
            uomFactor: i.uom ? i.uomFactor : 1,
            warrantyMonths: Number(i.warrantyMonths) || undefined,
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Failed to save quotation')
        return
      }
      router.push(`/c/${slug}/quotations/${editId || data.id}`)
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const inputSm = 'w-full text-right bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-sm font-semibold'

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-4 border-teal-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500">Loading quotation...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 pb-20">
      {/* Studio Top Header */}
      <header className="sticky top-0 z-30 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href={editId ? `/c/${slug}/quotations/${editId}` : `/c/${slug}/quotations`}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileText className="text-teal-600 dark:text-teal-400" size={22} />
              {editId ? `Edit ${quotationNo || 'Quotation'}` : 'Quotation Studio'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Create client quotes & estimates with units, tax and warranty</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="px-6 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-xl text-sm font-bold shadow-md shadow-teal-900/10 transition-all disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? 'Saving...' : editId ? 'Save Changes' : 'Create & Save Quotation'}
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto mt-8 px-4 sm:px-6">
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-medium">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 sm:p-10 space-y-8">
          {/* Client & Date Info */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pb-6 border-b border-slate-100 dark:border-slate-700/60">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Customer Name *</label>
              <input
                type="text"
                required
                placeholder="e.g. John Doe or Retail Ltd"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Phone (WhatsApp)</label>
              <input
                type="text"
                placeholder="+94 77 123 4567"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Email</label>
              <input
                type="email"
                placeholder="customer@example.lk"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">Valid Until</label>
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          {/* Line Items */}
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-800 dark:text-white">Items & Pricing</h3>
                <p className="text-xs text-slate-500">Pick products from your catalog or enter custom service lines</p>
              </div>

              <div className="flex items-center gap-2">
                {catalogItems.length > 0 && (
                  <select
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                    onChange={(e) => {
                      const item = catalogItems.find(c => c.id === e.target.value)
                      if (item) {
                        addItem(item)
                        e.target.value = ''
                      }
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>+ Add from Catalog...</option>
                    {catalogItems.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} — LKR {parseFloat(c.sellingPrice).toFixed(2)}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => addItem()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 text-xs font-bold hover:bg-teal-100 transition-colors"
                >
                  <Plus size={15} /> Custom Line
                </button>
              </div>
            </div>

            <datalist id="catalog-items-list">
              {catalogItems.map(c => (
                <option key={c.id} value={c.name}>
                  {c.sku ? `[${c.sku}] ` : ''}LKR {parseFloat(c.sellingPrice).toFixed(2)}
                </option>
              ))}
            </datalist>

            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-900/70 text-slate-500 dark:text-slate-400 text-xs uppercase font-bold border-b border-slate-200 dark:border-slate-700">
                    <th className="py-3 px-4 min-w-[200px]">Item Details</th>
                    <th className="py-3 px-2 w-24 text-right">Qty</th>
                    <th className="py-3 px-2 w-28">Unit</th>
                    <th className="py-3 px-2 w-32 text-right">Unit Price</th>
                    <th className="py-3 px-2 w-28 text-right">Discount</th>
                    <th className="py-3 px-2 w-20 text-right">Tax %</th>
                    <th className="py-3 px-2 w-24 text-right" title="Warranty in months (0 = none)">Warranty (mo)</th>
                    <th className="py-3 px-4 w-32 text-right">Total</th>
                    <th className="py-3 px-2 w-10 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {items.map((item, idx) => (
                    <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20">
                      <td className="py-2.5 px-4">
                        <input
                          type="text"
                          required
                          list="catalog-items-list"
                          placeholder="Type or pick from catalog..."
                          value={item.itemName}
                          onChange={(e) => updateItem(item.id, { itemName: e.target.value })}
                          className="w-full bg-transparent border-0 border-b border-transparent focus:border-teal-500 focus:outline-none py-1 font-medium text-slate-800 dark:text-white"
                        />
                        {item.itemId && (
                          <span className="inline-block text-[10px] font-mono font-bold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 px-1.5 rounded mt-0.5">
                            Catalog Item
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <input type="number" min={0.001} step="any" value={item.quantity}
                          onChange={(e) => updateItem(item.id, { quantity: parseFloat(e.target.value) || 0 })}
                          className={inputSm} />
                      </td>
                      <td className="py-2.5 px-2">
                        {item.itemId ? (
                          <LineUnitSelect
                            itemId={item.itemId}
                            baseUnit={item.baseUnit || catalogById.get(item.itemId)?.unit || 'pcs'}
                            value={item.uom ?? undefined}
                            basePrice={catalogById.has(item.itemId) ? (parseFloat(catalogById.get(item.itemId)!.sellingPrice) || item.basePrice) : item.basePrice}
                            onChange={(p) => updateItem(item.id, { uom: p.uom ?? undefined, uomFactor: p.uomFactor, unitPrice: p.unitPrice })}
                          />
                        ) : (
                          <input type="text" value={item.uom} placeholder="pcs" maxLength={20}
                            onChange={(e) => updateItem(item.id, { uom: e.target.value, uomFactor: 1 })}
                            className="w-20 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs" />
                        )}
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <input type="number" min={0} step="any" value={item.unitPrice}
                          onChange={(e) => updateItem(item.id, { unitPrice: parseFloat(e.target.value) || 0 })}
                          className={inputSm} />
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <input type="number" min={0} step="any" value={item.discount}
                          onChange={(e) => updateItem(item.id, { discount: parseFloat(e.target.value) || 0 })}
                          className={`${inputSm} text-rose-600`} />
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <input type="number" min={0} max={100} step="any" value={item.taxRate}
                          onChange={(e) => updateItem(item.id, { taxRate: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) })}
                          className={inputSm} />
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <input type="number" min={0} max={600} step={1} value={item.warrantyMonths}
                          onChange={(e) => updateItem(item.id, { warrantyMonths: Math.max(0, parseInt(e.target.value) || 0) })}
                          className={inputSm} />
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-800 dark:text-white">
                        {calc[idx].total.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Notes & Totals */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                Terms & Client Notes
              </label>
              <textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div className="bg-slate-50 dark:bg-slate-900/60 p-6 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
              <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400 font-medium">
                <span>Subtotal</span>
                <span className="font-mono font-bold">{subtotal.toFixed(2)} LKR</span>
              </div>
              {totalDiscount > 0 && (
                <div className="flex justify-between text-sm text-rose-600 font-medium">
                  <span>Total Discounts</span>
                  <span className="font-mono font-bold">-{totalDiscount.toFixed(2)} LKR</span>
                </div>
              )}
              {totalTax > 0 && (
                <div className="flex justify-between text-sm text-slate-600 dark:text-slate-400 font-medium">
                  <span>Tax{taxInclusive ? ' (included)' : ''}</span>
                  <span className="font-mono font-bold">{taxInclusive ? '' : '+'}{totalTax.toFixed(2)} LKR</span>
                </div>
              )}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-baseline">
                <span className="text-base font-bold text-slate-900 dark:text-white">Total Amount</span>
                <span className="text-2xl font-mono font-black text-teal-700 dark:text-teal-400">
                  {grandTotal.toFixed(2)} LKR
                </span>
              </div>
            </div>
          </div>
        </form>
      </main>
    </div>
  )
}
