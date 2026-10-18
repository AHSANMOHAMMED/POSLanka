'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { Loader2 } from 'lucide-react'
import { formatCurrency } from '@/lib/utils/currency'
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
  }
  paymentMethodBreakdown?: PaymentMethodBreakdown
}

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
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

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
    setActualAmounts(prev => ({
      ...prev,
      [paymentMethod]: Math.max(0, amount)
    }))
  }

  function handleClose() {
    setActualAmounts({})
    setNotes('')
    setError('')
    setShiftDetails(null)
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!shiftDetails?.id) {
      setError('No shift to close')
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
          notes: notes || null,
        }),
      })

      const data = await res.json()

      if (res.ok) {
        toast.success('Shift closed successfully')
        onShiftClosed()
        handleClose()
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
  const hasActualAmounts = Object.values(actualAmounts).some(amount => amount > 0)

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
