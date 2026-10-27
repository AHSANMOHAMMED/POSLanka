'use client'

import { useEffect, useState } from 'react'
import { FileText, X, Loader2, Printer, CheckCircle2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'

/** One cart line as POST /api/quotations takes it */
export interface QuotationLineInput {
  itemId: string | null
  itemName: string
  quantity: number
  unitPrice: number
  discount: number
  tax: number
  total: number
  uom?: string
  uomFactor?: number
  taxRate?: number
}

export interface QuotationTotals {
  subtotal: number
  discount: number
  tax: number
  total: number
}

function plusDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Message of an API error body ({ error: string } or the validation { error: { error, details } }) */
function apiError(data: unknown, fallback: string): string {
  const e = (data as { error?: unknown } | null)?.error
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && typeof (e as { error?: unknown }).error === 'string') return (e as { error: string }).error
  return fallback
}

/**
 * "Save as quotation" from the POS cart (Alt+Q): customer (the POS customer or a walk-in name /
 * phone), valid until, notes → POST /api/quotations. Afterwards: print it, clear or keep the cart.
 * Mount it only while open so each opening starts from the current cart and customer.
 */
export function SaveQuotationModal({ slug, lines, totals, customer, currencyCode, onClose, onClearCart }: {
  slug: string
  lines: QuotationLineInput[]
  totals: QuotationTotals
  customer: { id: string | null; name: string; phone?: string | null; email?: string | null } | null
  currencyCode: string
  onClose: () => void
  onClearCart: () => void
}) {
  const [linkCustomer, setLinkCustomer] = useState(!!customer?.id)
  const [name, setName] = useState(customer?.name || '')
  const [phone, setPhone] = useState(customer?.phone || '')
  const [email, setEmail] = useState(customer?.email || '')
  const [validUntil, setValidUntil] = useState(plusDays(14))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<{ id: string; quotationNo: string } | null>(null)

  // Esc closes; keys never reach the till behind (inputs keep working normally)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  async function save() {
    if (saving || lines.length === 0) return
    setSaving(true)
    try {
      const res = await fetch('/api/quotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: linkCustomer && customer?.id ? customer.id : null,
          customerName: name.trim() || undefined,
          customerPhone: phone.trim() || undefined,
          customerEmail: email.trim() || undefined,
          validUntil: validUntil || undefined,
          notes: notes.trim() || undefined,
          ...totals,
          items: lines,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(apiError(data, res.status === 403 ? 'You are not allowed to create quotations' : 'Could not save the quotation'))
        return
      }
      setSaved({ id: data.id, quotationNo: data.quotationNo || '' })
      toast.success(`Quotation ${data.quotationNo || ''} saved`.replace(/\s+/g, ' ').trim())
    } catch {
      toast.error('Could not save the quotation (server not reachable)')
    } finally {
      setSaving(false)
    }
  }

  function printQuote() {
    if (!saved) return
    window.open(`/c/${slug}/quotations/${saved.id}?print=1`, '_blank', 'noopener')
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Save as quotation"
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col border border-slate-200 dark:border-gray-700"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-gray-700">
          <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
            <FileText size={20} className="text-teal-700 dark:text-teal-400" /> {saved ? 'Quotation saved' : 'Save as quotation'}
          </h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 text-slate-500 dark:text-gray-400" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {saved ? (
          <div className="p-5 space-y-4">
            <p className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold">
              <CheckCircle2 size={20} /> Quotation {saved.quotationNo} is saved for {name.trim() || 'walk-in customer'}.
            </p>
            <button type="button" autoFocus onClick={printQuote} className="w-full py-3 theme-btn-primary rounded-xl font-bold flex items-center justify-center gap-2">
              <Printer size={18} /> Print quotation
            </button>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => { onClearCart(); onClose() }} className="py-2.5 rounded-xl font-bold bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-200 hover:bg-slate-200 dark:hover:bg-gray-700">
                Clear cart
              </button>
              <button type="button" onClick={onClose} className="py-2.5 rounded-xl font-bold border border-slate-300 dark:border-gray-600 text-slate-700 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-gray-800">
                Keep cart
              </button>
            </div>
          </div>
        ) : (
          <form className="overflow-y-auto p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); void save() }}>
            {customer?.id && (
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-gray-200">
                <input type="checkbox" checked={linkCustomer} onChange={(e) => setLinkCustomer(e.target.checked)} />
                Link to customer <span className="font-semibold">{customer.name}</span>
              </label>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 text-xs font-semibold text-slate-600 dark:text-gray-300">
                Customer name
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Walk-in customer" maxLength={255} autoFocus />
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-gray-300">
                Phone
                <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50} inputMode="tel" />
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-gray-300">
                Email
                <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label className="col-span-2 text-xs font-semibold text-slate-600 dark:text-gray-300">
                Valid until
                <input className={inputCls} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </label>
              <label className="col-span-2 text-xs font-semibold text-slate-600 dark:text-gray-300">
                Notes
                <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-gray-800 px-3 py-2 text-sm flex justify-between text-slate-700 dark:text-gray-200">
              <span>{lines.length} line{lines.length === 1 ? '' : 's'}</span>
              <span className="font-mono font-bold">{currencyCode} {totals.total.toFixed(2)}</span>
            </div>
            <button type="submit" disabled={saving || lines.length === 0} className="w-full py-3 theme-btn-primary rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">
              {saving ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />} Save quotation
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
