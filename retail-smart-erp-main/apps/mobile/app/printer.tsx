import React, { useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, StyleSheet, TextInput, ScrollView, Switch, ActivityIndicator, Alert, BackHandler } from 'react-native'
import { router } from 'expo-router'
import { THEME } from '../src/lib/theme'
import {
  blankPrinter,
  DEFAULT_LABEL_MEDIA,
  getPrinters,
  isNativePrinterAvailable,
  LABEL_LANGUAGE_LABELS,
  listBluetoothDevices,
  listUsbDevices,
  openDrawer,
  printerErrorMessage,
  removePrinter,
  ROLE_LABELS,
  savePrinter,
  testPrintPrinter,
  TRANSPORT_LABELS,
  type BluetoothDevice,
  type LabelLanguage,
  type LabelMediaSettings,
  type PrinterConfig,
  type PrinterRole,
  type PrinterTransport,
  type UsbDevice,
} from '../src/lib/printer'
import { useHeaderPad } from '../src/lib/safeArea'
import { goBack } from '../src/lib/nav'

const ROLES: Array<{ id: PrinterRole; emoji: string; sub: string }> = [
  { id: 'receipt', emoji: '🧾', sub: 'Sale receipts, Z-reports, cash drawer' },
  { id: 'label', emoji: '🏷️', sub: 'Barcode / price labels (TSPL, ZPL, EPL)' },
  { id: 'kitchen', emoji: '🍳', sub: 'Kitchen / order tickets (ESC/POS)' },
]
const LANGUAGES: LabelLanguage[] = ['tspl', 'zpl', 'epl', 'escpos-raster']

function transportDetail(p: PrinterConfig): string {
  switch (p.transport) {
    case 'bluetooth':
      return p.bluetoothName ? `${p.bluetoothName} (${p.bluetoothAddress || '?'})` : p.bluetoothAddress || 'no device selected'
    case 'usb':
      return p.usbName || (p.usbVendorId ? `${p.usbVendorId}:${p.usbProductId}` : 'no device selected')
    case 'network':
      return p.host ? `${p.host}:${p.port || 9100}` : 'no IP set'
    default:
      return ''
  }
}

function mediaDetail(p: PrinterConfig): string {
  if (p.role === 'label') {
    const m = p.label || DEFAULT_LABEL_MEDIA
    return `${m.widthMm} x ${m.heightMm} mm · gap ${m.gapMm} · ${m.dpi} dpi · ${m.language.toUpperCase()}`
  }
  return `${p.paperWidth}mm paper${p.role === 'receipt' && p.autoPrint ? ' · auto-print' : ''}`
}

/** Printer list: add / edit / remove printers and test each one. */
export default function PrintersScreen() {
  const headerPad = useHeaderPad()
  const [printers, setPrinters] = useState<PrinterConfig[] | null>(null)
  const [editing, setEditing] = useState<PrinterConfig | null>(null)
  const [testing, setTesting] = useState<string | null>(null)

  useEffect(() => {
    getPrinters()
      .then((l) => setPrinters([...l]))
      .catch(() => setPrinters([]))
  }, [])

  async function onTest(p: PrinterConfig) {
    setTesting(p.id)
    try {
      const warnings = await testPrintPrinter(p)
      Alert.alert('Test Print Sent', `Check ${p.name} for the test ${p.role === 'label' ? 'label' : 'page'}.${warnings.length ? `\n\n${warnings.join('\n')}` : ''}`)
    } catch (e) {
      Alert.alert('Print Failed', printerErrorMessage(e))
    } finally {
      setTesting(null)
    }
  }

  function addPrinter() {
    Alert.alert('Add printer', 'What will this printer be used for?', [
      ...ROLES.map((r) => ({ text: ROLE_LABELS[r.id], onPress: () => setEditing(blankPrinter(r.id)) })),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }

  if (editing) {
    return (
      <PrinterEditor
        key={editing.id}
        initial={editing}
        isNew={!printers?.some((p) => p.id === editing.id)}
        onDone={(list) => {
          if (list) setPrinters([...list])
          setEditing(null)
        }}
      />
    )
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, headerPad]}>
        <Pressable style={styles.backBtn} onPress={() => goBack()}>
          <Text style={styles.backBtnText}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Printers</Text>
          <Text style={styles.headerSub}>Receipt, label and kitchen printers</Text>
        </View>
      </View>
      {printers === null ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={THEME.colors.primary} />
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 40 }}>
          {printers.length === 0 && (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>No printers yet. Add a receipt printer for sales and a label printer for barcode labels.</Text>
            </View>
          )}
          {ROLES.map((r) => {
            const list = printers.filter((p) => p.role === r.id)
            if (!list.length) return null
            return (
              <View key={r.id}>
                <Text style={styles.sectionTitle}>
                  {r.emoji} {ROLE_LABELS[r.id]}s
                </Text>
                {list.map((p, idx) => (
                  <Pressable key={p.id} style={styles.card} onPress={() => setEditing({ ...p, label: p.label ? { ...p.label } : undefined })}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[styles.transportTitle, { flex: 1 }]} numberOfLines={1}>
                        {p.name}
                      </Text>
                      {idx === 0 && list.length > 1 ? <Text style={styles.badge}>DEFAULT</Text> : null}
                    </View>
                    <Text style={styles.transportSub}>
                      {TRANSPORT_LABELS[p.transport]}
                      {transportDetail(p) ? ` · ${transportDetail(p)}` : ''}
                    </Text>
                    <Text style={styles.transportSub}>{mediaDetail(p)}</Text>
                    <View style={[styles.actionsRow, { marginTop: 10 }]}>
                      <Pressable style={[styles.secondaryBtn, { flex: 1, marginBottom: 0 }]} onPress={() => onTest(p)} disabled={testing !== null || p.transport === 'none'}>
                        {testing === p.id ? (
                          <ActivityIndicator color={THEME.colors.primary} />
                        ) : (
                          <Text style={[styles.secondaryBtnText, p.transport === 'none' && { color: THEME.colors.textSubtle }]}>{p.role === 'label' ? '🏷️ Test label' : '🧾 Test print'}</Text>
                        )}
                      </Pressable>
                      <Pressable style={[styles.secondaryBtn, { flex: 1, marginBottom: 0 }]} onPress={() => setEditing({ ...p, label: p.label ? { ...p.label } : undefined })}>
                        <Text style={styles.secondaryBtnText}>✏️ Edit</Text>
                      </Pressable>
                    </View>
                  </Pressable>
                ))}
              </View>
            )
          })}
          <Pressable style={styles.saveBtn} onPress={addPrinter}>
            <Text style={styles.saveBtnText}>＋ Add printer</Text>
          </Pressable>
          {printers.some((p) => p.role === 'label') && (
            <Pressable style={[styles.secondaryBtn, { marginTop: 12 }]} onPress={() => router.push('/labels')}>
              <Text style={styles.secondaryBtnText}>🏷️ Print item labels</Text>
            </Pressable>
          )}
        </ScrollView>
      )}
    </View>
  )
}

const TRANSPORTS: Array<{ id: PrinterTransport; emoji: string; sub: string; native: boolean }> = [
  { id: 'none', emoji: '🚫', sub: 'Receipts are shown on screen only', native: false },
  { id: 'bluetooth', emoji: '📶', sub: 'Paired SPP thermal printer', native: true },
  { id: 'usb', emoji: '🔌', sub: 'OTG cable to the printer', native: true },
  { id: 'network', emoji: '🌐', sub: 'Wi-Fi / LAN printer, port 9100', native: true },
  { id: 'system', emoji: '🖨️', sub: 'Android print service or save as PDF', native: false },
]

function PrinterEditor({ initial, isNew, onDone }: { initial: PrinterConfig; isNew: boolean; onDone: (list: PrinterConfig[] | null) => void }) {
  const headerPad = useHeaderPad()
  const [settings, setSettings] = useState<PrinterConfig>(initial)
  const loaded = true
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<'test' | 'drawer' | 'scan' | null>(null)
  const [btDevices, setBtDevices] = useState<BluetoothDevice[] | null>(null)
  const [usbDevices, setUsbDevices] = useState<UsbDevice[] | null>(null)
  const nativeAvailable = isNativePrinterAvailable()

  const [savedList, setSavedList] = useState<PrinterConfig[] | null>(null)
  const media: LabelMediaSettings = settings.label || DEFAULT_LABEL_MEDIA
  const isLabel = settings.role === 'label'

  function update(patch: Partial<PrinterConfig>) {
    setSettings((prev) => ({ ...prev, ...patch }))
  }

  function updateMedia(patch: Partial<LabelMediaSettings>) {
    setSettings((prev) => ({ ...prev, label: { ...(prev.label || DEFAULT_LABEL_MEDIA), ...patch } }))
  }

  function setRole(role: PrinterRole) {
    setSettings((prev) => ({
      ...prev,
      role,
      name: !prev.name || Object.values(ROLE_LABELS).includes(prev.name) ? ROLE_LABELS[role] : prev.name,
      label: role === 'label' ? prev.label || { ...DEFAULT_LABEL_MEDIA } : prev.label,
      autoPrint: role === 'receipt' ? prev.autoPrint : false,
      drawerKick: role === 'receipt' ? prev.drawerKick : false,
    }))
  }

  async function persist(next?: PrinterConfig): Promise<PrinterConfig> {
    const toSave = next || settings
    setSaving(true)
    try {
      const list = await savePrinter(toSave)
      setSavedList(list)
      return list.find((p) => p.id === toSave.id) || toSave
    } finally {
      setSaving(false)
    }
  }

  function close() {
    onDone(savedList)
  }

  // Android hardware back closes the editor (back to the printer list) instead of leaving the
  // screen. Registered after the navigator's own handler, so it runs first.
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current()
      return true
    })
    return () => sub.remove()
  }, [])

  function onRemove() {
    Alert.alert('Remove printer?', settings.name, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            onDone(await removePrinter(settings.id))
          } catch (e) {
            Alert.alert('Printer', printerErrorMessage(e))
          }
        },
      },
    ])
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
    if (isLabel && settings.transport === 'system') {
      Alert.alert('Label printer', 'Label printers need a Bluetooth, USB or network connection.')
      return
    }
    setBusy('test')
    try {
      const saved = await persist()
      const warnings = await testPrintPrinter(saved)
      Alert.alert('Test Print Sent', `Check the printer for the test ${isLabel ? 'label' : 'page'}.${warnings.length ? `\n\n${warnings.join('\n')}` : ''}`)
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
    if (!settings.name.trim()) {
      Alert.alert('Name', 'Give this printer a name (e.g. "Counter 1 receipts").')
      return
    }
    if (isLabel && (!(media.widthMm >= 10) || !(media.heightMm >= 5))) {
      Alert.alert('Label size', 'Enter the label width and height in mm.')
      return
    }
    try {
      await persist({ ...settings, name: settings.name.trim(), host: settings.host?.trim(), port: Number(settings.port) || 9100 })
    } catch (e) {
      Alert.alert('Not saved', printerErrorMessage(e))
      return
    }
    Alert.alert('Saved', 'Printer settings saved on this device.', [{ text: 'OK', onPress: close }])
  }

  const rawSelected = settings.transport === 'bluetooth' || settings.transport === 'usb' || settings.transport === 'network'
  const numText = (n: number | undefined) => (n === undefined || n === null || Number.isNaN(n) ? '' : String(n))
  const parseNum = (v: string) => {
    const n = Number(v.replace(',', '.').replace(/[^0-9.]/g, ''))
    return Number.isFinite(n) ? n : 0
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, headerPad]}>
        <Pressable style={styles.backBtn} onPress={close}>
          <Text style={styles.backBtnText}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{isNew ? `New ${ROLE_LABELS[settings.role].toLowerCase()}` : settings.name}</Text>
          <Text style={styles.headerSub}>{isLabel ? 'Thermal label printer (TSPL / ZPL / EPL)' : settings.role === 'kitchen' ? 'ESC/POS kitchen ticket printer' : 'ESC/POS thermal printer & cash drawer'}</Text>
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

          <Text style={styles.sectionTitle}>Printer</Text>
          <View style={styles.card}>
            <Text style={styles.inputLabel}>NAME</Text>
            <TextInput
              style={[styles.input, { fontFamily: undefined }]}
              placeholder="e.g. Counter 1 receipts"
              placeholderTextColor={THEME.colors.textSubtle}
              value={settings.name}
              onChangeText={(v) => update({ name: v })}
            />
            <Text style={styles.inputLabel}>ROLE</Text>
            {ROLES.map((r) => {
              const active = settings.role === r.id
              return (
                <Pressable key={r.id} style={styles.transportRow} onPress={() => setRole(r.id)}>
                  <Text style={styles.transportEmoji}>{r.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.transportTitle, active && { color: THEME.colors.primary }]}>{ROLE_LABELS[r.id]}</Text>
                    <Text style={styles.transportSub}>{r.sub}</Text>
                  </View>
                  <View style={[styles.radio, active && styles.radioActive]}>{active ? <View style={styles.radioDot} /> : null}</View>
                </Pressable>
              )
            })}
          </View>

          <Text style={styles.sectionTitle}>Connection</Text>
          <View style={styles.card}>
            {TRANSPORTS.map((t) => {
              const active = settings.transport === t.id
              const disabled = (t.native && !nativeAvailable) || (isLabel && t.id === 'system')
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
                    <Text style={styles.transportSub}>{isLabel && t.id === 'system' ? 'Not for label printers' : disabled ? 'Needs the native build' : t.sub}</Text>
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

          {isLabel && (
            <>
              <Text style={styles.sectionTitle}>Labels</Text>
              <View style={styles.card}>
                <Text style={styles.inputLabel}>PRINTER LANGUAGE</Text>
                {LANGUAGES.map((l) => {
                  const active = media.language === l
                  return (
                    <Pressable key={l} style={styles.transportRow} onPress={() => updateMedia({ language: l })}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.transportTitle, active && { color: THEME.colors.primary }]}>{LABEL_LANGUAGE_LABELS[l]}</Text>
                        {l === 'escpos-raster' ? <Text style={styles.transportSub}>Not supported on mobile: use TSPL / ZPL / EPL</Text> : null}
                      </View>
                      <View style={[styles.radio, active && styles.radioActive]}>{active ? <View style={styles.radioDot} /> : null}</View>
                    </Pressable>
                  )
                })}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>WIDTH (MM)</Text>
                    <TextInput style={styles.input} keyboardType="decimal-pad" value={numText(media.widthMm)} onChangeText={(v) => updateMedia({ widthMm: parseNum(v) })} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>HEIGHT (MM)</Text>
                    <TextInput style={styles.input} keyboardType="decimal-pad" value={numText(media.heightMm)} onChangeText={(v) => updateMedia({ heightMm: parseNum(v) })} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>GAP (MM)</Text>
                    <TextInput style={styles.input} keyboardType="decimal-pad" value={numText(media.gapMm)} onChangeText={(v) => updateMedia({ gapMm: parseNum(v) })} />
                  </View>
                </View>
                <Text style={styles.inputLabel}>RESOLUTION</Text>
                <View style={styles.segment}>
                  {([203, 300] as const).map((d) => {
                    const active = media.dpi === d
                    return (
                      <Pressable key={d} style={[styles.segmentBtn, active && styles.segmentBtnActive]} onPress={() => updateMedia({ dpi: d })}>
                        <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{d} dpi</Text>
                      </Pressable>
                    )
                  })}
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>DARKNESS (OPTIONAL)</Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="number-pad"
                      placeholder="printer default"
                      placeholderTextColor={THEME.colors.textSubtle}
                      value={numText(media.darkness)}
                      onChangeText={(v) => updateMedia({ darkness: v.trim() === '' ? undefined : parseNum(v) })}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>SPEED (OPTIONAL)</Text>
                    <TextInput
                      style={styles.input}
                      keyboardType="number-pad"
                      placeholder="printer default"
                      placeholderTextColor={THEME.colors.textSubtle}
                      value={numText(media.speed)}
                      onChangeText={(v) => updateMedia({ speed: v.trim() === '' ? undefined : parseNum(v) })}
                    />
                  </View>
                </View>
                <Text style={styles.fieldHint}>The template size is used for each label; width / height here are used for the test label.</Text>
              </View>
            </>
          )}

          {!isLabel && (<>
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

            {settings.role === 'receipt' && (<>
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
            </>)}
          </View>
          </>)}

          <View style={styles.actionsRow}>
            <Pressable style={[styles.secondaryBtn, { flex: 1 }]} onPress={onTestPrint} disabled={busy !== null || settings.transport === 'none'}>
              {busy === 'test' ? <ActivityIndicator color={THEME.colors.primary} /> : <Text style={styles.secondaryBtnText}>{isLabel ? '🏷️ Test label' : '🧾 Test print'}</Text>}
            </Pressable>
            {settings.role === 'receipt' && (
              <Pressable style={[styles.secondaryBtn, { flex: 1 }]} onPress={onOpenDrawer} disabled={busy !== null || !rawSelected}>
                {busy === 'drawer' ? <ActivityIndicator color={THEME.colors.primary} /> : <Text style={[styles.secondaryBtnText, !rawSelected && { color: THEME.colors.textSubtle }]}>💰 Open drawer</Text>}
              </Pressable>
            )}
          </View>

          <Pressable style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={onSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnText}>Save Printer</Text>}
          </Pressable>
          {!isNew && (
            <Pressable style={[styles.secondaryBtn, { marginTop: 12, backgroundColor: THEME.colors.errorLight }]} onPress={onRemove} disabled={saving}>
              <Text style={[styles.secondaryBtnText, { color: THEME.colors.error }]}>Remove printer</Text>
            </Pressable>
          )}
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
  badge: { fontSize: 9, fontWeight: '800', color: THEME.colors.primary, backgroundColor: THEME.colors.primaryLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
})
