'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { Loader2, Printer } from 'lucide-react'
import { formatCurrency } from '@/lib/utils/currency'
import { usePrinter, closingToZReportInput, type ZReportSource } from '@/hooks/usePrinter'
import { fetchTenantInfo } from '@/lib/print/receipt-loader'
import type { ZReportDetails } from '@/lib/print/escpos/encoder'
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
  }
  paymentMethodBreakdown?: PaymentMethodBreakdown
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
          
          // Initialize actual amounts from all available payment method sources
          const initialActualAmounts: Record<string, number> = {}
          const breakdown = data.paymentMethodBreakdown
          if (breakdown) {
            // Collect all methods from openingBalances, salesByMethod, expectedAmounts
            const allMethods = new Set([
              ...Object.keys(breakdown.openingBalances || {}),
              ...Object.keys(breakdown.salesByMethod || {}),
              ...Object.keys(breakdown.expectedAmounts || {}),
            ])
            allMethods.forEach(method => {
              initialActualAmounts[method] = 0
            })
          }
          // Fallback to POS profile payment methods if no breakdown methods found
          if (Object.keys(initialActualAmounts).length === 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const paymentMethods = data.posProfile?.paymentMethods?.map((pm: any) => pm.paymentMethod) || ['cash']
            paymentMethods.forEach((method: string) => {
              initialActualAmounts[method] = 0
            })
          }
          setActualAmounts(initialActualAmounts)
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
        }),
      })

      const data = await res.json()

      if (res.ok) {
        toast.success('Shift closed successfully')
        if (carryForwardFloat && actualAmounts['cash'] != null) {
          try {
            localStorage.setItem('sky_last_cash_float', String(actualAmounts['cash']))
            if (shiftDetails?.posProfile?.id) {
              localStorage.setItem(`sky_last_cash_float_${shiftDetails.posProfile.id}`, String(actualAmounts['cash']))
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

          {/* Shift Handover Option */}
          {actualAmounts['cash'] != null && actualAmounts['cash'] > 0 && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center justify-between text-sm">
              <label className="flex items-center gap-2.5 cursor-pointer text-blue-900 dark:text-blue-200 font-medium select-none">
                <input
                  type="checkbox"
                  checked={carryForwardFloat}
                  onChange={(e) => setCarryForwardFloat(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                />
                Carry forward cash in drawer as Opening Float for next shift ({formatCurrency(actualAmounts['cash'])})
              </label>
            </div>
          )}

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
      <div className="flex justify-end gap-2 pt-2 border-t dark:border-gray-700">
        <button
          type="button"
          onClick={onPrint}
          disabled={printing}
          className="px-4 py-2 border rounded hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 dark:text-gray-300 flex items-center gap-2 disabled:opacity-50"
        >
          {printing ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}
          Print Z Report
        </button>
        <button type="button" onClick={onDone} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          Done
        </button>
      </div>
    </div>
  )
}
