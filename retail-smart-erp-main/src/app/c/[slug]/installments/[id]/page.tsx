'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Banknote, FileText, Printer, Truck, AlertTriangle, CheckCircle2, Ban, RotateCcw } from 'lucide-react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { useCurrency } from '@/hooks/useCurrency'
import { useDateFormat } from '@/hooks'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { toast } from '@/components/ui/toast'
import { Modal } from '@/components/ui/modal'
import { PageLoading } from '@/components/ui/loading-spinner'
import { FormInput, FormLabel, FormSelect, FormTextarea } from '@/components/ui/form-elements'
import { PLAN_STATUS_COLORS } from '@/lib/installments/constants'
import { companyHeader, esc, money, openPrint, type PrintCompany } from '@/lib/installments/print'
import { ChequeFields, chequeMissing, chequePayload, emptyCheque, type ChequeDraft } from '../cheque-fields'

interface Plan {
  id: string; planNo: string; saleId: string | null; invoiceNo: string | null; status: string; statusReason: string | null
  customerName: string; customerNic: string | null; customerPhone: string | null; customerAddress: string | null
  guarantorName: string | null; guarantorNic: string | null; guarantorPhone: string | null; guarantorAddress: string | null
  items: Array<{ itemName: string; quantity: number; unitPrice: number; serialNumbers?: string[] }>
  cashPrice: string; downPayment: string; financedAmount: string; interestType: 'flat' | 'fixed'; interestRate: string; interestAmount: string
  totalPayable: string; installmentAmount: string; installmentCount: number; termMonths: number; frequency: 'monthly' | 'weekly'
  startDate: string; lateFeeType: 'none' | 'fixed' | 'percent'; lateFeeValue: string; graceDays: number
  paidAmount: string; lateFeesPaid: string; rebateAmount: string; balance: string; terms: string | null; notes: string | null
  warehouseName: string | null; createdByName: string | null; createdAt: string; warehouseId: string | null
  writtenOffAmount: string; recoveredValue: string; openingAgreement: boolean
  repossession: { returnedToStock: boolean; condition: string | null; recoveredValue: number; writtenOff: number; principalOutstanding: number } | null
}
interface ScheduleRow { id: string; installmentNo: number; dueDate: string; amount: string; principal: string; interest: string; paidAmount: string; lateFee: string; lateFeePaid: string; status: string; paidAt: string | null }
interface Receipt { id: string; receiptNo: string; kind: string; paymentDate: string; amount: string; principalAmount: string; interestAmount: string; lateFeeAmount: string; rebateAmount: string; paymentMethod: string; reference: string | null; allocations: Array<{ installmentNo: number; amount: number; lateFee: number }>; receivedByName: string | null
  voidedAt?: string | null; voidReason?: string | null; chequeId?: string | null; chequeNo?: string | null; chequeBank?: string | null; chequeDate?: string | null; chequeStatus?: string | null }
interface Detail {
  plan: Plan; schedule: ScheduleRow[]; receipts: Receipt[]; today: string; company: PrintCompany | null
  figures: { outstanding: number; principalOutstanding?: number; lateFeesDue: number; overdueAmount: number; overdueCount: number; daysOverdue: number; nextDue: { installmentNo: number; dueDate: string; amount: number } | null; principalPaid: number; interestPaid: number }
  settlement: { rebatePercent: number; principalOutstanding: number; interestDue: number; futureInterest: number; rebate: number; lateFees: number; total: number } | null
}

const METHOD_LABELS: Record<string, string> = { cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', cheque: 'Cheque' }

export default function InstallmentPlanPage() {
  const { id } = useParams<{ id: string }>()
  const { tenantSlug } = useCompany()
  const { fCurrency, currencySymbol } = useCurrency()
  const { fDate } = useDateFormat()
  const [data, setData] = useState<Detail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [rebate, setRebate] = useState(50)
  const [payOpen, setPayOpen] = useState(false)
  const [settleOpen, setSettleOpen] = useState(false)
  const [statusAction, setStatusAction] = useState<null | 'cancel' | 'default' | 'repossess' | 'reactivate'>(null)
  const [receiptAction, setReceiptAction] = useState<null | { receipt: Receipt; action: 'void' | 'bounce' }>(null)

  const load = useCallback(async (rebatePercent?: number) => {
    const res = await fetch(`/api/installments/${id}?rebate=${rebatePercent ?? rebate}`)
    if (res.status === 404) { setNotFound(true); return }
    if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error || 'Failed to load plan'); return }
    setData(await res.json())
  }, [id, rebate])
  useRealtimeData(load, { entityType: 'installment-plan' })

  if (notFound) return <div className="p-8 text-center text-gray-500">Plan not found. <Link className="text-blue-600" href={`/c/${tenantSlug}/installments`}>Back to plans</Link></div>
  if (!data) return <PageLoading text="Loading plan..." />
  const { plan, schedule, receipts, figures, settlement, company, today } = data
  const live = plan.status === 'active' || plan.status === 'defaulted'

  function printAgreement() {
    const goods = plan.items.map((i) => `<tr><td>${esc(i.itemName)}</td><td class="n">${esc(i.quantity)}</td><td class="n">${money(i.unitPrice, currencySymbol)}</td><td>${esc((i.serialNumbers || []).join(', '))}</td></tr>`).join('')
    const rows = schedule.map((r) => `<tr><td>${r.installmentNo}</td><td>${esc(fDate(r.dueDate))}</td><td class="n">${money(r.amount, currencySymbol)}</td><td class="n">${money(r.principal, currencySymbol)}</td><td class="n">${money(r.interest, currencySymbol)}</td></tr>`).join('')
    const lateFee = plan.lateFeeType === 'none' ? 'None' : plan.lateFeeType === 'percent' ? `${Number(plan.lateFeeValue)}% of the installment after ${plan.graceDays} days` : `${money(plan.lateFeeValue, currencySymbol)} after ${plan.graceDays} days`
    const ok = openPrint(`Hire purchase agreement ${plan.planNo}`, `
      ${companyHeader(company, 'Hire Purchase Agreement', plan.planNo, fDate(plan.createdAt))}
      <div class="grid">
        <div class="box"><h3>Hirer</h3><div><b>${esc(plan.customerName)}</b></div><div>NIC: ${esc(plan.customerNic)}</div><div>Tel: ${esc(plan.customerPhone)}</div><div>${esc(plan.customerAddress)}</div></div>
        <div class="box"><h3>Guarantor</h3><div><b>${esc(plan.guarantorName || '—')}</b></div><div>NIC: ${esc(plan.guarantorNic)}</div><div>Tel: ${esc(plan.guarantorPhone)}</div><div>${esc(plan.guarantorAddress)}</div></div>
      </div>
      ${plan.invoiceNo ? `<div>Invoice: <b>${esc(plan.invoiceNo)}</b>${plan.warehouseName ? ` · Branch: ${esc(plan.warehouseName)}` : ''}</div>` : ''}
      <h3>Goods</h3><table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Price</th><th>Serial / IMEI</th></tr></thead><tbody>${goods}</tbody></table>
      <h3>Terms of payment</h3>
      <table><tbody>
        <tr><td>Cash price</td><td class="n">${money(plan.cashPrice, currencySymbol)}</td><td>Down payment</td><td class="n">${money(plan.downPayment, currencySymbol)}</td></tr>
        <tr><td>Amount financed</td><td class="n">${money(plan.financedAmount, currencySymbol)}</td><td>Interest ${plan.interestType === 'flat' ? `(flat ${Number(plan.interestRate)}% p.a.)` : '(fixed)'}</td><td class="n">${money(plan.interestAmount, currencySymbol)}</td></tr>
        <tr><td>Total hire purchase price</td><td class="n"><b>${money(Number(plan.totalPayable) + Number(plan.downPayment), currencySymbol)}</b></td><td>Installments</td><td class="n"><b>${plan.installmentCount} × ${money(plan.installmentAmount, currencySymbol)}</b> ${plan.frequency}</td></tr>
        <tr><td>Late fee</td><td colspan="3">${esc(lateFee)}</td></tr>
      </tbody></table>
      <h3>Schedule</h3><table><thead><tr><th>#</th><th>Due date</th><th class="n">Amount</th><th class="n">Principal</th><th class="n">Interest</th></tr></thead><tbody>${rows}</tbody></table>
      ${plan.terms ? `<h3>Conditions</h3><div style="white-space:pre-wrap">${esc(plan.terms)}</div>` : ''}
      <div class="sig"><div>Hirer</div><div>Guarantor</div><div>For ${esc(company?.name || 'the seller')}</div></div>
    `)
    if (!ok) toast.error('Allow pop-ups to print')
  }

  function printReceipt(r: Receipt, balanceAfter?: string | number) {
    const alloc = r.allocations.map((a) => `<tr><td>#${a.installmentNo}</td><td class="n">${money(a.amount, currencySymbol)}</td><td class="n">${a.lateFee ? money(a.lateFee, currencySymbol) : ''}</td></tr>`).join('')
    const ok = openPrint(`Receipt ${r.receiptNo}`, `
      ${companyHeader(company, r.kind === 'settlement' ? 'Settlement Receipt' : r.kind === 'down_payment' ? 'Down Payment Receipt' : 'Installment Receipt', r.receiptNo, fDate(r.paymentDate))}
      <div>Plan: <b>${esc(plan.planNo)}</b>${plan.invoiceNo ? ` · Invoice ${esc(plan.invoiceNo)}` : ''}</div>
      <div>Received from: <b>${esc(plan.customerName)}</b>${plan.customerNic ? ` (${esc(plan.customerNic)})` : ''}</div>
      <table><tbody>
        <tr><td>Amount received</td><td class="n"><b>${money(r.amount, currencySymbol)}</b></td></tr>
        <tr><td>Method</td><td class="n">${esc(METHOD_LABELS[r.paymentMethod] || r.paymentMethod)}${r.reference ? ` · ${esc(r.reference)}` : ''}</td></tr>
        ${Number(r.lateFeeAmount) ? `<tr><td>of which late fees</td><td class="n">${money(r.lateFeeAmount, currencySymbol)}</td></tr>` : ''}
        ${Number(r.rebateAmount) ? `<tr><td>Interest rebate</td><td class="n">${money(r.rebateAmount, currencySymbol)}</td></tr>` : ''}
      </tbody></table>
      ${alloc ? `<table><thead><tr><th>Installment</th><th class="n">Paid</th><th class="n">Late fee</th></tr></thead><tbody>${alloc}</tbody></table>` : ''}
      <div>Balance after this payment: <b>${money(balanceAfter ?? plan.balance, currencySymbol)}</b></div>
      <div class="muted small">Received by ${esc(r.receivedByName || '')}</div>
      <div class="sig"><div>Cashier</div></div>
    `, { receipt: true })
    if (!ok) toast.error('Allow pop-ups to print')
  }

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/c/${tenantSlug}/installments`} className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Back"><ArrowLeft size={18} /></Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{plan.planNo}</h1>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${PLAN_STATUS_COLORS[plan.status] || ''}`}>{plan.status}</span>
          </div>
          <div className="text-sm text-gray-500">{plan.customerName}{plan.invoiceNo ? ` · ${plan.invoiceNo}` : ''}{plan.warehouseName ? ` · ${plan.warehouseName}` : ''}</div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {live && <button onClick={() => setPayOpen(true)} className="px-3 py-2 rounded bg-green-600 text-white text-sm flex items-center gap-1"><Banknote size={15} />Take payment</button>}
          {live && <button onClick={() => setSettleOpen(true)} className="px-3 py-2 rounded border dark:border-gray-600 text-sm flex items-center gap-1"><CheckCircle2 size={15} />Early settlement</button>}
          <button onClick={printAgreement} className="px-3 py-2 rounded border dark:border-gray-600 text-sm flex items-center gap-1"><FileText size={15} />Agreement</button>
          <Link href={`/c/${tenantSlug}/deliveries?planId=${plan.id}`} className="px-3 py-2 rounded border dark:border-gray-600 text-sm flex items-center gap-1"><Truck size={15} />Schedule delivery</Link>
        </div>
      </div>

      {plan.status !== 'active' && plan.statusReason && (
        <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/30 p-3 text-sm">Reason: {plan.statusReason}</div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card label="Outstanding" value={fCurrency(figures.outstanding)} tone="text-orange-600" />
        <Card label="Overdue" value={fCurrency(figures.overdueAmount)} sub={figures.overdueCount ? `${figures.overdueCount} installments · ${figures.daysOverdue} days` : 'None'} tone={figures.overdueCount ? 'text-red-600' : ''} />
        <Card label="Late fees due" value={fCurrency(figures.lateFeesDue)} />
        <Card label="Next due" value={figures.nextDue ? fCurrency(figures.nextDue.amount) : '—'} sub={figures.nextDue ? `#${figures.nextDue.installmentNo} · ${fDate(figures.nextDue.dueDate)}` : ''} />
        <Card label="Paid so far" value={fCurrency(Number(plan.paidAmount) + Number(plan.lateFeesPaid))} sub={`Down payment ${fCurrency(plan.downPayment)}`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <h2 className="px-4 py-3 border-b dark:border-gray-700 font-medium">Schedule</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300"><tr>
                <th className="px-3 py-2 text-left">#</th><th className="px-3 py-2 text-left">Due</th><th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right hidden md:table-cell">Principal</th><th className="px-3 py-2 text-right hidden md:table-cell">Interest</th>
                <th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">Late fee</th><th className="px-3 py-2 text-left">Status</th>
              </tr></thead>
              <tbody>
                {schedule.map((r) => {
                  const overdue = (r.status === 'pending' || r.status === 'partial') && r.dueDate < today
                  return (
                    <tr key={r.id} className={`border-t dark:border-gray-700 ${overdue ? 'bg-red-50 dark:bg-red-900/20' : ''}`}>
                      <td className="px-3 py-2">{r.installmentNo}</td>
                      <td className="px-3 py-2">{fDate(r.dueDate)}</td>
                      <td className="px-3 py-2 text-right">{fCurrency(r.amount)}</td>
                      <td className="px-3 py-2 text-right hidden md:table-cell text-gray-500">{fCurrency(r.principal)}</td>
                      <td className="px-3 py-2 text-right hidden md:table-cell text-gray-500">{fCurrency(r.interest)}</td>
                      <td className="px-3 py-2 text-right">{Number(r.paidAmount) ? fCurrency(r.paidAmount) : '—'}</td>
                      <td className="px-3 py-2 text-right">{Number(r.lateFee) ? <span className={Number(r.lateFeePaid) >= Number(r.lateFee) ? 'text-gray-500' : 'text-red-600'}>{fCurrency(r.lateFee)}</span> : '—'}</td>
                      <td className="px-3 py-2">
                        {overdue ? <span className="inline-flex items-center gap-1 text-red-600 text-xs font-medium"><AlertTriangle size={12} />Overdue</span>
                          : <span className={`text-xs capitalize ${r.status === 'paid' ? 'text-green-600' : 'text-gray-600 dark:text-gray-300'}`}>{r.status}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="space-y-4">
          <section className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 text-sm space-y-1">
            <h2 className="font-medium mb-2">Agreement</h2>
            <Row k="Cash price" v={fCurrency(plan.cashPrice)} />
            <Row k="Down payment" v={fCurrency(plan.downPayment)} />
            <Row k="Financed" v={fCurrency(plan.financedAmount)} />
            <Row k={plan.interestType === 'flat' ? `Interest (flat ${Number(plan.interestRate)}% p.a.)` : 'Interest (fixed)'} v={fCurrency(plan.interestAmount)} />
            <Row k="Total payable" v={fCurrency(plan.totalPayable)} />
            <Row k="Installments" v={`${plan.installmentCount} × ${fCurrency(plan.installmentAmount)} ${plan.frequency}`} />
            <Row k="Late fee" v={plan.lateFeeType === 'none' ? 'None' : plan.lateFeeType === 'percent' ? `${Number(plan.lateFeeValue)}% after ${plan.graceDays} days` : `${fCurrency(plan.lateFeeValue)} after ${plan.graceDays} days`} />
            {Number(plan.rebateAmount) > 0 && <Row k="Interest rebate given" v={fCurrency(plan.rebateAmount)} />}
            {plan.repossession && <Row k="Goods recovered (stock value)" v={plan.repossession.returnedToStock ? fCurrency(plan.repossession.recoveredValue) : 'Not returned'} />}
            {Number(plan.writtenOffAmount) > 0 && <Row k="Written off (bad debt)" v={fCurrency(plan.writtenOffAmount)} />}
            {plan.openingAgreement && <Row k="Booked as" v="Opening agreement" />}
          </section>
          <section className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 text-sm space-y-1">
            <h2 className="font-medium mb-2">Hirer & guarantor</h2>
            <div className="font-medium">{plan.customerName}</div>
            <div className="text-gray-500">{[plan.customerNic, plan.customerPhone].filter(Boolean).join(' · ')}</div>
            {plan.customerAddress && <div className="text-gray-500 whitespace-pre-line">{plan.customerAddress}</div>}
            <div className="pt-2 font-medium">{plan.guarantorName || 'No guarantor'}</div>
            <div className="text-gray-500">{[plan.guarantorNic, plan.guarantorPhone].filter(Boolean).join(' · ')}</div>
          </section>
          <section className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 text-sm">
            <h2 className="font-medium mb-2">Goods</h2>
            {plan.items.map((i, n) => (
              <div key={n} className="py-1 border-t first:border-t-0 dark:border-gray-700">
                <div>{i.quantity} × {i.itemName}</div>
                {(i.serialNumbers || []).length > 0 && <div className="text-xs text-gray-500">S/N: {i.serialNumbers!.join(', ')}</div>}
              </div>
            ))}
          </section>
          {live && (
            <section className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 text-sm space-x-2">
              {plan.status === 'active' && <button onClick={() => setStatusAction('default')} className="text-red-600 hover:underline">Mark defaulted</button>}
              {plan.status === 'defaulted' && <button onClick={() => setStatusAction('reactivate')} className="text-blue-600 hover:underline">Reactivate</button>}
              <button onClick={() => setStatusAction('repossess')} className="text-orange-600 hover:underline">Repossessed</button>
              <button onClick={() => setStatusAction('cancel')} className="text-gray-600 hover:underline">Cancel plan</button>
            </section>
          )}
        </div>
      </div>

      <section className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
        <h2 className="px-4 py-3 border-b dark:border-gray-700 font-medium">Receipts</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300"><tr>
              <th className="px-3 py-2 text-left">Receipt</th><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-left">Method</th><th className="px-3 py-2 text-left hidden md:table-cell">By</th><th />
            </tr></thead>
            <tbody>
              {receipts.length === 0 ? <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500">No payments yet</td></tr> : receipts.map((r) => (
                <tr key={r.id} className={`border-t dark:border-gray-700 ${r.voidedAt ? 'opacity-60' : ''}`}>
                  <td className="px-3 py-2 font-medium">
                    <span className={r.voidedAt ? 'line-through' : ''}>{r.receiptNo}</span>
                    {r.voidedAt && <div className="text-xs text-red-600 font-normal">Reversed{r.voidReason ? `: ${r.voidReason}` : ''}</div>}
                  </td>
                  <td className="px-3 py-2">{fDate(r.paymentDate)}</td>
                  <td className="px-3 py-2 capitalize">{r.kind.replace('_', ' ')}</td>
                  <td className="px-3 py-2 text-right">{fCurrency(r.amount)}{Number(r.lateFeeAmount) > 0 && <div className="text-xs text-gray-500">late fee {fCurrency(r.lateFeeAmount)}</div>}</td>
                  <td className="px-3 py-2">{METHOD_LABELS[r.paymentMethod] || r.paymentMethod}{r.reference ? <span className="text-xs text-gray-500"> · {r.reference}</span> : null}
                    {r.chequeId && <div className="text-xs text-gray-500">Cheque {r.chequeNo} · {r.chequeDate ? fDate(r.chequeDate) : ''} · <span className="capitalize">{r.chequeStatus === 'pending' ? 'in hand' : r.chequeStatus}</span></div>}
                  </td>
                  <td className="px-3 py-2 hidden md:table-cell text-gray-500">{r.receivedByName}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => printReceipt(r)} className="p-1 text-gray-500 hover:text-blue-600" aria-label="Print receipt"><Printer size={15} /></button>
                    {!r.voidedAt && r.chequeId && (r.chequeStatus === 'pending' || r.chequeStatus === 'deposited') && (
                      <button onClick={() => setReceiptAction({ receipt: r, action: 'bounce' })} className="p-1 text-gray-500 hover:text-red-600" title="Mark cheque bounced" aria-label="Mark cheque bounced"><RotateCcw size={15} /></button>
                    )}
                    {!r.voidedAt && plan.status !== 'repossessed' && (
                      <button onClick={() => setReceiptAction({ receipt: r, action: 'void' })} className="p-1 text-gray-500 hover:text-red-600" title="Void receipt" aria-label="Void receipt"><Ban size={15} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {payOpen && <PaymentModal planId={plan.id} today={today} suggested={figures.overdueAmount + figures.lateFeesDue || figures.nextDue?.amount || 0}
        lateFeesDue={figures.lateFeesDue} onClose={() => setPayOpen(false)} onPaid={async (receipt, balance) => { setPayOpen(false); await load(); if (receipt) printReceipt(receipt, balance) }} />}
      {settleOpen && settlement && <SettlementModal planId={plan.id} quote={settlement} rebate={rebate}
        onRebate={async (v) => { setRebate(v); await load(v) }} onClose={() => setSettleOpen(false)}
        onPaid={async (receipt, balance) => { setSettleOpen(false); await load(); if (receipt) printReceipt(receipt, balance) }} />}
      {statusAction && <StatusModal planId={plan.id} action={statusAction} warehouseId={plan.warehouseId} principalOutstanding={figures.principalOutstanding ?? 0}
        onClose={() => setStatusAction(null)} onDone={async () => { setStatusAction(null); await load() }} />}
      {receiptAction && <ReceiptActionModal planId={plan.id} today={today} receipt={receiptAction.receipt} action={receiptAction.action}
        onClose={() => setReceiptAction(null)} onDone={async () => { setReceiptAction(null); await load() }} />}
    </div>
  )
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-semibold ${tone || 'text-gray-900 dark:text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-2"><span className="text-gray-500">{k}</span><span className="text-right">{v}</span></div>
}

function PaymentModal({ planId, today, suggested, lateFeesDue, onClose, onPaid }: {
  planId: string; today: string; suggested: number; lateFeesDue: number; onClose: () => void; onPaid: (receipt: Receipt | null, balance?: string) => void
}) {
  const [amount, setAmount] = useState(suggested ? String(Math.round(suggested * 100) / 100) : '')
  const [method, setMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [date, setDate] = useState(today)
  const [waive, setWaive] = useState(false)
  const [print, setPrint] = useState(true)
  const [saving, setSaving] = useState(false)
  const [cheque, setCheque] = useState<ChequeDraft>(() => emptyCheque(today))
  async function save() {
    if (!(Number(amount) > 0)) { toast.error('Enter the amount'); return }
    if (method === 'cheque') { const m = chequeMissing(cheque); if (m) { toast.error(m); return } }
    setSaving(true)
    try {
      const res = await fetch(`/api/installments/${planId}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(amount), paymentMethod: method, reference, paymentDate: date, waiveLateFees: waive,
          cheque: method === 'cheque' ? chequePayload(cheque) : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Payment failed'); return }
      toast.success(`Receipt ${data.receipt.receiptNo} saved`)
      onPaid(print ? { ...data.receipt, receivedByName: null, allocations: data.receipt.allocations || [] } : null, data.balance)
    } finally { setSaving(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title="Take installment payment" size="sm" footer={
      <div className="flex justify-end gap-2"><button onClick={onClose} className="px-3 py-2 border rounded text-sm dark:border-gray-600">Cancel</button>
        <button onClick={save} disabled={saving} className="px-3 py-2 rounded bg-green-600 text-white text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Save payment'}</button></div>
    }>
      <div className="space-y-3">
        <div><FormLabel required>Amount</FormLabel><FormInput type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></div>
        <p className="text-xs text-gray-500">Paid to the oldest installment first; part payments are allowed.</p>
        <div className="grid grid-cols-2 gap-2">
          <div><FormLabel>Method</FormLabel><FormSelect value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(METHOD_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </FormSelect></div>
          <div><FormLabel>Date</FormLabel><FormInput type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        {method === 'cheque' ? <ChequeFields value={cheque} onChange={setCheque} />
          : <div><FormLabel>Reference (card slip, bank ref)</FormLabel><FormInput value={reference} onChange={(e) => setReference(e.target.value)} /></div>}
        {lateFeesDue > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} />Waive late fees</label>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} />Print receipt</label>
      </div>
    </Modal>
  )
}

function SettlementModal({ planId, quote, rebate, onRebate, onClose, onPaid }: {
  planId: string; quote: NonNullable<Detail['settlement']>; rebate: number; onRebate: (v: number) => void; onClose: () => void; onPaid: (r: Receipt | null, balance?: string) => void
}) {
  const { fCurrency } = useCurrency()
  const [method, setMethod] = useState('cash')
  const [reference, setReference] = useState('')
  const [pct, setPct] = useState(String(rebate))
  const [saving, setSaving] = useState(false)
  const [cheque, setCheque] = useState<ChequeDraft>(() => emptyCheque(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })))
  async function save() {
    if (method === 'cheque') { const m = chequeMissing(cheque); if (m) { toast.error(m); return } }
    setSaving(true)
    try {
      const res = await fetch(`/api/installments/${planId}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: quote.total, paymentMethod: method, reference, settle: true, rebatePercent: rebate,
          cheque: method === 'cheque' ? chequePayload(cheque) : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Settlement failed'); return }
      toast.success(`Plan settled · receipt ${data.receipt.receiptNo}`)
      onPaid({ ...data.receipt, receivedByName: null, allocations: data.receipt.allocations || [] }, data.balance)
    } finally { setSaving(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title="Early settlement" size="sm" footer={
      <div className="flex justify-end gap-2"><button onClick={onClose} className="px-3 py-2 border rounded text-sm dark:border-gray-600">Close</button>
        <button onClick={save} disabled={saving || Number(pct) !== rebate} className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50">{saving ? 'Saving…' : `Settle for ${fCurrency(quote.total)}`}</button></div>
    }>
      <div className="space-y-2 text-sm">
        <div className="flex items-end gap-2">
          <div className="flex-1"><FormLabel>Waive % of interest not yet due</FormLabel><FormInput type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} /></div>
          <button onClick={() => onRebate(Math.min(100, Math.max(0, Number(pct) || 0)))} className="px-3 py-2 border rounded dark:border-gray-600">Recalculate</button>
        </div>
        <Row k="Principal outstanding" v={fCurrency(quote.principalOutstanding)} />
        <Row k="Interest already due" v={fCurrency(quote.interestDue)} />
        <Row k="Interest not yet due" v={fCurrency(quote.futureInterest)} />
        <Row k={`Rebate (${quote.rebatePercent}%)`} v={`− ${fCurrency(quote.rebate)}`} />
        <Row k="Late fees" v={fCurrency(quote.lateFees)} />
        <div className="flex justify-between border-t pt-2 font-semibold dark:border-gray-700"><span>Settlement amount</span><span>{fCurrency(quote.total)}</span></div>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <div><FormLabel>Method</FormLabel><FormSelect value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(METHOD_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </FormSelect></div>
          <div><FormLabel>Reference</FormLabel><FormInput value={reference} onChange={(e) => setReference(e.target.value)} /></div>
        </div>
        {method === 'cheque' && <ChequeFields value={cheque} onChange={setCheque} />}
        <p className="text-xs text-gray-500">The rebate is interest not charged: it is never posted as income.</p>
      </div>
    </Modal>
  )
}

const STATUS_TITLES = { cancel: 'Cancel plan', default: 'Mark plan defaulted', repossess: 'Goods repossessed', reactivate: 'Reactivate plan' } as const

function StatusModal({ planId, action, warehouseId, principalOutstanding, onClose, onDone }: {
  planId: string; action: keyof typeof STATUS_TITLES; warehouseId: string | null; principalOutstanding: number; onClose: () => void; onDone: () => void
}) {
  const { fCurrency } = useCurrency()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [returnToStock, setReturnToStock] = useState(true)
  const [returnWarehouseId, setReturnWarehouseId] = useState(warehouseId || '')
  const [condition, setCondition] = useState<'good' | 'used' | 'damaged'>('used')
  const [recoveredValue, setRecoveredValue] = useState('')
  const [writeOff, setWriteOff] = useState(true)
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([])
  useEffect(() => {
    if (action !== 'repossess') return
    fetch('/api/warehouses?all=true').then((r) => (r.ok ? r.json() : [])).then((d) => setBranches(Array.isArray(d) ? d : d.data || [])).catch(() => undefined)
  }, [action])
  async function save() {
    setSaving(true)
    try {
      const body: Record<string, unknown> = { action, reason }
      if (action === 'repossess') {
        Object.assign(body, {
          returnToStock, returnWarehouseId: returnToStock ? returnWarehouseId || null : null, condition,
          recoveredValue: returnToStock && recoveredValue !== '' ? Number(recoveredValue) : null, writeOff,
        })
      }
      const res = await fetch(`/api/installments/${planId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not update the plan'); return }
      toast.success(STATUS_TITLES[action])
      onDone()
    } finally { setSaving(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title={STATUS_TITLES[action]} size="sm" footer={
      <div className="flex justify-end gap-2"><button onClick={onClose} className="px-3 py-2 border rounded text-sm dark:border-gray-600">Back</button>
        <button onClick={save} disabled={saving} className="px-3 py-2 rounded bg-red-600 text-white text-sm disabled:opacity-50">Confirm</button></div>
    }>
      <div className="space-y-3 text-sm">
        <div><FormLabel required={action !== 'reactivate'}>Reason</FormLabel><FormTextarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        {action === 'repossess' && (
          <>
            <div className="text-gray-600 dark:text-gray-300">Principal outstanding: <b>{fCurrency(principalOutstanding)}</b> (interest not yet received is not owed)</div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={returnToStock} onChange={(e) => setReturnToStock(e.target.checked)} />Goods back into stock</label>
            {returnToStock && (
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2"><FormLabel>Warehouse</FormLabel><FormSelect value={returnWarehouseId} onChange={(e) => setReturnWarehouseId(e.target.value)}>
                  <option value="">Plan branch</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </FormSelect></div>
                <div><FormLabel>Condition</FormLabel><FormSelect value={condition} onChange={(e) => setCondition(e.target.value as 'good' | 'used' | 'damaged')}>
                  <option value="good">Good (sellable)</option><option value="used">Used (returned)</option><option value="damaged">Damaged (defective)</option>
                </FormSelect></div>
                <div><FormLabel>Stock value</FormLabel><FormInput type="number" min={0} placeholder="Cost" value={recoveredValue} onChange={(e) => setRecoveredValue(e.target.value)} /></div>
              </div>
            )}
            <label className="flex items-center gap-2"><input type="checkbox" checked={writeOff} onChange={(e) => setWriteOff(e.target.checked)} />Write the rest of the balance off (bad debt)</label>
            <p className="text-xs text-gray-500">Posts Dr Inventory (goods back) and Dr Bad Debts (write-off), Cr the plan&apos;s receivable. Serial numbers go back to stock.</p>
          </>
        )}
        {action === 'cancel' && <p className="text-xs text-gray-500">A plan from a sale leaves the sale as a credit sale. A hand-registered plan can only be cancelled before any installment is paid; its receivable is reversed.</p>}
      </div>
    </Modal>
  )
}

function ReceiptActionModal({ planId, today, receipt, action, onClose, onDone }: {
  planId: string; today: string; receipt: Receipt; action: 'void' | 'bounce'; onClose: () => void; onDone: () => void
}) {
  const { fCurrency } = useCurrency()
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(today)
  const [saving, setSaving] = useState(false)
  async function save() {
    if (reason.trim().length < 3) { toast.error('Give a reason'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/installments/${planId}/payments/${receipt.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason, date }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not update the receipt'); return }
      toast.success(action === 'bounce' ? 'Cheque bounced; the installments are unpaid again' : `Receipt ${receipt.receiptNo} voided`)
      onDone()
    } finally { setSaving(false) }
  }
  return (
    <Modal isOpen onClose={onClose} title={action === 'bounce' ? 'Mark cheque bounced' : 'Void receipt'} size="sm" footer={
      <div className="flex justify-end gap-2"><button onClick={onClose} className="px-3 py-2 border rounded text-sm dark:border-gray-600">Back</button>
        <button onClick={save} disabled={saving} className="px-3 py-2 rounded bg-red-600 text-white text-sm disabled:opacity-50">Confirm</button></div>
    }>
      <div className="space-y-3 text-sm">
        <div>{receipt.receiptNo} · {fCurrency(receipt.amount)}{receipt.chequeNo ? ` · cheque ${receipt.chequeNo}` : ''}</div>
        <div><FormLabel required>Reason</FormLabel><FormTextarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <div><FormLabel>Date</FormLabel><FormInput type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <p className="text-xs text-gray-500">The installments this receipt paid become unpaid again and its journal entry is reversed.</p>
      </div>
    </Modal>
  )
}
