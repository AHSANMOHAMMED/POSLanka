'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { useCurrency } from '@/hooks'
import { btnPrimary, btnSecondary, card, input, label, readJson } from '@/components/recurring-invoices/ui'

interface Option { id: string; name: string }
interface Invoice { id: string; invoiceNo: string; createdAt: string; total: number; paid: number; balance: number; dueDate: string | null }

const r2 = (n: number) => Math.round(n * 100) / 100

// Record payment: one customer, the amount received, allocated over their unpaid invoices
// (oldest first by default); the excess can be kept as customer credit.
export default function RecordPaymentPage() {
  const slug = useParams().slug as string
  const router = useRouter()
  const sp = useSearchParams()
  const { fCurrency } = useCurrency()
  const [customers, setCustomers] = useState<Option[]>([])
  const [customerId, setCustomerId] = useState(sp.get('customerId') || '')
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [creditBalance, setCreditBalance] = useState(0)
  const [amount, setAmount] = useState(0)
  const [method, setMethod] = useState<'cash' | 'card' | 'bank_transfer' | 'cheque'>('cash')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [alloc, setAlloc] = useState<Record<string, number>>({})
  const [credit, setCredit] = useState<Record<string, number>>({})
  const [excessToCredit, setExcessToCredit] = useState(true)
  const [cheque, setCheque] = useState({ chequeNo: '', bankName: '', chequeDate: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/customers?all=true').then((r) => (r.ok ? r.json() : [])).then((d) => setCustomers(Array.isArray(d) ? d : d.data || [])).catch(() => undefined)
  }, [])
  useEffect(() => {
    setInvoices([]); setAlloc({}); setCredit({}); setCreditBalance(0)
    if (!customerId) return
    fetch(`/api/payments-received/unpaid?customerId=${customerId}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return
      setInvoices(d.invoices || [])
      setCreditBalance(d.customer?.creditBalance || 0)
    }).catch(() => undefined)
  }, [customerId])

  const outstanding = r2(invoices.reduce((s, i) => s + i.balance, 0))
  const allocated = r2(Object.values(alloc).reduce((s, v) => s + (v || 0), 0))
  const creditUsed = r2(Object.values(credit).reduce((s, v) => s + (v || 0), 0))
  const excess = r2(amount - allocated)

  /** spread the amount over the invoices, oldest first */
  function autoAllocate(total: number) {
    let left = total
    const next: Record<string, number> = {}
    for (const i of invoices) {
      const room = r2(i.balance - (credit[i.id] || 0))
      const take = r2(Math.max(0, Math.min(room, left)))
      if (take > 0) next[i.id] = take
      left = r2(left - take)
    }
    setAlloc(next)
  }
  const overInvoice = useMemo(() => invoices.find((i) => (alloc[i.id] || 0) + (credit[i.id] || 0) > i.balance + 0.004), [invoices, alloc, credit])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!customerId) return setError('Choose the customer')
    if (overInvoice) return setError(`More than the balance of ${overInvoice.invoiceNo}`)
    if (excess < -0.004) return setError('Allocated more than the amount received')
    if (excess > 0.004 && !excessToCredit) return setError('Allocate the full amount, or keep the excess as customer credit')
    if (creditUsed > creditBalance + 0.004) return setError('More store credit than the customer has')
    setSaving(true)
    try {
      const allocations = invoices.filter((i) => (alloc[i.id] || 0) > 0 || (credit[i.id] || 0) > 0)
        .map((i) => ({ saleId: i.id, amount: alloc[i.id] || 0, creditAmount: credit[i.id] || 0 }))
      const res = await fetch('/api/payments-received', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerId, amountReceived: amount, method, reference: reference || undefined, notes: notes || undefined, allocations, excessToCredit,
          ...(method === 'cheque' && amount > 0 ? { cheque } : {}),
        }),
      })
      const data = await readJson(res)
      if (!res.ok) { setError(String(data.error || 'Could not record the payment')); return }
      router.push(`/c/${slug}/payments-received/${data.id}${res.status === 207 ? '?partial=1' : ''}`)
    } finally { setSaving(false) }
  }

  return (
    <form onSubmit={save} className="space-y-4 max-w-5xl">
      <Link href={`/c/${slug}/payments-received`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"><ChevronLeft size={14} /> Payments received</Link>
      <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Record payment</h1>
      {error && <div role="alert" className="px-3 py-2 text-sm rounded bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-200">{error}</div>}
      <div className={`${card} p-4 grid gap-4 md:grid-cols-4`}>
        <div className="md:col-span-2">
          <label className={label} htmlFor="pr-customer">Customer *</label>
          <select id="pr-customer" className={input} value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            <option value="">Select customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="pr-amount">Amount received</label>
          <input id="pr-amount" type="number" min={0} step="0.01" className={input} value={amount || ''} onChange={(e) => { const v = Number(e.target.value) || 0; setAmount(v); autoAllocate(v) }} />
        </div>
        <div>
          <label className={label} htmlFor="pr-method">Payment mode</label>
          <select id="pr-method" className={input} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option>
          </select>
        </div>
        <div className="md:col-span-2">
          <label className={label} htmlFor="pr-ref">Reference #</label>
          <input id="pr-ref" className={input} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={255} />
        </div>
        <div className="md:col-span-2">
          <label className={label} htmlFor="pr-notes">Notes</label>
          <input id="pr-notes" className={input} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </div>
        {method === 'cheque' && amount > 0 && (
          <>
            <div><label className={label} htmlFor="pr-chq">Cheque no.</label><input id="pr-chq" className={input} value={cheque.chequeNo} onChange={(e) => setCheque({ ...cheque, chequeNo: e.target.value })} required /></div>
            <div><label className={label} htmlFor="pr-bank">Bank</label><input id="pr-bank" className={input} value={cheque.bankName} onChange={(e) => setCheque({ ...cheque, bankName: e.target.value })} required /></div>
            <div><label className={label} htmlFor="pr-chqdate">Cheque date</label><input id="pr-chqdate" type="date" className={input} value={cheque.chequeDate} onChange={(e) => setCheque({ ...cheque, chequeDate: e.target.value })} required /></div>
          </>
        )}
      </div>

      {customerId && (
        <div className={`${card} overflow-x-auto`}>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
            <h2 className="text-sm font-semibold dark:text-white">Unpaid invoices · outstanding {fCurrency(outstanding)}</h2>
            <div className="flex items-center gap-2 text-sm">
              {creditBalance > 0 && <span className="text-gray-500">Store credit available: {fCurrency(creditBalance)}</span>}
              <button type="button" className={btnSecondary} onClick={() => { setAmount(r2(outstanding - creditUsed)); autoAllocate(r2(outstanding - creditUsed)) }}>Pay all</button>
            </div>
          </div>
          <table className="w-full text-sm mt-2">
            <caption className="sr-only">Allocate the payment</caption>
            <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300"><tr>
              <th scope="col" className="px-4 py-2 text-left font-medium">Date</th><th scope="col" className="px-4 py-2 text-left font-medium">Invoice</th>
              <th scope="col" className="px-4 py-2 text-left font-medium">Due</th><th scope="col" className="px-4 py-2 text-right font-medium">Total</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Balance</th>
              {creditBalance > 0 && <th scope="col" className="px-4 py-2 text-right font-medium">Use credit</th>}
              <th scope="col" className="px-4 py-2 text-right font-medium">Payment</th>
            </tr></thead>
            <tbody>
              {invoices.length === 0 ? <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">This customer has no unpaid invoices — the amount is kept as an advance (customer credit).</td></tr> : invoices.map((i) => (
                <tr key={i.id} className="border-t dark:border-gray-700 dark:text-gray-200">
                  <td className="px-4 py-2 whitespace-nowrap">{String(i.createdAt).slice(0, 10)}</td>
                  <td className="px-4 py-2">{i.invoiceNo}</td>
                  <td className="px-4 py-2">{i.dueDate || '—'}</td>
                  <td className="px-4 py-2 text-right">{fCurrency(i.total)}</td>
                  <td className="px-4 py-2 text-right">{fCurrency(i.balance)}</td>
                  {creditBalance > 0 && <td className="px-4 py-2 text-right"><input aria-label={`Store credit for ${i.invoiceNo}`} type="number" min={0} step="0.01" className={`${input} w-28 text-right`} value={credit[i.id] || ''} onChange={(e) => setCredit({ ...credit, [i.id]: Number(e.target.value) || 0 })} /></td>}
                  <td className="px-4 py-2 text-right"><input aria-label={`Payment for ${i.invoiceNo}`} type="number" min={0} step="0.01" className={`${input} w-32 text-right`} value={alloc[i.id] || ''} onChange={(e) => setAlloc({ ...alloc, [i.id]: Number(e.target.value) || 0 })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="flex flex-wrap justify-end gap-6 px-4 py-3 text-sm border-t dark:border-gray-700">
            <div><dt className="inline text-gray-500">Amount received </dt><dd className="inline font-medium dark:text-white">{fCurrency(amount)}</dd></div>
            <div><dt className="inline text-gray-500">Allocated </dt><dd className="inline font-medium dark:text-white">{fCurrency(allocated)}</dd></div>
            {creditUsed > 0 && <div><dt className="inline text-gray-500">Credit applied </dt><dd className="inline font-medium dark:text-white">{fCurrency(creditUsed)}</dd></div>}
            <div><dt className="inline text-gray-500">Amount in excess </dt><dd className={`inline font-medium ${excess < 0 ? 'text-red-600' : 'dark:text-white'}`}>{fCurrency(excess)}</dd></div>
          </dl>
          {excess > 0.004 && (
            <label className="flex items-center gap-2 px-4 pb-3 text-sm dark:text-gray-200">
              <input type="checkbox" checked={excessToCredit} onChange={(e) => setExcessToCredit(e.target.checked)} /> Keep the excess {fCurrency(excess)} as customer credit
            </label>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" className={btnPrimary} disabled={saving || !customerId}>{saving ? 'Saving…' : 'Save payment'}</button>
        <button type="button" className={btnSecondary} onClick={() => router.back()}>Cancel</button>
      </div>
    </form>
  )
}
