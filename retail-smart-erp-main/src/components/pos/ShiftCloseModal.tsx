'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { Loader2, Printer, FileText, MessageCircle, Plus, Trash2, ArrowRight } from 'lucide-react'
import { formatCurrency } from '@/lib/utils/currency'
import { usePrinter, closingToZReportInput, type ZReportSource } from '@/hooks/usePrinter'
import { fetchTenantInfo } from '@/lib/print/receipt-loader'
import type { ZReportDetails } from '@/lib/print/escpos/encoder'
import { buildWhatsAppShareUrl } from '@/lib/whatsapp'
import { 
  PaymentMethodReconciliationTable, 
  type PaymentMethodBreakdown 
} from '@/components/pos/PaymentMethodReconciliationTable'

interface PaymentBalance {
  paymentMethod: string
  openingAmount: string
}

interface Shift {
  id: string
  entryNumber: string
  openingTime: string
  status: string
  posProfile?: {
    id: string
    name: string
    paymentMethods?: {
      paymentMethod: string
    }[]
  } | null
  balances?: PaymentBalance[]
  calculatedTotals?: {
    totalSales: number
    totalReturns: number
    netSales: number
    totalTransactions: number
    cashPaidIn?: number
    cashPaidOut?: number
    outsideCollections?: number
  }
  /** 0187: advances / invoice / layaway payments taken outside the POS sale screen */
  outsideCollections?: { total: number; count: number; bySource: Record<string, number>; byMethod: Record<string, number> }
  paymentMethodBreakdown?: PaymentMethodBreakdown
}

/** Labels of the 0187 outside-POS collection sources (mirror of src/lib/pos/shift-collections.ts) */
const OUTSIDE_SOURCE_LABELS: Record<string, string> = {
  print_job_advance: 'Print job advances',
  print_job_refund: 'Print job advance refunds',
  print_job_invoice: 'Print job invoices',
  service_job_advance: 'Service job advances',
  service_job_refund: 'Service job advance refunds',
  service_job_invoice: 'Service job invoices',
  work_order_invoice: 'Work order invoices',
  layaway_payment: 'Layaway payments',
  invoice_payment: 'Invoice payments',
}

/** H1: structured variance reasons (mirror of SHIFT_VARIANCE_REASONS in validation/schemas/pos) */
const VARIANCE_REASONS: Array<{ value: string; label: string }> = [
  { value: 'counting_error', label: 'Counting error' },
  { value: 'change_error', label: 'Wrong change given' },
  { value: 'unrecorded_sale', label: 'Sale not recorded' },
  { value: 'unrecorded_expense', label: 'Expense paid without a paid-out' },
  { value: 'card_terminal_mismatch', label: 'Card terminal / settlement mismatch' },
  { value: 'theft_suspected', label: 'Suspected theft' },
  { value: 'other', label: 'Other' },
]

/** Tenders that never sit in the drawer (reconciled at the expected amount by the server) */
const NON_DRAWER = new Set(['credit', 'gift_card'])

interface ShiftCloseModalProps {
  isOpen: boolean
  shift: Shift | null
  onClose: () => void
  onShiftClosed: () => void
}

export function ShiftCloseModal({ isOpen, shift, onClose, onShiftClosed }: ShiftCloseModalProps) {
  const [loading, setLoading] = useState(false)
  const [loadingDetails, setLoadingDetails] = useState(true)
  const [shiftDetails, setShiftDetails] = useState<Shift | null>(null)
  const [actualAmounts, setActualAmounts] = useState<Record<string, number>>({})
  /** Methods the cashier actually counted (a counted 0 is valid: empty drawer, takings banked) */
  const [countedMethods, setCountedMethods] = useState<Set<string>>(new Set())
  const [carryForwardFloat, setCarryForwardFloat] = useState(true)
  const [cashOutHandover, setCashOutHandover] = useState<number>(0)
  const [externalBills, setExternalBills] = useState<Array<{ id: string; billNo: string; description: string; amount: number; paymentMethod: string }>>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [varianceReason, setVarianceReason] = useState('')
  const [varianceNote, setVarianceNote] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [closeResult, setCloseResult] = useState<any>(null)
  const [printing, setPrinting] = useState(false)
  const { printZReport } = usePrinter()

  // Fetch shift details when opened
  useEffect(() => {
    if (isOpen && shift?.id) {
      setLoadingDetails(true)
      fetch(`/api/pos-opening-entries/${shift.id}`)
        .then(res => {
          if (!res.ok) throw new Error(`Failed to load shift (${res.status})`)
          return res.json()
        })
        .then(data => {
          setShiftDetails(data)
          
          // Initialize actual amounts: non-cash tenders default to expected, cash defaults to expected to prevent alarming "-5000" false variance
          const initialActualAmounts: Record<string, number> = {}
          const breakdown = data.paymentMethodBreakdown
          if (breakdown) {
            const allMethods = new Set([
              ...Object.keys(breakdown.openingBalances || {}),
              ...Object.keys(breakdown.salesByMethod || {}),
              ...Object.keys(breakdown.expectedAmounts || {}),
            ])
            allMethods.forEach(method => {
              // Pre-fill with the expected amount so cashier starts at 0 variance
              initialActualAmounts[method] = breakdown.expectedAmounts?.[method] || 0
            })
          }
          if (Object.keys(initialActualAmounts).length === 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const paymentMethods = data.posProfile?.paymentMethods?.map((pm: any) => pm.paymentMethod) || ['cash']
            paymentMethods.forEach((method: string) => {
              initialActualAmounts[method] = 0
            })
          }
          setActualAmounts(initialActualAmounts)
          // Mark as initialized so cashier can review or adjust counts
          setCountedMethods(new Set(Object.keys(initialActualAmounts)))
        })
        .catch(err => {
          console.error('Failed to load shift details:', err)
          toast.error('Failed to load shift details')
        })
        .finally(() => setLoadingDetails(false))
    }
  }, [isOpen, shift?.id])

  const handleActualAmountChange = (paymentMethod: string, amount: number) => {
    setCountedMethods(prev => new Set(prev).add(paymentMethod))
    setActualAmounts(prev => ({
      ...prev,
      [paymentMethod]: Math.max(0, amount)
    }))
  }

  // Variance per tender as the server will compute it (actual − expected)
  const variances = Object.entries(shiftDetails?.paymentMethodBreakdown?.expectedAmounts || {})
    .filter(([method]) => !NON_DRAWER.has(method))
    .map(([method, expected]) => ({ method, variance: Math.round(((actualAmounts[method] || 0) - expected) * 100) / 100 }))
    .filter(v => Math.abs(v.variance) >= 0.01)
  const hasVariance = variances.length > 0

  function handleClose() {
    if (closeResult) onShiftClosed()
    setActualAmounts({})
    setCountedMethods(new Set())
    setNotes('')
    setError('')
    setVarianceReason('')
    setVarianceNote('')
    setCloseResult(null)
    setShiftDetails(null)
    onClose()
  }

  async function handlePrintZ() {
    if (!closeResult) return
    setPrinting(true)
    try {
      const tenant = await fetchTenantInfo()
      const src: ZReportSource = {
        ...closeResult,
        shift: { entryNumber: shiftDetails?.entryNumber, openingTime: shiftDetails?.openingTime, posProfile: shiftDetails?.posProfile || null },
      }
      const ok = await printZReport(closingToZReportInput(src, tenant))
      if (!ok) toast.error('Z report could not be printed')
    } catch {
      toast.error('Z report could not be printed')
    } finally {
      setPrinting(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!shiftDetails?.id) {
      setError('No shift to close')
      return
    }
    if (hasVariance && !varianceReason) {
      setError('The counted amounts differ from the expected amounts. Select a variance reason.')
      return
    }
    if (hasVariance && varianceReason === 'other' && !varianceNote.trim()) {
      setError('Describe the variance when the reason is "Other".')
      return
    }

    setLoading(true)
    setError('')

    const countedCash = actualAmounts['cash'] || 0
    const safeCashOut = Math.min(countedCash, Math.max(0, cashOutHandover))
    const retainedFloat = Math.max(0, Math.round((countedCash - safeCashOut) * 100) / 100)

    try {
      // Convert actualAmounts record to array format expected by API
      const actualAmountsArray = Object.entries(actualAmounts).map(([paymentMethod, amount]) => ({
        paymentMethod,
        amount
      }))

      const res = await fetch(`/api/pos-opening-entries/${shiftDetails.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualAmounts: actualAmountsArray,
          notes: notes || undefined,
          varianceReason: hasVariance ? varianceReason : undefined,
          varianceNote: hasVariance && varianceNote.trim() ? varianceNote.trim() : undefined,
          cashOutAmount: safeCashOut,
          retainedFloatAmount: retainedFloat,
          externalBills: externalBills.map(b => ({
            billNo: b.billNo,
            description: b.description,
            amount: b.amount,
            paymentMethod: b.paymentMethod,
          })),
        }),
      })

      const data = await res.json()

      if (res.ok) {
        toast.success('Shift closed successfully')
        if (carryForwardFloat && retainedFloat != null) {
          try {
            localStorage.setItem('sky_last_cash_float', String(retainedFloat))
            if (shiftDetails?.posProfile?.id) {
              localStorage.setItem(`sky_last_cash_float_${shiftDetails.posProfile.id}`, String(retainedFloat))
            }
          } catch {}
        }
        // Stay open on the result so the Z report can be printed; onShiftClosed runs on Done
        setCloseResult(data)
      } else {
        setError(data.error || 'Failed to close shift')
        // Handle missing payment methods
        if (data.missingMethods) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          toast.error(`Missing payment methods: ${data.missingMethods.map((m: any) => m.label).join(', ')}`)
        }
      }
    } catch {
      setError('Failed to close shift')
    } finally {
      setLoading(false)
    }
  }

  // Check if any actual amounts have been entered
  const hasActualAmounts = countedMethods.size > 0 || Object.values(actualAmounts).some(amount => amount > 0)

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Close Shift"
      size="xl"
    >
      {loadingDetails ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : !shiftDetails ? (
        <div className="text-center py-8">
          <p className="text-gray-500 dark:text-gray-400">Failed to load shift details</p>
        </div>
      ) : closeResult ? (
        <ShiftCloseResult result={closeResult} onPrint={handlePrintZ} printing={printing} onDone={handleClose} />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 text-red-600 rounded text-sm dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Shift Summary */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded p-4">
            <h3 className="font-medium mb-3 dark:text-white">Shift Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-gray-500 dark:text-gray-400">Shift #</p>
                <p className="font-medium dark:text-white">{shiftDetails.entryNumber}</p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Opened</p>
                <p className="font-medium dark:text-white">
                  {new Date(shiftDetails.openingTime).toLocaleTimeString()}
                </p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Total Sales</p>
                <p className="font-medium text-green-600 dark:text-green-400">
                  {formatCurrency(shiftDetails.calculatedTotals?.totalSales || 0)}
                </p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Transactions</p>
                <p className="font-medium dark:text-white">
                  {shiftDetails.calculatedTotals?.totalTransactions || 0}
                </p>
              </div>
            </div>
            {shiftDetails.calculatedTotals && shiftDetails.calculatedTotals.totalReturns > 0 && (
              <div className="mt-3 pt-3 border-t dark:border-gray-700">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">Returns</span>
                  <span className="text-red-600 dark:text-red-400">
                    -{formatCurrency(shiftDetails.calculatedTotals.totalReturns)}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-medium mt-1">
                  <span className="dark:text-gray-300">Net Sales</span>
                  <span className="dark:text-white">
                    {formatCurrency(shiftDetails.calculatedTotals.netSales)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Payment Method Reconciliation Table */}
          <div>
            <h3 className="font-medium mb-2 dark:text-white">Payment Reconciliation</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              Count the actual amounts for each payment method and enter them below
            </p>
            {shiftDetails.paymentMethodBreakdown ? (
              <PaymentMethodReconciliationTable
                breakdown={shiftDetails.paymentMethodBreakdown}
                actualAmounts={actualAmounts}
                onActualAmountChange={handleActualAmountChange}
                readOnly={false}
              />
            ) : (
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded">
                <p className="text-sm text-yellow-600 dark:text-yellow-400">
                  Payment method breakdown not available. Using simplified reconciliation.
                </p>
              </div>
            )}
          </div>

          {(shiftDetails.calculatedTotals?.cashPaidIn || shiftDetails.calculatedTotals?.cashPaidOut) ? (
            <div className="flex justify-between text-sm bg-gray-50 dark:bg-gray-800 rounded p-3">
              <span className="text-gray-500 dark:text-gray-400">Cash paid in / out (included in expected cash)</span>
              <span className="dark:text-white">
                +{formatCurrency(shiftDetails.calculatedTotals?.cashPaidIn || 0)} / −{formatCurrency(shiftDetails.calculatedTotals?.cashPaidOut || 0)}
              </span>
            </div>
          ) : null}

          {shiftDetails.outsideCollections && shiftDetails.outsideCollections.count > 0 ? (
            <div className="text-sm bg-gray-50 dark:bg-gray-800 rounded p-3 space-y-1">
              <div className="text-gray-500 dark:text-gray-400">Collected outside the POS (included in expected amounts)</div>
              {Object.entries(shiftDetails.outsideCollections.bySource).map(([source, amount]) => (
                <div key={source} className="flex justify-between">
                  <span className="dark:text-gray-300">{OUTSIDE_SOURCE_LABELS[source] || source}</span>
                  <span className="dark:text-white">{formatCurrency(amount)}</span>
                </div>
              ))}
            </div>
          ) : null}

          {hasVariance && (
            <div className="p-3 rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 space-y-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Variance: {variances.map(v => `${v.method} ${v.variance > 0 ? '+' : ''}${formatCurrency(v.variance)}`).join(', ')}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <select
                  value={varianceReason}
                  onChange={(e) => setVarianceReason(e.target.value)}
                  className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                >
                  <option value="">Select a reason…</option>
                  {VARIANCE_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <input
                  value={varianceNote}
                  onChange={(e) => setVarianceNote(e.target.value)}
                  maxLength={1000}
                  placeholder={varianceReason === 'other' ? 'Describe the variance (required)' : 'Note (optional)'}
                  className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                />
              </div>
            </div>
          )}

          {/* Cash Drawer Handover (Cash Out vs Retained Float) */}
          <div className="bg-blue-50/60 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-blue-900 dark:text-blue-200">
              💵 Cash Drawer Handover & Next-Day Float
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div className="bg-white dark:bg-gray-800 p-2.5 rounded border border-gray-200 dark:border-gray-700">
                <span className="text-xs text-gray-500 dark:text-gray-400 block">Total Counted Cash in Drawer</span>
                <span className="text-base font-bold font-mono text-gray-900 dark:text-white">
                  {formatCurrency(actualAmounts['cash'] || 0)}
                </span>
              </div>
              <div>
                <label className="text-xs text-gray-600 dark:text-gray-300 font-medium block mb-1">
                  Cash Out (Safe Drop / Handed to Owner)
                </label>
                <input
                  type="number"
                  min="0"
                  max={actualAmounts['cash'] || 0}
                  step="any"
                  value={cashOutHandover || ''}
                  onChange={(e) => setCashOutHandover(Math.max(0, parseFloat(e.target.value) || 0))}
                  placeholder="0.00"
                  className="w-full px-2.5 py-1.5 text-sm font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                />
              </div>
              <div className="bg-green-50 dark:bg-green-900/30 p-2.5 rounded border border-green-200 dark:border-green-800">
                <span className="text-xs text-green-700 dark:text-green-300 font-medium block">
                  🏦 Retained Float for Next Shift
                </span>
                <span className="text-base font-bold font-mono text-green-800 dark:text-green-200">
                  {formatCurrency(Math.max(0, (actualAmounts['cash'] || 0) - cashOutHandover))}
                </span>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-blue-900 dark:text-blue-300 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={carryForwardFloat}
                onChange={(e) => setCarryForwardFloat(e.target.checked)}
                className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
              />
              Auto-fill next morning's shift opening float with this retained cash ({formatCurrency(Math.max(0, (actualAmounts['cash'] || 0) - cashOutHandover))})
            </label>
          </div>

          {/* External / Off-Register Bills Section */}
          <div className="bg-gray-50 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
                External / Manual Bills ({externalBills.length})
              </span>
              <button
                type="button"
                onClick={() => setExternalBills(prev => [
                  ...prev,
                  { id: `ext-${Date.now()}`, billNo: '', description: '', amount: 0, paymentMethod: 'cash' }
                ])}
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                <Plus size={13} /> Add Manual Bill
              </button>
            </div>
            {externalBills.length > 0 && (
              <div className="space-y-2 pt-1">
                {externalBills.map((bill, bIdx) => (
                  <div key={bill.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Bill # (e.g. EXT-101)"
                      value={bill.billNo}
                      onChange={(e) => {
                        const val = e.target.value
                        setExternalBills(prev => prev.map((b, i) => i === bIdx ? { ...b, billNo: val } : b))
                      }}
                      className="w-28 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                    <input
                      type="text"
                      placeholder="Description or Item Name"
                      value={bill.description}
                      onChange={(e) => {
                        const val = e.target.value
                        setExternalBills(prev => prev.map((b, i) => i === bIdx ? { ...b, description: val } : b))
                      }}
                      className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                    <input
                      type="number"
                      placeholder="Amount"
                      min="0"
                      step="any"
                      value={bill.amount || ''}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0
                        setExternalBills(prev => prev.map((b, i) => i === bIdx ? { ...b, amount: val } : b))
                      }}
                      className="w-24 px-2 py-1 text-xs text-right font-mono border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                    <select
                      value={bill.paymentMethod}
                      onChange={(e) => {
                        const val = e.target.value
                        setExternalBills(prev => prev.map((b, i) => i === bIdx ? { ...b, paymentMethod: val } : b))
                      }}
                      className="w-20 px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="bank_transfer">Bank</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setExternalBills(prev => prev.filter((_, i) => i !== bIdx))}
                      className="p-1 text-gray-400 hover:text-red-500 rounded"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              rows={2}
              placeholder="Any notes about this shift closing..."
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t dark:border-gray-700">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border rounded hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 dark:text-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !hasActualAmounts}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              Close Shift
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

/** After closing: totals, Z-report detail and the print button. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ShiftCloseResult({ result, onPrint, printing, onDone }: { result: any; onPrint: () => void; printing: boolean; onDone: () => void }) {
  const z = result?.zReport as ZReportDetails | undefined
  const rows: Array<[string, string]> = [
    ['Net sales', formatCurrency(result?.summary?.netSales || 0)],
    ['Transactions', String(result?.summary?.totalTransactions || 0)],
    ['Total variance', formatCurrency(result?.summary?.totalVariance || 0)],
  ]
  if (z) {
    rows.push(
      ['Tax collected', formatCurrency(z.tax?.total || 0)],
      ['Discounts', `${formatCurrency(z.discounts?.total || 0)} (${z.discounts?.count || 0})`],
      ['Voids', `${z.voids?.count || 0} · ${formatCurrency(z.voids?.total || 0)}`],
      ['Returns', `${z.returns?.count || 0} · ${formatCurrency(z.returns?.total || 0)}`],
      ['Cash paid in / out', `+${formatCurrency(z.cashMovements?.paidIn || 0)} / −${formatCurrency(z.cashMovements?.paidOut || 0)}`],
      ...Object.entries(z.outsideCollections?.bySource || {}).map(([source, amount]): [string, string] => [OUTSIDE_SOURCE_LABELS[source] || source, formatCurrency(amount)]),
      ['Ledger tie-out', !z.ledger?.posted ? 'Not posted' : z.ledger.tiesOut ? 'OK' : `Difference ${formatCurrency(z.ledger.difference)}`],
    )
  }
  return (
    <div className="space-y-4">
      <div className="bg-gray-50 dark:bg-gray-800 rounded p-4 text-sm divide-y dark:divide-gray-700">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between py-1.5">
            <span className="text-gray-500 dark:text-gray-400">{k}</span>
            <span className="font-medium dark:text-white">{v}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t dark:border-gray-700">
        <div className="flex items-center gap-2">
          {result?.closingEntry?.id && (
            <>
              <a
                href={`/api/pos-closing-entries/${result.closingEntry.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 rounded flex items-center gap-1.5 transition-colors font-medium border border-blue-200 dark:border-blue-800"
              >
                <FileText size={15} /> A4 PDF Summary
              </a>
              <button
                type="button"
                onClick={() => {
                  const shiftNo = result?.closingEntry?.entryNumber || 'Shift'
                  const total = formatCurrency(result?.summary?.netSales || 0)
                  const handover = formatCurrency(result?.cashOutAmount || 0)
                  const retained = formatCurrency(result?.retainedFloatAmount || 0)
                  const origin = window.location.origin
                  const pdfLink = `${origin}/api/pos-closing-entries/${result.closingEntry.id}/pdf`
                  const text = [
                    `📋 *Daily Shift & Sales Summary*`,
                    `Shift: *${shiftNo}*`,
                    `Net Sales: *${total}*`,
                    `💵 Cash Handover (To Owner): *${handover}*`,
                    `🏦 Retained Float: *${retained}*`,
                    `📄 Full A4 PDF Summary: ${pdfLink}`,
                  ].join('\n')
                  const waUrl = buildWhatsAppShareUrl({ text })
                  window.open(waUrl, '_blank')
                }}
                className="px-3 py-2 text-sm bg-green-50 hover:bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 dark:hover:bg-green-900/50 rounded flex items-center gap-1.5 transition-colors font-medium border border-green-200 dark:border-green-800"
              >
                <MessageCircle size={15} /> Share to Owner (WhatsApp)
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPrint}
            disabled={printing}
            className="px-4 py-2 text-sm border rounded hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 dark:text-gray-300 flex items-center gap-2 disabled:opacity-50"
          >
            {printing ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
            Print Z Report
          </button>
          <button type="button" onClick={onDone} className="px-5 py-2 text-sm font-semibold bg-blue-600 text-white rounded hover:bg-blue-700">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
