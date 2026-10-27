'use client'

/**
 * Recurring invoice profile editor (new + edit). Lines: item, quantity, unit (LineUnitSelect), price,
 * discount; tax follows the item's tax template (the preview prices the lines exactly like
 * POST /api/sales will). Upcoming dates use the generator's own schedule math.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { LineUnitSelect } from '@/components/items/LineUnitSelect'
import { useCurrency } from '@/hooks'
import { upcomingDates, type RecurringFrequency, type RecurringEndType } from '@/lib/recurring-invoices/schedule'
import { btnPrimary, btnSecondary, card, colomboToday, input, label, readJson } from './ui'

interface CatalogItem { id: string; name: string; sellingPrice: string; unit?: string | null }
interface Option { id: string; name: string }
interface Line { key: string; itemId: string; itemName: string; quantity: number; unitPrice: number; discount: number; uom: string; uomFactor: number; baseUnit: string; basePrice: number }

export interface RecurringInvoiceInitial {
  id?: string
  profileName: string; customerId: string; warehouseId: string | null
  frequency: RecurringFrequency; intervalCount: number; startDate: string
  endType: RecurringEndType; endAfterCount: number | null; endDate: string | null
  invoiceAction: 'draft' | 'final'; paymentTermsDays: number; notes: string | null; terms: string | null
  notifyChannel: 'none' | 'sms' | 'whatsapp'
  lines: Array<{ itemId: string; itemName: string; quantity: string | number; unitPrice: string | number; discount: string | number; uom: string | null; uomFactor: string | number }>
}

let seq = 0
const newKey = () => `l${++seq}`
const r2 = (n: number) => Math.round(n * 100) / 100

type Mode = 'weekly' | 'monthly' | 'every_n_months' | 'yearly'

export function RecurringInvoiceForm({ slug, initial }: { slug: string; initial?: RecurringInvoiceInitial }) {
  const router = useRouter()
  const { fCurrency } = useCurrency()
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [customers, setCustomers] = useState<Option[]>([])
  const [branches, setBranches] = useState<Option[]>([])
  const [profileName, setProfileName] = useState(initial?.profileName || '')
  const [customerId, setCustomerId] = useState(initial?.customerId || '')
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId || '')
  const initialMode: Mode = !initial ? 'monthly' : initial.frequency === 'monthly' && initial.intervalCount > 1 ? 'every_n_months' : initial.frequency
  const [mode, setMode] = useState<Mode>(initialMode)
  const [intervalCount, setIntervalCount] = useState(initial?.intervalCount || 1)
  const [startDate, setStartDate] = useState(initial?.startDate || colomboToday())
  const [endType, setEndType] = useState<RecurringEndType>(initial?.endType || 'never')
  const [endAfterCount, setEndAfterCount] = useState<number>(initial?.endAfterCount || 12)
  const [endDate, setEndDate] = useState(initial?.endDate || '')
  const [invoiceAction, setInvoiceAction] = useState<'draft' | 'final'>(initial?.invoiceAction || 'final')
  const [paymentTermsDays, setPaymentTermsDays] = useState(initial?.paymentTermsDays ?? 30)
  const [notes, setNotes] = useState(initial?.notes || '')
  const [terms, setTerms] = useState(initial?.terms || '')
  const [notifyChannel, setNotifyChannel] = useState<'none' | 'sms' | 'whatsapp'>(initial?.notifyChannel || 'none')
  const [lines, setLines] = useState<Line[]>(() => (initial?.lines || []).map((l) => ({
    key: newKey(), itemId: l.itemId, itemName: l.itemName, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice),
    discount: Number(l.discount) || 0, uom: l.uom || '', uomFactor: Number(l.uomFactor) || 1, baseUnit: 'pcs', basePrice: Number(l.unitPrice),
  })))
  const [preview, setPreview] = useState<{ subtotal: number; tax: number; total: number; promotionDiscount: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const list = (d: unknown) => (Array.isArray(d) ? d : (d as { data?: unknown[] })?.data || []) as never[]
    fetch('/api/items?all=true&activeOnly=true').then((r) => (r.ok ? r.json() : [])).then((d) => setCatalog(list(d))).catch(() => undefined)
    fetch('/api/customers?all=true').then((r) => (r.ok ? r.json() : [])).then((d) => setCustomers(list(d))).catch(() => undefined)
    fetch('/api/warehouses?all=true').then((r) => (r.ok ? r.json() : [])).then((d) => setBranches(list(d))).catch(() => undefined)
  }, [])
  const byId = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog])

  const frequency: RecurringFrequency = mode === 'every_n_months' ? 'monthly' : mode
  const interval = mode === 'every_n_months' ? Math.max(2, intervalCount) : 1
  const schedule = { frequency, intervalCount: interval, startDate, endType, endAfterCount, endDate: endDate || null }
  const upcoming = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? upcomingDates(schedule, 0, 5) : []

  const payloadLines = lines.filter((l) => l.itemId).map((l) => ({
    itemId: l.itemId, itemName: l.itemName, quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, uom: l.uom || null, uomFactor: l.uomFactor,
  }))
  const linesKey = JSON.stringify([customerId, payloadLines])
  useEffect(() => {
    if (payloadLines.length === 0) { setPreview(null); return }
    const t = setTimeout(() => {
      fetch('/api/recurring-invoices/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customerId: customerId || null, lines: payloadLines }) })
        .then((r) => (r.ok ? r.json() : null)).then((d) => setPreview(d)).catch(() => setPreview(null))
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesKey])

  const update = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const pickItem = (key: string, itemId: string) => {
    const it = byId.get(itemId)
    const price = it ? Number(it.sellingPrice) || 0 : 0
    update(key, { itemId, itemName: it?.name || '', unitPrice: price, basePrice: price, baseUnit: it?.unit || 'pcs', uom: '', uomFactor: 1 })
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!customerId) return setError('Choose the customer')
    if (payloadLines.length === 0) return setError('Add at least one line')
    setSaving(true)
    try {
      const body = {
        profileName, customerId, warehouseId: warehouseId || null, frequency, intervalCount: interval, startDate, endType,
        endAfterCount: endType === 'after' ? endAfterCount : null, endDate: endType === 'on_date' ? endDate : null,
        invoiceAction, paymentTermsDays, notes: notes || null, terms: terms || null, notifyChannel, lines: payloadLines,
      }
      const res = await fetch(initial?.id ? `/api/recurring-invoices/${initial.id}` : '/api/recurring-invoices', {
        method: initial?.id ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await readJson(res)
      if (!res.ok) { setError(String(data.error || 'Could not save')); return }
      router.push(`/c/${slug}/recurring-invoices/${initial?.id || data.id}`)
    } finally {
      setSaving(false)
    }
  }

  const lineTotal = (l: Line) => r2(l.quantity * l.unitPrice - l.discount)

  return (
    <form onSubmit={save} className="space-y-4">
      {error && <div role="alert" className="px-3 py-2 text-sm rounded bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800">{error}</div>}
      <div className={`${card} p-4 grid gap-4 md:grid-cols-3`}>
        <div className="md:col-span-1">
          <label className={label} htmlFor="ri-name">Profile name *</label>
          <input id="ri-name" className={input} value={profileName} onChange={(e) => setProfileName(e.target.value)} required maxLength={150} placeholder="e.g. Monthly maintenance – Acme" />
        </div>
        <div>
          <label className={label} htmlFor="ri-customer">Customer *</label>
          <select id="ri-customer" className={input} value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            <option value="">Select customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="ri-branch">Branch / warehouse</label>
          <select id="ri-branch" className={input} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Default branch</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      <div className={`${card} p-4 grid gap-4 md:grid-cols-4`}>
        <div>
          <label className={label} htmlFor="ri-freq">Repeat</label>
          <select id="ri-freq" className={input} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="every_n_months">Every N months</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        {mode === 'every_n_months' && (
          <div>
            <label className={label} htmlFor="ri-n">Every … months</label>
            <input id="ri-n" type="number" min={2} max={60} className={input} value={Math.max(2, intervalCount)} onChange={(e) => setIntervalCount(Number(e.target.value) || 2)} />
          </div>
        )}
        <div>
          <label className={label} htmlFor="ri-start">Starts on</label>
          <input id="ri-start" type="date" className={input} value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </div>
        <div>
          <label className={label} htmlFor="ri-end">Ends</label>
          <select id="ri-end" className={input} value={endType} onChange={(e) => setEndType(e.target.value as RecurringEndType)}>
            <option value="never">Never expires</option>
            <option value="after">After a number of invoices</option>
            <option value="on_date">On a date</option>
          </select>
        </div>
        {endType === 'after' && (
          <div>
            <label className={label} htmlFor="ri-count">Number of invoices</label>
            <input id="ri-count" type="number" min={1} max={1000} className={input} value={endAfterCount} onChange={(e) => setEndAfterCount(Number(e.target.value) || 1)} />
          </div>
        )}
        {endType === 'on_date' && (
          <div>
            <label className={label} htmlFor="ri-enddate">End date</label>
            <input id="ri-enddate" type="date" className={input} value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} required />
          </div>
        )}
        <div className="md:col-span-4 text-xs text-gray-500 dark:text-gray-400">
          Next invoices: {upcoming.length ? upcoming.join(' · ') : '—'} (Sri Lanka dates; a month-end start stays on the last day of shorter months)
        </div>
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <caption className="sr-only">Invoice lines</caption>
          <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Item</th>
              <th scope="col" className="px-3 py-2 text-right font-medium w-24">Qty</th>
              <th scope="col" className="px-3 py-2 text-left font-medium w-28">Unit</th>
              <th scope="col" className="px-3 py-2 text-right font-medium w-32">Price</th>
              <th scope="col" className="px-3 py-2 text-right font-medium w-28">Discount</th>
              <th scope="col" className="px-3 py-2 text-right font-medium w-32">Amount</th>
              <th scope="col" className="w-10"><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.key} className="border-t dark:border-gray-700">
                <td className="px-3 py-2">
                  <select aria-label="Item" className={input} value={l.itemId} onChange={(e) => pickItem(l.key, e.target.value)}>
                    <option value="">Select item…</option>
                    {catalog.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    {l.itemId && !byId.has(l.itemId) && <option value={l.itemId}>{l.itemName}</option>}
                  </select>
                </td>
                <td className="px-3 py-2"><input aria-label="Quantity" type="number" min={0.001} step="any" className={`${input} text-right`} value={l.quantity} onChange={(e) => update(l.key, { quantity: Number(e.target.value) || 0 })} /></td>
                <td className="px-3 py-2">
                  <LineUnitSelect itemId={l.itemId || null} baseUnit={byId.get(l.itemId)?.unit || l.baseUnit} value={l.uom}
                    basePrice={byId.has(l.itemId) ? Number(byId.get(l.itemId)!.sellingPrice) || l.basePrice : l.basePrice}
                    onChange={(p) => update(l.key, { uom: p.uom || '', uomFactor: p.uomFactor, unitPrice: p.unitPrice })} />
                </td>
                <td className="px-3 py-2"><input aria-label="Price" type="number" min={0} step="any" className={`${input} text-right`} value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: Number(e.target.value) || 0 })} /></td>
                <td className="px-3 py-2"><input aria-label="Discount" type="number" min={0} step="any" className={`${input} text-right`} value={l.discount} onChange={(e) => update(l.key, { discount: Number(e.target.value) || 0 })} /></td>
                <td className="px-3 py-2 text-right font-medium dark:text-white">{fCurrency(lineTotal(l))}</td>
                <td className="px-2 py-2"><button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="p-1.5 text-gray-400 hover:text-red-600" aria-label="Remove line"><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-wrap items-start justify-between gap-4 p-3 border-t dark:border-gray-700">
          <button type="button" className={btnSecondary} onClick={() => setLines((ls) => [...ls, { key: newKey(), itemId: '', itemName: '', quantity: 1, unitPrice: 0, discount: 0, uom: '', uomFactor: 1, baseUnit: 'pcs', basePrice: 0 }])}>
            <Plus size={14} /> Add line
          </button>
          <dl className="text-sm min-w-[14rem] space-y-1">
            <div className="flex justify-between gap-6"><dt className="text-gray-500">Sub total</dt><dd className="dark:text-white">{fCurrency(preview?.subtotal ?? lines.reduce((s, l) => s + lineTotal(l), 0))}</dd></div>
            {!!preview?.promotionDiscount && <div className="flex justify-between gap-6"><dt className="text-gray-500">Promotions</dt><dd className="dark:text-white">−{fCurrency(preview.promotionDiscount)}</dd></div>}
            <div className="flex justify-between gap-6"><dt className="text-gray-500">Tax (item tax templates)</dt><dd className="dark:text-white">{fCurrency(preview?.tax ?? 0)}</dd></div>
            <div className="flex justify-between gap-6 font-semibold"><dt className="dark:text-white">Total per invoice</dt><dd className="dark:text-white">{fCurrency(preview?.total ?? lines.reduce((s, l) => s + lineTotal(l), 0))}</dd></div>
          </dl>
        </div>
      </div>

      <div className={`${card} p-4 grid gap-4 md:grid-cols-3`}>
        <div>
          <label className={label} htmlFor="ri-action">When an invoice is due</label>
          <select id="ri-action" className={input} value={invoiceAction} onChange={(e) => setInvoiceAction(e.target.value as 'draft' | 'final')}>
            <option value="final">Create the invoice on the customer&apos;s account</option>
            <option value="draft">Create a draft to review and post</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="ri-terms-days">Payment terms (due in days)</label>
          <input id="ri-terms-days" type="number" min={0} max={365} className={input} value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(Number(e.target.value) || 0)} />
        </div>
        <div>
          <label className={label} htmlFor="ri-notify">Notify the customer</label>
          <select id="ri-notify" className={input} value={notifyChannel} onChange={(e) => setNotifyChannel(e.target.value as 'none' | 'sms' | 'whatsapp')}>
            <option value="none">Don&apos;t notify</option>
            <option value="sms">SMS with the bill link</option>
            <option value="whatsapp">WhatsApp with the bill link</option>
          </select>
        </div>
        <div className="md:col-span-3 grid gap-4 md:grid-cols-2">
          <div>
            <label className={label} htmlFor="ri-notes">Customer notes</label>
            <textarea id="ri-notes" rows={3} className={input} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </div>
          <div>
            <label className={label} htmlFor="ri-tc">Terms &amp; conditions</label>
            <textarea id="ri-tc" rows={3} className={input} value={terms} onChange={(e) => setTerms(e.target.value)} maxLength={5000} />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={saving}>{saving ? 'Saving…' : initial?.id ? 'Save changes' : 'Save profile'}</button>
        <button type="button" className={btnSecondary} onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  )
}
