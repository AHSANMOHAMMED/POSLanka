import React, { useState, useMemo, useEffect, useRef } from 'react'
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  Switch,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { THEME, formatLKR } from '../lib/theme'
import { apiGet, apiPost, isNetworkError } from '../lib/api'
import { enqueueSale, isQueueablePayload } from '../lib/offlineQueue'
import { adjustLocalStock, nextOfflineRef } from '../lib/localdb'
import { calculateCartTax, roundCurrency, type TaxConfig } from '../lib/tax'
import { cartPayable, cartSubtotal, lineTotal } from '../lib/cartMath'
import { taxableLineTotals } from '../lib/cartPricing'
import { allowedTenders, TENDER_METHOD, type TenderOption as TenderOptionT } from '../lib/tenderRules'
import { settleTenders } from '../lib/tenders'
import { lineBaseQty } from '../lib/measureUnits'
import * as SecureStore from 'expo-secure-store'
import { shiftCounterName, shiftWarehouseName, type Shift } from '../lib/shift'
import { getPrinterSettings, isPrintingEnabled, TRANSPORT_LABELS, type PrinterSettings } from '../lib/printer'
import { receiptFromSale, type BusinessInfo } from '../lib/receipt'
import type { ReceiptInput } from '../lib/escpos'
import type { CartLine } from './CartDrawerModal'
import { CustomerPickerModal, type Customer } from './CustomerPickerModal'
import { SupervisorPinModal, type SupervisorApprovalRequest } from './SupervisorPinModal'
import { PrescriptionSheet, type PrescriptionInput, type PrescriptionRequest } from './PrescriptionSheet'
import { useHeaderPad } from '../lib/safeArea'
import { useFeatureFlags } from '../lib/features'

export interface SaleResultData {
  invoiceNo: string
  total: number
  change: number
  tenderMethod: string
  queued?: boolean
  isReturn?: boolean
  /** Printable receipt document (built from the POST /api/sales response). */
  receipt?: ReceiptInput | null
  /** Cashier's choice on the tender screen; falls back to the printer setting. */
  autoPrint?: boolean
  /** Server sale id (online sales only) — lets the receipt screen send the bill by SMS / WhatsApp */
  saleId?: string | null
  /** The sale's customer number, offered as the default recipient */
  customerPhone?: string | null
}

interface TenderModalProps {
  visible: boolean
  onClose: () => void
  cart: CartLine[]
  shift: Shift
  customer: Customer | null
  /** Idempotency key for this cart; generated once per cart by the POS screen. */
  clientSaleId: string
  taxConfig: TaxConfig
  online: boolean
  /** Business block for the printed receipt (GET /api/tenant). */
  business?: BusinessInfo | null
  cashierName?: string | null
  onSaleComplete: (saleData: SaleResultData) => void
  /** H5: cart-level promotion discount of the current quote (line promotions are on the lines) */
  cartPromotionDiscount?: number
  /** H5: coupon codes entered in the cart */
  couponCodes?: string[]
  /** H5: the server re-priced the cart (409 PRICE_CHANGED): the POS shows the new prices */
  onPriceChanged?: (quote: unknown) => void
  /** Customer picked on this screen (for a credit line); the POS keeps it on the cart */
  onCustomerChange?: (customer: Customer) => void
}

/** UI tender options mapped onto the server's payment method enum. */
type TenderOption = TenderOptionT

const TENDER_LABELS: Record<TenderOption, string> = {
  cash: 'CASH',
  card: 'CARD',
  lankaqr: 'LANKAQR',
  credit: 'CREDIT',
  cheque: 'CHEQUE',
}

const METHOD_INFO: Record<TenderOption, { emoji: string; title: string; sub: string }> = {
  cash: { emoji: '💵', title: 'Cash', sub: 'Notes & coins' },
  card: { emoji: '💳', title: 'Card', sub: 'Visa / Master / LankaPay' },
  lankaqr: { emoji: '📱', title: 'LankaQR / Transfer', sub: 'Bank transfer with reference' },
  cheque: { emoji: '🏦', title: 'Cheque', sub: 'Number, bank and date' },
  credit: { emoji: '🧾', title: 'Credit', sub: 'On the customer account' },
}
const METHOD_ORDER: TenderOption[] = ['cash', 'card', 'lankaqr', 'cheque', 'credit']

/** One payment line on the bill (several lines = split payment) */
interface PayLine { key: number; method: TenderOption; amount: string }

/** Remembered on this phone: the on-screen number pad is shown */
const NUMPAD_KEY = 'pos_numpad_on'

/** Sri Lankan banks offered as quick picks for a cheque (any name can be typed). */
const CHEQUE_BANKS = ['Bank of Ceylon', "People's Bank", 'Commercial Bank', 'Hatton National Bank', 'Sampath Bank', 'Seylan Bank', 'NDB Bank', 'DFCC Bank', 'Nations Trust Bank', 'Pan Asia Bank', 'Union Bank', 'National Savings Bank', 'Cargills Bank', 'Amana Bank']

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface SaleResponse {
  id: string
  invoiceNo: string
  total: string | number
  subtotal?: string | number
  discountAmount?: string | number
  taxAmount?: string | number
  paidAmount?: string | number
  createdAt?: string
  items?: Array<{ itemName: string; quantity: string | number; unitPrice: string | number; total?: string | number }>
  payments?: Array<{ method: string; amount: string | number; reference?: string | null }>
}

export function TenderModal({
  visible,
  onClose,
  cart,
  shift,
  customer,
  clientSaleId,
  taxConfig,
  online,
  business,
  cashierName,
  onSaleComplete,
  cartPromotionDiscount = 0,
  couponCodes,
  onPriceChanged,
  onCustomerChange,
}: TenderModalProps) {
  const headerPad = useHeaderPad()
  // Σ of rounded line totals — what POST /api/sales checks the subtotal against.
  const subtotal = useMemo(() => cartSubtotal(cart), [cart])
  // tax is charged on what the customer pays: lines net of their share of the cart promotions
  const taxResult = useMemo(() => {
    const taxable = taxableLineTotals(cart.map((l) => lineTotal(l)), cartPromotionDiscount)
    return calculateCartTax(
      cart.map((l, i) => ({ lineTotal: taxable[i], taxTemplateId: l.taxTemplateId })),
      taxConfig,
      customer?.taxExempt === true
    )
  }, [cart, taxConfig, customer, cartPromotionDiscount])
  const tax = taxResult.tax
  // subtotal + exclusive tax: a cart mixing inclusive and exclusive templates still pays the
  // exclusive part (inclusive tax is already inside the prices).
  const grossPayable = cartPayable(roundCurrency(subtotal - cartPromotionDiscount), taxResult)

  // Loyalty program (conversion factor + tier redeem rate), same maths as the web POS
  type LoyaltyProgram = { conversionFactor?: string | number | null; tiers?: { tier: string; redeemRate?: string | number | null; isActive?: boolean }[] }
  const [loyaltyProgram, setLoyaltyProgram] = useState<LoyaltyProgram | null>(null)
  const [loyaltyPoints, setLoyaltyPoints] = useState('')
  const loyaltyPts = Math.max(0, Math.floor(parseFloat(loyaltyPoints) || 0))
  const availablePoints = customer?.loyaltyPoints ?? null
  const loyaltyRedeemValue = useMemo(() => {
    if (!customer || loyaltyPts <= 0 || !loyaltyProgram) return 0
    const factor = Number(loyaltyProgram.conversionFactor) || 0
    const tier = loyaltyProgram.tiers?.find((t) => t.tier === (customer.loyaltyTier || 'bronze') && t.isActive !== false)
    const rate = tier && tier.redeemRate != null ? Number(tier.redeemRate) || 1 : 1
    return Math.min(grossPayable, roundCurrency(loyaltyPts * factor * rate))
  }, [customer, loyaltyPts, loyaltyProgram, grossPayable])
  const netPayable = roundCurrency(Math.max(0, grossPayable - loyaltyRedeemValue))

  // Payment lines: one line = a plain cash / card / … sale; more lines = split payment
  const [lines, setLines] = useState<PayLine[]>([{ key: 0, method: 'cash', amount: '' }])
  const [activeLine, setActiveLine] = useState(0)
  const lineKey = useRef(1)
  const [reference, setReference] = useState('')
  // K1: the cheque taken (number, bank, branch, date; post-dated allowed)
  const [cheque, setCheque] = useState({ chequeNo: '', bankName: '', branchName: '', chequeDate: localToday() })
  const [autoPrint, setAutoPrint] = useState(false)
  const [printer, setPrinter] = useState<PrinterSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [numpadOn, setNumpadOn] = useState(false)
  const [pickCustomer, setPickCustomer] = useState(false)
  // H1: supervisor approvals for this cart (credit limit override, …), sent with the sale
  const approvalTokensRef = useRef<string[]>([])
  // Feature switches set by the platform (credit sales, loyalty …)
  const features = useFeatureFlags()
  const [approvalRequest, setApprovalRequest] = useState<SupervisorApprovalRequest | null>(null)
  // Pharmacy: prescription for prescription / controlled medicines (asked for when the server says so)
  const prescriptionRef = useRef<PrescriptionInput | null>(null)
  const [rxRequest, setRxRequest] = useState<PrescriptionRequest | null>(null)

  useEffect(() => {
    SecureStore.getItemAsync(NUMPAD_KEY).then((v) => setNumpadOn(v === '1')).catch(() => undefined)
  }, [])
  function toggleNumpad() {
    const next = !numpadOn
    setNumpadOn(next)
    SecureStore.setItemAsync(NUMPAD_KEY, next ? '1' : '0').catch(() => undefined)
  }

  // Reset the form each time the modal opens for a (possibly new) cart.
  useEffect(() => {
    if (visible) {
      approvalTokensRef.current = []
      setApprovalRequest(null)
      prescriptionRef.current = null
      setRxRequest(null)
      setLines([{ key: 0, method: 'cash', amount: netPayable.toFixed(2) }])
      setActiveLine(0)
      setReference('')
      setCheque({ chequeNo: '', bankName: '', branchName: '', chequeDate: localToday() })
      setLoyaltyPoints('')
      setBusy(false)
      getPrinterSettings().then((s) => {
        setPrinter(s)
        setAutoPrint(isPrintingEnabled(s) && s.autoPrint)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, clientSaleId])

  useEffect(() => {
    if (!visible || !customer?.id || !features.has('loyalty')) { setLoyaltyProgram(null); return }
    let cancelled = false
    apiGet<LoyaltyProgram | null>('/api/loyalty-programs').then((res) => {
      if (!cancelled) setLoyaltyProgram(res.ok && res.data ? res.data : null)
    })
    return () => { cancelled = true }
  }, [visible, customer?.id, features.flags?.loyalty]) // eslint-disable-line react-hooks/exhaustive-deps

  // One payment line follows the payable amount when loyalty redemption changes it
  useEffect(() => {
    if (visible) setLines((ls) => (ls.length === 1 ? [{ ...ls[0], amount: netPayable.toFixed(2) }] : ls))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [netPayable])

  const presets = useMemo(() => {
    const exact = netPayable
    const roundNext50 = Math.ceil(netPayable / 50) * 50
    const roundNext100 = Math.ceil(netPayable / 100) * 100
    const next1000 = Math.ceil(netPayable / 1000) * 1000
    const next5000 = Math.ceil(netPayable / 5000) * 5000 || 5000
    return [
      { label: 'Exact', value: exact },
      { label: roundNext50 > exact ? `+${(roundNext50 - exact).toFixed(2)}` : 'Round', value: roundNext50 > exact ? roundNext50 : roundNext100 },
      { label: '1,000s', value: next1000 > exact ? next1000 : next1000 + 1000 },
      { label: '5,000s', value: next5000 >= exact ? next5000 : 5000 },
    ]
  }, [netPayable])

  const settled = settleTenders(netPayable, lines.map((l) => ({ method: TENDER_METHOD[l.method], amount: parseFloat(l.amount) || 0 })))
  const single = lines.length === 1 ? lines[0] : null
  const tender: TenderOption = lines[0]?.method || 'cash'
  const has = (m: TenderOption) => lines.some((l) => l.method === m && (parseFloat(l.amount) || 0) > 0)
  const changeDue = settled.change
  const chequeDateValid = /^\d{4}-\d{2}-\d{2}$/.test(cheque.chequeDate) && !Number.isNaN(Date.parse(`${cheque.chequeDate}T00:00:00Z`))
  const chequeComplete = !!cheque.chequeNo.trim() && !!cheque.bankName.trim() && chequeDateValid
  const chequeDays = chequeDateValid
    ? Math.round((Date.parse(`${cheque.chequeDate}T00:00:00Z`) - Date.parse(`${localToday()}T00:00:00Z`)) / 86400000)
    : 0
  const chequeSplit = settled.splits.find((sp) => sp.method === 'cheque')
  const isTenderSufficient = !settled.error && settled.balance <= 0.009 && (!has('cheque') || chequeComplete) && (!has('credit') || !!customer)
  const tenders = allowedTenders(shift.posProfile)
  /** Why a method cannot be used here (null = usable) */
  function blockedReason(m: TenderOption): string | null {
    if (m === 'credit') {
      if (!features.has('credit_customer')) return 'Credit sales are switched off for this business (super admin → vendor → Features).'
      if (shift.posProfile?.allowCreditSale === false) return `Credit sales are off on the counter "${shiftCounterName(shift) || 'this counter'}". The owner can allow them on the web: Settings → POS Profiles → the counter → Allow credit sale.`
      return null
    }
    if (m === 'cheque' && !features.has('cheques')) return 'Cheques are switched off for this business.'
    if (!tenders.has(m)) {
      const name = METHOD_INFO[m].title
      return `${name} is not switched on for the counter "${shiftCounterName(shift) || 'this counter'}".\n\nThe owner can switch it on in the web app: Settings → POS Profiles → open the counter → Payment methods → tick ${name} → Save. Then close and open the shift again on this phone.`
    }
    return null
  }
  const visibleMethods = METHOD_ORDER.filter((m) => (m !== 'cheque' || features.has('cheques')) && (m !== 'credit' || features.has('credit_customer')))
  const usableMethods = visibleMethods.filter((m) => !blockedReason(m))

  function setLine(i: number, patch: Partial<PayLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  /** What is still owed without line i (for "Rest") */
  function restFor(i: number): number {
    const others = lines.reduce((sum, l, idx) => (idx === i ? sum : sum + (parseFloat(l.amount) || 0)), 0)
    return roundCurrency(Math.max(0, netPayable - others))
  }
  function chooseSingle(m: TenderOption) {
    const why = blockedReason(m)
    if (why) {
      Alert.alert(`${METHOD_INFO[m].title} not available`, why)
      return
    }
    if (m === 'credit' && !customer) {
      Alert.alert('Customer needed', 'A credit sale is billed to a customer. Pick the customer now?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Pick customer', onPress: () => setPickCustomer(true) },
      ])
    }
    setLines([{ key: lines[0]?.key ?? 0, method: m, amount: netPayable.toFixed(2) }])
    setActiveLine(0)
  }
  function addLine() {
    const used = new Set(lines.map((l) => l.method))
    const next = usableMethods.find((m) => !used.has(m)) || usableMethods.find((m) => m !== 'cheque' || !used.has('cheque'))
    if (!next) {
      Alert.alert('No other payment method', 'Only cash is switched on for this counter. The owner can add card, credit or cheque on the web: Settings → POS Profiles.')
      return
    }
    // The first line keeps what was typed; the new line takes what is still owed
    const rest = roundCurrency(Math.max(0, netPayable - lines.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0)))
    setLines((ls) => [...ls, { key: lineKey.current++, method: next, amount: rest > 0 ? rest.toFixed(2) : '' }])
    setActiveLine(lines.length)
  }
  function removeLine(i: number) {
    setLines((ls) => ls.filter((_, idx) => idx !== i))
    setActiveLine(0)
  }
  function changeLineMethod(i: number, m: TenderOption) {
    const why = blockedReason(m)
    if (why) {
      Alert.alert(`${METHOD_INFO[m].title} not available`, why)
      return
    }
    if (m === 'cheque' && lines.some((l, idx) => idx !== i && l.method === 'cheque')) {
      Alert.alert('One cheque per bill', 'This bill already has a cheque line.')
      return
    }
    if (m === 'credit' && !customer) setPickCustomer(true)
    setLine(i, { method: m })
  }
  /** On-screen number pad: types into the active line */
  function padPress(k: string) {
    const i = Math.min(activeLine, lines.length - 1)
    const cur = lines[i]?.amount || ''
    let next = cur
    if (k === 'C') next = ''
    else if (k === '⌫') next = cur.slice(0, -1)
    else if (k === '.') next = cur.includes('.') ? cur : (cur || '0') + '.'
    else {
      const dot = cur.indexOf('.')
      if (dot >= 0 && cur.length - dot > 2) return
      next = cur === '0' ? k : cur + k
    }
    setLine(i, { amount: next })
  }

  if (!visible) return null

  function buildPayload(): Record<string, unknown> {
    const cartItems = cart.map((c, idx) => ({
      itemId: c.itemId || c.id,
      name: c.name,
      sku: c.sku || undefined,
      quantity: c.quantity,
      unitPrice: roundCurrency(Number(c.sellingPrice)),
      discount: 0,
      // H5: unit sold and fixed prices (the server adds the promotions itself)
      uom: c.uom || undefined,
      priceLocked: c.priceLocked || undefined,
      barcode: c.priceBarcode || undefined,
      taxRate: taxResult.perLine[idx]?.effectiveRate || undefined,
      taxAmount: taxResult.perLine[idx]?.totalTax || undefined,
      taxBreakdown: taxResult.perLine[idx]?.breakdown?.length ? taxResult.perLine[idx].breakdown : undefined,
      taxTemplateId: c.taxTemplateId || undefined,
    }))

    let paymentMethod = TENDER_METHOD[tender]
    let amountPaid: number
    const creditAmount = 0
    let paymentSplits: Array<{ method: string; amount: number; reference?: string }> | undefined

    if (!single) {
      // Split payment: exact amounts per method (cash over the rest is change, taken off the cash)
      paymentSplits = settled.splits.map((sp) => (sp.method === 'bank_transfer' && reference.trim() ? { ...sp, reference: reference.trim() } : sp))
      paymentMethod = paymentSplits[0]?.method || paymentMethod
      amountPaid = roundCurrency(settled.received + settled.onAccount)
    } else {
      switch (tender) {
        case 'cash':
          amountPaid = roundCurrency(parseFloat(single.amount) || 0)
          break
        case 'lankaqr':
          // LankaQR settles to the bank account -> bank_transfer with the QR reference.
          amountPaid = netPayable
          paymentSplits = [{ method: 'bank_transfer', amount: netPayable, reference: reference.trim() || undefined }]
          break
        case 'credit':
          // Sell on customer credit: nothing received now.
          amountPaid = 0
          break
        default:
          // Card / cheque cover the bill (no change); the server registers a cheque in Cheques
          amountPaid = netPayable
      }
    }

    return {
      clientSaleId,
      cartItems,
      paymentMethod,
      paymentSplits,
      subtotal,
      discount: 0,
      tax,
      // Always sent (W6): the server then validates the device's template maths instead of
      // recomputing, and an offline sale computed from cached templates is never rejected for rounding.
      taxBreakdown: taxResult.breakdown,
      total: netPayable,
      amountPaid,
      creditAmount,
      addOverpaymentToCredit: false,
      customerId: customer?.id || undefined,
      customerName: customer?.name || undefined,
      warehouseId: shift.warehouseId,
      posOpeningEntryId: shift.id,
      loyaltyPointsRedeemed: customer && loyaltyPts > 0 && loyaltyRedeemValue > 0 ? loyaltyPts : undefined,
      approvalTokens: approvalTokensRef.current.length > 0 ? [...approvalTokensRef.current] : undefined,
      // H5: cart promotions are not part of `discount`; the device time prices an offline sale
      promotionDiscount: cartPromotionDiscount > 0 ? cartPromotionDiscount : undefined,
      couponCodes: couponCodes && couponCodes.length ? couponCodes : undefined,
      prescription: prescriptionRef.current || undefined,
      cheque: (single ? tender === 'cheque' : !!chequeSplit)
        ? {
            chequeNo: cheque.chequeNo.trim(),
            bankName: cheque.bankName.trim(),
            branchName: cheque.branchName.trim() || undefined,
            chequeDate: cheque.chequeDate,
            amount: single ? netPayable : chequeSplit?.amount ?? 0,
            partyName: customer?.name || undefined,
          }
        : undefined,
      soldAt: new Date().toISOString(),
    }
  }

  async function handleCompleteSale() {
    if (settled.error) {
      Alert.alert('Check the payments', settled.error)
      return
    }
    if (has('credit') && !customer) {
      Alert.alert('Customer Required', 'Pick the customer the credit is billed to.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Pick customer', onPress: () => setPickCustomer(true) },
      ])
      return
    }
    if (settled.balance > 0.009) {
      Alert.alert('Not fully paid', `${formatLKR(settled.balance)} is still owed. Add it to a payment line (tap "Rest"), or add another payment.`)
      return
    }
    if (has('cheque') && !chequeComplete) {
      Alert.alert('Cheque Details', 'Enter the cheque number, bank and date (YYYY-MM-DD).')
      return
    }
    if (loyaltyPts > 0 && !customer) {
      Alert.alert('Customer Required', 'Link a customer to redeem loyalty points.')
      return
    }
    if (loyaltyPts > 0 && availablePoints != null && loyaltyPts > availablePoints) {
      Alert.alert('Not Enough Points', `${customer?.name} has ${availablePoints} points available.`)
      return
    }

    const payload = buildPayload()
    const tenderMethod = single ? TENDER_LABELS[tender] : Array.from(new Set(lines.filter((l) => (parseFloat(l.amount) || 0) > 0).map((l) => TENDER_LABELS[l.method]))).join(' + ')
    const change = Math.max(0, changeDue)

    setBusy(true)
    try {
      const businessInfo: BusinessInfo = business || { name: 'skyERPOS' }
      const splits = payload.paymentSplits as Array<{ method: string; amount: number; reference?: string }> | undefined
      const fallbackPayment = splits?.[0] || { method: String(payload.paymentMethod), amount: Number(payload.amountPaid) || netPayable }
      // local stock is in base units (a box line holds quantity × factor pieces)
      const stockLines = cart.map((c) => ({ itemId: c.itemId || c.id, quantity: lineBaseQty(c) }))
      // Buyer particulars for TAX INVOICE printing (name, TIN / VAT number, address when known)
      const buyer = customer
        ? {
            name: customer.name,
            taxId: customer.taxId ?? null,
            address: customer.address || [customer.addressLine1, customer.city].filter(Boolean).join(', ') || null,
          }
        : null

      // Saves the sale on the device with an OFF-<device>-<seq> receipt number (W6).
      const completeOffline = async () => {
        if (!isQueueablePayload(payload)) {
          Alert.alert(
            'No Connection',
            'Credit, gift card and loyalty sales cannot be saved offline. Reconnect and try again, or take cash / card only.'
          )
          return
        }
        const offlineRef = await nextOfflineRef()
        payload.offlineRef = offlineRef
        await enqueueSale(payload)
        adjustLocalStock(stockLines).catch(() => undefined)
        const receipt = receiptFromSale(
          {
            invoiceNo: offlineRef,
            total: netPayable,
            payments: splits?.length ? splits : undefined,
            subtotal,
            taxAmount: tax,
            createdAt: new Date().toISOString(),
            taxBreakdown: taxResult.breakdown.length ? taxResult.breakdown.map((b) => ({ taxName: b.taxName, amount: b.amount })) : null,
            items: cart.map((c) => ({ itemName: c.name, quantity: c.quantity, unitPrice: Number(c.sellingPrice), total: lineTotal(c), unit: c.unit, uom: c.uom, uomFactor: c.uomFactor, baseUnit: c.unit })),
          },
          { business: businessInfo, shift, cashier: cashierName, customerName: customer?.name, customer: buyer, change, fallbackPayment }
        )
        onSaleComplete({
          invoiceNo: offlineRef,
          total: netPayable,
          change,
          tenderMethod,
          queued: true,
          receipt,
          autoPrint,
        })
      }

      // Known to be offline (power cut / no internet): don't wait for a network timeout.
      if (!online) {
        await completeOffline()
        return
      }

      const res = await apiPost<SaleResponse>('/api/sales', payload)

      if (res.ok) {
        adjustLocalStock(stockLines).catch(() => undefined)
        const sale = res.data || ({} as SaleResponse)
        const receipt = receiptFromSale(
          {
            ...sale,
            invoiceNo: sale.invoiceNo || 'Sale recorded',
            total: sale.total ?? netPayable,
            subtotal: sale.subtotal ?? subtotal,
            taxAmount: sale.taxAmount ?? tax,
            createdAt: sale.createdAt || new Date().toISOString(),
            taxBreakdown: taxResult.breakdown.length ? taxResult.breakdown.map((b) => ({ taxName: b.taxName, amount: b.amount })) : null,
            items: sale.items?.length
              ? sale.items
              : cart.map((c) => ({ itemName: c.name, quantity: c.quantity, unitPrice: Number(c.sellingPrice), total: lineTotal(c), unit: c.unit })),
          },
          { business: businessInfo, shift, cashier: cashierName, customerName: customer?.name, customer: buyer, change, fallbackPayment }
        )
        onSaleComplete({
          invoiceNo: sale.invoiceNo || 'Sale recorded',
          total: Number(sale.total ?? netPayable) || netPayable,
          change,
          tenderMethod,
          receipt,
          autoPrint,
          saleId: sale.id || null,
          customerPhone: customer?.phone || null,
        })
        return
      }

      if (isNetworkError(res)) {
        // The request may or may not have reached the server; the queue replays it with the same
        // clientSaleId, so the server returns the original sale if it was recorded after all.
        await completeOffline()
        return
      }

      const body = res.data as unknown as { code?: string; scopes?: string[]; quote?: unknown; level?: 'prescription' | 'controlled'; items?: Array<{ id: string; name: string }> } | null
      if (res.status === 400 && body?.code === 'PRESCRIPTION_REQUIRED' && body.level) {
        setRxRequest({ level: body.level, items: body.items || [], message: res.error })
        return
      }
      if (res.status === 409 && body?.code === 'PRICE_CHANGED' && body.quote && onPriceChanged) {
        onPriceChanged(body.quote)
        Alert.alert('Prices Changed', 'Prices or promotions changed. Review the cart and take payment again.')
        return
      }
      if (res.status === 403 && body?.code === 'APPROVAL_REQUIRED') {
        // Over the credit limit / counter limits: a supervisor approves on this device, then retry
        setApprovalRequest({ scopes: body.scopes || [], message: res.error, amount: netPayable, posOpeningEntryId: shift.id })
        return
      }
      Alert.alert('Checkout Failed', res.error)
    } finally {
      setBusy(false)
    }
  }

  const cashLineIdx = lines.findIndex((l) => l.method === 'cash')
  const paidShown = roundCurrency(lines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0))

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={[styles.header, headerPad]}>
          <Pressable style={styles.backBtn} onPress={onClose} disabled={busy} accessibilityLabel="Back to the cart">
            <Text style={styles.backBtnText}>←</Text>
          </Pressable>
          <View style={styles.headerTitleCol}>
            <Text style={styles.headerTitle}>Payment</Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {shiftWarehouseName(shift) || 'Branch'} ▸ {shiftCounterName(shift) || 'Counter'}
            </Text>
          </View>
          <Pressable style={[styles.padToggle, numpadOn && styles.padToggleOn]} onPress={toggleNumpad} accessibilityRole="switch" accessibilityState={{ checked: numpadOn }}>
            <Text style={[styles.padToggleText, numpadOn && { color: '#FFF' }]}>🔢 Pad</Text>
          </Pressable>
          <View style={[styles.liveIndicator, !online && styles.liveIndicatorOffline]}>
            <View style={[styles.pulsingDot, !online && { backgroundColor: THEME.colors.error }]} />
            <Text style={[styles.liveText, !online && { color: THEME.colors.error }]}>{online ? 'Ready' : 'Offline'}</Text>
          </View>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {/* Total / Paid / Balance (or Change) */}
          <View style={styles.heroBox}>
            <View style={styles.heroTiles}>
              <View style={styles.heroTile}>
                <Text style={styles.heroTileLabel}>Total</Text>
                <Text style={styles.heroTileValue} numberOfLines={1} adjustsFontSizeToFit>{formatLKR(netPayable)}</Text>
              </View>
              <View style={styles.heroTile}>
                <Text style={styles.heroTileLabel}>Paid</Text>
                <Text style={styles.heroTileValue} numberOfLines={1} adjustsFontSizeToFit>{formatLKR(paidShown)}</Text>
              </View>
              <View style={[styles.heroTile, settled.change > 0 ? styles.heroTileOk : settled.balance > 0.009 ? styles.heroTileWarn : styles.heroTileOk]}>
                <Text style={styles.heroTileLabel}>{settled.change > 0 ? 'Change' : 'Balance'}</Text>
                <Text style={styles.heroTileValue} numberOfLines={1} adjustsFontSizeToFit>{formatLKR(settled.change > 0 ? settled.change : settled.balance)}</Text>
              </View>
            </View>
            <View style={styles.heroMetaRow}>
              <Text style={styles.heroMetaText}>
                Subtotal {formatLKR(subtotal)}
                {tax > 0 ? ` • Tax ${formatLKR(tax)}${taxResult.hasInclusiveTax ? ' (incl.)' : ''}` : taxConfig.unavailable ? ' • Tax per server' : ' • No tax'}
              </Text>
              <Text style={styles.heroItemCountBadge}>{cart.reduce((c, i) => c + i.quantity, 0)} Items</Text>
            </View>
            <Pressable style={styles.customerRow} onPress={() => setPickCustomer(true)} accessibilityRole="button">
              <Text style={styles.heroCustomer} numberOfLines={1}>👤 {customer ? `${customer.name}${customer.phone ? ` · ${customer.phone}` : ''}` : 'Walk-in customer'}</Text>
              <Text style={styles.customerChange}>{customer ? 'Change' : 'Add customer'}</Text>
            </Pressable>
          </View>

          {!online && (
            <View style={styles.offlineBanner}>
              <Text style={styles.offlineBannerText}>
                No connection. Cash, card, LankaQR and cheque sales are saved on this device and synced automatically. Credit needs a connection.
              </Text>
            </View>
          )}

          {/* One payment: method tiles */}
          {single ? (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Pay by</Text>
                <Text style={styles.sectionHint}>Tap a method</Text>
              </View>
              <View style={styles.methodGrid}>
                {visibleMethods.map((m) => {
                  const active = single.method === m
                  const why = blockedReason(m)
                  const info = METHOD_INFO[m]
                  const sub = why ? 'Off on this counter · tap for help' : m === 'credit' ? (customer ? `Bill to ${customer.name}` : 'Pick a customer') : info.sub
                  return (
                    <Pressable key={m} style={[styles.methodCard, active && styles.methodCardActive, !!why && styles.methodCardDisabled]} onPress={() => chooseSingle(m)} accessibilityRole="button" accessibilityState={{ selected: active, disabled: !!why }}>
                      <View style={styles.methodIconRow}>
                        <Text style={styles.methodEmoji}>{info.emoji}</Text>
                        {active && (
                          <View style={styles.checkCircle}>
                            <Text style={styles.checkText}>✓</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.methodTitle, active && { color: THEME.colors.primary }]}>{info.title}</Text>
                      <Text style={styles.methodSub} numberOfLines={2}>{sub}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          ) : null}

          {/* Amount(s): one line, or one row per payment (split) */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>{single ? (single.method === 'cash' ? 'Cash received' : 'Amount') : 'Payments on this bill'}</Text>
              {single?.method === 'cash' ? (
                <Pressable onPress={() => setLine(0, { amount: '' })}>
                  <Text style={styles.clearText}>Clear</Text>
                </Pressable>
              ) : null}
            </View>

            {lines.map((l, i) => (
              <View key={l.key} style={[styles.lineRow, !single && activeLine === i && styles.lineRowActive]}>
                {!single ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} keyboardShouldPersistTaps="handled">
                    {visibleMethods.map((m) => (
                      <Pressable key={m} style={[styles.lineChip, l.method === m && styles.lineChipActive, !!blockedReason(m) && { opacity: 0.45 }]} onPress={() => changeLineMethod(i, m)}>
                        <Text style={[styles.lineChipText, l.method === m && styles.lineChipTextActive]}>{METHOD_INFO[m].emoji} {METHOD_INFO[m].title}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : null}
                <View style={styles.lineInputRow}>
                  <View style={[styles.tenderInputRow, { flex: 1 }]}>
                    <Text style={styles.tenderCurrencyPrefix}>LKR</Text>
                    <TextInput
                      style={styles.tenderInput}
                      keyboardType="decimal-pad"
                      value={l.amount}
                      onFocus={() => setActiveLine(i)}
                      onChangeText={(v) => setLine(i, { amount: v.replace(/[^0-9.]/g, '') })}
                      placeholder="0.00"
                      showSoftInputOnFocus={!numpadOn}
                    />
                  </View>
                  {!single ? (
                    <>
                      <Pressable style={styles.restBtn} onPress={() => { setLine(i, { amount: restFor(i).toFixed(2) }); setActiveLine(i) }}>
                        <Text style={styles.restBtnText}>Rest</Text>
                      </Pressable>
                      <Pressable style={styles.removeBtn} onPress={() => removeLine(i)} accessibilityLabel="Remove this payment">
                        <Text style={styles.removeBtnText}>✕</Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              </View>
            ))}

            {/* Quick cash notes for the (first) cash line */}
            {cashLineIdx >= 0 ? (
              <View style={[styles.presetsGrid, { marginTop: 10 }]}>
                {presets.map((preset, idx) => {
                  const target = single ? netPayable : restFor(cashLineIdx)
                  const value = idx === 0 ? target : preset.value
                  const isSelected = Math.abs((parseFloat(lines[cashLineIdx].amount) || 0) - value) < 0.01
                  return (
                    <Pressable key={idx} style={[styles.presetCard, isSelected && styles.presetCardActive]} onPress={() => { setLine(cashLineIdx, { amount: value.toFixed(2) }); setActiveLine(cashLineIdx) }}>
                      <Text style={[styles.presetSub, isSelected && styles.presetSubActive]}>{idx === 0 && !single ? 'Rest' : preset.label}</Text>
                      <Text style={[styles.presetVal, isSelected && styles.presetValActive]}>{formatLKR(value).replace('LKR ', '')}</Text>
                    </Pressable>
                  )
                })}
              </View>
            ) : null}

            {numpadOn ? (
              <View style={styles.pad}>
                {['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'].map((k) => (
                  <Pressable key={k} style={({ pressed }) => [styles.padKey, pressed && styles.padKeyPressed]} onPress={() => padPress(k)}>
                    <Text style={styles.padKeyText}>{k}</Text>
                  </Pressable>
                ))}
                <Pressable style={({ pressed }) => [styles.padKey, styles.padKeyWide, pressed && styles.padKeyPressed]} onPress={() => padPress('C')}>
                  <Text style={[styles.padKeyText, { color: THEME.colors.error }]}>Clear</Text>
                </Pressable>
              </View>
            ) : null}

            {settled.error ? <Text style={styles.lineError}>{settled.error}</Text> : null}

            <Pressable style={styles.addPayBtn} onPress={addLine} accessibilityRole="button">
              <Text style={styles.addPayText}>＋ Add payment (split: cash + card + credit …)</Text>
            </Pressable>
          </View>

          {has('lankaqr') && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>LankaQR / Transfer Reference</Text>
              <TextInput
                style={styles.phoneInput}
                placeholder="Transaction reference (optional)"
                placeholderTextColor={THEME.colors.textSubtle}
                value={reference}
                onChangeText={setReference}
                autoCapitalize="characters"
              />
            </View>
          )}

          {has('cheque') && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Cheque Details</Text>
                {chequeDays > 0 ? <Text style={styles.sectionHint}>Post-dated · {chequeDays} day{chequeDays === 1 ? '' : 's'}</Text> : null}
              </View>
              <TextInput
                style={styles.phoneInput}
                placeholder="Cheque number"
                placeholderTextColor={THEME.colors.textSubtle}
                value={cheque.chequeNo}
                onChangeText={(v) => setCheque((c) => ({ ...c, chequeNo: v.replace(/[^0-9A-Za-z-]/g, '').slice(0, 50) }))}
                autoCapitalize="characters"
              />
              <TextInput
                style={styles.phoneInput}
                placeholder="Bank"
                placeholderTextColor={THEME.colors.textSubtle}
                value={cheque.bankName}
                onChangeText={(v) => setCheque((c) => ({ ...c, bankName: v.slice(0, 100) }))}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} keyboardShouldPersistTaps="handled">
                {CHEQUE_BANKS.filter((b) => !cheque.bankName.trim() || b.toLowerCase().includes(cheque.bankName.trim().toLowerCase())).map((b) => (
                  <Pressable key={b} style={[styles.bankChip, cheque.bankName === b && styles.bankChipActive]} onPress={() => setCheque((c) => ({ ...c, bankName: b }))}>
                    <Text style={[styles.bankChipText, cheque.bankName === b && styles.bankChipTextActive]}>{b}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <TextInput
                style={styles.phoneInput}
                placeholder="Branch (optional)"
                placeholderTextColor={THEME.colors.textSubtle}
                value={cheque.branchName}
                onChangeText={(v) => setCheque((c) => ({ ...c, branchName: v.slice(0, 100) }))}
              />
              <TextInput
                style={[styles.phoneInput, !chequeDateValid && { borderColor: THEME.colors.error }]}
                placeholder="Cheque date (YYYY-MM-DD)"
                placeholderTextColor={THEME.colors.textSubtle}
                value={cheque.chequeDate}
                onChangeText={(v) => setCheque((c) => ({ ...c, chequeDate: v.replace(/[^0-9-]/g, '').slice(0, 10) }))}
                keyboardType="numbers-and-punctuation"
              />
              <Text style={styles.toggleSub}>No change is given on a cheque. It appears under Money out & cheques until it is deposited and cleared.</Text>
            </View>
          )}

          {has('credit') && (
            <View style={[styles.section, { backgroundColor: THEME.colors.secondaryLight }]}>
              <Text style={[styles.sectionTitle, { color: THEME.colors.onSecondaryContainer }]}>Credit (on account)</Text>
              {customer ? (
                <Text style={styles.creditText}>
                  {formatLKR(settled.onAccount || (single ? netPayable : 0))} will be added to {customer.name}'s outstanding balance
                  {customer.balance != null ? ` (current ${formatLKR(customer.balance)})` : ''}
                  {customer.creditLimit != null ? `, limit ${formatLKR(customer.creditLimit)}` : ''}.
                </Text>
              ) : (
                <Pressable style={styles.pickCustomerBtn} onPress={() => setPickCustomer(true)}>
                  <Text style={styles.pickCustomerText}>👤 Pick the customer to bill</Text>
                </Pressable>
              )}
            </View>
          )}

          {customer && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>⭐ Redeem Loyalty Points</Text>
                <Text style={styles.sectionHint}>{availablePoints != null ? `${availablePoints} available` : ''}</Text>
              </View>
              <TextInput
                style={styles.phoneInput}
                placeholder="Points to redeem (optional)"
                placeholderTextColor={THEME.colors.textSubtle}
                keyboardType="number-pad"
                value={loyaltyPoints}
                onChangeText={setLoyaltyPoints}
              />
              {loyaltyPts > 0 && (
                <Text style={[styles.toggleSub, { fontWeight: '700', color: loyaltyRedeemValue > 0 ? THEME.colors.primary : THEME.colors.error }]}>
                  {loyaltyRedeemValue > 0
                    ? `Redeems ${formatLKR(loyaltyRedeemValue)} — payable ${formatLKR(netPayable)}`
                    : 'No active loyalty program — points will not be redeemed'}
                </Text>
              )}
              <Text style={styles.toggleSub}>Points are deducted from the customer's balance by the server. Sales that redeem points cannot be saved offline.</Text>
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Text style={styles.toggleTitle}>🖨️ Auto-print Receipt</Text>
                <Text style={styles.toggleSub}>
                  {printer && isPrintingEnabled(printer)
                    ? `${printer.paperWidth}mm ESC/POS via ${TRANSPORT_LABELS[printer.transport]}`
                    : 'No printer set up — open Printer settings from the POS screen'}
                </Text>
              </View>
              <Switch
                value={autoPrint}
                onValueChange={setAutoPrint}
                disabled={!printer || !isPrintingEnabled(printer)}
                trackColor={{ false: THEME.colors.border, true: THEME.colors.primary }}
              />
            </View>
          </View>

          <View style={styles.footer}>
            <Pressable style={[styles.completeBtn, (!isTenderSufficient || busy) && styles.completeBtnDisabled]} onPress={handleCompleteSale} disabled={!isTenderSufficient || busy}>
              {busy ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Text style={styles.completeBtnText}>✓ Complete Sale</Text>
                  <View style={styles.completeBtnPill}>
                    <Text style={styles.completeBtnPillText}>{formatLKR(netPayable)}</Text>
                  </View>
                </>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </View>
      {rxRequest ? (
        <PrescriptionSheet
          request={rxRequest}
          initial={prescriptionRef.current}
          customerName={customer?.name}
          customerPhone={(customer as { phone?: string | null } | null)?.phone}
          onClose={() => setRxRequest(null)}
          onSave={(p) => {
            prescriptionRef.current = p
            setRxRequest(null)
            void handleCompleteSale()
          }}
        />
      ) : null}
      <CustomerPickerModal
        visible={pickCustomer}
        onClose={() => setPickCustomer(false)}
        onSelect={(c) => {
          setPickCustomer(false)
          onCustomerChange?.(c)
        }}
      />
      <SupervisorPinModal
        request={approvalRequest}
        onCancel={() => setApprovalRequest(null)}
        onApproved={(token) => {
          approvalTokensRef.current = [...approvalTokensRef.current, token]
          setApprovalRequest(null)
          void handleCompleteSale()
        }}
      />
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  header: {
    paddingTop: 44,
    height: 100,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  backBtn: { width: 38, height: 38, borderRadius: 8, backgroundColor: THEME.colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  backBtnText: { fontSize: 20, fontWeight: '700', color: THEME.colors.text },
  headerTitleCol: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: THEME.colors.text },
  headerSub: { fontSize: 11, color: THEME.colors.textMuted },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', backgroundColor: THEME.colors.tertiaryLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, gap: 4 },
  liveIndicatorOffline: { backgroundColor: THEME.colors.errorLight },
  pulsingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: THEME.colors.tertiary },
  liveText: { fontSize: 10, fontWeight: '700', color: THEME.colors.tertiary },
  scroll: { flex: 1, padding: 16 },
  heroBox: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: THEME.colors.border, marginBottom: 16 },
  heroTiles: { flexDirection: 'row', gap: 8, alignSelf: 'stretch', marginBottom: 10 },
  heroTile: { flex: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, backgroundColor: THEME.colors.primary, alignItems: 'center' },
  heroTileOk: { backgroundColor: THEME.colors.tertiary },
  heroTileWarn: { backgroundColor: THEME.colors.secondary },
  heroTileLabel: { fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: 0.5 },
  heroTileValue: { fontSize: 17, fontWeight: '900', color: '#FFFFFF', marginTop: 2 },
  customerRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'stretch', justifyContent: 'center' },
  customerChange: { fontSize: 12, fontWeight: '800', color: THEME.colors.primary },
  padToggle: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, marginRight: 8 },
  padToggleOn: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  padToggleText: { fontSize: 12, fontWeight: '800', color: THEME.colors.text },
  lineRow: { marginBottom: 10, borderRadius: 12, padding: 2 },
  lineRowActive: { borderWidth: 1.5, borderColor: THEME.colors.primary, padding: 8 },
  lineInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineChip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: THEME.colors.surfaceContainerLow, marginRight: 6 },
  lineChipActive: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  lineChipText: { fontSize: 12, fontWeight: '700', color: THEME.colors.text },
  lineChipTextActive: { color: '#FFF' },
  restBtn: { height: 56, paddingHorizontal: 14, borderRadius: 12, backgroundColor: THEME.colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  restBtnText: { fontSize: 13, fontWeight: '800', color: THEME.colors.primary },
  removeBtn: { height: 56, width: 44, borderRadius: 12, backgroundColor: THEME.colors.errorLight, alignItems: 'center', justifyContent: 'center' },
  removeBtnText: { fontSize: 16, fontWeight: '800', color: THEME.colors.error },
  lineError: { marginTop: 8, fontSize: 12, fontWeight: '700', color: THEME.colors.error },
  addPayBtn: { marginTop: 12, minHeight: 48, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  addPayText: { fontSize: 13, fontWeight: '800', color: THEME.colors.primary, textAlign: 'center' },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  padKey: { width: '31.5%', height: 54, borderRadius: 12, backgroundColor: THEME.colors.surfaceContainerLow, borderWidth: 1, borderColor: THEME.colors.border, alignItems: 'center', justifyContent: 'center' },
  padKeyWide: { width: '100%' },
  padKeyPressed: { backgroundColor: THEME.colors.primaryLight },
  padKeyText: { fontSize: 22, fontWeight: '800', color: THEME.colors.text },
  pickCustomerBtn: { marginTop: 8, minHeight: 44, borderRadius: 10, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: THEME.colors.secondaryContainer },
  pickCustomerText: { fontSize: 14, fontWeight: '800', color: THEME.colors.onSecondaryContainer },
  heroLabel: { fontSize: 11, fontWeight: '700', color: THEME.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroAmount: { fontSize: 32, fontWeight: '800', color: THEME.colors.primary, marginVertical: 4 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  heroMetaText: { fontSize: 12, color: THEME.colors.textMuted },
  heroItemCountBadge: { backgroundColor: THEME.colors.surfaceContainerHigh, color: THEME.colors.text, fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  heroCustomer: { marginTop: 8, fontSize: 12, fontWeight: '700', color: THEME.colors.text },
  offlineBanner: { backgroundColor: THEME.colors.secondaryLight, padding: 12, borderRadius: 10, marginBottom: 14 },
  offlineBannerText: { fontSize: 12, fontWeight: '600', color: THEME.colors.onSecondaryContainer },
  section: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: THEME.colors.border },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: THEME.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionHint: { fontSize: 11, fontWeight: '700', color: THEME.colors.primary },
  clearText: { fontSize: 12, fontWeight: '600', color: THEME.colors.error },
  lankaPayBadge: { fontSize: 11, fontWeight: '700', color: THEME.colors.tertiary },
  presetsGrid: { flexDirection: 'row', gap: 8 },
  presetCard: { flex: 1, paddingVertical: 10, paddingHorizontal: 4, backgroundColor: THEME.colors.surfaceContainerLow, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: THEME.colors.border },
  presetCardActive: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  presetSub: { fontSize: 10, fontWeight: '700', color: THEME.colors.textMuted },
  presetSubActive: { color: THEME.colors.onPrimaryContainer },
  presetVal: { fontSize: 13, fontWeight: '800', color: THEME.colors.text, marginTop: 2 },
  presetValActive: { color: '#FFF' },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  methodCard: { width: '48%', padding: 12, borderRadius: 12, backgroundColor: THEME.colors.surfaceContainerLow, borderWidth: 1.5, borderColor: THEME.colors.border },
  methodCardActive: { backgroundColor: '#FFFFFF', borderColor: THEME.colors.primary },
  methodCardDisabled: { opacity: 0.45 },
  methodIconRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  methodEmoji: { fontSize: 22 },
  checkCircle: { width: 20, height: 20, borderRadius: 10, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  checkText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  methodTitle: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  methodSub: { fontSize: 10, color: THEME.colors.textMuted, marginTop: 2 },
  tenderInputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: THEME.colors.surfaceContainerLow, borderRadius: 12, borderWidth: 1.5, borderColor: THEME.colors.border, paddingHorizontal: 16, height: 56 },
  tenderCurrencyPrefix: { fontSize: 18, fontWeight: '800', color: THEME.colors.textMuted, marginRight: 8 },
  tenderInput: { flex: 1, fontSize: 24, fontWeight: '800', color: THEME.colors.text, textAlign: 'right' },
  changeBox: { marginTop: 12, padding: 14, borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  changeBoxSuccess: { backgroundColor: THEME.colors.tertiaryLight },
  changeBoxError: { backgroundColor: THEME.colors.errorLight },
  changeLabel: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  changeLabelSuccess: { color: THEME.colors.tertiary },
  changeLabelError: { color: THEME.colors.error },
  changeSub: { fontSize: 10, color: THEME.colors.textMuted, marginTop: 2 },
  changeAmount: { fontSize: 20, fontWeight: '900' },
  changeAmountSuccess: { color: THEME.colors.tertiary },
  changeAmountError: { color: THEME.colors.error },
  bankChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: THEME.colors.border, backgroundColor: THEME.colors.surfaceContainerLow, marginRight: 6 },
  bankChipActive: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  bankChipText: { fontSize: 12, fontWeight: '600', color: THEME.colors.text },
  bankChipTextActive: { color: '#FFF' },
  creditText: { fontSize: 12, color: THEME.colors.onSecondaryContainer, marginTop: 6 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggleInfo: { flex: 1, marginRight: 12 },
  toggleTitle: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  toggleSub: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 6 },
  phoneInput: { marginTop: 10, borderWidth: 1, borderColor: THEME.colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#FFFFFF', fontSize: 14, color: THEME.colors.text },
  footer: { marginTop: 10, marginBottom: 20 },
  completeBtn: { height: 56, backgroundColor: THEME.colors.primary, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  completeBtnDisabled: { opacity: 0.5 },
  completeBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  completeBtnPill: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  completeBtnPillText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
})
