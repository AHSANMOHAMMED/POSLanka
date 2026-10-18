'use client'

import { useMemo } from 'react'
import { X, Loader2, Wallet, Gift, Banknote, CreditCard, Building2, Smartphone, Search, CheckCircle, AlertTriangle } from 'lucide-react'
import { FormInput } from '@/components/ui/form-elements'
import { useCurrency } from '@/hooks/useCurrency'
import { getCurrencyNotes } from '@/lib/utils/countries'
import type { Customer, PaymentMethodConfig, LoyaltyProgram, GiftCardInfo } from './types'

const PAYMENT_METHOD_META: Record<string, { icon: typeof Banknote; label: string }> = {
  cash: { icon: Banknote, label: 'Cash' },
  card: { icon: CreditCard, label: 'Card' },
  bank_transfer: { icon: Building2, label: 'Transfer' },
  credit: { icon: Wallet, label: 'Credit' },
  gift_card: { icon: Gift, label: 'Gift Card' },
  mobile_payment: { icon: Smartphone, label: 'Mobile' },
}

interface POSPaymentModalProps {
  isOpen: boolean
  onClose: () => void
  onCompleteSale: () => void

  isReturnMode: boolean
  total: number
  loyaltyRedeemValue: number
  selectedCustomer: Customer | null
  processing: boolean

  paymentMethod: string
  setPaymentMethod: (method: string) => void
  refundMethod: string
  setRefundMethod: (method: string) => void
  amountPaid: string
  setAmountPaid: (value: string) => void
  creditAmount: string
  setCreditAmount: (value: string) => void
  customerCredit: number

  enabledPaymentMethods: PaymentMethodConfig[]
  enabledRefundMethods: string[]

  loyaltyProgram: LoyaltyProgram | null
  loyaltyPointsToRedeem: string
  setLoyaltyPointsToRedeem: (value: string) => void
  showLoyaltyRedeem: boolean
  setShowLoyaltyRedeem: (show: boolean) => void
  tierRedeemRate: number
  loyaltyRedeemPoints: number
  tipAmount?: number
  currency?: string

  // Gift card
  giftCardNumber: string
  setGiftCardNumber: (value: string) => void
  giftCardInfo: GiftCardInfo | null
  giftCardLookupLoading: boolean
  onLookupGiftCard: () => void
}

export function POSPaymentModal({
  isOpen,
  onClose,
  onCompleteSale,
  isReturnMode,
  total,
  loyaltyRedeemValue,
  selectedCustomer,
  processing,
  paymentMethod,
  setPaymentMethod,
  refundMethod,
  setRefundMethod,
  amountPaid,
  setAmountPaid,
  creditAmount,
  setCreditAmount,
  customerCredit,
  enabledPaymentMethods,
  enabledRefundMethods,
  loyaltyProgram,
  loyaltyPointsToRedeem,
  setLoyaltyPointsToRedeem,
  showLoyaltyRedeem,
  setShowLoyaltyRedeem,
  tierRedeemRate,
  loyaltyRedeemPoints,
  tipAmount,
  currency,
  giftCardNumber,
  setGiftCardNumber,
  giftCardInfo,
  giftCardLookupLoading,
  onLookupGiftCard,
}: POSPaymentModalProps) {
  const { currency: currencyCode } = useCurrency()
  const payableTotal = Math.max(0, total - loyaltyRedeemValue + (tipAmount || 0))
  const creditUsed = parseFloat(creditAmount) || 0
  const remainingAfterCredit = Math.max(0, payableTotal - creditUsed)
  const cashCardPaid = parseFloat(amountPaid) || 0
  const effectiveCashCardPaid = paymentMethod === 'cash' ? cashCardPaid : Math.min(cashCardPaid, remainingAfterCredit)
  const totalPaid = effectiveCashCardPaid + creditUsed
  const change = paymentMethod === 'cash' ? Math.max(0, totalPaid - payableTotal) : 0
  const balanceDue = Math.max(0, payableTotal - totalPaid)

  const loyaltyConversionFactor = loyaltyProgram ? parseFloat(loyaltyProgram.conversionFactor) : 0
  const loyaltyRedeemValueCalc = loyaltyRedeemPoints * loyaltyConversionFactor * tierRedeemRate

  // Smart quick amount buttons — suggest banknote combinations based on currency
  const quickAmounts = useMemo(() => {
    const amounts: { label: string; value: number }[] = [
      { label: 'Exact', value: remainingAfterCredit }
    ]
    if (paymentMethod === 'cash' && payableTotal > 0) {
      const notes = getCurrencyNotes(currency || 'LKR')
      const seen = new Set<number>()
      // Find the smallest combination of notes >= payableTotal
      for (let i = notes.length - 1; i >= 0; i--) {
        const note = notes[i]
        if (note <= payableTotal) continue
        // Single note that covers the total
        if (!seen.has(note)) {
          seen.add(note)
          amounts.push({ label: note.toLocaleString(), value: note })
        }
      }
      // Round up to multiples of common notes
      for (let i = notes.length - 1; i >= 0; i--) {
        const note = notes[i]
        const rounded = Math.ceil(payableTotal / note) * note
        if (rounded > payableTotal && !seen.has(rounded)) {
          seen.add(rounded)
          amounts.push({ label: rounded.toLocaleString(), value: rounded })
        }
      }
      // Sort suggestions by value
      amounts.sort((a, b) => a.value - b.value)
      // Keep Exact first, then lowest suggestions
      const exact = amounts.splice(amounts.findIndex(a => a.label === 'Exact'), 1)
      amounts.unshift(...exact)
    }
    return amounts.slice(0, 5)
  }, [payableTotal, remainingAfterCredit, paymentMethod, currency])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className={`px-6 py-5 ${isReturnMode ? 'bg-red-50' : 'bg-gradient-to-r from-blue-600 to-blue-500'}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className={`text-xl font-bold ${isReturnMode ? 'text-red-700' : 'text-white'}`}>
                {isReturnMode ? 'Process Refund' : 'Payment'}
              </h2>
              {selectedCustomer && (
                <p className={`text-sm ${isReturnMode ? 'text-red-600' : 'text-blue-100'}`}>
                  {selectedCustomer.name}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              disabled={processing}
              className={`p-2 rounded-md ${isReturnMode ? 'hover:bg-red-100' : 'hover:bg-white/20'} transition-colors`}
            >
              <X size={20} className={isReturnMode ? 'text-red-600' : 'text-white'} />
            </button>
          </div>
          <div className={`mt-4 text-center py-4 rounded-2xl ${isReturnMode ? 'bg-red-100' : 'bg-white/20'}`}>
            <p className={`text-sm ${isReturnMode ? 'text-red-600' : 'text-blue-100'}`}>
              {isReturnMode ? 'Refund Amount' : 'Total Amount'}
              {!isReturnMode && (tipAmount || 0) > 0 && ' (incl. tip)'}
            </p>
            <p className={`text-4xl font-bold ${isReturnMode ? 'text-red-700' : 'text-white'}`}>
              {currencyCode} {Math.abs(isReturnMode ? total : payableTotal).toFixed(2)}
            </p>
          </div>
        </div>

        <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
          {/* Refund Method */}
          {isReturnMode && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-3">Refund Method</label>
              <div className={`grid gap-3 ${enabledRefundMethods.length <= 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
                {enabledRefundMethods.map(methodId => {
                  const meta = PAYMENT_METHOD_META[methodId] || { icon: Banknote, label: methodId }
                  const Icon = meta.icon
                  const isCredit = methodId === 'credit'
                  const disabled = isCredit && !selectedCustomer
                  return (
                    <button
                      key={methodId}
                      onClick={() => setRefundMethod(methodId)}
                      disabled={disabled}
                      className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${
                        refundMethod === methodId
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      } ${disabled ? 'opacity-50' : ''}`}
                    >
                      <Icon size={24} className={refundMethod === methodId ? 'text-blue-600' : 'text-gray-400'} />
                      <span className={`text-sm font-medium ${refundMethod === methodId ? 'text-blue-700' : 'text-gray-600'}`}>
                        {meta.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Loyalty Points Redemption */}
          {!isReturnMode && selectedCustomer && loyaltyProgram && (selectedCustomer.loyaltyPoints || 0) >= loyaltyProgram.minRedemptionPoints && (
            <div className="bg-purple-50 border-2 border-purple-200 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Gift className="text-purple-600" size={20} />
                  <span className="font-medium text-purple-800">Loyalty Points</span>
                </div>
                <span className="text-lg font-bold text-purple-700">{selectedCustomer.loyaltyPoints} pts</span>
              </div>
              {showLoyaltyRedeem ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <FormInput
                      type="number"
                      inputSize="md"
                      min={0}
                      max={selectedCustomer.loyaltyPoints}
                      value={loyaltyPointsToRedeem}
                      onChange={(e) => {
                        const val = Math.min(parseInt(e.target.value) || 0, selectedCustomer.loyaltyPoints || 0)
                        setLoyaltyPointsToRedeem(val > 0 ? String(val) : '')
                      }}
                      placeholder="Points to redeem"
                      className="flex-1"
                    />
                    <button
                      onClick={() => {
                        const pts = parseInt(loyaltyPointsToRedeem) || 0
                        if (pts < loyaltyProgram.minRedemptionPoints) {
                          return
                        }
                        const value = pts * loyaltyConversionFactor * tierRedeemRate
                        if (value > total) {
                          return
                        }
                        setShowLoyaltyRedeem(false)
                        const newTotal = Math.max(0, total - value)
                        setAmountPaid(Math.max(0, newTotal - (parseFloat(creditAmount) || 0)).toFixed(2))
                      }}
                      className="px-4 py-2 bg-purple-600 text-white rounded-md font-medium hover:bg-purple-700 text-sm"
                    >
                      Apply
                    </button>
                  </div>
                  {loyaltyRedeemPoints > 0 && (
                    <p className="text-xs text-purple-600">
                      = {currencyCode} {loyaltyRedeemValueCalc.toFixed(2)} discount
                    </p>
                  )}
                  <button
                    onClick={() => { setLoyaltyPointsToRedeem(''); setShowLoyaltyRedeem(false) }}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowLoyaltyRedeem(true)}
                    className="flex-1 py-2 bg-purple-600 text-white rounded-md font-medium hover:bg-purple-700"
                  >
                    Redeem Points
                  </button>
                  {loyaltyRedeemPoints > 0 && (
                    <button
                      onClick={() => {
                        setLoyaltyPointsToRedeem('')
                        setAmountPaid(total.toFixed(2))
                      }}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md font-medium hover:bg-gray-300"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Customer Credit */}
          {!isReturnMode && selectedCustomer && customerCredit > 0 && (
            <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Wallet className="text-green-600" size={20} />
                  <span className="font-medium text-green-800">Customer Credit</span>
                </div>
                <span className="text-lg font-bold text-green-700">{currencyCode} {customerCredit.toFixed(2)}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const useAmount = Math.min(customerCredit, payableTotal)
                    setCreditAmount(useAmount.toFixed(2))
                    setAmountPaid(Math.max(0, payableTotal - useAmount).toFixed(2))
                  }}
                  className="flex-1 py-2 bg-green-600 text-white rounded-md font-medium hover:bg-green-700"
                >
                  Use Credit
                </button>
                {creditUsed > 0 && (
                  <button
                    onClick={() => {
                      setCreditAmount('')
                      setAmountPaid(payableTotal.toFixed(2))
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md font-medium hover:bg-gray-300"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Payment Method */}
          {!isReturnMode && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-3">Payment Method</label>
              <div className={`grid gap-3 ${enabledPaymentMethods.length <= 3 ? 'grid-cols-3' : enabledPaymentMethods.length <= 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                {enabledPaymentMethods.map(pm => {
                  const meta = PAYMENT_METHOD_META[pm.paymentMethod] || { icon: Banknote, label: pm.paymentMethod }
                  const Icon = meta.icon
                  return (
                    <button
                      key={pm.paymentMethod}
                      onClick={() => {
                        setPaymentMethod(pm.paymentMethod)
                        if (pm.paymentMethod !== 'cash' && cashCardPaid > remainingAfterCredit) {
                          setAmountPaid(remainingAfterCredit.toFixed(2))
                        }
                      }}
                      className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all ${
                        paymentMethod === pm.paymentMethod
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <Icon size={24} className={paymentMethod === pm.paymentMethod ? 'text-blue-600' : 'text-gray-400'} />
                      <span className={`text-sm font-medium ${paymentMethod === pm.paymentMethod ? 'text-blue-700' : 'text-gray-600'}`}>
                        {meta.label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Gift Card Lookup */}
          {!isReturnMode && paymentMethod === 'gift_card' && (
            <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Gift className="text-amber-600" size={20} />
                <span className="font-medium text-amber-800">Gift Card</span>
              </div>
              <div className="flex gap-2">
                <FormInput
                  type="text"
                  inputSize="md"
                  value={giftCardNumber}
                  onChange={(e) => setGiftCardNumber(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onLookupGiftCard() }}
                  placeholder="Enter card number"
                  className="flex-1"
                  autoFocus
                />
                <button
                  onClick={onLookupGiftCard}
                  disabled={giftCardLookupLoading || !giftCardNumber.trim()}
                  className="px-4 py-2 bg-amber-600 text-white rounded-md font-medium hover:bg-amber-700 disabled:opacity-50"
                >
                  {giftCardLookupLoading ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
                </button>
              </div>
              {giftCardInfo && (
                <div className="mt-3 p-3 bg-white rounded-xl border border-amber-200">
                  {giftCardInfo.status === 'active' ? (
                    <>
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle size={16} className="text-green-600" />
                        <span className="text-sm font-medium text-green-700">Active Card</span>
                        <span className="ml-auto text-xs text-gray-500">{giftCardInfo.cardNumber}</span>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-gray-500">Available Balance</p>
                        <p className="text-2xl font-bold text-amber-700">
                          {currencyCode} {giftCardInfo.currentBalance.toFixed(2)}
                        </p>
                      </div>
                      {giftCardInfo.currentBalance < remainingAfterCredit && (
                        <p className="text-xs text-amber-600 mt-2 text-center">
                          Card balance is less than total. Remaining {currencyCode} {(remainingAfterCredit - giftCardInfo.currentBalance).toFixed(2)} will need another payment.
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={16} className="text-red-500" />
                      <span className="text-sm font-medium text-red-600">
                        Card is {giftCardInfo.status} — cannot be used
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Amount Input — hidden for credit sales (no money received) */}
          {!isReturnMode && paymentMethod !== 'credit' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Amount Received
              </label>
              <FormInput
                type="number"
                inputSize="lg"
                step="0.01"
                min={0}
                value={amountPaid}
                onChange={(e) => {
                  let val = Math.max(0, parseFloat(e.target.value) || 0)
                  if (paymentMethod !== 'cash' && val > remainingAfterCredit) val = remainingAfterCredit
                  setAmountPaid(val > 0 ? val.toString() : '0')
                }}
                className="text-xl font-bold"
              />
              <div className="flex gap-2 mt-3">
                {quickAmounts.map((qa, i) => (
                  <button
                    key={i}
                    onClick={() => setAmountPaid(qa.value.toFixed(2))}
                    className="px-4 py-2 bg-gray-100 rounded text-sm font-medium hover:bg-gray-200"
                  >
                    {qa.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Credit sale notice */}
          {!isReturnMode && paymentMethod === 'credit' && (
            <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-4 text-center">
              <Wallet className="mx-auto text-blue-600 mb-2" size={24} />
              <p className="text-sm font-semibold text-blue-800">Full amount on credit</p>
              <p className="text-xs text-blue-600 mt-1">
                {selectedCustomer
                  ? `${selectedCustomer.name} will owe ${currencyCode} ${payableTotal.toFixed(2)}`
                  : 'Please select a customer for credit sales'}
              </p>
            </div>
          )}

          {/* Change Display */}
          {!isReturnMode && change > 0 && (
            <div className="bg-green-100 border-2 border-green-300 rounded-2xl p-5 text-center">
              <p className="text-sm text-green-700 font-medium uppercase tracking-wide">Change Due</p>
              <p className="text-4xl font-black text-green-800 mt-1">{currencyCode} {change.toFixed(2)}</p>
            </div>
          )}

          {/* Balance Due */}
          {!isReturnMode && balanceDue > 0 && (
            <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 text-center">
              <p className="text-sm text-amber-700 font-medium">Balance Due</p>
              <p className="text-2xl font-bold text-amber-800">{currencyCode} {balanceDue.toFixed(2)}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-5 bg-gray-50 border-t flex gap-3">
          <button
            onClick={onClose}
            disabled={processing}
            className="flex-1 py-3.5 border-2 border-gray-200 text-gray-700 rounded-md font-medium hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onCompleteSale}
            disabled={processing || (isReturnMode && refundMethod === 'credit' && !selectedCustomer) || (!isReturnMode && paymentMethod === 'credit' && !selectedCustomer) || (!isReturnMode && paymentMethod === 'gift_card' && (!giftCardInfo || giftCardInfo.status !== 'active'))}
            className={`flex-1 py-3.5 text-white rounded-md font-bold shadow-lg transition-all disabled:opacity-50 ${
              isReturnMode
                ? 'bg-gradient-to-r from-red-600 to-red-500'
                : balanceDue > 0
                ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                : 'bg-gradient-to-r from-green-600 to-green-500'
            }`}
          >
            {processing ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="animate-spin" size={20} />
                Processing...
              </span>
            ) : isReturnMode ? (
              'Process Refund'
            ) : (
              'Complete Sale'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
