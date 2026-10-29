'use client'

/**
 * POS payment screen. Matches the till (theme primary colour, light / dark).
 *  - Top: Total, Paid and Balance / Change, always visible.
 *  - One payment: pick the method (tiles, F1…), type the amount (cash may be more: change).
 *  - Split payment: "+ Add payment" adds lines (cash, card, transfer, cheque, mobile, credit = left on
 *    the customer's account), each with its own amount; "Rest" fills a line with what is still owed.
 *    The arithmetic is src/lib/pos/tenders.ts (same as the saved sale).
 *  - Number pad: off by default, switched on with "Number pad" (remembered on this PC); it types into
 *    the selected line.
 */
import { useEffect, useMemo, useState } from 'react'
import { X, Loader2, Wallet, Gift, Banknote, CreditCard, Building2, Smartphone, Search, CheckCircle, AlertTriangle, RotateCcw, FileText, CalendarClock, Plus, Trash2, Calculator } from 'lucide-react'
import { FormInput } from '@/components/ui/form-elements'
import { useCurrency } from '@/hooks/useCurrency'
import { getCurrencyNotes } from '@/lib/utils/countries'
import { settleTenders } from '@/lib/pos/tenders'
import type { Customer, PaymentMethodConfig, LoyaltyProgram, GiftCardInfo, ChequeFormValue, ExtraTender } from './types'
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

/** Methods that cannot take a hire-purchase down payment (the balance itself goes on account) */
const HP_BLOCKED_METHODS = ['credit', 'gift_card', 'cheque']
/** Split lines: gift cards pay alone (one card per sale) */
const NOT_IN_SPLIT = ['gift_card']
const NUMPAD_KEY = 'pos_numpad_on'

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

  /** Split payment: payment lines after the first (paymentMethod + amountPaid) */
  extraTenders?: ExtraTender[]
  setExtraTenders?: (lines: ExtraTender[]) => void

  /** K1: cheque details (shown when any payment line is a cheque) */
  chequeDetails?: ChequeFormValue
  setChequeDetails?: (value: ChequeFormValue) => void

  /**
   * Hire purchase / installment (installments module): the amount received is the down payment,
   * the rest is left on the customer's account and financed by an installment plan.
   * Leave setHirePurchase undefined to hide the option.
   */
  hirePurchase?: boolean
  setHirePurchase?: (value: boolean) => void
}

const money = (n: number) => n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

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
  extraTenders = [],
  setExtraTenders,
  chequeDetails,
  setChequeDetails,
  hirePurchase: hirePurchaseProp = false,
  setHirePurchase,
}: POSPaymentModalProps) {
  const hirePurchase = !isReturnMode && !!setHirePurchase && hirePurchaseProp
  const { currency: currencyCode } = useCurrency()
  const multi = !isReturnMode && !hirePurchase && extraTenders.length > 0
  // Line the number pad / quick cash buttons type into: 0 = first payment, n = extraTenders[n - 1]
  const [activeLine, setActiveLine] = useState(0)
  const [adding, setAdding] = useState(false)
  const [numpadOn, setNumpadOn] = useState(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem(NUMPAD_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleNumpad = () => {
    const next = !numpadOn
    setNumpadOn(next)
    try {
      localStorage.setItem(NUMPAD_KEY, next ? '1' : '0')
    } catch {
      /* private mode */
    }
  }

  const lineMethods = [paymentMethod, ...extraTenders.map((t) => t.method)]
  const needsCheque = !isReturnMode && (multi ? lineMethods.includes('cheque') : paymentMethod === 'cheque')
  const chequeIncomplete = needsCheque && (!chequeDetails?.chequeNo.trim() || !chequeDetails?.bankName.trim() || !chequeDetails?.chequeDate)
  const todayStr = new Date().toLocaleDateString('en-CA')
  const chequeDays = chequeDetails?.chequeDate
    ? Math.round((Date.parse(`${chequeDetails.chequeDate}T00:00:00Z`) - Date.parse(`${todayStr}T00:00:00Z`)) / 86400000)
    : 0

  const payableTotal = Math.max(0, total - loyaltyRedeemValue + (tipAmount || 0))
  const creditUsed = parseFloat(creditAmount) || 0
  const remainingAfterCredit = Math.max(0, payableTotal - creditUsed)
  const cashCardPaid = parseFloat(amountPaid) || 0

  // Split: shared arithmetic; one payment: as before (credit = everything on account)
  const settled = multi
    ? settleTenders(remainingAfterCredit, [{ method: paymentMethod, amount: cashCardPaid }, ...extraTenders.map((t) => ({ method: t.method, amount: parseFloat(t.amount) || 0 }))])
    : null
  const effectiveCashCardPaid = paymentMethod === 'credit' ? 0 : paymentMethod === 'cash' ? cashCardPaid : Math.min(cashCardPaid, remainingAfterCredit)
  const totalPaid = settled
    ? settled.paid + creditUsed
    : paymentMethod === 'credit'
      ? payableTotal
      : Math.min(payableTotal, effectiveCashCardPaid + creditUsed)
  const change = settled ? settled.change : paymentMethod === 'cash' ? Math.max(0, cashCardPaid + creditUsed - payableTotal) : 0
  const balanceDue = settled ? settled.balance : paymentMethod === 'credit' ? 0 : Math.max(0, payableTotal - effectiveCashCardPaid - creditUsed)
  const splitError = settled?.error ?? null
  const creditLineWithoutCustomer = multi && lineMethods.includes('credit') && !selectedCustomer

  const completeDisabled = processing
    || chequeIncomplete
    || !!splitError
    || creditLineWithoutCustomer
    || (isReturnMode && refundMethod === 'credit' && !selectedCustomer)
    || (!isReturnMode && !multi && paymentMethod === 'credit' && !selectedCustomer)
    || (!isReturnMode && !multi && paymentMethod === 'gift_card' && (!giftCardInfo || giftCardInfo.status !== 'active'))

  // Keyboard: Enter = complete sale, Escape = close
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

  const loyaltyConversionFactor = loyaltyProgram ? parseFloat(loyaltyProgram.conversionFactor) : 0
  const loyaltyRedeemValueCalc = loyaltyRedeemPoints * loyaltyConversionFactor * tierRedeemRate

  // Amount of a line (0 = first payment)
  const lineAmount = (i: number) => (i === 0 ? amountPaid : extraTenders[i - 1]?.amount ?? '')
  const lineMethod = (i: number) => (i === 0 ? paymentMethod : extraTenders[i - 1]?.method ?? 'cash')
  const setLineAmount = (i: number, v: string) => {
    if (i === 0) setAmountPaid(v)
    else setExtraTenders?.(extraTenders.map((t, k) => (k === i - 1 ? { ...t, amount: v } : t)))
  }
  const setLineMethod = (i: number, m: string) => {
    if (i === 0) setPaymentMethod(m)
    else setExtraTenders?.(extraTenders.map((t, k) => (k === i - 1 ? { ...t, method: m } : t)))
  }
  // What a line must be so the bill is exactly paid (the other lines stay as they are)
  const restFor = (i: number) => {
    const others = [0, ...extraTenders.map((_, k) => k + 1)].filter((k) => k !== i).reduce((sum, k) => sum + (parseFloat(lineAmount(k)) || 0), 0)
    return Math.max(0, Math.round((remainingAfterCredit - others) * 100) / 100)
  }
  const activeIsCash = lineMethod(activeLine) === 'cash'

  // Banknote suggestions for the cash line being typed
  const quickAmounts = useMemo(() => {
    const target = multi ? restFor(activeLine) : remainingAfterCredit
    const amounts: { label: string; value: number }[] = [{ label: 'Exact', value: target }]
    if (activeIsCash && target > 0) {
      const notes = getCurrencyNotes(currency || 'LKR')
      const seen = new Set<number>([target])
      for (let i = notes.length - 1; i >= 0; i--) {
        const note = notes[i]
        if (note > target && !seen.has(note)) { seen.add(note); amounts.push({ label: note.toLocaleString(), value: note }) }
      }
      for (let i = notes.length - 1; i >= 0; i--) {
        const rounded = Math.ceil(target / notes[i]) * notes[i]
        if (rounded > target && !seen.has(rounded)) { seen.add(rounded); amounts.push({ label: rounded.toLocaleString(), value: rounded }) }
      }
      const rest = amounts.slice(1).sort((a, b) => a.value - b.value)
      return [amounts[0], ...rest].slice(0, 5)
    }
    return amounts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingAfterCredit, activeIsCash, currency, multi, activeLine, amountPaid, extraTenders])

  // Keyboard: F1, F2 … pick the payment / refund method by position (one payment only)
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
      if (multi) return
      if (hirePurchase && HP_BLOCKED_METHODS.includes(id)) return
      setPaymentMethod(id)
      if (id !== 'cash' && cashCardPaid > remainingAfterCredit) setAmountPaid(remainingAfterCredit.toFixed(2))
    }
    window.addEventListener('keydown', onMethodKey)
    return () => window.removeEventListener('keydown', onMethodKey)
  }, [isOpen, processing, isReturnMode, enabledRefundMethods, enabledPaymentMethods, selectedCustomer, setRefundMethod, setPaymentMethod, setAmountPaid, cashCardPaid, remainingAfterCredit, hirePurchase, multi])

  function toggleHirePurchase() {
    if (!setHirePurchase) return
    const next = !hirePurchase
    setHirePurchase(next)
    if (next) {
      setExtraTenders?.([])
      setActiveLine(0)
      if (HP_BLOCKED_METHODS.includes(paymentMethod)) {
        setPaymentMethod(enabledPaymentMethods.find((m) => !HP_BLOCKED_METHODS.includes(m.paymentMethod))?.paymentMethod || 'cash')
      }
      setAmountPaid('0')
    } else {
      setAmountPaid(remainingAfterCredit.toFixed(2))
    }
  }

  // Methods a new split line can use
  const splitChoices = enabledPaymentMethods
    .map((m) => m.paymentMethod)
    .filter((m) => !NOT_IN_SPLIT.includes(m) && !(m === 'cheque' && lineMethods.includes('cheque')))
  function addLine(method: string) {
    if (!setExtraTenders) return
    // first payment as typed; when it already covers the bill, the new line starts at 0 and is selected
    if (!multi && paymentMethod === 'gift_card') return
    const firstIsCredit = !multi && paymentMethod === 'credit'
    if (firstIsCredit) setAmountPaid('0')
    const next = [...extraTenders, { method, amount: '' }]
    const others = (firstIsCredit ? 0 : cashCardPaid) + extraTenders.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)
    const rest = Math.max(0, Math.round((remainingAfterCredit - others) * 100) / 100)
    next[next.length - 1].amount = rest > 0 ? rest.toFixed(2) : ''
    setExtraTenders(next)
    setActiveLine(next.length)
    setAdding(false)
  }
  function removeLine(i: number) {
    if (!setExtraTenders || i === 0) return
    setExtraTenders(extraTenders.filter((_, k) => k !== i - 1))
    setActiveLine(0)
  }

  function pressKey(key: string) {
    const cur = lineAmount(activeLine) || ''
    const isPrefilled = cur === (multi ? restFor(activeLine) : remainingAfterCredit).toFixed(2)
    if (key === 'C') return setLineAmount(activeLine, '')
    if (key === '⌫') return setLineAmount(activeLine, cur.length > 1 ? cur.slice(0, -1) : '')
    if (key === '.') {
      if (!cur.includes('.') || isPrefilled) setLineAmount(activeLine, !cur || cur === '0' || isPrefilled ? '0.' : `${cur}.`)
      return
    }
    setLineAmount(activeLine, !cur || cur === '0' || isPrefilled ? key : `${cur}${key}`)
  }

  if (!isOpen) return null

  const methodTile = (id: string, idx: number, selected: boolean, onClick: () => void, disabled = false, title?: string) => {
    const meta = PAYMENT_METHOD_META[id] || { icon: Banknote, label: id }
    const Icon = meta.icon
    return (
      <button
        key={id}
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={`flex flex-col items-center gap-1.5 p-3 rounded-2xl border-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
          selected ? 'theme-border-primary theme-bg-subtle' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-500'
        }`}
      >
        <Icon size={22} className={selected ? 'theme-text-primary' : 'text-gray-400'} />
        <span className={`text-sm font-semibold ${selected ? 'theme-text-primary' : 'text-gray-600 dark:text-gray-300'}`}>{meta.label}</span>
        {idx < 9 && <kbd className="hidden sm:inline text-[10px] font-mono font-bold px-1 rounded border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">F{idx + 1}</kbd>}
      </button>
    )
  }

  const amountLines = [0, ...extraTenders.map((_, k) => k + 1)]
  const showAmounts = !isReturnMode && (multi || paymentMethod !== 'credit')
  const showPad = numpadOn && showAmounts

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4">
      <div className={`bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full ${showPad ? 'max-w-4xl' : 'max-w-xl'} overflow-hidden flex flex-col max-h-[96vh] border border-gray-100 dark:border-gray-800`}>
        {/* Header: same colour as the till */}
        <div
          className={`px-5 sm:px-6 py-4 ${isReturnMode ? 'bg-red-50 dark:bg-red-950/40' : 'text-white'}`}
          style={isReturnMode ? undefined : { background: 'linear-gradient(135deg, var(--primary), var(--primary-hover))' }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className={`text-xl font-bold ${isReturnMode ? 'text-red-700 dark:text-red-300' : 'text-white'}`}>{isReturnMode ? 'Process Refund' : 'Payment'}</h2>
              {selectedCustomer && <p className={`text-sm truncate ${isReturnMode ? 'text-red-600' : 'text-white/80'}`}>{selectedCustomer.name}{selectedCustomer.phone ? ` · ${selectedCustomer.phone}` : ''}</p>}
            </div>
            <div className="flex items-center gap-1.5">
              {!isReturnMode && (
                <button
                  type="button"
                  onClick={toggleNumpad}
                  aria-pressed={numpadOn}
                  title="Show / hide the number pad"
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors ${numpadOn ? 'bg-white theme-text-primary' : 'bg-white/15 text-white hover:bg-white/25'}`}
                >
                  <Calculator size={14} /> Number pad
                </button>
              )}
              <button onClick={onClose} disabled={processing} aria-label="Close" className={`p-2 rounded-md ${isReturnMode ? 'hover:bg-red-100' : 'hover:bg-white/20'} transition-colors`}>
                <X size={20} className={isReturnMode ? 'text-red-600' : 'text-white'} />
              </button>
            </div>
          </div>
          {isReturnMode ? (
            <div className="mt-3 text-center py-3 rounded-2xl bg-red-100 dark:bg-red-900/40">
              <p className="text-sm text-red-600 dark:text-red-300">Refund Amount</p>
              <p className="text-4xl font-bold text-red-700 dark:text-red-200">{currencyCode} {money(Math.abs(total))}</p>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-2xl bg-white/15 py-2.5 px-1">
                <p className="text-[11px] uppercase tracking-wide text-white/80">Total{(tipAmount || 0) > 0 ? ' (incl. tip)' : ''}</p>
                <p className="text-xl sm:text-2xl font-extrabold tabular-nums">{money(payableTotal)}</p>
              </div>
              <div className="rounded-2xl bg-white/15 py-2.5 px-1">
                <p className="text-[11px] uppercase tracking-wide text-white/80">Paid</p>
                <p className="text-xl sm:text-2xl font-extrabold tabular-nums">{money(totalPaid)}</p>
              </div>
              <div className={`rounded-2xl py-2.5 px-1 ${change > 0 ? 'bg-emerald-500' : balanceDue > 0 ? 'bg-amber-500' : 'bg-white/15'}`}>
                <p className="text-[11px] uppercase tracking-wide text-white/90">{change > 0 ? 'Change' : hirePurchase ? 'On installments' : 'Balance'}</p>
                <p className="text-xl sm:text-2xl font-extrabold tabular-nums">{money(change > 0 ? change : balanceDue)}</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className={showPad ? 'grid md:grid-cols-[minmax(0,1fr)_300px]' : ''}>
            <div className="p-5 sm:p-6 space-y-5 text-gray-900 dark:text-gray-100">
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
              {/* How the customer pays */}
              {!isReturnMode && !multi && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Payment method</label>
                  <div className={`grid gap-2 ${enabledPaymentMethods.length <= 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
                    {enabledPaymentMethods.map((pm, idx) =>
                      methodTile(
                        pm.paymentMethod,
                        idx,
                        paymentMethod === pm.paymentMethod,
                        () => {
                          setPaymentMethod(pm.paymentMethod)
                          setActiveLine(0)
                          if (pm.paymentMethod !== 'cash' && cashCardPaid > remainingAfterCredit) setAmountPaid(remainingAfterCredit.toFixed(2))
                          if (pm.paymentMethod !== 'credit' && cashCardPaid === 0) setAmountPaid(remainingAfterCredit.toFixed(2))
                        },
                        hirePurchase && HP_BLOCKED_METHODS.includes(pm.paymentMethod),
                        hirePurchase && HP_BLOCKED_METHODS.includes(pm.paymentMethod) ? 'Not for a hire purchase down payment' : undefined
                      )
                    )}
                  </div>
                </div>
              )}

              {/* Amount lines */}
              {showAmounts && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {multi ? 'Payments' : hirePurchase ? 'Down payment' : 'Amount received'}
                    </label>
                    {multi && <span className="text-xs text-gray-500">Tap a line to type into it</span>}
                  </div>
                  {amountLines.map((i) => {
                    const m = lineMethod(i)
                    const meta = PAYMENT_METHOD_META[m] || { icon: Banknote, label: m }
                    const Icon = meta.icon
                    const active = activeLine === i
                    return (
                      <div
                        key={i}
                        onClick={() => setActiveLine(i)}
                        className={`flex items-center gap-2 rounded-2xl border-2 p-2 transition-colors ${active ? 'theme-border-primary theme-bg-subtle' : 'border-gray-200 dark:border-gray-700'}`}
                      >
                        {multi ? (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Icon size={18} className={active ? 'theme-text-primary' : 'text-gray-400'} />
                            <select
                              value={m}
                              aria-label="Payment method"
                              onChange={(e) => setLineMethod(i, e.target.value)}
                              className="text-sm font-semibold bg-transparent border border-gray-200 dark:border-gray-700 rounded-lg px-1.5 py-1.5 dark:bg-gray-900"
                            >
                              {enabledPaymentMethods
                                .map((x) => x.paymentMethod)
                                .filter((x) => x === m || (!NOT_IN_SPLIT.includes(x) && !(x === 'cheque' && lineMethods.includes('cheque'))))
                                .map((x) => (
                                  <option key={x} value={x} disabled={x === 'credit' && !selectedCustomer}>
                                    {PAYMENT_METHOD_META[x]?.label || x}{x === 'credit' ? ' (on account)' : ''}
                                  </option>
                                ))}
                            </select>
                          </div>
                        ) : (
                          <Icon size={22} className="theme-text-primary shrink-0 ml-1" />
                        )}
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`${meta.label} amount`}
                          value={lineAmount(i)}
                          placeholder="0.00"
                          onFocus={(e) => { setActiveLine(i); e.target.select() }}
                          onChange={(e) => {
                            const v = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
                            if (!multi && paymentMethod !== 'cash' && (parseFloat(v) || 0) > remainingAfterCredit) return setLineAmount(i, remainingAfterCredit.toFixed(2))
                            setLineAmount(i, v)
                          }}
                          autoFocus={i === activeLine}
                          className="flex-1 min-w-0 bg-transparent text-right text-2xl font-bold tabular-nums tracking-wide outline-none px-2 py-1"
                        />
                        {multi && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); setLineAmount(i, restFor(i).toFixed(2)); setActiveLine(i) }}
                            className="px-2 py-1.5 rounded-lg text-xs font-bold theme-btn-subtle border shrink-0" title="Fill with what is still owed">
                            Rest
                          </button>
                        )}
                        {i > 0 && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); removeLine(i) }} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 shrink-0" aria-label="Remove this payment">
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    )
                  })}

                  {/* Add another way to pay */}
                  {setExtraTenders && !hirePurchase && paymentMethod !== 'gift_card' && splitChoices.some((m) => m !== paymentMethod) && (
                    adding ? (
                      <div className="rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-2">
                        <p className="text-xs text-gray-500 mb-1.5 px-1">Add a payment</p>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                          {splitChoices.map((m) => {
                            const meta = PAYMENT_METHOD_META[m] || { icon: Banknote, label: m }
                            const Icon = meta.icon
                            const noCustomer = m === 'credit' && !selectedCustomer
                            return (
                              <button key={m} type="button" disabled={noCustomer} title={noCustomer ? 'Pick a customer to leave part on credit' : undefined}
                                onClick={() => addLine(m)}
                                className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 text-sm font-semibold disabled:opacity-40">
                                <Icon size={16} className="theme-text-primary" /> {meta.label}
                              </button>
                            )
                          })}
                        </div>
                        <button type="button" onClick={() => setAdding(false)} className="mt-1.5 text-xs text-gray-500 hover:underline px-1">Cancel</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setAdding(true)}
                        className="w-full py-2.5 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 flex items-center justify-center gap-1.5">
                        <Plus size={16} /> Add payment (split: cash + card + cheque + credit…)
                      </button>
                    )
                  )}

                  {/* Banknotes for the cash line */}
                  {activeIsCash && quickAmounts.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {quickAmounts.map((qa, k) => (
                        <button key={k} type="button" onClick={() => setLineAmount(activeLine, qa.value.toFixed(2))}
                          className={`flex-1 min-w-[72px] py-2.5 px-2 rounded-xl text-sm font-bold border shadow-sm transition-colors ${k === 0 ? 'theme-btn-subtle' : 'bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border-gray-300 dark:border-gray-600'}`}>
                          {k === 0 ? `Exact ${money(qa.value)}` : qa.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {splitError && <p className="text-sm font-semibold text-red-600 dark:text-red-400" role="alert">{splitError}</p>}
                  {creditLineWithoutCustomer && <p className="text-sm font-semibold text-red-600 dark:text-red-400" role="alert">Pick a customer to leave part of the bill on credit.</p>}
                </div>
              )}

          {/* Hire purchase / installment */}
          {!isReturnMode && setHirePurchase && (
            <div className={`rounded-2xl border-2 p-4 space-y-2 ${hirePurchase ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30' : 'border-gray-200 dark:border-gray-700'}`}>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={hirePurchase} onChange={toggleHirePurchase} className="w-4 h-4" />
                <CalendarClock size={20} className="text-amber-600 dark:text-amber-400" />
                <span className="font-semibold text-gray-800 dark:text-gray-100">Hire purchase / Installment</span>
              </label>
              {hirePurchase && (
                <div className="text-xs text-amber-900 dark:text-amber-200 space-y-1 pl-7">
                  <p>Enter the <b>down payment</b> below. The rest stays on the customer&apos;s account and the installment plan form opens next.</p>
                  {selectedCustomer ? (
                    <p>Customer: <b>{selectedCustomer.name}</b>{selectedCustomer.phone ? ` (${selectedCustomer.phone})` : ''}</p>
                  ) : (
                    <p className="text-red-600 dark:text-red-400 font-semibold">A customer is required — Complete opens the customer picker.</p>
                  )}
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
                The cheque line is the cheque amount; no change is given on a cheque.
              </p>
            </div>
          )}
          {/* Gift Card Lookup */}
          {!isReturnMode && !multi && paymentMethod === 'gift_card' && (
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
          {/* Credit sale notice */}
          {!isReturnMode && !multi && paymentMethod === 'credit' && (
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
            </div>

            {/* Number pad (optional) */}
            {showPad && (
              <div className="border-t md:border-t-0 md:border-l border-gray-100 dark:border-gray-800 p-4 bg-gray-50 dark:bg-gray-950/40">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                  Typing into: <span className="theme-text-primary">{PAYMENT_METHOD_META[lineMethod(activeLine)]?.label || lineMethod(activeLine)}</span>
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'].map((k) => (
                    <button key={k} type="button" onClick={() => pressKey(k)}
                      className="h-14 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 active:scale-95 border border-gray-200 dark:border-gray-700 rounded-2xl text-2xl font-bold shadow-sm select-none transition-transform">
                      {k}
                    </button>
                  ))}
                  <button type="button" onClick={() => pressKey('C')} className="col-span-3 h-11 rounded-2xl text-sm font-bold border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700">
                    Clear
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-4 bg-gray-50 dark:bg-gray-950/60 border-t border-gray-100 dark:border-gray-800 flex gap-3">
          <button onClick={onClose} disabled={processing}
            className="flex-1 py-3.5 border-2 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-semibold hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            Cancel
          </button>
          <button onClick={onCompleteSale} disabled={completeDisabled}
            className={`flex-[2] py-3.5 text-white rounded-xl font-bold text-base shadow-lg transition-all disabled:opacity-50 ${
              isReturnMode ? 'bg-gradient-to-r from-red-600 to-red-500' : balanceDue > 0 && !hirePurchase ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'theme-btn-primary'
            }`}>
            {processing ? (
              <span className="flex items-center justify-center gap-2"><Loader2 className="animate-spin" size={20} /> Processing...</span>
            ) : isReturnMode ? 'Process Refund'
              : hirePurchase ? 'Complete & set up plan'
              : balanceDue > 0 ? `Complete (balance ${money(balanceDue)}) — Enter`
              : change > 0 ? `Complete · Change ${money(change)} — Enter`
              : 'Complete Sale — Enter'}
          </button>
        </div>
      </div>
    </div>
  )
}
