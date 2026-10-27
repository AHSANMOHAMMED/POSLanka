'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Search, Trash2 } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useCurrency } from '@/hooks/useCurrency'
import { useDateFormat } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { FormInput, FormLabel, FormSelect, FormTextarea } from '@/components/ui/form-elements'
import { BranchSelect } from '@/components/ui/branch-select'
import { addMonths, calculatePlan, round2 } from '@/lib/installments/schedule'
import { ChequeFields, chequeMissing, chequePayload, emptyCheque, type ChequeDraft } from '../cheque-fields'

interface Line { itemId?: string | null; saleItemId?: string | null; itemName: string; quantity: number; unitPrice: number; serials: string }

interface LookupSale {
  id: string
  invoiceNo: string
  saleDate: string
  warehouseName: string | null
  customerId: string | null
  customerName: string | null
  customerPhone: string | null
  customerAddress: string | null
  total: number
  paidAmount: number
  balance: number
  lines: Array<{ saleItemId: string; itemId: string | null; itemName: string; quantity: number; unitPrice: number; total: number; serialNumbers: Array<{ serialNumber: string }> }>
}

const DEFAULT_TERMS = `1. Ownership of the goods remains with the seller until every installment and charge under this agreement is paid in full.
2. The hirer shall pay each installment on or before its due date. A late fee is charged on installments paid after the grace period.
3. The hirer shall not sell, pledge, lend or remove the goods from the address above without the seller's written consent.
4. If two or more installments are in arrears, the seller may terminate the agreement and repossess the goods; amounts paid are not refundable.
5. The guarantor is jointly and severally liable with the hirer for all amounts due under this agreement.
6. The hirer may settle the agreement early; part of the interest not yet due is waived as the seller decides.`

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })

export default function NewInstallmentPlanPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { tenantSlug } = useCompany()
  const { fCurrency } = useCurrency()
  const { fDate } = useDateFormat()

  const [invoiceNo, setInvoiceNo] = useState(searchParams.get('invoiceNo') || '')
  const [sale, setSale] = useState<LookupSale | null>(null)
  const [looking, setLooking] = useState(false)
  const [warehouseId, setWarehouseId] = useState('')

  const [customerName, setCustomerName] = useState('')
  const [customerNic, setCustomerNic] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [guarantorName, setGuarantorName] = useState('')
  const [guarantorNic, setGuarantorNic] = useState('')
  const [guarantorPhone, setGuarantorPhone] = useState('')
  const [guarantorAddress, setGuarantorAddress] = useState('')

  const [lines, setLines] = useState<Line[]>([{ itemName: '', quantity: 1, unitPrice: 0, serials: '' }])
  const [cashPrice, setCashPrice] = useState('')
  const [downPayment, setDownPayment] = useState('0')
  const [interestType, setInterestType] = useState<'flat' | 'fixed'>('flat')
  const [interestRate, setInterestRate] = useState('24')
  const [interestAmount, setInterestAmount] = useState('0')
  const [termMonths, setTermMonths] = useState('12')
  const [frequency, setFrequency] = useState<'monthly' | 'weekly'>('monthly')
  const [startDate, setStartDate] = useState(addMonths(today(), 1))
  const [lateFeeType, setLateFeeType] = useState<'none' | 'fixed' | 'percent'>('percent')
  const [lateFeeValue, setLateFeeValue] = useState('2')
  const [graceDays, setGraceDays] = useState('7')
  const [recordDownPayment, setRecordDownPayment] = useState(true)
  const [downPaymentMethod, setDownPaymentMethod] = useState('cash')
  const [downPaymentCheque, setDownPaymentCheque] = useState<ChequeDraft>(() => emptyCheque(today()))
  const [openingAgreement, setOpeningAgreement] = useState(false)
  const [agreementTerms, setAgreementTerms] = useState(DEFAULT_TERMS)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const linesTotal = round2(lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0))

  // a manual plan's cash price follows the goods unless typed
  const [cashTouched, setCashTouched] = useState(false)
  useEffect(() => {
    if (!sale && !cashTouched) setCashPrice(linesTotal ? String(linesTotal) : '')
  }, [linesTotal, sale, cashTouched])

  const preview = useMemo(() => {
    const cp = Number(cashPrice) || 0
    const dp = Number(downPayment) || 0
    const tm = Math.floor(Number(termMonths) || 0)
    if (cp <= 0 || dp >= cp || tm < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null
    return calculatePlan({
      cashPrice: cp, downPayment: dp, interestType, interestRate: Number(interestRate) || 0,
      interestAmount: Number(interestAmount) || 0, termMonths: tm, frequency, startDate,
    })
  }, [cashPrice, downPayment, interestType, interestRate, interestAmount, termMonths, frequency, startDate])

  async function lookup(no?: string) {
    const q = (no ?? invoiceNo).trim()
    if (!q) return
    setLooking(true)
    try {
      const res = await fetch(`/api/installments/sale-lookup?invoiceNo=${encodeURIComponent(q)}`)
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Sale not found'); return }
      if (data.existingPlan) {
        toast.warning(`This sale is already on plan ${data.existingPlan.planNo}`)
        router.push(`/c/${tenantSlug}/installments/${data.existingPlan.id}`)
        return
      }
      const s = data.sale as LookupSale
      if (s.balance <= 0) { toast.error('This sale is fully paid — nothing to finance'); return }
      setSale(s)
      setCustomerId(s.customerId)
      setCustomerName(s.customerName || '')
      setCustomerPhone(s.customerPhone || '')
      setCustomerAddress(s.customerAddress || '')
      setLines(s.lines.map((l) => ({
        itemId: l.itemId, saleItemId: l.saleItemId, itemName: l.itemName, quantity: l.quantity, unitPrice: l.unitPrice,
        serials: l.serialNumbers.map((x) => x.serialNumber).join(', '),
      })))
      setCashPrice(String(s.total))
      setDownPayment(String(s.paidAmount))
    } catch {
      toast.error('Lookup failed')
    } finally {
      setLooking(false)
    }
  }

  useEffect(() => {
    const no = searchParams.get('invoiceNo')
    if (no) lookup(no)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function clearSale() {
    setSale(null)
    setCustomerId(null)
    setLines([{ itemName: '', quantity: 1, unitPrice: 0, serials: '' }])
    setDownPayment('0')
    setCashTouched(false)
  }

  async function submit() {
    if (!customerName.trim()) { toast.error('Enter the customer name'); return }
    if (!customerNic.trim()) { toast.error('Enter the customer NIC'); return }
    const goods = lines.filter((l) => l.itemName.trim())
    if (goods.length === 0) { toast.error('Add the goods on this agreement'); return }
    if (!preview) { toast.error('Check the cash price, down payment, term and first due date'); return }
    const takeDown = !sale && recordDownPayment && Number(downPayment) > 0
    if (takeDown && downPaymentMethod === 'cheque' && !openingAgreement) {
      const missing = chequeMissing(downPaymentCheque)
      if (missing) { toast.error(missing); return }
    }
    setSaving(true)
    try {
      const res = await fetch('/api/installments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saleId: sale?.id || null,
          customerId,
          warehouseId: sale ? null : warehouseId || null,
          customerName, customerNic, customerPhone, customerAddress,
          guarantorName, guarantorNic, guarantorPhone, guarantorAddress,
          items: goods.map((l) => ({
            itemId: l.itemId || null, saleItemId: l.saleItemId || null, itemName: l.itemName.trim(),
            quantity: Number(l.quantity) || 1, unitPrice: Number(l.unitPrice) || 0,
            serialNumbers: l.serials.split(/[,\n]/).map((x) => x.trim()).filter(Boolean),
          })),
          terms: {
            cashPrice: Number(cashPrice), downPayment: Number(downPayment) || 0, interestType,
            interestRate: Number(interestRate) || 0, interestAmount: Number(interestAmount) || 0,
            termMonths: Math.floor(Number(termMonths)), frequency, startDate,
            lateFeeType, lateFeeValue: Number(lateFeeValue) || 0, graceDays: Math.floor(Number(graceDays) || 0),
          },
          agreementTerms, notes,
          recordDownPayment: takeDown,
          downPaymentMethod,
          downPaymentCheque: takeDown && downPaymentMethod === 'cheque' && !openingAgreement ? chequePayload(downPaymentCheque) : null,
          openingAgreement: !sale && openingAgreement,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not create the plan'); return }
      toast.success(`Plan ${data.planNo} created`)
      router.push(`/c/${tenantSlug}/installments/${data.id}`)
    } catch {
      toast.error('Could not create the plan')
    } finally {
      setSaving(false)
    }
  }

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Link href={`/c/${tenantSlug}/installments`} className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Back"><ArrowLeft size={18} /></Link>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">New hire purchase plan</h1>
      </div>

      <section className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 space-y-3">
        <h2 className="font-medium text-gray-900 dark:text-white">1. Sale</h2>
        <p className="text-sm text-gray-500">Find the credit sale made at the POS (sell on credit, take the down payment). Leave empty to register an agreement by hand.</p>
        {sale ? (
          <div className="flex flex-wrap items-center gap-3 rounded bg-blue-50 dark:bg-blue-900/30 p-3 text-sm">
            <span className="font-medium">{sale.invoiceNo}</span>
            <span>{fDate(sale.saleDate)}</span>
            {sale.warehouseName && <span>{sale.warehouseName}</span>}
            <span>Total {fCurrency(sale.total)}</span>
            <span>Paid {fCurrency(sale.paidAmount)}</span>
            <span className="font-semibold text-orange-700 dark:text-orange-300">To finance {fCurrency(sale.balance)}</span>
            <button onClick={clearSale} className="ml-auto text-red-600 hover:underline">Remove</button>
          </div>
        ) : (
          <div className="flex gap-2 max-w-md">
            <FormInput value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="Invoice number" onKeyDown={(e) => { if (e.key === 'Enter') lookup() }} />
            <button onClick={() => lookup()} disabled={looking} className="px-3 py-2 rounded bg-blue-600 text-white text-sm flex items-center gap-1 disabled:opacity-50"><Search size={14} />Find</button>
          </div>
        )}
        {!sale && <BranchSelect value={warehouseId} onChange={setWarehouseId} className="max-w-xs" />}
      </section>

      <section className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <h2 className="font-medium text-gray-900 dark:text-white">2. Customer (hirer)</h2>
          <div><FormLabel required>Name</FormLabel><FormInput value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><FormLabel required>NIC</FormLabel><FormInput value={customerNic} onChange={(e) => setCustomerNic(e.target.value)} placeholder="199012345678 / 901234567V" /></div>
            <div><FormLabel>Phone</FormLabel><FormInput value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} /></div>
          </div>
          <div><FormLabel>Address</FormLabel><FormTextarea rows={2} value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} /></div>
        </div>
        <div className="space-y-2">
          <h2 className="font-medium text-gray-900 dark:text-white">Guarantor</h2>
          <div><FormLabel>Name</FormLabel><FormInput value={guarantorName} onChange={(e) => setGuarantorName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><FormLabel>NIC</FormLabel><FormInput value={guarantorNic} onChange={(e) => setGuarantorNic(e.target.value)} /></div>
            <div><FormLabel>Phone</FormLabel><FormInput value={guarantorPhone} onChange={(e) => setGuarantorPhone(e.target.value)} /></div>
          </div>
          <div><FormLabel>Address</FormLabel><FormTextarea rows={2} value={guarantorAddress} onChange={(e) => setGuarantorAddress(e.target.value)} /></div>
        </div>
      </section>

      <section className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 space-y-2">
        <h2 className="font-medium text-gray-900 dark:text-white">3. Goods</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-gray-600 dark:text-gray-300"><tr>
              <th className="text-left py-1">Item / model</th><th className="text-right py-1 w-20">Qty</th><th className="text-right py-1 w-32">Price</th>
              <th className="text-left py-1 pl-2">Serial / IMEI numbers</th><th className="w-8" />
            </tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t dark:border-gray-700">
                  <td className="py-1 pr-2"><FormInput value={l.itemName} disabled={!!sale} onChange={(e) => setLine(i, { itemName: e.target.value })} placeholder="e.g. Samsung 43&quot; Smart TV" /></td>
                  <td className="py-1"><FormInput type="number" min={1} value={l.quantity} disabled={!!sale} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} className="text-right" /></td>
                  <td className="py-1 pl-2"><FormInput type="number" min={0} value={l.unitPrice} disabled={!!sale} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} className="text-right" /></td>
                  <td className="py-1 pl-2"><FormInput value={l.serials} onChange={(e) => setLine(i, { serials: e.target.value })} placeholder="comma separated" /></td>
                  <td className="py-1 pl-1">{!sale && lines.length > 1 && <button onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-red-500 p-1" aria-label="Remove line"><Trash2 size={14} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!sale && <button onClick={() => setLines((ls) => [...ls, { itemName: '', quantity: 1, unitPrice: 0, serials: '' }])} className="text-sm text-blue-600 flex items-center gap-1"><Plus size={14} />Add line</button>}
      </section>

      <section className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 grid lg:grid-cols-2 gap-4">
        <div className="space-y-2">
          <h2 className="font-medium text-gray-900 dark:text-white">4. Terms</h2>
          <div className="grid grid-cols-2 gap-2">
            <div><FormLabel required>Cash price</FormLabel><FormInput type="number" value={cashPrice} disabled={!!sale} onChange={(e) => { setCashTouched(true); setCashPrice(e.target.value) }} /></div>
            <div><FormLabel>Down payment</FormLabel><FormInput type="number" value={downPayment} disabled={!!sale} onChange={(e) => setDownPayment(e.target.value)} /></div>
            <div><FormLabel>Interest</FormLabel>
              <FormSelect value={interestType} onChange={(e) => setInterestType(e.target.value as 'flat' | 'fixed')}>
                <option value="flat">Flat rate (% per year)</option>
                <option value="fixed">Fixed amount</option>
              </FormSelect>
            </div>
            {interestType === 'flat'
              ? <div><FormLabel>Rate % per year</FormLabel><FormInput type="number" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} /></div>
              : <div><FormLabel>Interest amount</FormLabel><FormInput type="number" value={interestAmount} onChange={(e) => setInterestAmount(e.target.value)} /></div>}
            <div><FormLabel required>Term (months)</FormLabel><FormInput type="number" min={1} max={120} value={termMonths} onChange={(e) => setTermMonths(e.target.value)} /></div>
            <div><FormLabel>Pay</FormLabel>
              <FormSelect value={frequency} onChange={(e) => setFrequency(e.target.value as 'monthly' | 'weekly')}>
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
              </FormSelect>
            </div>
            <div><FormLabel required>First due date</FormLabel><FormInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
            <div />
            <div><FormLabel>Late fee</FormLabel>
              <FormSelect value={lateFeeType} onChange={(e) => setLateFeeType(e.target.value as 'none' | 'fixed' | 'percent')}>
                <option value="none">None</option>
                <option value="percent">% of the installment</option>
                <option value="fixed">Fixed amount</option>
              </FormSelect>
            </div>
            {lateFeeType !== 'none' && (
              <div className="grid grid-cols-2 gap-2">
                <div><FormLabel>{lateFeeType === 'percent' ? '%' : 'Amount'}</FormLabel><FormInput type="number" value={lateFeeValue} onChange={(e) => setLateFeeValue(e.target.value)} /></div>
                <div><FormLabel>Grace days</FormLabel><FormInput type="number" min={0} value={graceDays} onChange={(e) => setGraceDays(e.target.value)} /></div>
              </div>
            )}
          </div>
          {!sale && Number(downPayment) > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={recordDownPayment} onChange={(e) => setRecordDownPayment(e.target.checked)} />Take the down payment now (receipt)</label>
              {recordDownPayment && (
                <select value={downPaymentMethod} onChange={(e) => setDownPaymentMethod(e.target.value)} className="px-2 py-1 border rounded dark:bg-gray-700 dark:border-gray-600">
                  <option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option>
                </select>
              )}
              {recordDownPayment && downPaymentMethod === 'cheque' && !openingAgreement && (
                <div className="w-full"><ChequeFields value={downPaymentCheque} onChange={setDownPaymentCheque} /></div>
              )}
            </div>
          )}
          {!sale && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={openingAgreement} onChange={(e) => setOpeningAgreement(e.target.checked)} />
              <span>Existing agreement carried over (sale already in the old books)
                <span className="block text-xs text-gray-500">The balance is booked as an opening receivable, not as new sales revenue.</span></span>
            </label>
          )}
        </div>
        <div className="space-y-2">
          <h2 className="font-medium text-gray-900 dark:text-white">Schedule</h2>
          {preview ? (
            <>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded bg-gray-50 dark:bg-gray-700 p-2">Financed<div className="font-semibold">{fCurrency(preview.financedAmount)}</div></div>
                <div className="rounded bg-gray-50 dark:bg-gray-700 p-2">Interest<div className="font-semibold">{fCurrency(preview.interestAmount)}</div></div>
                <div className="rounded bg-gray-50 dark:bg-gray-700 p-2">Total payable<div className="font-semibold">{fCurrency(preview.totalPayable)}</div></div>
                <div className="rounded bg-blue-50 dark:bg-blue-900/30 p-2">{preview.installmentCount} × {frequency === 'weekly' ? 'weekly' : 'monthly'}<div className="font-semibold text-blue-700 dark:text-blue-300">{fCurrency(preview.installmentAmount)}</div></div>
              </div>
              <div className="max-h-64 overflow-y-auto border rounded dark:border-gray-700">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0"><tr><th className="p-1 text-left">#</th><th className="p-1 text-left">Due</th><th className="p-1 text-right">Amount</th><th className="p-1 text-right">Principal</th><th className="p-1 text-right">Interest</th></tr></thead>
                  <tbody>{preview.rows.map((r) => (
                    <tr key={r.installmentNo} className="border-t dark:border-gray-700"><td className="p-1">{r.installmentNo}</td><td className="p-1">{fDate(r.dueDate)}</td><td className="p-1 text-right">{r.amount.toFixed(2)}</td><td className="p-1 text-right">{r.principal.toFixed(2)}</td><td className="p-1 text-right">{r.interest.toFixed(2)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          ) : <p className="text-sm text-gray-500">Enter the cash price, down payment, term and first due date.</p>}
        </div>
      </section>

      <section className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 space-y-2">
        <h2 className="font-medium text-gray-900 dark:text-white">5. Agreement terms</h2>
        <FormTextarea rows={7} value={agreementTerms} onChange={(e) => setAgreementTerms(e.target.value)} />
        <div><FormLabel>Internal notes</FormLabel><FormTextarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </section>

      <div className="flex justify-end gap-2 pb-8">
        <Link href={`/c/${tenantSlug}/installments`} className="px-4 py-2 rounded border dark:border-gray-600 text-sm">Cancel</Link>
        <button onClick={submit} disabled={saving} className="px-4 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Create plan'}</button>
      </div>
    </div>
  )
}
