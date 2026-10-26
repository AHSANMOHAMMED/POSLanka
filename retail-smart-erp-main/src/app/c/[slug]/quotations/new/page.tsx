'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, FileText } from 'lucide-react'

interface QuotationLine {
  id: string
  itemId?: string | null
  itemName: string
  quantity: number
  unitPrice: number
  discount: number
}

interface CatalogItem {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  sellingPrice: string
}

export default function NewQuotationStudioPage() {
  const params = useParams()
  const slug = params.slug as string
  const router = useRouter()

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [notes, setNotes] = useState('Thank you for choosing us! Quotation valid for 14 days.')
  
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  const [items, setItems] = useState<QuotationLine[]>([
    { id: '1', itemId: null, itemName: '', quantity: 1, unitPrice: 0, discount: 0 }
  ])

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
  }, [])

  function addItem(catalogItem?: CatalogItem) {
    if (catalogItem) {
      setItems(prev => [
        ...prev,
        {
          id: Date.now().toString(),
          itemId: catalogItem.id,
          itemName: catalogItem.name,
          quantity: 1,
          unitPrice: parseFloat(catalogItem.sellingPrice) || 0,
          discount: 0,
        }
      ])
    } else {
      setItems(prev => [
        ...prev,
        { id: Date.now().toString(), itemId: null, itemName: '', quantity: 1, unitPrice: 0, discount: 0 }
      ])
    }
  }

  function removeItem(id: string) {
    if (items.length <= 1) return
    setItems(prev => prev.filter(i => i.id !== id))
  }

  function updateItem(id: string, field: keyof QuotationLine, val: string | number) {
    setItems(prev => prev.map(i => {
      if (i.id !== id) return i
      if (field === 'itemName') {
        const typed = String(val)
        // Check if typed name exactly matches a catalog item to auto-populate price
        const matched = catalogItems.find(c => c.name.toLowerCase() === typed.toLowerCase())
        if (matched) {
          return {
            ...i,
            itemName: matched.name,
            itemId: matched.id,
            unitPrice: parseFloat(matched.sellingPrice) || i.unitPrice,
          }
        }
      }
      return { ...i, [field]: val }
    }))
  }

  const subtotal = items.reduce((acc, i) => acc + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0)
  const totalDiscount = items.reduce((acc, i) => acc + (Number(i.discount) || 0), 0)
  const grandTotal = Math.max(0, subtotal - totalDiscount)

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
      const res = await fetch('/api/quotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerPhone,
          validUntil: validUntil || undefined,
          subtotal,
          discount: totalDiscount,
          tax: 0,
          total: grandTotal,
          items: validLines.map(i => ({
            itemId: i.itemId || undefined,
            itemName: i.itemName,
            quantity: Number(i.quantity) || 1,
            unitPrice: Number(i.unitPrice) || 0,
            discount: Number(i.discount) || 0,
            tax: 0,
            total: Math.max(0, (Number(i.quantity) || 1) * (Number(i.unitPrice) || 0) - (Number(i.discount) || 0)),
          })),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Failed to create quotation')
        return
      }
      router.push(`/c/${slug}/quotations`)
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 pb-20">
      {/* Studio Top Header */}
      <header className="sticky top-0 z-30 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <Link
            href={`/c/${slug}/quotations`}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileText className="text-teal-600 dark:text-teal-400" size={22} />
              Quotation Studio
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Create client quotes & estimates with live styling</p>
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
            {saving ? 'Creating...' : 'Create & Save Quotation'}
          </button>
        </div>
      </header>

      {/* Main Studio Body */}
      <main className="max-w-5xl mx-auto mt-8 px-4 sm:px-6">
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-medium">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 sm:p-10 space-y-8">
          {/* Client & Date Info Card */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pb-6 border-b border-slate-100 dark:border-slate-700/60">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                Customer Name *
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe or Retail Ltd"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full pl-3 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                Phone (WhatsApp)
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="+94 77 123 4567"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="w-full pl-3 pr-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                Valid Until
              </label>
              <input
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-semibold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          {/* Line Items Table */}
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

            {/* Datalist for fast autocomplete */}
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
                    <th className="py-3 px-4">Item Details</th>
                    <th className="py-3 px-3 w-28 text-right">Quantity</th>
                    <th className="py-3 px-3 w-36 text-right">Unit Price</th>
                    <th className="py-3 px-3 w-32 text-right">Discount</th>
                    <th className="py-3 px-4 w-36 text-right">Total</th>
                    <th className="py-3 px-2 w-12 text-center"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {items.map((item) => {
                    const lineSub = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)
                    const lineTot = Math.max(0, lineSub - (Number(item.discount) || 0))
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/20">
                        <td className="py-2.5 px-4">
                          <input
                            type="text"
                            required
                            list="catalog-items-list"
                            placeholder="Type or pick from catalog..."
                            value={item.itemName}
                            onChange={(e) => updateItem(item.id, 'itemName', e.target.value)}
                            className="w-full bg-transparent border-0 border-b border-transparent focus:border-teal-500 focus:outline-none py-1 font-medium text-slate-800 dark:text-white"
                          />
                          {item.itemId && (
                            <span className="inline-block text-[10px] font-mono font-bold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 px-1.5 py-0.2 rounded mt-0.5">
                              Catalog Item
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <input
                            type="number"
                            min={0.001}
                            step="any"
                            value={item.quantity}
                            onChange={(e) => updateItem(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                            className="w-full text-right bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-sm font-semibold"
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={item.unitPrice}
                            onChange={(e) => updateItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                            className="w-full text-right bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-sm font-semibold"
                          />
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={item.discount}
                            onChange={(e) => updateItem(item.id, 'discount', parseFloat(e.target.value) || 0)}
                            className="w-full text-right bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-sm font-semibold text-rose-600"
                          />
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-800 dark:text-white">
                          {lineTot.toFixed(2)}
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
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom Notes & Totals */}
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
