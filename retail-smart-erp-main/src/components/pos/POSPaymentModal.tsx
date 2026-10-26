'use client'

import { useEffect, useMemo } from 'react'
import { X, Loader2, Wallet, Gift, Banknote, CreditCard, Building2, Smartphone, Search, CheckCircle, AlertTriangle, RotateCcw, FileText } from 'lucide-react'
import { FormInput } from '@/components/ui/form-elements'
import { useCurrency } from '@/hooks/useCurrency'
import { getCurrencyNotes } from '@/lib/utils/countries'
import type { Customer, PaymentMethodConfig, LoyaltyProgram, GiftCardInfo, ChequeFormValue } from './types'
import { paymentMethodIndexForKey } from '@/lib/pos/shortcuts'

const PAYMENT_METHOD_META: Record<string, { icon: typeof Banknote; label: string }> = {
  cash: { icon: Banknote, label: 'Cash' },
  card: { icon: CreditCard, label: 'Card' },
  bank_transfer: { icon: Building2, label: 'Transfer' },
  credit: { icon: Wallet, label: 'Credit' },
  gift_card: { icon: Gift, label: 'Gift Card' },
  cheque: { icon: FileText, label: 'Cheque' },
  mobile_payment: { icon: Smartphone, label: 'Mobile' },
  original: { icon: RotateCcw, label: 'Original methods' },
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

  /** Split tender (cash + second method) */
  splitEnabled?: boolean
  setSplitEnabled?: (value: boolean) => void
  splitSecondMethod?: string
  setSplitSecondMethod?: (method: string) => void
  splitSecondAmount?: string
  setSplitSecondAmount?: (value: string) => void

  /** K1: cheque details (shown when the tender or the second split is a cheque) */
  chequeDetails?: ChequeFormValue
  setChequeDetails?: (value: ChequeFormValue) => void
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
  splitEnabled = false,
  setSplitEnabled,
  splitSecondMethod = 'card',
  setSplitSecondMethod,
  splitSecondAmount = '',
  setSplitSecondAmount,
  chequeDetails,
  setChequeDetails,
}: POSPaymentModalProps) {
  const { currency: currencyCode } = useCurrency()

  const needsCheque = !isReturnMode && (paymentMethod === 'cheque' || (splitEnabled && splitSecondMethod === 'cheque'))
  const chequeIncomplete = needsCheque && (!chequeDetails?.chequeNo.trim() || !chequeDetails?.bankName.trim() || !chequeDetails?.chequeDate)
  const todayStr = new Date().toLocaleDateString('en-CA')
  const chequeDays = chequeDetails?.chequeDate
    ? Math.round((Date.parse(`${chequeDetails.chequeDate}T00:00:00Z`) - Date.parse(`${todayStr}T00:00:00Z`)) / 86400000)
    : 0

  const completeDisabled = processing
    || chequeIncomplete
    || (isReturnMode && refundMethod === 'credit' && !selectedCustomer)
    || (!isReturnMode && paymentMethod === 'credit' && !selectedCustomer)
    || (!isReturnMode && paymentMethod === 'gift_card' && (!giftCardInfo || giftCardInfo.status !== 'active'))

  // Keyboard: Enter = complete sale, Escape = close (ignored while a text field other than amounts is focused)
  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!processing) onClose()
        return
      }
      if (e.key === 'Enter' && !e.shiftKey && !completeDisabled) {
        const el = document.activeElement as HTMLElement | null
        if (el && el.tagName === 'BUTTON') return
        e.preventDefault()
        onCompleteSale()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, processing, completeDisabled, onClose, onCompleteSale])
  const payableTotal = Math.max(0, total - loyaltyRedeemValue + (tipAmount || 0))
  const creditUsed = parseFloat(creditAmount) || 0
  const remainingAfterCredit = Math.max(0, payableTotal - creditUsed)
  const cashCardPaid = parseFloat(amountPaid) || 0
  const secondSplit = parseFloat(splitSecondAmount) || 0
  const effectiveCashCardPaid = paymentMethod === 'cash' ? cashCardPaid : Math.min(cashCardPaid, remainingAfterCredit)
  const totalPaid = splitEnabled
    ? Math.min(remainingAfterCredit, effectiveCashCardPaid + secondSplit) + creditUsed
    : effectiveCashCardPaid + creditUsed
  const change =
    paymentMethod === 'cash' && !splitEnabled
      ? Math.max(0, totalPaid - payableTotal)
      : splitEnabled && paymentMethod === 'cash'
        ? Math.max(0, effectiveCashCardPaid + secondSplit + creditUsed - payableTotal)
        : 0
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

  // Keyboard: F1, F2 … pick the payment / refund method by position (the digit too when not typing in a field)
  useEffect(() => {
    if (!isOpen || processing) return
    function onMethodKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      const inTextInput = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
      const ids = isReturnMode ? enabledRefundMethods : enabledPaymentMethods.map((m) => m.paymentMethod)
      const idx = paymentMethodIndexForKey(e, { inTextInput, count: ids.length })
      if (idx === null) return
      e.preventDefault()
      const id = ids[idx]
      if (isReturnMode) {
        if (id === 'credit' && !selectedCustomer) return
        setRefundMethod(id)
        return
      }
      setPaymentMethod(id)
      if (id !== 'cash' && cashCardPaid > remainingAfterCredit) setAmountPaid(remainingAfterCredit.toFixed(2))
    }
    window.addEventListener('keydown', onMethodKey)
    return () => window.removeEventListener('keydown', onMethodKey)
  }, [isOpen, processing, isReturnMode, enabledRefundMethods, enabledPaymentMethods, selectedCustomer, setRefundMethod, setPaymentMethod, setAmountPaid, cashCardPaid, remainingAfterCredit])

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
                {enabledRefundMethods.map((methodId, methodIdx) => {
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
                      {methodIdx < 9 && <kbd className="hidden sm:inline text-[10px] font-mono font-bold px-1 rounded border border-gray-300 bg-gray-100 text-gray-600">F{methodIdx + 1}</kbd>}
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
              <div className="flex items-center justify-between mb-3">
                <label className="block text-sm font-semibold text-gray-700">Payment Method</label>
                {setSplitEnabled && enabledPaymentMethods.length > 1 && (
                  <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={splitEnabled}
                      onChange={(e) => {
                        setSplitEnabled(e.target.checked)
                        if (e.target.checked) {
                          const half = (remainingAfterCredit / 2).toFixed(2)
                          setAmountPaid(half)
                          setSplitSecondAmount?.(half)
                          const second =
                            enabledPaymentMethods.find((m) => m.paymentMethod !== paymentMethod)?.paymentMethod ||
                            'card'
                          setSplitSecondMethod?.(second)
                        } else {
                          setSplitSecondAmount?.('')
                          setAmountPaid(remainingAfterCredit.toFixed(2))
                        }
                      }}
                    />
                    Split payment
                  </label>
                )}
              </div>
              <div className={`grid gap-3 ${enabledPaymentMethods.length <= 3 ? 'grid-cols-3' : enabledPaymentMethods.length <= 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                {enabledPaymentMethods.map((pm, methodIdx) => {
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
                      {methodIdx < 9 && <kbd className="hidden sm:inline text-[10px] font-mono font-bold px-1 rounded border border-gray-300 bg-gray-100 text-gray-600">F{methodIdx + 1}</kbd>}
                    </button>
                  )
                })}
              </div>
              {splitEnabled && setSplitSecondMethod && setSplitSecondAmount && (
                <div className="mt-3 space-y-2 border rounded-xl p-3 bg-slate-50">
                  <p className="text-xs font-medium text-gray-600">Second tender</p>
                  <select
                    value={splitSecondMethod}
                    onChange={(e) => setSplitSecondMethod(e.target.value)}
                    className="w-full border rounded-md px-2 py-2 text-sm"
                  >
                    {enabledPaymentMethods
                      .filter((m) => m.paymentMethod !== paymentMethod && m.paymentMethod !== 'credit' && m.paymentMethod !== 'gift_card')
                      .map((m) => (
                        <option key={m.paymentMethod} value={m.paymentMethod}>
                          {PAYMENT_METHOD_META[m.paymentMethod]?.label || m.paymentMethod}
                        </option>
                      ))}
                  </select>
                  <FormInput
                    type="number"
                    inputSize="md"
                    step="0.01"
                    min={0}
                    value={splitSecondAmount}
                    onChange={(e) => {
                      const val = Math.max(0, parseFloat(e.target.value) || 0)
                      setSplitSecondAmount(val > 0 ? String(val) : '0')
                      const first = Math.max(0, remainingAfterCredit - val)
                      setAmountPaid(first.toFixed(2))
                    }}
                    placeholder="Second amount"
                  />
                </div>
              )}
            </div>
          )}

          {/* Cheque details (K1) */}
          {needsCheque && chequeDetails && setChequeDetails && (
            <div className="bg-indigo-50 border-2 border-indigo-200 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <FileText className="text-indigo-600" size={20} />
                <span className="font-medium text-indigo-800">Cheque details</span>
                {chequeDays > 0 && (
                  <span className="ml-auto text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    Post-dated · {chequeDays} day{chequeDays === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <FormInput
                  type="text"
                  inputSize="md"
                  value={chequeDetails.chequeNo}
                  onChange={(e) => setChequeDetails({ ...chequeDetails, chequeNo: e.target.value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 50) })}
                  placeholder="Cheque no. *"
                  aria-label="Cheque number"
                />
                <FormInput
                  type="date"
                  inputSize="md"
                  value={chequeDetails.chequeDate}
                  onChange={(e) => setChequeDetails({ ...chequeDetails, chequeDate: e.target.value })}
                  aria-label="Cheque date"
                />
                <FormInput
                  type="text"
                  inputSize="md"
                  value={chequeDetails.bankName}
                  onChange={(e) => setChequeDetails({ ...chequeDetails, bankName: e.target.value.slice(0, 100) })}
                  placeholder="Bank *"
                  list="pos-cheque-banks"
                  aria-label="Bank"
                />
                <FormInput
                  type="text"
                  inputSize="md"
                  value={chequeDetails.branchName}
                  onChange={(e) => setChequeDetails({ ...chequeDetails, branchName: e.target.value.slice(0, 100) })}
                  placeholder="Branch"
                  aria-label="Branch"
                />
              </div>
              <datalist id="pos-cheque-banks">
                {['Bank of Ceylon', "People's Bank", 'Commercial Bank', 'Hatton National Bank', 'Sampath Bank', 'Seylan Bank', 'NDB Bank', 'DFCC Bank', 'Nations Trust Bank', 'Pan Asia Bank', 'Union Bank', 'National Savings Bank', 'Cargills Bank', 'Amana Bank']
                  .map((b) => <option key={b} value={b} />)}
              </datalist>
              <p className="text-xs text-indigo-700">
                The cheque amount is the {splitEnabled && splitSecondMethod === 'cheque' ? 'second tender' : 'amount received'}; no change is given on a cheque.
              </p>
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

          {/* Amount Input — for cash & other manual tenders */}
          {!isReturnMode && paymentMethod !== 'credit' && paymentMethod !== 'card' && (
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
                onFocus={(e) => e.target.select()}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                onChange={(e) => {
                  let val = Math.max(0, parseFloat(e.target.value) || 0)
                  if (paymentMethod !== 'cash' && val > remainingAfterCredit) val = remainingAfterCredit
                  setAmountPaid(val > 0 ? val.toString() : '0')
                }}
                className="text-2xl font-bold tracking-wide"
                autoFocus
              />

              {/* Quick Cash Shortcuts */}
              <div className="flex flex-wrap gap-2 mt-3">
                {quickAmounts.map((qa, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setAmountPaid(qa.value.toFixed(2))}
                    className="flex-1 py-2.5 px-3 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl text-sm font-semibold text-slate-800 transition-colors shadow-sm"
                  >
                    {qa.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setAmountPaid(remainingAfterCredit.toFixed(2))}
                  className="py-2.5 px-4 bg-teal-50 hover:bg-teal-100 border border-teal-300 text-teal-800 rounded-xl text-sm font-bold shadow-sm"
                >
                  Exact ({remainingAfterCredit.toFixed(2)})
                </button>
              </div>

              {/* Touchscreen On-Screen Numeric Dialpad */}
              <div className="mt-4 pt-3 border-t border-slate-200">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Touch Dialpad</p>
                <div className="grid grid-cols-3 gap-2">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((btn) => (
                    <button
                      key={btn}
                      type="button"
                      onClick={() => {
                        const cur = amountPaid || ''
                        const isExactDefault = cur === remainingAfterCredit.toFixed(2)
                        if (btn === '⌫') {
                          setAmountPaid(cur.length > 1 ? cur.slice(0, -1) : '0')
                        } else if (btn === '.') {
                          if (!cur.includes('.')) {
                            setAmountPaid((cur === '0' || !cur || isExactDefault) ? '0.' : cur + '.')
                          }
                        } else {
                          // If current amount is the pre-filled default bill amount, typing a number replaces it
                          setAmountPaid((cur === '0' || !cur || isExactDefault) ? btn : cur + btn)
                        }
                      }}
                      className="h-12 bg-white hover:bg-slate-50 active:bg-slate-200 border border-slate-200 rounded-xl text-lg font-bold text-slate-700 shadow-sm flex items-center justify-center transition-all select-none"
                    >
                      {btn}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Card payment quick action */}
          {!isReturnMode && paymentMethod === 'card' && (
            <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-4 text-center space-y-3">
              <div className="flex items-center justify-center gap-2 text-blue-700">
                <CreditCard size={28} />
                <span className="text-lg font-bold">Card Payment: {currencyCode} {remainingAfterCredit.toFixed(2)}</span>
              </div>
              <p className="text-xs text-blue-600">
                Tap or insert card on the POS terminal. When approved, click Complete or press Enter.
              </p>
              <button
                type="button"
                onClick={onCompleteSale}
                disabled={completeDisabled}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl font-bold text-base shadow-md transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle size={20} />
                Complete Card Payment (Enter)
              </button>
            </div>
          )}

          {/* Credit sale notice */}
          {!isReturnMode && paymentMethod === 'credit' && (
            <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-amber-800">
                <Wallet className="text-amber-600" size={24} />
                <span className="font-bold text-base">Store Credit Sale</span>
              </div>
              {selectedCustomer ? (
                <div className="text-xs text-amber-800 space-y-1">
                  <p>Customer: <b>{selectedCustomer.name}</b> {selectedCustomer.phone ? `(${selectedCustomer.phone})` : ''}</p>
                  <p>Current Credit Balance: <b>{currencyCode} {(customerCredit || 0).toFixed(2)}</b></p>
                  <p className="font-semibold text-sm text-amber-900 mt-2">
                    Amount to add to customer credit: {currencyCode} {payableTotal.toFixed(2)}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-red-600 font-semibold">
                  ⚠️ Please select a customer from the cart first to record a credit sale.
                </p>
              )}
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
            disabled={completeDisabled}
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
