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
import { allowedTenders, type TenderOption as TenderOptionT } from '../lib/tenderRules'
import { shiftCounterName, shiftWarehouseName, type Shift } from '../lib/shift'
import { getPrinterSettings, isPrintingEnabled, TRANSPORT_LABELS, type PrinterSettings } from '../lib/printer'
import { receiptFromSale, type BusinessInfo } from '../lib/receipt'
import type { ReceiptInput } from '../lib/escpos'
import type { CartLine } from './CartDrawerModal'
import type { Customer } from './CustomerPickerModal'
import { SupervisorPinModal, type SupervisorApprovalRequest } from './SupervisorPinModal'

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
}

/** UI tender options mapped onto the server's payment method enum. */
type TenderOption = TenderOptionT

const TENDER_LABELS: Record<TenderOption, string> = {
  cash: 'CASH',
  card: 'CARD',
  lankaqr: 'LANKAQR',
  credit: 'CREDIT',
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
}: TenderModalProps) {
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

  const [tender, setTender] = useState<TenderOption>('cash')
  const [cashTendered, setCashTendered] = useState<string>('')
  const [reference, setReference] = useState('')
  const [autoPrint, setAutoPrint] = useState(false)
  const [printer, setPrinter] = useState<PrinterSettings | null>(null)
  const [busy, setBusy] = useState(false)
  // H1: supervisor approvals for this cart (credit limit override, …), sent with the sale
  const approvalTokensRef = useRef<string[]>([])
  const [approvalRequest, setApprovalRequest] = useState<SupervisorApprovalRequest | null>(null)

  // Reset the form each time the modal opens for a (possibly new) cart.
  useEffect(() => {
    if (visible) {
      approvalTokensRef.current = []
      setApprovalRequest(null)
      setTender('cash')
      setCashTendered(netPayable.toFixed(2))
      setReference('')
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
    if (!visible || !customer?.id) { setLoyaltyProgram(null); return }
    let cancelled = false
    apiGet<LoyaltyProgram | null>('/api/loyalty-programs').then((res) => {
      if (!cancelled) setLoyaltyProgram(res.ok && res.data ? res.data : null)
    })
    return () => { cancelled = true }
  }, [visible, customer?.id])

  // Keep the cash field in sync when loyalty redemption changes the payable amount
  useEffect(() => {
    if (visible && tender === 'cash') setCashTendered(netPayable.toFixed(2))
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

  const numericTendered = parseFloat(cashTendered) || 0
  const changeDue = roundCurrency(numericTendered - netPayable)
  const isTenderSufficient = tender !== 'cash' || changeDue >= -0.009
  const tenders = allowedTenders(shift.posProfile)
  const creditAllowed = !!customer && shift.posProfile?.allowCreditSale !== false
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

    let paymentMethod: 'cash' | 'card' | 'bank_transfer' | 'credit'
    let amountPaid: number
    let creditAmount = 0
    let paymentSplits: Array<{ method: string; amount: number; reference?: string }> | undefined

    switch (tender) {
      case 'cash':
        paymentMethod = 'cash'
        amountPaid = roundCurrency(numericTendered)
        break
      case 'card':
        paymentMethod = 'card'
        amountPaid = netPayable
        break
      case 'lankaqr':
        // LankaQR settles to the bank account -> bank_transfer with the QR reference.
        paymentMethod = 'bank_transfer'
        amountPaid = netPayable
        paymentSplits = [{ method: 'bank_transfer', amount: netPayable, reference: reference.trim() || undefined }]
        break
      case 'credit':
        // Sell on customer credit: nothing received now.
        paymentMethod = 'credit'
        amountPaid = 0
        creditAmount = 0
        break
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
      soldAt: new Date().toISOString(),
    }
  }

  async function handleCompleteSale() {
    if (!isTenderSufficient) {
      Alert.alert('Insufficient Tender', 'Tendered cash is less than the net amount payable.')
      return
    }
    if (tender === 'credit' && !customer) {
      Alert.alert('Customer Required', 'Link a customer before selling on credit.')
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
    const tenderMethod = TENDER_LABELS[tender]
    const change = tender === 'cash' ? Math.max(0, changeDue) : 0

    setBusy(true)
    try {
      const businessInfo: BusinessInfo = business || { name: 'POSLanka' }
      const splits = payload.paymentSplits as Array<{ method: string; amount: number; reference?: string }> | undefined
      const fallbackPayment = splits?.[0] || { method: String(payload.paymentMethod), amount: Number(payload.amountPaid) || netPayable }
      // local stock is in base units (a box line holds quantity × factor pieces)
      const stockLines = cart.map((c) => ({ itemId: c.itemId || c.id, quantity: Math.round(c.quantity * (c.uomFactor || 1) * 1000) / 1000 }))
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
            'Credit, gift card and loyalty sales cannot be saved offline. Reconnect and try again, or switch to cash/card.'
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
            subtotal,
            taxAmount: tax,
            createdAt: new Date().toISOString(),
            taxBreakdown: taxResult.breakdown.length ? taxResult.breakdown.map((b) => ({ taxName: b.taxName, amount: b.amount })) : null,
            items: cart.map((c) => ({ itemName: c.name, quantity: c.quantity, unitPrice: Number(c.sellingPrice), total: lineTotal(c), unit: c.unit })),
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
        })
        return
      }

      if (isNetworkError(res)) {
        // The request may or may not have reached the server; the queue replays it with the same
        // clientSaleId, so the server returns the original sale if it was recorded after all.
        await completeOffline()
        return
      }

      const body = res.data as unknown as { code?: string; scopes?: string[]; quote?: unknown } | null
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

  const methodCards: Array<{ id: TenderOption; emoji: string; title: string; sub: string; disabled?: boolean }> = [
    { id: 'cash', emoji: '💵', title: 'Cash', sub: 'Physical tender' },
    { id: 'card', emoji: '💳', title: 'Card POS', sub: tenders.has('card') ? 'Visa / Master / LankaPay' : 'Not enabled on this counter', disabled: !tenders.has('card') },
    { id: 'lankaqr', emoji: '📱', title: 'LankaQR', sub: tenders.has('lankaqr') ? 'Bank transfer with reference' : 'Not enabled on this counter', disabled: !tenders.has('lankaqr') },
    { id: 'credit', emoji: '🧾', title: 'Customer Credit', sub: customer ? `Bill to ${customer.name}` : 'Link a customer first', disabled: !creditAllowed },
  ]

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={onClose} disabled={busy}>
            <Text style={styles.backBtnText}>←</Text>
          </Pressable>
          <View style={styles.headerTitleCol}>
            <Text style={styles.headerTitle}>Payment Tender</Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              {shiftWarehouseName(shift) || 'Branch'} ▸ {shiftCounterName(shift) || 'Counter'}
            </Text>
          </View>
          <View style={[styles.liveIndicator, !online && styles.liveIndicatorOffline]}>
            <View style={[styles.pulsingDot, !online && { backgroundColor: THEME.colors.error }]} />
            <Text style={[styles.liveText, !online && { color: THEME.colors.error }]}>{online ? 'Ready' : 'Offline'}</Text>
          </View>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={styles.heroBox}>
            <Text style={styles.heroLabel}>Net Amount Payable</Text>
            <Text style={styles.heroAmount}>{formatLKR(netPayable)}</Text>
            <View style={styles.heroMetaRow}>
              <Text style={styles.heroMetaText}>
                Subtotal {formatLKR(subtotal)}
                {tax > 0 ? ` • Tax ${formatLKR(tax)}${taxResult.hasInclusiveTax ? ' (incl.)' : ''}` : taxConfig.unavailable ? ' • Tax per server' : ' • No tax'}
              </Text>
              <Text style={styles.heroItemCountBadge}>{cart.reduce((c, i) => c + i.quantity, 0)} Items</Text>
            </View>
            {customer ? <Text style={styles.heroCustomer}>👤 {customer.name}</Text> : null}
          </View>

          {!online && (
            <View style={styles.offlineBanner}>
              <Text style={styles.offlineBannerText}>
                No connection. Cash, card and LankaQR sales will be saved on this device and synced automatically.
              </Text>
            </View>
          )}

          {tender === 'cash' && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Quick Cash Denominations</Text>
                <Text style={styles.sectionHint}>Touch to apply</Text>
              </View>
              <View style={styles.presetsGrid}>
                {presets.map((preset, idx) => {
                  const isSelected = Math.abs(numericTendered - preset.value) < 0.01
                  return (
                    <Pressable key={idx} style={[styles.presetCard, isSelected && styles.presetCardActive]} onPress={() => setCashTendered(preset.value.toFixed(2))}>
                      <Text style={[styles.presetSub, isSelected && styles.presetSubActive]}>{preset.label}</Text>
                      <Text style={[styles.presetVal, isSelected && styles.presetValActive]}>{formatLKR(preset.value).replace('LKR ', '')}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Payment Instrument</Text>
              <Text style={styles.lankaPayBadge}>✓ LankaPay Ready</Text>
            </View>
            <View style={styles.methodGrid}>
              {methodCards.map((m) => {
                const active = tender === m.id
                return (
                  <Pressable
                    key={m.id}
                    style={[styles.methodCard, active && styles.methodCardActive, m.disabled && styles.methodCardDisabled]}
                    disabled={m.disabled}
                    onPress={() => {
                      setTender(m.id)
                      if (m.id !== 'cash') setCashTendered(netPayable.toFixed(2))
                    }}
                  >
                    <View style={styles.methodIconRow}>
                      <Text style={styles.methodEmoji}>{m.emoji}</Text>
                      {active && (
                        <View style={styles.checkCircle}>
                          <Text style={styles.checkText}>✓</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.methodTitle}>{m.title}</Text>
                    <Text style={styles.methodSub} numberOfLines={1}>
                      {m.sub}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          </View>

          {tender === 'cash' && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Cash Tendered by Customer</Text>
                <Pressable onPress={() => setCashTendered('')}>
                  <Text style={styles.clearText}>Clear</Text>
                </Pressable>
              </View>
              <View style={styles.tenderInputRow}>
                <Text style={styles.tenderCurrencyPrefix}>LKR</Text>
                <TextInput style={styles.tenderInput} keyboardType="decimal-pad" value={cashTendered} onChangeText={setCashTendered} placeholder="0.00" />
              </View>

              <View style={[styles.changeBox, changeDue < -0.009 ? styles.changeBoxError : styles.changeBoxSuccess]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.changeLabel, changeDue < -0.009 ? styles.changeLabelError : styles.changeLabelSuccess]}>
                    {changeDue >= -0.009 ? 'Change Due to Customer' : 'Deficit / Short Tender'}
                  </Text>
                  <Text style={styles.changeSub}>{changeDue >= -0.009 ? 'Hand back to customer on completion' : 'Collect remaining cash from customer'}</Text>
                </View>
                <Text style={[styles.changeAmount, changeDue < -0.009 ? styles.changeAmountError : styles.changeAmountSuccess]}>{formatLKR(Math.abs(changeDue))}</Text>
              </View>
            </View>
          )}

          {tender === 'lankaqr' && (
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

          {tender === 'credit' && customer && (
            <View style={[styles.section, { backgroundColor: THEME.colors.secondaryLight }]}>
              <Text style={[styles.sectionTitle, { color: THEME.colors.onSecondaryContainer }]}>Credit Sale</Text>
              <Text style={styles.creditText}>
                {formatLKR(netPayable)} will be added to {customer.name}'s outstanding balance
                {customer.balance != null ? ` (current ${formatLKR(customer.balance)})` : ''}
                {customer.creditLimit != null ? `, limit ${formatLKR(customer.creditLimit)}` : ''}.
              </Text>
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
  heroBox: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 20, alignItems: 'center', borderWidth: 1, borderColor: THEME.colors.border, marginBottom: 16 },
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
