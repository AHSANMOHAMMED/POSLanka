import React, { useState, useMemo } from 'react'
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
import { apiFetch } from '../lib/api'
import { CartLine } from './CartDrawerModal'

interface TenderModalProps {
  visible: boolean
  onClose: () => void
  cart: CartLine[]
  onSaleComplete: (saleData: { invoiceNo: string; total: number; change: number; tenderMethod: string }) => void
}

type PaymentMethodType = 'cash' | 'card' | 'lankaqr' | 'loyalty'

export function TenderModal({
  visible,
  onClose,
  cart,
  onSaleComplete,
}: TenderModalProps) {
  if (!visible) return null

  const subtotal = cart.reduce(
    (sum, line) => sum + Number(line.sellingPrice) * line.quantity,
    0
  )
  const ssclTax = subtotal * 0.025
  const netPayable = subtotal + ssclTax

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('cash')
  const [cashTendered, setCashTendered] = useState<string>(netPayable.toFixed(2))
  const [autoPrint, setAutoPrint] = useState(true)
  const [whatsAppSlip, setWhatsAppSlip] = useState(false)
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)

  // Quick preset calculations
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
  const changeDue = numericTendered - netPayable
  const isTenderSufficient = paymentMethod !== 'cash' || changeDue >= -0.009

  async function handleCompleteSale() {
    if (!isTenderSufficient) {
      Alert.alert('Insufficient Tender', 'Tendered cash is less than the net amount payable.')
      return
    }

    setBusy(true)
    try {
      const cartItems = cart.map((c) => ({
        itemId: c.id,
        name: c.name,
        quantity: c.quantity,
        unitPrice: Number(c.sellingPrice),
      }))

      const payload = {
        cartItems,
        paymentMethod: paymentMethod === 'loyalty' ? 'customer_credit' : paymentMethod,
        subtotal,
        discount: 0,
        tax: ssclTax,
        total: netPayable,
        amountPaid: paymentMethod === 'cash' ? numericTendered : netPayable,
        phone: whatsAppSlip ? phone : undefined,
        autoPrint,
      }

      const res = await apiFetch('/api/sales', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      const data = await res.json()

      if (!res.ok) {
        Alert.alert('Checkout Failed', data.error || 'Server error occurred during sale.')
        return
      }

      const invoiceNo = data.invoiceNo || data.sale?.invoiceNo || `#INV-${Date.now().toString().slice(-6)}`
      onSaleComplete({
        invoiceNo,
        total: netPayable,
        change: paymentMethod === 'cash' ? Math.max(0, changeDue) : 0,
        tenderMethod: paymentMethod.toUpperCase(),
      })
    } catch (e) {
      Alert.alert('Network Error', e instanceof Error ? e.message : 'Sale submission failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={onClose}>
            <Text style={styles.backBtnText}>←</Text>
          </Pressable>
          <View style={styles.headerTitleCol}>
            <Text style={styles.headerTitle}>Payment Tender</Text>
            <Text style={styles.headerSub}>Colombo Main Branch ▸ Counter 02</Text>
          </View>
          <View style={styles.liveIndicator}>
            <View style={styles.pulsingDot} />
            <Text style={styles.liveText}>Ready</Text>
          </View>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Hero Net Amount Payable Display */}
          <View style={styles.heroBox}>
            <Text style={styles.heroLabel}>Net Amount Payable</Text>
            <Text style={styles.heroAmount}>{formatLKR(netPayable)}</Text>
            <View style={styles.heroMetaRow}>
              <Text style={styles.heroMetaText}>Includes SSCL (2.5%) & VAT</Text>
              <Text style={styles.heroItemCountBadge}>
                {cart.reduce((c, i) => c + i.quantity, 0)} Items
              </Text>
            </View>
          </View>

          {/* Quick Cash Presets (for cash transactions) */}
          {paymentMethod === 'cash' && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Quick Cash Denominations</Text>
                <Text style={styles.sectionHint}>Touch to apply</Text>
              </View>
              <View style={styles.presetsGrid}>
                {presets.map((preset, idx) => {
                  const isSelected = Math.abs(numericTendered - preset.value) < 0.01
                  return (
                    <Pressable
                      key={idx}
                      style={[styles.presetCard, isSelected && styles.presetCardActive]}
                      onPress={() => setCashTendered(preset.value.toFixed(2))}
                    >
                      <Text style={[styles.presetSub, isSelected && styles.presetSubActive]}>
                        {preset.label}
                      </Text>
                      <Text style={[styles.presetVal, isSelected && styles.presetValActive]}>
                        {formatLKR(preset.value).replace('LKR ', '')}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          )}

          {/* Payment Method Matrix */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Payment Instrument</Text>
              <Text style={styles.lankaPayBadge}>✓ LankaPay Ready</Text>
            </View>
            <View style={styles.methodGrid}>
              {/* Cash */}
              <Pressable
                style={[styles.methodCard, paymentMethod === 'cash' && styles.methodCardActive]}
                onPress={() => setPaymentMethod('cash')}
              >
                <View style={styles.methodIconRow}>
                  <Text style={styles.methodEmoji}>💵</Text>
                  {paymentMethod === 'cash' && <View style={styles.checkCircle}><Text style={styles.checkText}>✓</Text></View>}
                </View>
                <Text style={styles.methodTitle}>Cash</Text>
                <Text style={styles.methodSub}>Physical Tender</Text>
              </Pressable>

              {/* Card */}
              <Pressable
                style={[styles.methodCard, paymentMethod === 'card' && styles.methodCardActive]}
                onPress={() => {
                  setPaymentMethod('card')
                  setCashTendered(netPayable.toFixed(2))
                }}
              >
                <View style={styles.methodIconRow}>
                  <Text style={styles.methodEmoji}>💳</Text>
                  {paymentMethod === 'card' && <View style={styles.checkCircle}><Text style={styles.checkText}>✓</Text></View>}
                </View>
                <Text style={styles.methodTitle}>Card POS</Text>
                <Text style={styles.methodSub}>Visa / Master / LankaPay</Text>
              </Pressable>

              {/* LankaQR */}
              <Pressable
                style={[styles.methodCard, paymentMethod === 'lankaqr' && styles.methodCardActive]}
                onPress={() => {
                  setPaymentMethod('lankaqr')
                  setCashTendered(netPayable.toFixed(2))
                }}
              >
                <View style={styles.methodIconRow}>
                  <Text style={styles.methodEmoji}>📱</Text>
                  {paymentMethod === 'lankaqr' && <View style={styles.checkCircle}><Text style={styles.checkText}>✓</Text></View>}
                </View>
                <Text style={styles.methodTitle}>LankaQR</Text>
                <Text style={styles.methodSub}>FriMi • Genie • iPay</Text>
              </Pressable>

              {/* Loyalty */}
              <Pressable
                style={[styles.methodCard, paymentMethod === 'loyalty' && styles.methodCardActive]}
                onPress={() => {
                  setPaymentMethod('loyalty')
                  setCashTendered(netPayable.toFixed(2))
                }}
              >
                <View style={styles.methodIconRow}>
                  <Text style={styles.methodEmoji}>⭐</Text>
                  {paymentMethod === 'loyalty' && <View style={styles.checkCircle}><Text style={styles.checkText}>✓</Text></View>}
                </View>
                <Text style={styles.methodTitle}>Loyalty</Text>
                <Text style={styles.methodSub}>Customer Points</Text>
              </Pressable>
            </View>
          </View>

          {/* Cash Tendered Input & Live Change Box */}
          {paymentMethod === 'cash' && (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Cash Tendered by Customer</Text>
                <Pressable onPress={() => setCashTendered('')}>
                  <Text style={styles.clearText}>Clear</Text>
                </Pressable>
              </View>
              <View style={styles.tenderInputRow}>
                <Text style={styles.tenderCurrencyPrefix}>LKR</Text>
                <TextInput
                  style={styles.tenderInput}
                  keyboardType="numeric"
                  value={cashTendered}
                  onChangeText={setCashTendered}
                  placeholder="0.00"
                />
              </View>

              {/* Live Change Result Banner */}
              <View style={[styles.changeBox, changeDue < -0.009 ? styles.changeBoxError : styles.changeBoxSuccess]}>
                <View>
                  <Text style={[styles.changeLabel, changeDue < -0.009 ? styles.changeLabelError : styles.changeLabelSuccess]}>
                    {changeDue >= -0.009 ? 'Change Due to Customer' : 'Deficit / Short Tender'}
                  </Text>
                  <Text style={styles.changeSub}>
                    {changeDue >= -0.009 ? 'Cash drawer 01 auto-triggers on completion' : 'Collect remaining cash from customer'}
                  </Text>
                </View>
                <Text style={[styles.changeAmount, changeDue < -0.009 ? styles.changeAmountError : styles.changeAmountSuccess]}>
                  {formatLKR(Math.abs(changeDue))}
                </Text>
              </View>
            </View>
          )}

          {/* Peripheral Toggles: Print & WhatsApp */}
          <View style={styles.section}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Text style={styles.toggleTitle}>🖨️ Auto-print Receipt</Text>
                <Text style={styles.toggleSub}>58mm Thermal ESC/POS (Counter Slip)</Text>
              </View>
              <Switch
                value={autoPrint}
                onValueChange={setAutoPrint}
                trackColor={{ false: THEME.colors.border, true: THEME.colors.primary }}
              />
            </View>

            <View style={[styles.toggleRow, { marginTop: 12 }]}>
              <View style={styles.toggleInfo}>
                <Text style={styles.toggleTitle}>💬 WhatsApp Digital Slip</Text>
                <Text style={styles.toggleSub}>Direct e-Receipt dispatch via WhatsApp API</Text>
              </View>
              <Switch
                value={whatsAppSlip}
                onValueChange={setWhatsAppSlip}
                trackColor={{ false: THEME.colors.border, true: THEME.colors.primary }}
              />
            </View>

            {whatsAppSlip && (
              <TextInput
                style={styles.phoneInput}
                placeholder="+94 7X XXX XXXX"
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />
            )}
          </View>

          {/* Action Trigger Button */}
          <View style={styles.footer}>
            <Pressable
              style={[styles.completeBtn, (!isTenderSufficient || busy) && styles.completeBtnDisabled]}
              onPress={handleCompleteSale}
              disabled={!isTenderSufficient || busy}
            >
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
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  header: {
    height: 64,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: THEME.colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  backBtnText: { fontSize: 20, fontWeight: '700', color: THEME.colors.text },
  headerTitleCol: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: THEME.colors.text },
  headerSub: { fontSize: 11, color: THEME.colors.textMuted },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.tertiaryLight,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  pulsingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: THEME.colors.tertiary },
  liveText: { fontSize: 10, fontWeight: '700', color: THEME.colors.tertiary },
  scroll: { flex: 1, padding: 16 },
  heroBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
    marginBottom: 16,
  },
  heroLabel: { fontSize: 11, fontWeight: '700', color: THEME.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroAmount: { fontSize: 32, fontWeight: '800', color: THEME.colors.primary, marginVertical: 4 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroMetaText: { fontSize: 12, color: THEME.colors.textMuted },
  heroItemCountBadge: {
    backgroundColor: THEME.colors.surfaceContainerHigh,
    color: THEME.colors.text,
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: THEME.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionHint: { fontSize: 11, fontWeight: '700', color: THEME.colors.primary },
  clearText: { fontSize: 12, fontWeight: '600', color: THEME.colors.error },
  lankaPayBadge: { fontSize: 11, fontWeight: '700', color: THEME.colors.tertiary },
  presetsGrid: { flexDirection: 'row', gap: 8 },
  presetCard: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  presetCardActive: {
    backgroundColor: THEME.colors.primary,
    borderColor: THEME.colors.primary,
  },
  presetSub: { fontSize: 10, fontWeight: '700', color: THEME.colors.textMuted },
  presetSubActive: { color: THEME.colors.onPrimaryContainer },
  presetVal: { fontSize: 13, fontWeight: '800', color: THEME.colors.text, marginTop: 2 },
  presetValActive: { color: '#FFF' },
  methodGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  methodCard: {
    width: '48%',
    padding: 12,
    borderRadius: 12,
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderWidth: 1.5,
    borderColor: THEME.colors.border,
  },
  methodCardActive: {
    backgroundColor: '#FFFFFF',
    borderColor: THEME.colors.primary,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  methodIconRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  methodEmoji: { fontSize: 22 },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: THEME.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  methodTitle: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  methodSub: { fontSize: 10, color: THEME.colors.textMuted, marginTop: 2 },
  tenderInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: THEME.colors.border,
    paddingHorizontal: 16,
    height: 56,
  },
  tenderCurrencyPrefix: { fontSize: 18, fontWeight: '800', color: THEME.colors.textMuted, marginRight: 8 },
  tenderInput: { flex: 1, fontSize: 24, fontWeight: '800', color: THEME.colors.text, textAlign: 'right' },
  changeBox: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  changeBoxSuccess: { backgroundColor: THEME.colors.tertiaryLight },
  changeBoxError: { backgroundColor: THEME.colors.errorLight },
  changeLabel: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  changeLabelSuccess: { color: THEME.colors.tertiary },
  changeLabelError: { color: THEME.colors.error },
  changeSub: { fontSize: 10, color: THEME.colors.textMuted, marginTop: 2 },
  changeAmount: { fontSize: 20, fontWeight: '900' },
  changeAmountSuccess: { color: THEME.colors.tertiary },
  changeAmountError: { color: THEME.colors.error },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggleInfo: { flex: 1, marginRight: 12 },
  toggleTitle: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  toggleSub: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 2 },
  phoneInput: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    fontSize: 14,
  },
  footer: { marginTop: 10, marginBottom: 20 },
  completeBtn: {
    height: 56,
    backgroundColor: THEME.colors.primary,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  completeBtnDisabled: { opacity: 0.5 },
  completeBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  completeBtnPill: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  completeBtnPillText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
})
