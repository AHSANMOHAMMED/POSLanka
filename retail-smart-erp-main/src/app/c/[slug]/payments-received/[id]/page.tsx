'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { ChevronLeft, Printer } from 'lucide-react'
import { useCurrency } from '@/hooks'
import { fetchTenantInfo, type TenantReceiptInfo } from '@/lib/print/receipt-loader'
import { METHOD_LABELS, btnPrimary, readJson } from '@/components/recurring-invoices/ui'

interface Allocation { id: string; saleId: string; invoiceNo: string | null; amount: string; creditAmount: string; invoiceTotal: string | null; invoiceDate: string | null }
interface Receipt {
  id: string; receiptNo: string; receiptDate: string; method: string; reference: string | null; amountReceived: string
  amountAllocated: string; creditApplied: string; excessToCredit: string; status: string; notes: string | null; error: string | null
  customerName: string | null; customerPhone: string | null; customerAddress: string | null; receivedBy: string | null; warehouseName: string | null
  allocations: Allocation[]
}

// Printable payment receipt (window.print; the page chrome is hidden in print)
export default function PaymentReceiptPage() {
  const params = useParams()
  const slug = params.slug as string
  const id = params.id as string
  const partial = useSearchParams().get('partial') === '1'
  const { fCurrency } = useCurrency()
  const [r, setR] = useState<Receipt | null>(null)
  const [tenant, setTenant] = useState<TenantReceiptInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/payments-received/${id}`).then(async (res) => {
      const d = await readJson(res)
      if (!res.ok) setError(String(d.error || 'Not found'))
      else setR(d as unknown as Receipt)
    }).catch(() => setError('Could not load the receipt'))
    fetchTenantInfo().then(setTenant).catch(() => undefined)
  }, [id])

  if (error) return <div className="p-6 text-sm text-red-600">{error}</div>
  if (!r) return <div className="p-6 text-sm text-gray-500">Loading…</div>
  const n = (v: string | number | null | undefined) => Number(v) || 0
  return (
    <div className="space-y-3 max-w-3xl">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/c/${slug}/payments-received`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"><ChevronLeft size={14} /> Payments received</Link>
        <button className={btnPrimary} onClick={() => window.print()}><Printer size={14} /> Print receipt</button>
      </div>
      {(partial || r.status === 'partial') && (
        <div role="alert" className="px-3 py-2 text-sm rounded bg-amber-50 text-amber-800 border border-amber-200 print:hidden">
          Only part of this payment was recorded{r.error ? `: ${r.error}` : ''}. Record the rest from the invoice or again here.
        </div>
      )}
      <article className="bg-white text-gray-900 rounded border p-8 print:border-0 print:p-0">
        <header className="flex justify-between gap-4 border-b pb-4">
          <div>
            <div className="text-xl font-bold">{tenant?.name || ''}</div>
            <div className="text-xs text-gray-600 whitespace-pre-line">{[tenant?.address, tenant?.phone, tenant?.email].filter(Boolean).join('\n')}</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold tracking-wide">PAYMENT RECEIPT</div>
            <div className="text-sm">{r.receiptNo}</div>
            <div className="text-sm text-gray-600">{r.receiptDate}</div>
          </div>
        </header>
        <section className="grid grid-cols-2 gap-4 py-4 text-sm">
          <div>
            <div className="text-xs uppercase text-gray-500">Received from</div>
            <div className="font-medium">{r.customerName}</div>
            <div className="text-gray-600 whitespace-pre-line">{[r.customerAddress, r.customerPhone].filter(Boolean).join('\n')}</div>
          </div>
          <div className="text-right space-y-0.5">
            <div><span className="text-gray-500">Payment mode: </span>{METHOD_LABELS[r.method] || r.method}</div>
            {r.reference && <div><span className="text-gray-500">Reference: </span>{r.reference}</div>}
            {r.warehouseName && <div><span className="text-gray-500">Branch: </span>{r.warehouseName}</div>}
            {r.receivedBy && <div><span className="text-gray-500">Received by: </span>{r.receivedBy}</div>}
          </div>
        </section>
        <div className="rounded bg-gray-100 px-4 py-3 flex justify-between items-center">
          <span className="text-sm text-gray-600">Amount received</span>
          <span className="text-2xl font-bold">{fCurrency(n(r.amountReceived))}</span>
        </div>
        {r.allocations.length > 0 && (
          <table className="w-full text-sm mt-4">
            <caption className="text-left text-xs uppercase text-gray-500 pb-1">Payment for</caption>
            <thead><tr className="border-b text-gray-600">
              <th scope="col" className="py-1 text-left font-medium">Invoice</th><th scope="col" className="py-1 text-left font-medium">Date</th>
              <th scope="col" className="py-1 text-right font-medium">Invoice amount</th><th scope="col" className="py-1 text-right font-medium">Paid now</th>
            </tr></thead>
            <tbody>{r.allocations.map((a) => (
              <tr key={a.id} className="border-b">
                <td className="py-1">{a.invoiceNo}</td>
                <td className="py-1">{a.invoiceDate ? String(a.invoiceDate).slice(0, 10) : ''}</td>
                <td className="py-1 text-right">{fCurrency(n(a.invoiceTotal))}</td>
                <td className="py-1 text-right">{fCurrency(n(a.amount) + n(a.creditAmount))}{n(a.creditAmount) > 0 ? <span className="text-xs text-gray-500"> (incl. credit {fCurrency(n(a.creditAmount))})</span> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <dl className="mt-4 ml-auto w-72 text-sm space-y-1">
          <div className="flex justify-between"><dt className="text-gray-500">Applied to invoices</dt><dd>{fCurrency(n(r.amountAllocated))}</dd></div>
          {n(r.creditApplied) > 0 && <div className="flex justify-between"><dt className="text-gray-500">Store credit applied</dt><dd>{fCurrency(n(r.creditApplied))}</dd></div>}
          {n(r.excessToCredit) > 0 && <div className="flex justify-between"><dt className="text-gray-500">Kept as customer credit</dt><dd>{fCurrency(n(r.excessToCredit))}</dd></div>}
        </dl>
        {r.notes && <p className="mt-4 text-sm text-gray-600">{r.notes}</p>}
        <footer className="mt-12 flex justify-between text-xs text-gray-500">
          <span>Thank you for your payment.</span>
          <span className="border-t border-gray-400 pt-1 w-48 text-center">Authorised signature</span>
        </footer>
      </article>
    </div>
  )
}
