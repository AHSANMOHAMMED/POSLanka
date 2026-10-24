// Minimal returns flow, opened when a receipt code (INV-/RTN-/OFF- QR or typed) is
// scanned at the POS. Receipt codes resolve exactly through GET /api/sales/lookup
// (RTN- → its original sale, OFF- → the offline receipt); anything else falls back to
// GET /api/sales?search=. Lines carry originalSaleItemId and the remaining quantity; the
// server prices the return from the original invoice (incl. tax) and answers with the
// refund it actually paid (refundAmount), which is what we print.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native'
import * as Crypto from 'expo-crypto'
import { apiGet, apiPost, asList, qs } from '../lib/api'
import { roundCurrency } from '../lib/tax'
import { shiftCounterName, type Shift } from '../lib/shift'
import { THEME, formatLKR } from '../lib/theme'
import { receiptFromSale, type BusinessInfo } from '../lib/receipt'
import type { SaleResultData } from './TenderModal'
import { IdempotencyKey } from '../lib/idempotency'
import { useHeaderPad } from '../lib/safeArea'
import { lineUnit } from '../lib/unitConversion'

/**
 * Refund back to how the customer paid: several methods → 'original' (server splits the refund
 * across them within what each method paid), a card sale → card, otherwise cash.
 */
export function chooseRefundMethod(sale: Pick<ReturnableSale, 'paidByMethod' | 'paymentMethod'>): {
  method: 'cash' | 'card' | 'original'; description: string; pill: string
} {
  const paid = Object.entries(sale.paidByMethod || {})
    .filter(([m, amt]) => Number(amt) > 0 && !['credit', 'gift_card', 'loyalty'].includes(m))
  if (paid.length > 1) {
    return { method: 'original', description: 'Back to the original payment methods', pill: '↩ ' + paid.map(([m]) => m.replace('_', ' ').toUpperCase()).join(' + ') }
  }
  const only = paid[0]?.[0] || sale.paymentMethod || 'cash'
  if (only === 'card') return { method: 'card', description: 'Back to the card used', pill: '💳 CARD' }
  return { method: 'cash', description: 'Cash from the drawer', pill: '💵 CASH' }
}

/** Unit text for a sold line (see lib/unitConversion) — kept under its old name. */
export const returnLineUnit = lineUnit

export interface ReturnableSale {
  id: string
  invoiceNo: string
  total: string | number
  status: string
  isReturn?: boolean
  createdAt: string
  customerId?: string | null
  customerName?: string | null
  warehouseId?: string | null
  paymentMethod?: string | null
  /** From /api/sales/lookup: amount paid per method on the original sale */
  paidByMethod?: Record<string, number>
  items?: Array<{
    id?: string
    itemId?: string | null
    itemName: string
    quantity: string | number
    unitPrice: string | number
    total?: string | number
    /** from /api/sales/lookup */
    remainingQuantity?: number
    refundUnitAmount?: number
    isGiftCard?: boolean
    /** H5: unit the line was sold in and base units per 1 of it (sale_items.uom / uom_factor) */
    uom?: string | null
    uomFactor?: string | number | null
    /** from /api/sales/lookup: the item's base unit (items.unit) */
    baseUnit?: string | null
  }>
  returnStatus?: 'none' | 'partial' | 'full'
  returns?: Array<{ id: string; invoiceNo: string; total: string }>
}

interface ReturnModalProps {
  visible: boolean
  onClose: () => void
  /** Invoice number (or fragment) that was scanned / typed. */
  invoiceQuery: string
  shift: Shift
  business: BusinessInfo | null
  cashierName?: string | null
  onReturnComplete: (data: SaleResultData) => void
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'))
  return isNaN(n) ? 0 : n
}

export function ReturnModal({ visible, onClose, invoiceQuery, shift, business, cashierName, onReturnComplete }: ReturnModalProps) {
  const headerPad = useHeaderPad()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [matches, setMatches] = useState<ReturnableSale[]>([])
  const [selected, setSelected] = useState<ReturnableSale | null>(null)
  const [qty, setQty] = useState<Record<number, number>>({})
  const [busy, setBusy] = useState(false)
  // One clientSaleId per return attempt: a retry after a timeout (the first request may have been
  // recorded) re-sends the same key, so the server answers with the existing return instead of
  // refunding twice. A new key is minted only when the sale or the quantities change.
  const returnKey = useRef(new IdempotencyKey(() => Crypto.randomUUID()))

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setMatches([])
    setSelected(null)
    setQty({})
    ;(async () => {
      // Receipt codes: exact lookup (RTN- resolves to the original sale, OFF- to an offline receipt)
      const code = invoiceQuery.trim()
      if (/^(INV|RTN|OFF)-/i.test(code)) {
        const found = await apiGet<any>(`/api/sales/lookup${qs({ code })}`)
        if (cancelled) return
        if (found.ok && found.data?.sale) {
          const sale = found.data.sale as ReturnableSale
          if (sale.status === 'void') {
            setError(`Invoice ${sale.invoiceNo} was voided`)
          } else if (sale.returnStatus === 'full') {
            setError(`Invoice ${sale.invoiceNo} has already been fully returned`)
          } else {
            setMatches([sale])
            setSelected(sale)
          }
          setLoading(false)
          return
        }
      }
      const res = await apiGet<any>(`/api/sales${qs({ search: code, pageSize: 5 })}`)
      if (cancelled) return
      if (!res.ok) {
        setError(res.error)
        setLoading(false)
        return
      }
      const rows = asList<ReturnableSale>(res.data).filter((s) => !s.isReturn && s.status !== 'void' && s.returnStatus !== 'full')
      setMatches(rows)
      const exact = rows.find((s) => s.invoiceNo.toLowerCase() === code.toLowerCase())
      const pick = exact || (rows.length === 1 ? rows[0] : null)
      if (pick) {
        // Refresh through the lookup endpoint: remaining quantities, refund prices and the
        // per-method amounts needed to refund back to the original payment methods
        const full = await apiGet<any>(`/api/sales/lookup${qs({ code: pick.invoiceNo })}`)
        setSelected(full.ok && full.data?.sale ? full.data.sale : pick)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [visible, invoiceQuery])

  const lines = useMemo(
    () =>
      (selected?.items || [])
        .filter((i) => !i.isGiftCard && num(i.quantity) > 0)
        .map((i) => ({
          ...i,
          maxQty: i.remainingQuantity ?? Math.abs(num(i.quantity)),
          // what one unit refunds (incl. tax, after discounts) — server-computed when looked up
          refundUnit: i.refundUnitAmount ?? num(i.unitPrice),
        })),
    [selected]
  )

  // Preview only: the server recomputes the refund from the original invoice
  const refundAmount = useMemo(
    () => roundCurrency(lines.reduce((sum, l, idx) => sum + (qty[idx] || 0) * l.refundUnit, 0)),
    [lines, qty]
  )
  const hasAny = Object.values(qty).some((q) => q > 0)

  function bump(idx: number, delta: number) {
    setQty((prev) => {
      const max = lines[idx]?.maxQty ?? 0
      const next = Math.max(0, Math.min(max, (prev[idx] || 0) + delta))
      return { ...prev, [idx]: next }
    })
  }

  function selectAll() {
    const all: Record<number, number> = {}
    lines.forEach((l, idx) => {
      all[idx] = l.maxQty
    })
    setQty(all)
  }

  async function submit() {
    if (!selected || !hasAny) return
    const cartItems = lines
      .map((l, idx) => ({ l, q: qty[idx] || 0 }))
      .filter(({ q }) => q > 0)
      .map(({ l, q }) => ({
        originalSaleItemId: l.id || undefined,
        itemId: l.itemId || undefined,
        name: l.itemName,
        quantity: -q,
        unitPrice: l.refundUnit,
        discount: 0,
        total: roundCurrency(-q * l.refundUnit),
      }))
    // Unit of each returned line, for the fallback slip (the server keeps the original line's unit)
    const lineUoms = lines
      .map((l, idx) => ({ l, q: qty[idx] || 0 }))
      .filter(({ q }) => q > 0)
      .map(({ l }) => l.uom || null)
    const subtotal = roundCurrency(cartItems.reduce((s, c) => s + c.total, 0)) // negative
    const total = subtotal
    const refund = Math.abs(total)

    const refundChoice = chooseRefundMethod(selected)
    const signature = JSON.stringify([selected.id, cartItems.map((c) => [c.originalSaleItemId || c.itemId || c.name, c.quantity])])
    const payload = {
      clientSaleId: returnKey.current.for(signature),
      customerId: selected.customerId || undefined,
      cartItems,
      paymentMethod: 'cash',
      subtotal,
      discount: 0,
      tax: 0,
      total,
      amountPaid: 0,
      creditAmount: 0,
      addOverpaymentToCredit: false,
      isReturn: true,
      returnAgainst: selected.id,
      refundMethod: refundChoice.method,
      warehouseId: selected.warehouseId || shift.warehouseId,
      posOpeningEntryId: shift.id,
    }

    setBusy(true)
    try {
      const res = await apiPost<any>('/api/sales', payload)
      if (!res.ok) {
        Alert.alert(res.status === 0 ? 'No Connection' : 'Return Failed', res.status === 0 ? 'Returns cannot be processed offline.' : res.error)
        return
      }
      returnKey.current.reset()
      const sale = res.data || {}
      const refunded = typeof sale.refundAmount === 'number' ? sale.refundAmount : refund
      // Refund method actually used (the return row's paymentMethod), for the slip / result screen
      const paidOutMethod = typeof sale.paymentMethod === 'string' && sale.paymentMethod ? sale.paymentMethod : refundChoice.method === 'card' ? 'card' : 'cash'
      const receipt = receiptFromSale(
        { ...sale, invoiceNo: sale.invoiceNo || 'Return recorded', total: sale.total ?? total, items: sale.items?.length ? sale.items : cartItems.map((c, i) => ({ itemName: c.name, quantity: c.quantity, unitPrice: c.unitPrice, total: c.total, uom: lineUoms[i] ?? null })), isReturn: true },
        {
          business: business || { name: 'skyERPOS' },
          shift,
          cashier: cashierName,
          customerName: selected.customerName || undefined,
          // CREDIT NOTE particulars: the buyer and the invoice being credited
          customer: sale.customer
            ? { name: sale.customer.name ?? selected.customerName ?? null, taxId: sale.customer.taxId ?? null, address: sale.customer.address ?? null }
            : selected.customerName ? { name: selected.customerName } : null,
          originalInvoiceNo: sale.originalInvoiceNo || selected.invoiceNo,
          fallbackPayment: { method: paidOutMethod, amount: -refunded },
        }
      )
      onReturnComplete({
        invoiceNo: sale.invoiceNo || 'Return recorded',
        total: refunded,
        change: 0,
        tenderMethod: refundChoice.method === 'original' ? 'REFUND TO ORIGINAL METHODS' : `${paidOutMethod.replace('_', ' ').toUpperCase()} REFUND`,
        isReturn: true,
        receipt,
      })
    } finally {
      setBusy(false)
    }
  }

  if (!visible) return null

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={[styles.header, headerPad]}>
          <Pressable style={styles.backBtn} onPress={onClose} disabled={busy}>
            <Text style={styles.backBtnText}>←</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Return / Refund</Text>
            <Text style={styles.headerSub} numberOfLines={1}>
              Scanned {invoiceQuery} · {shiftCounterName(shift) || 'Counter'}
            </Text>
          </View>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }}>
          {loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={THEME.colors.primary} />
              <Text style={styles.muted}>Looking up invoice…</Text>
            </View>
          ) : error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : matches.length === 0 ? (
            <View style={styles.centerBox}>
              <Text style={{ fontSize: 36 }}>🧾</Text>
              <Text style={styles.emptyTitle}>No returnable sale found</Text>
              <Text style={styles.muted}>Nothing matched "{invoiceQuery}" (voided or fully-returned invoices are excluded).</Text>
            </View>
          ) : (
            <>
              {!selected || matches.length > 1 ? (
                <View style={styles.card}>
                  <Text style={styles.sectionTitle}>Matching invoices</Text>
                  {matches.map((s) => {
                    const active = selected?.id === s.id
                    return (
                      <Pressable
                        key={s.id}
                        style={[styles.matchRow, active && styles.matchRowActive]}
                        onPress={() => {
                          setSelected(s)
                          // load per-method amounts / remaining quantities for this receipt
                          apiGet<any>(`/api/sales/lookup${qs({ code: s.invoiceNo })}`).then((full) => { if (full.ok && full.data?.sale) setSelected(full.data.sale) })
                          setQty({})
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.matchInvoice}>{s.invoiceNo}</Text>
                          <Text style={styles.muted}>
                            {new Date(s.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                            {s.customerName ? ` • ${s.customerName}` : ''}
                            {s.returnStatus === 'partial' ? ' • partially returned' : ''}
                          </Text>
                        </View>
                        <Text style={styles.matchTotal}>{formatLKR(s.total)}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              ) : null}

              {selected ? (
                <View style={styles.card}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.sectionTitle}>Start return for {selected.invoiceNo}</Text>
                    <Pressable onPress={selectAll}>
                      <Text style={styles.linkText}>Return all</Text>
                    </Pressable>
                  </View>
                  {selected.returns?.length ? (
                    <Text style={styles.warnText}>
                      Already has {selected.returns.length} credit note(s): {selected.returns.map((r) => r.invoiceNo).join(', ')}. The server blocks over-returns.
                    </Text>
                  ) : null}
                  {lines.length === 0 ? (
                    <Text style={styles.muted}>This sale has no item lines to return.</Text>
                  ) : (
                    lines.map((l, idx) => {
                      const q = qty[idx] || 0
                      const u = returnLineUnit(l)
                      return (
                        <View key={`${l.id || l.itemId || l.itemName}-${idx}`} style={styles.lineRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.lineName}>{l.itemName}</Text>
                            <Text style={styles.muted}>
                              {l.maxQty}{u.unit ? ` ${u.unit}` : ''} returnable × {formatLKR(l.refundUnit)}{u.unit ? ` per ${u.unit}` : ''}
                            </Text>
                            {u.conversion ? <Text style={styles.unitNote}>Sold in {u.unit} · {u.conversion}</Text> : null}
                          </View>
                          <View style={styles.stepper}>
                            <Pressable style={styles.stepBtn} onPress={() => bump(idx, -1)} disabled={q <= 0}>
                              <Text style={styles.stepText}>−</Text>
                            </Pressable>
                            <Text style={styles.stepVal}>{q}</Text>
                            <Pressable style={styles.stepBtn} onPress={() => bump(idx, +1)} disabled={q >= l.maxQty}>
                              <Text style={styles.stepText}>+</Text>
                            </Pressable>
                          </View>
                        </View>
                      )
                    })
                  )}
                </View>
              ) : null}

              {selected ? (
                <View style={styles.card}>
                  <View style={styles.rowBetween}>
                    <View>
                      <Text style={styles.sectionTitle}>Refund method</Text>
                      <Text style={styles.muted}>{chooseRefundMethod(selected).description}</Text>
                    </View>
                    <View style={styles.methodPill}>
                      <Text style={styles.methodPillText}>{chooseRefundMethod(selected).pill}</Text>
                    </View>
                  </View>
                  <View style={[styles.refundBox]}>
                    <Text style={styles.refundLabel}>Refund amount</Text>
                    <Text style={styles.refundVal}>{formatLKR(refundAmount)}</Text>
                  </View>
                  <Pressable style={[styles.submitBtn, (!hasAny || busy) && { opacity: 0.5 }]} onPress={submit} disabled={!hasAny || busy}>
                    {busy ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitText}>↩ Process Return · {formatLKR(refundAmount)}</Text>}
                  </Pressable>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>
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
    backgroundColor: THEME.colors.errorLight,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
    gap: 12,
  },
  backBtn: { width: 38, height: 38, borderRadius: 8, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  backBtnText: { fontSize: 20, fontWeight: '700', color: THEME.colors.text },
  headerTitle: { fontSize: 17, fontWeight: '800', color: THEME.colors.error },
  headerSub: { fontSize: 11, color: THEME.colors.textMuted },
  scroll: { flex: 1, padding: 16 },
  centerBox: { padding: 30, alignItems: 'center', gap: 8 },
  muted: { fontSize: 12, color: THEME.colors.textMuted, textAlign: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: THEME.colors.text },
  errorBox: { backgroundColor: THEME.colors.errorLight, padding: 14, borderRadius: 12 },
  errorText: { color: THEME.colors.error, fontWeight: '600' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: THEME.colors.border },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: THEME.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  linkText: { fontSize: 12, fontWeight: '800', color: THEME.colors.primary },
  warnText: { fontSize: 11, color: THEME.colors.onSecondaryContainer, backgroundColor: THEME.colors.secondaryLight, padding: 8, borderRadius: 8, marginBottom: 8 },
  matchRow: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: THEME.colors.border, marginBottom: 8, gap: 8 },
  matchRowActive: { borderColor: THEME.colors.error, backgroundColor: THEME.colors.errorLight },
  matchInvoice: { fontSize: 14, fontWeight: '800', color: THEME.colors.text, fontFamily: 'monospace' },
  matchTotal: { fontSize: 13, fontWeight: '800', color: THEME.colors.text },
  lineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: THEME.colors.border, gap: 10 },
  lineName: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  unitNote: { fontSize: 11, color: THEME.colors.primary, marginTop: 2, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { width: 34, height: 34, borderRadius: 8, backgroundColor: THEME.colors.surfaceContainerLow, borderWidth: 1, borderColor: THEME.colors.border, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  stepVal: { minWidth: 28, textAlign: 'center', fontSize: 15, fontWeight: '800', color: THEME.colors.error },
  methodPill: { backgroundColor: THEME.colors.surfaceContainerHigh, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  methodPillText: { fontSize: 12, fontWeight: '800', color: THEME.colors.text },
  refundBox: { marginTop: 12, padding: 14, borderRadius: 12, backgroundColor: THEME.colors.errorLight, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  refundLabel: { fontSize: 12, fontWeight: '800', color: THEME.colors.error, textTransform: 'uppercase' },
  refundVal: { fontSize: 20, fontWeight: '900', color: THEME.colors.error },
  submitBtn: { marginTop: 12, height: 52, borderRadius: 12, backgroundColor: THEME.colors.error, alignItems: 'center', justifyContent: 'center' },
  submitText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
})
