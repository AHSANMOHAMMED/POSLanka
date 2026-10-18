'use client'

import { useState, useEffect } from 'react'
import { X, Banknote, CreditCard, Building2, Trash2, Clock } from 'lucide-react'
import { formatCurrency } from '@/lib/utils/currency'
import { formatDate } from '@/lib/utils/date-format'

export type PaymentMethod = 'cash' | 'card' | 'bank_transfer'

// Payment history item
export interface PaymentHistoryItem {
  id: string
  amount: string | number
  method: PaymentMethod
  reference?: string | null
  createdAt: string
  createdByName?: string | null
  voided?: boolean
}

interface PaymentModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (payment: PaymentResult) => void
  /** Total amount to be paid */
  total: number
  /** Already paid amount (for partial payments) */
  paidAmount?: number
  /** Customer credit available (optional) */
  customerCredit?: number
  /** Title for the modal */
  title?: string
  /** Description or entity being paid */
  description?: string
  /** Show customer credit options */
  showCreditOptions?: boolean
  /** Allow overpayment for cash */
  allowOverpayment?: boolean
  /** Processing state */
  processing?: boolean
  /** Submit button text */
  submitText?: string
  /** Payment history for display */
  payments?: PaymentHistoryItem[]
  /** Callback to void a payment */
  onVoidPayment?: (paymentId: string) => void
}

export interface PaymentResult {
  method: PaymentMethod
  amount: number
  reference: string | null
  creditUsed: number
  overpaymentAction: 'return' | 'credit'
}

const paymentMethods: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'bank_transfer', label: 'Transfer', icon: Building2 },
]

export function PaymentModal({
  isOpen,
  onClose,
  onSubmit,
  total,
  paidAmount = 0,
  customerCredit = 0,
  title = 'Record Payment',
  description,
  showCreditOptions = true,
  allowOverpayment = true,
  processing = false,
  submitText = 'Record Payment',
  payments = [],
  onVoidPayment,
}: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [creditAmount, setCreditAmount] = useState('')
  const [overpaymentAction, setOverpaymentAction] = useState<'return' | 'credit'>('return')

  const remainingBalance = total - paidAmount
  const creditUsed = parseFloat(creditAmount) || 0
  const paymentAmount = parseFloat(amount) || 0
  const effectiveCredit = showCreditOptions ? Math.min(creditUsed, customerCredit, remainingBalance) : 0
  const amountAfterCredit = Math.max(0, remainingBalance - effectiveCredit)

  // For card/bank, cap at remaining amount. For cash, allow overpayment
  const effectivePayment = method === 'cash' && allowOverpayment
    ? paymentAmount
    : Math.min(paymentAmount, amountAfterCredit)

  const totalPayment = effectivePayment + effectiveCredit
  const overpayment = method === 'cash' && allowOverpayment
    ? Math.max(0, totalPayment - remainingBalance)
    : 0
  const balanceDue = Math.max(0, remainingBalance - totalPayment)

  // Reset form when modal opens (not when remainingBalance changes mid-session)
  useEffect(() => {
    if (isOpen) {
      setMethod('cash')
      setAmount((total - paidAmount).toFixed(2))
      setReference('')
      setCreditAmount('')
      setOverpaymentAction('return')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  function handleSubmit() {
    if (paymentAmount <= 0 && effectiveCredit <= 0) return

    onSubmit({
      method,
      amount: effectivePayment,
      reference: method !== 'cash' ? reference : null,
      creditUsed: effectiveCredit,
      overpaymentAction,
    })
  }

  function handleUseCredit() {
    const useAmount = Math.min(customerCredit, remainingBalance)
    setCreditAmount(useAmount.toFixed(2))
    const remaining = remainingBalance - useAmount
    setAmount(remaining > 0 ? remaining.toFixed(2) : '0')
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 className="text-lg font-semibold dark:text-white">{title}</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            <X size={20} className="text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {/* Summary */}
          <div className="bg-gray-50 dark:bg-gray-900 rounded p-3">
            {description && (
              <div className="flex justify-between text-sm dark:text-gray-300 mb-1">
                <span>Description:</span>
                <span className="font-medium">{description}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold dark:text-white">
              <span>{paidAmount > 0 ? 'Balance Due:' : 'Total:'}</span>
              <span>{formatCurrency(remainingBalance)}</span>
            </div>
            {paidAmount > 0 && (
              <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400">
                <span>Previously paid:</span>
                <span>{formatCurrency(paidAmount)}</span>
              </div>
            )}
          </div>

          {/* Payment History */}
          {payments.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <Clock size={14} />
                Payment History
              </div>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {payments.map((payment) => {
                  const amt = typeof payment.amount === 'string' ? parseFloat(payment.amount) : payment.amount
                  return (
                    <div
                      key={payment.id}
                      className={`flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-900 ${
                        payment.voided ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">
                          {payment.method === 'cash' && <Banknote size={16} />}
                          {payment.method === 'card' && <CreditCard size={16} />}
                          {payment.method === 'bank_transfer' && <Building2 size={16} />}
                        </span>
                        <div>
                          <div className={`text-sm font-medium dark:text-white ${payment.voided ? 'line-through' : ''}`}>
                            {formatCurrency(amt)}
                            {payment.voided && <span className="ml-2 text-red-500 text-xs">(Voided)</span>}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {formatDate(payment.createdAt)}
                            {payment.reference && ` - ${payment.reference}`}
                          </div>
                        </div>
                      </div>
                      {onVoidPayment && !payment.voided && (
                        <button
                          onClick={() => onVoidPayment(payment.id)}
                          className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                          title="Void payment"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Customer Credit */}
          {showCreditOptions && customerCredit > 0 && (
            <div className="bg-green-50 dark:bg-green-900/50 border border-green-200 dark:border-green-800 rounded p-3">
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-sm font-medium text-green-800 dark:text-green-300">
                    Customer Credit Available
                  </div>
                  <div className="text-lg font-bold text-green-700 dark:text-green-400">
                    {formatCurrency(customerCredit)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleUseCredit}
                  className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Use Credit
                </button>
              </div>
              {effectiveCredit > 0 && (
                <div className="mt-2">
                  <label className="block text-sm font-medium mb-1 text-green-800 dark:text-green-300">
                    Credit to Use
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={Math.min(customerCredit, remainingBalance)}
                    value={creditAmount}
                    onChange={(e) => setCreditAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-green-300 dark:border-green-700 rounded focus:outline-none focus:ring-2 focus:ring-green-500 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              )}
            </div>
          )}

          {/* Payment Method */}
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-200">
              Payment Method
            </label>
            <div className="grid grid-cols-3 gap-2">
              {paymentMethods.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMethod(value)}
                  className={`p-2 border rounded flex flex-col items-center gap-1 text-sm ${
                    method === value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
                      : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300'
                  }`}
                >
                  <Icon size={20} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-200">
              Amount
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Reference - Only for Card and Bank Transfer */}
          {method !== 'cash' && (
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-200">
                Reference {method === 'card' ? '(Transaction ID)' : '(Transfer Ref)'}
              </label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={method === 'card' ? 'Card approval code...' : 'Bank reference...'}
                className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
          )}

          {/* Overpayment Options (Cash only) */}
          {method === 'cash' && allowOverpayment && overpayment > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/50 border border-amber-200 dark:border-amber-800 rounded p-3">
              <p className="text-amber-800 dark:text-amber-300 text-sm font-medium mb-2">
                Overpayment: {formatCurrency(overpayment)}
              </p>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={overpaymentAction === 'return'}
                    onChange={() => setOverpaymentAction('return')}
                  />
                  <span className="text-sm dark:text-gray-300">Return as change</span>
                </label>
                {showCreditOptions && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={overpaymentAction === 'credit'}
                      onChange={() => setOverpaymentAction('credit')}
                    />
                    <span className="text-sm dark:text-gray-300">Add to credit</span>
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Payment Summary */}
          <div className="bg-gray-50 dark:bg-gray-900 rounded p-3 space-y-1">
            <div className="flex justify-between text-sm dark:text-gray-300">
              <span>Payment:</span>
              <span>{formatCurrency(effectivePayment)}</span>
            </div>
            {effectiveCredit > 0 && (
              <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                <span>Credit Used:</span>
                <span>-{formatCurrency(effectiveCredit)}</span>
              </div>
            )}
            {overpayment > 0 && (
              <div className="flex justify-between text-sm text-amber-600 dark:text-amber-400">
                <span>Change:</span>
                <span>{formatCurrency(overpayment)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold pt-1 border-t dark:border-gray-700 dark:text-white">
              <span>{balanceDue > 0 ? 'Remaining Balance:' : 'Fully Paid'}</span>
              <span className={balanceDue > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>
                {balanceDue > 0 ? formatCurrency(balanceDue) : formatCurrency(totalPayment)}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end p-4 border-t dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={processing || (paymentAmount <= 0 && effectiveCredit <= 0)}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {processing ? 'Processing...' : submitText}
          </button>
        </div>
      </div>
    </div>
  )
}
