'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Loader2, Plus, X } from 'lucide-react'

interface TemplateItem { taxName: string; rate: string; includedInPrice: boolean }
interface TaxTemplate { id: string; name: string; isActive: boolean; items?: TemplateItem[] }
interface SaleHit { id: string; invoiceNo: string; customerId: string | null; customerName: string | null; isReturn: boolean; status: string }
interface CustomerHit { id: string; name: string; taxId?: string | null }
interface Line { itemName: string; quantity: string; unitPrice: string; taxTemplateId: string }

const inputClass =
  'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500'
const emptyLine = (taxTemplateId = ''): Line => ({ itemName: '', quantity: '1', unitPrice: '', taxTemplateId })

/** Client-side preview only; the server recomputes VAT from the template. */
function previewTax(amount: number, t: TaxTemplate | undefined) {
  if (!t?.items?.length) return { net: amount, tax: 0 }
  const inclRate = t.items.filter((i) => i.includedInPrice).reduce((s, i) => s + Number(i.rate), 0)
  const net = inclRate > 0 ? amount / (1 + inclRate / 100) : amount
  const tax = t.items.reduce((s, i) => s + net * (Number(i.rate) / 100), 0)
  return { net: Math.round(net * 100) / 100, tax: Math.round(tax * 100) / 100 }
}

export default function NewDebitNotePage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [templates, setTemplates] = useState<TaxTemplate[]>([])
  const [defaultTemplateId, setDefaultTemplateId] = useState('')
  const [invoiceSearch, setInvoiceSearch] = useState('')
  const [sale, setSale] = useState<SaleHit | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerHits, setCustomerHits] = useState<CustomerHit[]>([])
  const [customer, setCustomer] = useState<CustomerHit | null>(null)
  const [reason, setReason] = useState('')
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [status, setStatus] = useState<'issued' | 'draft'>('issued')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const [tt, st] = await Promise.all([fetch('/api/accounting/tax-templates?all=true'), fetch('/api/accounting/settings')])
        if (tt.ok) {
          const list = await tt.json()
          setTemplates((Array.isArray(list) ? list : list.data || []).filter((t: TaxTemplate) => t.isActive))
        }
        if (st.ok) {
          const s = await st.json()
          if (s?.defaultTaxTemplateId) {
            setDefaultTemplateId(s.defaultTaxTemplateId)
            setLines([emptyLine(s.defaultTaxTemplateId)])
          }
        }
      } catch {
        // templates are optional (no accounting permission → untaxed lines)
      }
    })()
  }, [])

  async function findInvoice() {
    setError(null)
    const q = invoiceSearch.trim()
    if (!q) return
    const res = await fetch(`/api/sales?search=${encodeURIComponent(q)}&pageSize=10`)
    const data = await res.json()
    const hits: SaleHit[] = (Array.isArray(data) ? data : data.data || []).filter((s: SaleHit) => !s.isReturn && s.status !== 'void')
    const hit = hits.find((s) => s.invoiceNo.toLowerCase() === q.toLowerCase()) || hits[0]
    if (!hit) {
      setError('Invoice not found')
      setSale(null)
      return
    }
    setSale(hit)
    if (hit.customerId) setCustomer({ id: hit.customerId, name: hit.customerName || 'Customer' })
  }

  useEffect(() => {
    const q = customerSearch.trim()
    if (q.length < 2) {
      setCustomerHits([])
      return
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers?search=${encodeURIComponent(q)}&pageSize=8`)
        const data = await res.json()
        setCustomerHits(Array.isArray(data) ? data : data.data || [])
      } catch {
        setCustomerHits([])
      }
    }, 250)
    return () => clearTimeout(t)
  }, [customerSearch])

  const totals = useMemo(() => {
    let net = 0
    let tax = 0
    for (const l of lines) {
      const amount = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0)
      const r = previewTax(amount, templates.find((t) => t.id === l.taxTemplateId))
      net += r.net
      tax += r.tax
    }
    return { net: Math.round(net * 100) / 100, tax: Math.round(tax * 100) / 100, total: Math.round((net + tax) * 100) / 100 }
  }, [lines, templates])

  function updateLine(i: number, patch: Partial<Line>) {
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!customer) {
      setError('Select the invoice or a customer')
      return
    }
    const items = lines
      .filter((l) => l.itemName.trim() && Number(l.quantity) > 0 && Number(l.unitPrice) >= 0)
      .map((l) => ({
        itemName: l.itemName.trim(),
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        taxTemplateId: l.taxTemplateId || null,
      }))
    if (items.length === 0) {
      setError('Add at least one line')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/debit-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleId: sale?.id || null, customerId: customer.id, reason: reason || undefined, items, status }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Failed to create debit note')
        return
      }
      router.push(`/c/${slug}/debit-notes/${data.id}`)
    } catch {
      setError('Failed to create debit note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white">New debit note</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Original invoice (recommended)</label>
          <div className="flex gap-2">
            <input className={inputClass} value={invoiceSearch} onChange={(e) => setInvoiceSearch(e.target.value)} placeholder="e.g. INV-000123" />
            <button type="button" onClick={findInvoice} className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-100 dark:hover:bg-gray-700">Find</button>
          </div>
          {sale && (
            <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
              Against {sale.invoiceNo}{sale.customerName ? ` — ${sale.customerName}` : ''}{' '}
              <button type="button" className="text-red-600 ml-1" onClick={() => setSale(null)}>remove</button>
            </p>
          )}
        </div>
        <div className="relative">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Customer *</label>
          {customer ? (
            <div className="flex items-center justify-between text-sm border border-gray-300 dark:border-gray-600 rounded px-3 py-2">
              <span>{customer.name}{customer.taxId ? ` (VAT ${customer.taxId})` : ''}</span>
              {!sale?.customerId && <button type="button" onClick={() => setCustomer(null)} aria-label="Clear customer"><X size={14} /></button>}
            </div>
          ) : (
            <>
              <input className={inputClass} value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="Search customer" />
              {customerHits.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-800 border dark:border-gray-700 rounded shadow">
                  {customerHits.map((c) => (
                    <button type="button" key={c.id} onClick={() => { setCustomer(c); setCustomerHits([]); setCustomerSearch('') }}
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700">
                      {c.name}{c.taxId ? ` — VAT ${c.taxId}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Reason</label>
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Delivery charge omitted from the invoice" />
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900">
            <tr className="text-left text-gray-600 dark:text-gray-400">
              <th className="px-3 py-2 font-medium">Description *</th>
              <th className="px-3 py-2 font-medium w-20">Qty</th>
              <th className="px-3 py-2 font-medium w-28">Unit price</th>
              <th className="px-3 py-2 font-medium w-44">VAT</th>
              <th className="px-3 py-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-gray-100 dark:border-gray-700">
                <td className="px-3 py-2"><input className={inputClass} value={l.itemName} onChange={(e) => updateLine(i, { itemName: e.target.value })} /></td>
                <td className="px-3 py-2"><input className={inputClass} type="number" min="0.001" step="any" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} /></td>
                <td className="px-3 py-2"><input className={inputClass} type="number" min="0" step="any" value={l.unitPrice} onChange={(e) => updateLine(i, { unitPrice: e.target.value })} /></td>
                <td className="px-3 py-2">
                  <select className={inputClass} value={l.taxTemplateId} onChange={(e) => updateLine(i, { taxTemplateId: e.target.value })}>
                    <option value="">No VAT</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  {lines.length > 1 && (
                    <button type="button" onClick={() => setLines(lines.filter((_, idx) => idx !== i))} className="p-1 text-red-500" aria-label="Remove line"><X size={14} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-3 py-2 border-t dark:border-gray-700">
          <button type="button" onClick={() => setLines([...lines, emptyLine(defaultTemplateId)])} className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
            <Plus size={14} /> Add line
          </button>
          <div className="text-sm text-right space-y-0.5">
            <div>Value excl. VAT: <span className="font-mono">{totals.net.toFixed(2)}</span></div>
            <div>VAT: <span className="font-mono">{totals.tax.toFixed(2)}</span></div>
            <div className="font-semibold">Total: <span className="font-mono">{totals.total.toFixed(2)}</span></div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <select className="border border-gray-300 dark:border-gray-600 rounded px-2 py-2 text-sm bg-white dark:bg-gray-700" value={status} onChange={(e) => setStatus(e.target.value as 'issued' | 'draft')}>
          <option value="issued">Issue now (post to ledger)</option>
          <option value="draft">Save as draft</option>
        </select>
        <button type="submit" disabled={saving} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          {saving && <Loader2 size={14} className="animate-spin" />}
          {status === 'issued' ? 'Issue debit note' : 'Save draft'}
        </button>
      </div>
    </form>
  )
}
