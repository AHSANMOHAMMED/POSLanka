import React, { useEffect, useRef, useState } from 'react'
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  TextInput,
} from 'react-native'
import * as Linking from 'expo-linking'
import { router } from 'expo-router'
import { THEME, formatLKR } from '../lib/theme'
import { getPrinterSettings, isPrintingEnabled, printerErrorMessage, printReceipt, shareReceiptPdf, type PrinterSettings } from '../lib/printer'
import type { SaleResultData } from './TenderModal'
import { useFeatureFlags } from '../lib/features'
import { FALLBACK_CODES, sendReceiptMessage, useMessagingAvailability } from '../lib/messaging'

interface SaleReceiptModalProps {
  visible: boolean
  onClose: () => void
  saleData: SaleResultData | null
}

type PrintState = { status: 'idle' | 'printing' | 'done' | 'error'; message?: string }

export function SaleReceiptModal({
  visible,
  onClose,
  saleData,
}: SaleReceiptModalProps) {
  const [printer, setPrinter] = useState<PrinterSettings | null>(null)
  const [printState, setPrintState] = useState<PrintState>({ status: 'idle' })
  const [sharing, setSharing] = useState(false)
  const autoPrintedFor = useRef<string | null>(null)
  const features = useFeatureFlags()
  // SMS / WhatsApp through the business's messaging plan (online sales with a server id only)
  const canSendViaServer = visible && !!saleData?.saleId && !saleData?.queued
  const messaging = useMessagingAvailability(canSendViaServer)
  const [phone, setPhone] = useState('')
  const [askPhone, setAskPhone] = useState<'sms' | 'whatsapp' | null>(null)
  const [msgState, setMsgState] = useState<{ status: 'idle' | 'sending' | 'done' | 'error'; text?: string }>({ status: 'idle' })

  const invoiceNo = saleData?.invoiceNo
  const receipt = saleData?.receipt || null
  const wantsAutoPrint = saleData?.autoPrint

  async function doPrint(settings?: PrinterSettings) {
    if (!receipt) return
    setPrintState({ status: 'printing' })
    try {
      await printReceipt(receipt, settings)
      setPrintState({ status: 'done' })
    } catch (e) {
      setPrintState({ status: 'error', message: printerErrorMessage(e) })
    }
  }

  // Load printer settings when a sale is shown and auto-print once per invoice.
  useEffect(() => {
    if (!visible || !saleData) return
    setPrintState({ status: 'idle' })
    setPhone(saleData.customerPhone || '')
    setAskPhone(null)
    setMsgState({ status: 'idle' })
    let cancelled = false
    getPrinterSettings().then((s) => {
      if (cancelled) return
      setPrinter(s)
      const shouldAuto = (wantsAutoPrint ?? s.autoPrint) && isPrintingEnabled(s) && !!receipt
      if (shouldAuto && invoiceNo && autoPrintedFor.current !== invoiceNo) {
        autoPrintedFor.current = invoiceNo
        doPrint(s)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, invoiceNo])

  if (!visible || !saleData) return null

  const printerReady = !!printer && isPrintingEnabled(printer)

  async function sendViaServer(channel: 'sms' | 'whatsapp') {
    if (!saleData?.saleId) return
    const to = phone.trim()
    if (!to) {
      setAskPhone(channel)
      return
    }
    setMsgState({ status: 'sending' })
    const r = await sendReceiptMessage(saleData.saleId, channel, to)
    if (r.ok) {
      setMsgState({ status: 'done', text: channel === 'sms' ? 'SMS sent' : 'WhatsApp message sent' })
      setAskPhone(null)
    } else if (channel === 'whatsapp' && r.code && FALLBACK_CODES.includes(r.code) && features.has('whatsapp')) {
      setMsgState({ status: 'idle' })
      shareWhatsApp(to)
    } else {
      setMsgState({ status: 'error', text: r.error })
    }
  }

  function shareWhatsApp(toPhone?: string) {
    if (!saleData) return
    const r = saleData.receipt
    const lines = r
      ? r.lines.map((l) => `${l.name} x${l.qty} = ${formatLKR(l.total)}`).join('\n')
      : ''
    const text = encodeURIComponent(
      `${r?.business.name || 'skyERPOS'} ${saleData.isReturn ? 'Credit Note' : 'Digital Receipt'}\nInvoice: ${saleData.invoiceNo}\n${lines ? `${lines}\n` : ''}${
        saleData.isReturn ? 'Refund' : 'Total Paid'
      }: ${formatLKR(saleData.total)}\nMethod: ${saleData.tenderMethod}\n${r?.footer || 'Thank you for shopping with us!'}`
    )
    const digits = (toPhone || '').replace(/\D/g, '')
    const waPhone = /^0\d{9}$/.test(digits) ? `94${digits.slice(1)}` : digits
    Linking.openURL(`https://wa.me/${waPhone}?text=${text}`)
  }

  async function sharePdf() {
    if (!receipt) return
    setSharing(true)
    try {
      await shareReceiptPdf(receipt)
    } catch (e) {
      setPrintState({ status: 'error', message: printerErrorMessage(e) })
    } finally {
      setSharing(false)
    }
  }

  const badgeColor = saleData.queued ? THEME.colors.secondaryAmber : saleData.isReturn ? THEME.colors.error : THEME.colors.tertiary

  return (
    <Modal visible={visible} animationType="fade" transparent={true} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Success Check Badge */}
          <View style={[styles.checkBadge, { backgroundColor: badgeColor }]}>
            <Text style={styles.checkEmoji}>{saleData.queued ? '⏳' : saleData.isReturn ? '↩' : '✓'}</Text>
          </View>

          <Text style={styles.title}>{saleData.queued ? 'Saved Offline' : saleData.isReturn ? 'Return Processed' : 'Sale Completed'}</Text>
          <Text style={styles.invoiceNo}>{saleData.invoiceNo}</Text>
          {saleData.queued ? (
            <Text style={styles.queuedNote}>No connection. This sale is queued on the device and will be sent automatically when you are back online.</Text>
          ) : null}

          {/* Receipt Breakdown Box */}
          <View style={styles.receiptBox}>
            <View style={styles.receiptRow}>
              <Text style={styles.label}>{saleData.isReturn ? 'Refund Method' : 'Tender Method'}</Text>
              <Text style={styles.val}>{saleData.tenderMethod}</Text>
            </View>
            <View style={styles.receiptRow}>
              <Text style={styles.label}>{saleData.isReturn ? 'Refund Amount' : 'Total Amount'}</Text>
              <Text style={styles.valBold}>{formatLKR(saleData.total)}</Text>
            </View>
            {saleData.change > 0 && (
              <View style={[styles.receiptRow, styles.changeRow]}>
                <Text style={styles.changeLabel}>Change Given</Text>
                <Text style={styles.changeVal}>{formatLKR(saleData.change)}</Text>
              </View>
            )}
          </View>

          {/* Print status */}
          {printState.status !== 'idle' ? (
            <View style={[styles.printStatus, printState.status === 'error' && styles.printStatusError]}>
              {printState.status === 'printing' ? <ActivityIndicator size="small" color={THEME.colors.primary} /> : null}
              <Text style={[styles.printStatusText, printState.status === 'error' && { color: THEME.colors.error }]} numberOfLines={3}>
                {printState.status === 'printing' ? 'Sending to printer…' : printState.status === 'done' ? 'Receipt sent to printer' : printState.message}
              </Text>
            </View>
          ) : null}

          {/* Action Triggers */}
          <View style={styles.actions}>
            {receipt ? (
              printerReady ? (
                <Pressable style={styles.printBtn} onPress={() => doPrint()} disabled={printState.status === 'printing'}>
                  <Text style={styles.printText}>🖨️ {printState.status === 'done' ? 'Print Again' : 'Print Receipt'}</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={styles.setupBtn}
                  onPress={() => {
                    onClose()
                    router.push('/printer')
                  }}
                >
                  <Text style={styles.setupText}>🖨️ Set up a receipt printer</Text>
                </Pressable>
              )
            ) : null}

            {canSendViaServer && (messaging.sms || messaging.whatsapp) ? (
              <View style={styles.sendBox}>
                {askPhone || phone ? (
                  <TextInput
                    style={styles.phoneInput}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="Customer mobile, e.g. 0771234567"
                    keyboardType="phone-pad"
                    autoFocus={!!askPhone}
                    onSubmitEditing={() => askPhone && sendViaServer(askPhone)}
                  />
                ) : null}
                <View style={styles.shareRow}>
                  {messaging.sms ? (
                    <Pressable style={[styles.smsBtn, { flex: 1 }]} onPress={() => sendViaServer('sms')} disabled={msgState.status === 'sending'}>
                      <Text style={styles.whatsAppText}>✉️ Send SMS</Text>
                    </Pressable>
                  ) : null}
                  {messaging.whatsapp ? (
                    <Pressable style={[styles.whatsAppBtn, { flex: 1 }]} onPress={() => sendViaServer('whatsapp')} disabled={msgState.status === 'sending'}>
                      <Text style={styles.whatsAppText}>💬 Send WhatsApp</Text>
                    </Pressable>
                  ) : null}
                </View>
                {msgState.status !== 'idle' ? (
                  <View style={[styles.printStatus, msgState.status === 'error' && styles.printStatusError]}>
                    {msgState.status === 'sending' ? <ActivityIndicator size="small" color={THEME.colors.primary} /> : null}
                    <Text style={[styles.printStatusText, msgState.status === 'error' && { color: THEME.colors.error }]} numberOfLines={3}>
                      {msgState.status === 'sending' ? 'Sending…' : msgState.text}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.shareRow}>
              {features.has('whatsapp') && !(canSendViaServer && messaging.whatsapp) ? (
                <Pressable style={[styles.whatsAppBtn, { flex: 1 }]} onPress={() => shareWhatsApp(phone)}>
                  <Text style={styles.whatsAppText}>💬 WhatsApp</Text>
                </Pressable>
              ) : null}
              {receipt ? (
                <Pressable style={[styles.pdfBtn, { flex: 1 }]} onPress={sharePdf} disabled={sharing}>
                  {sharing ? <ActivityIndicator size="small" color={THEME.colors.primary} /> : <Text style={styles.pdfText}>📄 Share PDF</Text>}
                </Pressable>
              ) : null}
            </View>

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
  queuedNote: { fontSize: 12, color: THEME.colors.onSecondaryContainer, backgroundColor: THEME.colors.secondaryLight, padding: 10, borderRadius: 8, marginBottom: 16, textAlign: 'center' },
  receiptBox: {
    width: '100%',
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderRadius: 12,
    padding: 16,
    marginBottom: 14,
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
  printStatus: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: THEME.colors.primaryLight, padding: 10, borderRadius: 10, marginBottom: 12 },
  printStatusError: { backgroundColor: THEME.colors.errorLight },
  printStatusText: { flex: 1, fontSize: 12, fontWeight: '600', color: THEME.colors.primary },
  actions: { width: '100%', gap: 10 },
  printBtn: { width: '100%', height: 48, borderRadius: 12, backgroundColor: THEME.colors.text, alignItems: 'center', justifyContent: 'center' },
  printText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  setupBtn: { width: '100%', height: 44, borderRadius: 12, borderWidth: 1, borderColor: THEME.colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: THEME.colors.surfaceContainerLow },
  setupText: { color: THEME.colors.textMuted, fontSize: 13, fontWeight: '700' },
  shareRow: { flexDirection: 'row', gap: 10 },
  whatsAppBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
  },
  whatsAppText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  smsBtn: { height: 48, borderRadius: 12, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBox: { width: '100%', gap: 8 },
  phoneInput: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.colors.border,
    paddingHorizontal: 12,
    fontSize: 14,
    color: THEME.colors.text,
    backgroundColor: THEME.colors.surfaceContainerLow,
  },
  pdfBtn: { height: 48, borderRadius: 12, backgroundColor: THEME.colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  pdfText: { color: THEME.colors.primary, fontSize: 14, fontWeight: '700' },
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
