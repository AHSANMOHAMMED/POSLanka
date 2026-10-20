import React from 'react'
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
} from 'react-native'
import { THEME, formatLKR } from '../lib/theme'

export interface CartLine {
  /** Cart line key. Equals the item id except for scale-weighed lines (`<itemId>#<n>`). */
  id: string
  /** Catalog item id when it differs from `id`. */
  itemId?: string
  name: string
  sku?: string | null
  barcode?: string | null
  sellingPrice: string
  quantity: number
  unit?: string | null
  taxTemplateId?: string | null
  trackStock?: boolean
  availableStock?: number | null
}

interface CartDrawerModalProps {
  visible: boolean
  onClose: () => void
  cart: CartLine[]
  onUpdateQuantity: (id: string, delta: number) => void
  onRemoveItem: (id: string) => void
  onClearCart: () => void
  onHoldCart: () => void
  onProceedToTender: () => void
  /** Document tax computed by the parent (tax templates). */
  tax: number
  taxLabel?: string
  /** True when the tax is already included in item prices. */
  taxInclusive?: boolean
}

export function CartDrawerModal({
  visible,
  onClose,
  cart,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  onHoldCart,
  onProceedToTender,
  tax,
  taxLabel = 'Tax',
  taxInclusive = false,
}: CartDrawerModalProps) {
  if (!visible) return null

  const subtotal = cart.reduce(
    (sum, line) => sum + Number(line.sellingPrice) * line.quantity,
    0
  )
  const totalPayable = taxInclusive ? subtotal : subtotal + tax

  return (
    <Modal visible={visible} animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissOverlay} onPress={onClose} />
        <View style={styles.sheetContainer}>
          {/* Grab Handle */}
          <View style={styles.handleBar} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{cart.reduce((c, i) => c + i.quantity, 0)}</Text>
              </View>
              <Text style={styles.title}>Active Cart Details</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </Pressable>
          </View>

          {/* Cart Items List */}
          {cart.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>Cart is empty</Text>
              <Text style={styles.emptySub}>Scan a barcode or tap products to add them.</Text>
            </View>
          ) : (
            <FlatList
              data={cart}
              keyExtractor={(item) => item.id}
              style={styles.list}
              contentContainerStyle={{ paddingBottom: 16 }}
              renderItem={({ item }) => {
                const lineTotal = Number(item.sellingPrice) * item.quantity
                return (
                  <View style={styles.cartRow}>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemName} numberOfLines={2}>
                        {item.name}
                      </Text>
                      <Text style={styles.itemSku}>
                        {item.barcode ? `Barcode: ${item.barcode}` : item.sku ? `SKU: ${item.sku}` : 'Standard Item'}
                      </Text>
                      <Text style={styles.unitPrice}>
                        {formatLKR(item.sellingPrice)} each
                      </Text>
                    </View>

                    {/* Quantity Stepper & Line Total */}
                    <View style={styles.actionsCol}>
                      <View style={styles.stepper}>
                        <Pressable
                          style={styles.stepBtn}
                          onPress={() => onUpdateQuantity(item.id, -1)}
                        >
                          <Text style={styles.stepText}>−</Text>
                        </Pressable>
                        <View style={styles.countBox}>
                          <Text style={styles.countText}>{item.quantity}</Text>
                        </View>
                        <Pressable
                          style={styles.stepBtn}
                          onPress={() => onUpdateQuantity(item.id, 1)}
                        >
                          <Text style={styles.stepText}>+</Text>
                        </Pressable>
                      </View>

                      <View style={styles.priceRow}>
                        <Text style={styles.lineTotal}>{formatLKR(lineTotal)}</Text>
                        <Pressable
                          style={styles.trashBtn}
                          onPress={() => onRemoveItem(item.id)}
                        >
                          <Text style={styles.trashText}>🗑</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                )
              }}
            />
          )}

          {/* Financial Breakdown */}
          {cart.length > 0 && (
            <View style={styles.summaryBox}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Subtotal</Text>
                <Text style={styles.summaryVal}>{formatLKR(subtotal)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{taxLabel}{taxInclusive ? ' (included)' : ''}</Text>
                <Text style={styles.summaryVal}>{formatLKR(tax)}</Text>
              </View>
              <View style={[styles.summaryRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total Payable</Text>
                <Text style={styles.totalVal}>{formatLKR(totalPayable)}</Text>
              </View>

              {/* Action Buttons */}
              <View style={styles.buttonsRow}>
                <Pressable style={styles.secondaryBtn} onPress={onHoldCart}>
                  <Text style={styles.secondaryBtnText}>⏸ Hold</Text>
                </Pressable>
                <Pressable style={styles.secondaryBtn} onPress={onClearCart}>
                  <Text style={[styles.secondaryBtnText, { color: THEME.colors.error }]}>✕ Clear</Text>
                </Pressable>
                <Pressable
                  style={styles.primaryChargeBtn}
                  onPress={() => {
                    onClose()
                    onProceedToTender()
                  }}
                >
                  <Text style={styles.primaryChargeText}>Charge {formatLKR(totalPayable)} →</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  dismissOverlay: { flex: 1 },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    minHeight: '45%',
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 20,
  },
  handleBar: {
    width: 44,
    height: 5,
    backgroundColor: THEME.colors.outline,
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
  },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: {
    backgroundColor: THEME.colors.primary,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: { color: '#FFF', fontWeight: '700', fontSize: 13 },
  title: { fontSize: 18, fontWeight: '700', color: THEME.colors.text },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: THEME.colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { color: THEME.colors.textMuted, fontSize: 16, fontWeight: '600' },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: THEME.colors.textMuted, marginBottom: 8 },
  emptySub: { fontSize: 14, color: THEME.colors.textSubtle, textAlign: 'center' },
  list: { flex: 1, paddingHorizontal: 16 },
  cartRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  itemInfo: { flex: 1, marginRight: 12 },
  itemName: { fontSize: 14, fontWeight: '700', color: THEME.colors.text, lineHeight: 18 },
  itemSku: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 2 },
  unitPrice: { fontSize: 12, color: THEME.colors.primary, fontWeight: '600', marginTop: 3 },
  actionsCol: { alignItems: 'flex-end', gap: 6 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.colors.border,
  },
  stepBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepText: { fontSize: 18, fontWeight: '700', color: THEME.colors.primary },
  countBox: { minWidth: 28, alignItems: 'center' },
  countText: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lineTotal: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  trashBtn: { padding: 4 },
  trashText: { fontSize: 14 },
  summaryBox: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
    backgroundColor: THEME.colors.surface,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  summaryLabel: { fontSize: 13, color: THEME.colors.textMuted },
  summaryVal: { fontSize: 13, fontWeight: '600', color: THEME.colors.text },
  totalRow: {
    marginTop: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
    marginBottom: 12,
  },
  totalLabel: { fontSize: 16, fontWeight: '700', color: THEME.colors.text },
  totalVal: { fontSize: 18, fontWeight: '800', color: THEME.colors.primary },
  buttonsRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  secondaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: THEME.colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { fontSize: 12, fontWeight: '700', color: THEME.colors.text },
  primaryChargeBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: THEME.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: THEME.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  primaryChargeText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
})
