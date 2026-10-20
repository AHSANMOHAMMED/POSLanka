import React, { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, TextInput, ScrollView, Switch, ActivityIndicator, Alert } from 'react-native'
import { router } from 'expo-router'
import { THEME } from '../src/lib/theme'
import {
  DEFAULT_PRINTER_SETTINGS,
  getPrinterSettings,
  isNativePrinterAvailable,
  listBluetoothDevices,
  listUsbDevices,
  openDrawer,
  printerErrorMessage,
  savePrinterSettings,
  testPrint,
  TRANSPORT_LABELS,
  type BluetoothDevice,
  type PrinterSettings,
  type PrinterTransport,
  type UsbDevice,
} from '../src/lib/printer'

const TRANSPORTS: Array<{ id: PrinterTransport; emoji: string; sub: string; native: boolean }> = [
  { id: 'none', emoji: '🚫', sub: 'Receipts are shown on screen only', native: false },
  { id: 'bluetooth', emoji: '📶', sub: 'Paired SPP thermal printer', native: true },
  { id: 'usb', emoji: '🔌', sub: 'OTG cable to the printer', native: true },
  { id: 'network', emoji: '🌐', sub: 'Wi-Fi / LAN printer, port 9100', native: true },
  { id: 'system', emoji: '🖨️', sub: 'Android print service or save as PDF', native: false },
]

export default function PrinterSettingsScreen() {
  const [settings, setSettings] = useState<PrinterSettings>(DEFAULT_PRINTER_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<'test' | 'drawer' | 'scan' | null>(null)
  const [btDevices, setBtDevices] = useState<BluetoothDevice[] | null>(null)
  const [usbDevices, setUsbDevices] = useState<UsbDevice[] | null>(null)
  const nativeAvailable = isNativePrinterAvailable()

  useEffect(() => {
    getPrinterSettings()
      .then(setSettings)
      .finally(() => setLoaded(true))
  }, [])

  function update(patch: Partial<PrinterSettings>) {
    setSettings((prev) => ({ ...prev, ...patch }))
  }

  async function persist(next?: PrinterSettings): Promise<PrinterSettings> {
    const toSave = next || settings
    setSaving(true)
    try {
      await savePrinterSettings(toSave)
      return toSave
    } finally {
      setSaving(false)
    }
  }

  async function scanBluetooth() {
    setBusy('scan')
    try {
      const list = await listBluetoothDevices()
      setBtDevices(list)
      if (list.length === 0) Alert.alert('No Paired Printers', 'Pair the printer in Android Bluetooth settings first, then scan again.')
    } catch (e) {
      Alert.alert('Bluetooth', printerErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function scanUsb() {
    setBusy('scan')
    try {
      const list = await listUsbDevices()
      setUsbDevices(list)
      if (list.length === 0) Alert.alert('No USB Printers', 'Connect the printer with an OTG cable and allow USB access when Android asks.')
    } catch (e) {
      Alert.alert('USB', printerErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function onTestPrint() {
    if (settings.transport === 'none') {
      Alert.alert('No Printer', 'Choose a printer transport first.')
      return
    }
    if (settings.transport === 'network' && !settings.host?.trim()) {
      Alert.alert('Printer IP', 'Enter the printer IP address.')
      return
    }
    setBusy('test')
    try {
      const saved = await persist()
      await testPrint(saved)
      Alert.alert('Test Print Sent', 'Check the printer for the test page.')
    } catch (e) {
      Alert.alert('Print Failed', printerErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function onOpenDrawer() {
    setBusy('drawer')
    try {
      const saved = await persist()
      await openDrawer(saved)
    } catch (e) {
      Alert.alert('Cash Drawer', printerErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  async function onSave() {
    if (settings.transport === 'network') {
      const host = settings.host?.trim() || ''
      if (!host) {
        Alert.alert('Printer IP', 'Enter the printer IP address (e.g. 192.168.1.50).')
        return
      }
      const port = Number(settings.port)
      if (!port || port < 1 || port > 65535) {
        Alert.alert('Printer Port', 'Enter a valid TCP port (usually 9100).')
        return
      }
    }
    await persist({ ...settings, host: settings.host?.trim(), port: Number(settings.port) || 9100 })
    Alert.alert('Saved', 'Printer settings saved on this device.', [{ text: 'OK', onPress: () => (router.canGoBack() ? router.back() : router.replace('/pos')) }])
  }

  const rawSelected = settings.transport === 'bluetooth' || settings.transport === 'usb' || settings.transport === 'network'

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => (router.canGoBack() ? router.back() : router.replace('/pos'))}>
          <Text style={styles.backBtnText}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Receipt Printer</Text>
          <Text style={styles.headerSub}>ESC/POS thermal printer & cash drawer</Text>
        </View>
      </View>

      {!loaded ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={THEME.colors.primary} />
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {!nativeAvailable && (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                Bluetooth, USB and network printing need the POSLanka dev-client / EAS build. In Expo Go only "System print / PDF" works.
              </Text>
            </View>
          )}

          <Text style={styles.sectionTitle}>Connection</Text>
          <View style={styles.card}>
            {TRANSPORTS.map((t) => {
              const active = settings.transport === t.id
              const disabled = t.native && !nativeAvailable
              return (
                <Pressable
                  key={t.id}
                  style={[styles.transportRow, active && styles.transportRowActive, disabled && { opacity: 0.45 }]}
                  onPress={() => update({ transport: t.id })}
                  disabled={disabled}
                >
                  <Text style={styles.transportEmoji}>{t.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.transportTitle, active && { color: THEME.colors.primary }]}>{TRANSPORT_LABELS[t.id]}</Text>
                    <Text style={styles.transportSub}>{disabled ? 'Needs the native build' : t.sub}</Text>
                  </View>
                  <View style={[styles.radio, active && styles.radioActive]}>{active ? <View style={styles.radioDot} /> : null}</View>
                </Pressable>
              )
            })}
          </View>

          {settings.transport === 'bluetooth' && (
            <>
              <Text style={styles.sectionTitle}>Bluetooth printer</Text>
              <View style={styles.card}>
                <Text style={styles.fieldHint}>
                  Selected: {settings.bluetoothName ? `${settings.bluetoothName} (${settings.bluetoothAddress})` : settings.bluetoothAddress || 'none'}
                </Text>
                <Pressable style={styles.secondaryBtn} onPress={scanBluetooth} disabled={busy !== null}>
                  {busy === 'scan' ? <ActivityIndicator color={THEME.colors.primary} /> : <Text style={styles.secondaryBtnText}>🔍 Find paired printers</Text>}
                </Pressable>
                {btDevices?.map((d) => {
                  const active = settings.bluetoothAddress === d.address
                  return (
                    <Pressable key={d.address} style={[styles.deviceRow, active && styles.deviceRowActive]} onPress={() => update({ bluetoothAddress: d.address, bluetoothName: d.name })}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.deviceName}>{d.name}</Text>
                        <Text style={styles.deviceMeta}>{d.address}</Text>
                      </View>
                      {active ? <Text style={styles.deviceCheck}>✓</Text> : null}
                    </Pressable>
                  )
                })}
                <Text style={styles.inputLabel}>OR ENTER MAC ADDRESS</Text>
                <TextInput
                  style={styles.input}
                  placeholder="AA:BB:CC:DD:EE:FF"
                  placeholderTextColor={THEME.colors.textSubtle}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  value={settings.bluetoothAddress || ''}
                  onChangeText={(v) => update({ bluetoothAddress: v.trim(), bluetoothName: btDevices?.find((d) => d.address === v.trim())?.name })}
                />
              </View>
            </>
          )}

          {settings.transport === 'usb' && (
            <>
              <Text style={styles.sectionTitle}>USB printer</Text>
              <View style={styles.card}>
                <Text style={styles.fieldHint}>
                  Selected: {settings.usbName ? `${settings.usbName} (${settings.usbVendorId}:${settings.usbProductId})` : settings.usbVendorId ? `${settings.usbVendorId}:${settings.usbProductId}` : 'none'}
                </Text>
                <Pressable style={styles.secondaryBtn} onPress={scanUsb} disabled={busy !== null}>
                  {busy === 'scan' ? <ActivityIndicator color={THEME.colors.primary} /> : <Text style={styles.secondaryBtnText}>🔍 Find USB printers</Text>}
                </Pressable>
                {usbDevices?.map((d) => {
                  const active = settings.usbVendorId === d.vendorId && settings.usbProductId === d.productId
                  return (
                    <Pressable
                      key={`${d.vendorId}:${d.productId}`}
                      style={[styles.deviceRow, active && styles.deviceRowActive]}
                      onPress={() => update({ usbVendorId: d.vendorId, usbProductId: d.productId, usbName: d.name })}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.deviceName}>{d.name}</Text>
                        <Text style={styles.deviceMeta}>
                          VID {d.vendorId} · PID {d.productId}
                        </Text>
                      </View>
                      {active ? <Text style={styles.deviceCheck}>✓</Text> : null}
                    </Pressable>
                  )
                })}
              </View>
            </>
          )}

          {settings.transport === 'network' && (
            <>
              <Text style={styles.sectionTitle}>Network printer</Text>
              <View style={styles.card}>
                <Text style={styles.inputLabel}>IP ADDRESS / HOSTNAME</Text>
                <TextInput
                  style={styles.input}
                  placeholder="192.168.1.50"
                  placeholderTextColor={THEME.colors.textSubtle}
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={settings.host || ''}
                  onChangeText={(v) => update({ host: v })}
                />
                <Text style={styles.inputLabel}>PORT</Text>
                <TextInput
                  style={styles.input}
                  placeholder="9100"
                  placeholderTextColor={THEME.colors.textSubtle}
                  keyboardType="number-pad"
                  value={String(settings.port ?? 9100)}
                  onChangeText={(v) => update({ port: Number(v.replace(/[^0-9]/g, '')) || 0 })}
                />
                <Text style={styles.fieldHint}>Most LAN thermal printers accept RAW ESC/POS on port 9100. Print the printer's self-test page to find its IP.</Text>
              </View>
            </>
          )}

          <Text style={styles.sectionTitle}>Paper & behaviour</Text>
          <View style={styles.card}>
            <Text style={styles.inputLabel}>PAPER WIDTH</Text>
            <View style={styles.segment}>
              {([58, 80] as const).map((w) => {
                const active = settings.paperWidth === w
                return (
                  <Pressable key={w} style={[styles.segmentBtn, active && styles.segmentBtnActive]} onPress={() => update({ paperWidth: w })}>
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                      {w}mm · {w === 80 ? 48 : 32} cols
                    </Text>
                  </Pressable>
                )
              })}
            </View>

            <View style={styles.toggleRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={styles.toggleTitle}>Auto-print receipts</Text>
                <Text style={styles.toggleSub}>Print after every completed sale and the Z-report on shift close.</Text>
              </View>
              <Switch
                value={settings.autoPrint}
                onValueChange={(v) => update({ autoPrint: v })}
                trackColor={{ false: THEME.colors.border, true: THEME.colors.primary }}
                disabled={settings.transport === 'none'}
              />
            </View>
            <View style={styles.toggleRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={styles.toggleTitle}>Kick cash drawer</Text>
                <Text style={styles.toggleSub}>Pulse the drawer connector (RJ11 on the printer) before each sale receipt.</Text>
              </View>
              <Switch
                value={settings.drawerKick}
                onValueChange={(v) => update({ drawerKick: v })}
                trackColor={{ false: THEME.colors.border, true: THEME.colors.primary }}
                disabled={!rawSelected}
              />
            </View>
          </View>

          <View style={styles.actionsRow}>
            <Pressable style={[styles.secondaryBtn, { flex: 1 }]} onPress={onTestPrint} disabled={busy !== null || settings.transport === 'none'}>
              {busy === 'test' ? <ActivityIndicator color={THEME.colors.primary} /> : <Text style={styles.secondaryBtnText}>🧾 Test print</Text>}
            </Pressable>
            <Pressable style={[styles.secondaryBtn, { flex: 1 }]} onPress={onOpenDrawer} disabled={busy !== null || !rawSelected}>
              {busy === 'drawer' ? <ActivityIndicator color={THEME.colors.primary} /> : <Text style={[styles.secondaryBtnText, !rawSelected && { color: THEME.colors.textSubtle }]}>💰 Open drawer</Text>}
            </Pressable>
          </View>

          <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={onSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnText}>Save Printer Settings</Text>}
          </Pressable>
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: THEME.colors.background },
  header: {
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.border,
    gap: 10,
  },
  backBtn: { width: 38, height: 38, borderRadius: 8, backgroundColor: THEME.colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  backBtnText: { fontSize: 20, fontWeight: '700', color: THEME.colors.text },
  headerTitle: { fontSize: 18, fontWeight: '800', color: THEME.colors.text },
  headerSub: { fontSize: 11, color: THEME.colors.textMuted },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1, padding: 16 },
  notice: { backgroundColor: THEME.colors.secondaryLight, padding: 12, borderRadius: 10, marginBottom: 14 },
  noticeText: { fontSize: 12, fontWeight: '600', color: THEME.colors.onSecondaryContainer },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: THEME.colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 6 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: THEME.colors.border },
  transportRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: THEME.colors.border },
  transportRowActive: {},
  transportEmoji: { fontSize: 20, width: 28, textAlign: 'center' },
  transportTitle: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  transportSub: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 1 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: THEME.colors.outline, alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: THEME.colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: THEME.colors.primary },
  fieldHint: { fontSize: 12, color: THEME.colors.textMuted, marginBottom: 10 },
  secondaryBtn: {
    height: 44,
    borderRadius: 10,
    backgroundColor: THEME.colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  secondaryBtnText: { color: THEME.colors.primary, fontWeight: '800', fontSize: 13 },
  deviceRow: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: THEME.colors.border, marginBottom: 8 },
  deviceRowActive: { borderColor: THEME.colors.primary, backgroundColor: THEME.colors.primaryLight },
  deviceName: { fontSize: 13, fontWeight: '700', color: THEME.colors.text },
  deviceMeta: { fontSize: 11, color: THEME.colors.textMuted, fontFamily: 'monospace' },
  deviceCheck: { fontSize: 16, fontWeight: '900', color: THEME.colors.primary },
  inputLabel: { fontSize: 10, fontWeight: '800', color: THEME.colors.textMuted, letterSpacing: 0.5, marginBottom: 6, marginTop: 6 },
  input: {
    borderWidth: 1,
    borderColor: THEME.colors.border,
    backgroundColor: THEME.colors.surfaceContainerLow,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: THEME.colors.text,
    marginBottom: 8,
    fontFamily: 'monospace',
  },
  segment: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  segmentBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: THEME.colors.surfaceContainerLow, borderWidth: 1, borderColor: THEME.colors.border },
  segmentBtnActive: { backgroundColor: THEME.colors.primary, borderColor: THEME.colors.primary },
  segmentText: { fontSize: 12, fontWeight: '700', color: THEME.colors.text },
  segmentTextActive: { color: '#FFF' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1, borderTopColor: THEME.colors.border },
  toggleTitle: { fontSize: 14, fontWeight: '700', color: THEME.colors.text },
  toggleSub: { fontSize: 11, color: THEME.colors.textMuted, marginTop: 2 },
  actionsRow: { flexDirection: 'row', gap: 10 },
  saveBtn: { height: 52, borderRadius: 12, backgroundColor: THEME.colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  saveBtnText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
})
