import React from 'react'
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native'
import * as Linking from 'expo-linking'
import { THEME, formatLKR } from '../lib/theme'

interface SaleReceiptModalProps {
  visible: boolean
  onClose: () => void
  saleData: {
    invoiceNo: string
    total: number
    change: number
    tenderMethod: string
  } | null
}

export function SaleReceiptModal({
  visible,
  onClose,
  saleData,
}: SaleReceiptModalProps) {
  if (!visible || !saleData) return null

  function shareWhatsApp() {
    const text = encodeURIComponent(
      `POSLanka Digital Receipt\nInvoice: ${saleData.invoiceNo}\nTotal Paid: ${formatLKR(saleData.total)}\nMethod: ${saleData.tenderMethod}\nThank you for shopping with us!`
    )
    Linking.openURL(`https://wa.me/?text=${text}`)
  }

  return (
    <Modal visible={visible} animationType="fade" transparent={true} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Success Check Badge */}
          <View style={styles.checkBadge}>
            <Text style={styles.checkEmoji}>✓</Text>
          </View>

          <Text style={styles.title}>Sale Completed</Text>
          <Text style={styles.invoiceNo}>{saleData.invoiceNo}</Text>

          {/* Receipt Breakdown Box */}
          <View style={styles.receiptBox}>
            <View style={styles.receiptRow}>
              <Text style={styles.label}>Tender Method</Text>
              <Text style={styles.val}>{saleData.tenderMethod}</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.label}>Total Amount</Text>
              <Text style={styles.valBold}>{formatLKR(saleData.total)}</Text>
            </View>
            {saleData.change > 0 && (
              <View style={[styles.receiptRow, styles.changeRow]}>
                <Text style={styles.changeLabel}>Change Given</Text>
                <Text style={styles.changeVal}>{formatLKR(saleData.change)}</Text>
              </View>
            )}
          </View>

          {/* Action Triggers */}
          <View style={styles.actions}>
            <Pressable style={styles.whatsAppBtn} onPress={shareWhatsApp}>
              <Text style={styles.whatsAppText}>💬 Send WhatsApp Slip</Text>
            </Pressable>

            <Pressable style={styles.newSaleBtn} onPress={onClose}>
              <Text style={styles.newSaleText}>+ Start New Sale</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 10,
  },
  checkBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: THEME.colors.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  checkEmoji: { fontSize: 32, color: '#FFF', fontWeight: '900' },
  title: { fontSize: 22, fontWeight: '800', color: THEME.colors.text },
  invoiceNo: { fontSize: 13, fontWeight: '700', color: THEME.colors.primary, marginTop: 4, marginBottom: 20 },
  receiptBox: {
    width: '100%',
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  label: { fontSize: 13, color: THEME.colors.textMuted },
  val: { fontSize: 13, fontWeight: '600', color: THEME.colors.text },
  valBold: { fontSize: 15, fontWeight: '800', color: THEME.colors.text },
  changeRow: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.border,
    marginBottom: 0,
  },
  changeLabel: { fontSize: 13, fontWeight: '700', color: THEME.colors.tertiary },
  changeVal: { fontSize: 15, fontWeight: '800', color: THEME.colors.tertiary },
  actions: { width: '100%', gap: 10 },
  whatsAppBtn: {
    width: '100%',
    height: 48,
    borderRadius: 12,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
  },
  whatsAppText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  newSaleBtn: {
    width: '100%',
    height: 50,
    borderRadius: 12,
    backgroundColor: THEME.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newSaleText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
})
