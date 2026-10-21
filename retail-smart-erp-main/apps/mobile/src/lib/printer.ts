// Receipt printer settings + transports.
//
// Raw ESC/POS bytes (src/lib/escpos.ts) are pushed over Bluetooth classic SPP,
// USB or TCP 9100 through `react-native-thermal-receipt-printer-image-qr`.
// That package is a native module and only exists in a dev-client / EAS build,
// so it is loaded with a guarded require: in Expo Go (or when the module is
// missing) those transports report "not available" and the always-present
// `system` transport (expo-print → Android print service / PDF share) is used.
import { Platform, PermissionsAndroid, Share } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import * as Print from 'expo-print'
import * as FileSystem from 'expo-file-system'
import {
  buildReceipt,
  buildZReport,
  bytesToBase64,
  bytesToPlainText,
  EscPosBuilder,
  formatReceiptDate,
  invoiceCodeFor,
  money,
  paymentLabel,
  qtyText,
  sanitizeAscii,
  type PaperWidth,
  type ReceiptInput,
  type ZReportInput,
} from './escpos'
import { code128Svg } from './code128'
import { businessHeaderHtml, escapeHtml, zReportHtml } from './printHtml'
import { qrSvg } from './qr'
import {
  encodeLabels,
  labelTestTemplate,
  ESCPOS_RASTER_UNSUPPORTED,
  type LabelItemData,
  type LabelPrintItem,
  type LabelTemplateLike,
  type RawLabelLanguage,
} from './label'

export type PrinterTransport = 'none' | 'bluetooth' | 'usb' | 'network' | 'system'

export interface PrinterSettings {
  transport: PrinterTransport
  /** Bluetooth classic MAC address (from listBluetoothDevices). */
  bluetoothAddress?: string
  bluetoothName?: string
  usbVendorId?: string
  usbProductId?: string
  usbName?: string
  /** Network printer host (IP / hostname). */
  host?: string
  /** TCP port, 9100 for RAW printing. */
  port: number
  paperWidth: PaperWidth
  /** Print a receipt automatically after every completed sale / shift close. */
  autoPrint: boolean
  /** Pulse the cash drawer before printing a sale receipt. */
  drawerKick: boolean
}

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  transport: 'none',
  port: 9100,
  paperWidth: 58,
  autoPrint: false,
  drawerKick: false,
}

export const TRANSPORT_LABELS: Record<PrinterTransport, string> = {
  none: 'No printer',
  bluetooth: 'Bluetooth (SPP)',
  usb: 'USB (OTG)',
  network: 'Network (TCP 9100)',
  system: 'System print / PDF',
}

// ---------------------------------------------------------------------------
// Multiple printers with roles
// ---------------------------------------------------------------------------
export type PrinterRole = 'receipt' | 'label' | 'kitchen'
export type LabelLanguage = RawLabelLanguage

export const ROLE_LABELS: Record<PrinterRole, string> = {
  receipt: 'Receipt printer',
  label: 'Label printer',
  kitchen: 'Kitchen printer',
}

export const LABEL_LANGUAGE_LABELS: Record<LabelLanguage, string> = {
  tspl: 'TSPL (TSC, Xprinter, Gainscha, HPRT)',
  zpl: 'ZPL (Zebra)',
  epl: 'EPL2 (older Zebra / Eltron)',
  'escpos-raster': 'ESC/POS raster (web only)',
}

/** Media settings for label printers. */
export interface LabelMediaSettings {
  widthMm: number
  heightMm: number
  /** Gap between die-cut labels (mm). */
  gapMm: number
  dpi: 203 | 300
  language: LabelLanguage
  /** Optional print darkness (TSPL DENSITY 0-15, ZPL ~SD 0-30, EPL D 0-15). */
  darkness?: number
  /** Optional print speed. */
  speed?: number
}

export const DEFAULT_LABEL_MEDIA: LabelMediaSettings = { widthMm: 50, heightMm: 30, gapMm: 2, dpi: 203, language: 'tspl' }

/**
 * One configured printer. Receipt / kitchen printers use `paperWidth`
 * (+ autoPrint / drawerKick for receipts); label printers use `label`.
 */
export interface PrinterConfig extends PrinterSettings {
  id: string
  name: string
  role: PrinterRole
  label?: LabelMediaSettings
}

const SETTINGS_KEY = 'poslanka_printer_settings' // legacy single receipt printer (pre multi-printer)
const PRINTERS_FILE = 'poslanka_printers_v2.json'
const PRINTERS_FALLBACK_KEY = 'poslanka_printers_v2'

let cachedPrinters: PrinterConfig[] | null = null

export function newPrinterId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeLabelMedia(raw: any): LabelMediaSettings {
  const num = (v: unknown, d: number, min: number, max: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= min && n <= max ? n : d
  }
  const lang: LabelLanguage = ['tspl', 'zpl', 'epl', 'escpos-raster'].includes(raw?.language) ? raw.language : 'tspl'
  const out: LabelMediaSettings = {
    widthMm: num(raw?.widthMm, DEFAULT_LABEL_MEDIA.widthMm, 10, 120),
    heightMm: num(raw?.heightMm, DEFAULT_LABEL_MEDIA.heightMm, 5, 300),
    gapMm: num(raw?.gapMm, DEFAULT_LABEL_MEDIA.gapMm, 0, 20),
    dpi: Number(raw?.dpi) === 300 ? 300 : 203,
    language: lang,
  }
  if (raw?.darkness !== undefined && raw?.darkness !== null && raw?.darkness !== '') out.darkness = num(raw.darkness, 8, 0, 30)
  if (raw?.speed !== undefined && raw?.speed !== null && raw?.speed !== '') out.speed = num(raw.speed, 4, 1, 14)
  return out
}

export function normalizePrinter(raw: any): PrinterConfig {
  const role: PrinterRole = raw?.role === 'label' || raw?.role === 'kitchen' ? raw.role : 'receipt'
  const transport: PrinterTransport = ['none', 'bluetooth', 'usb', 'network', 'system'].includes(raw?.transport) ? raw.transport : 'none'
  const p: PrinterConfig = {
    ...DEFAULT_PRINTER_SETTINGS,
    ...(raw || {}),
    id: typeof raw?.id === 'string' && raw.id ? raw.id : newPrinterId(),
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : ROLE_LABELS[role],
    role,
    transport,
    port: Number(raw?.port) || 9100,
    paperWidth: raw?.paperWidth === 80 ? 80 : 58,
    autoPrint: role === 'receipt' ? !!raw?.autoPrint : false,
    drawerKick: role === 'receipt' ? !!raw?.drawerKick : false,
  }
  if (role === 'label') p.label = normalizeLabelMedia(raw?.label)
  else delete p.label
  return p
}

/** A new, unsaved printer for a role (used by the settings screen). */
export function blankPrinter(role: PrinterRole): PrinterConfig {
  return normalizePrinter({ role, name: ROLE_LABELS[role], transport: 'none', label: role === 'label' ? { ...DEFAULT_LABEL_MEDIA } : undefined })
}

function printersPath(): string | null {
  return FileSystem.documentDirectory ? `${FileSystem.documentDirectory}${PRINTERS_FILE}` : null
}

async function readStoredPrinters(): Promise<any[] | null> {
  const path = printersPath()
  try {
    if (path) {
      const info = await FileSystem.getInfoAsync(path)
      if (info.exists) {
        const parsed = JSON.parse(await FileSystem.readAsStringAsync(path))
        if (Array.isArray(parsed?.printers)) return parsed.printers
      }
    } else {
      const raw = await SecureStore.getItemAsync(PRINTERS_FALLBACK_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed?.printers)) return parsed.printers
      }
    }
  } catch {
    // corrupt file: fall through to migration / defaults
  }
  return null
}

async function writeStoredPrinters(list: PrinterConfig[]): Promise<void> {
  const json = JSON.stringify({ version: 2, printers: list })
  const path = printersPath()
  if (path) await FileSystem.writeAsStringAsync(path, json)
  else await SecureStore.setItemAsync(PRINTERS_FALLBACK_KEY, json)
}

/** All configured printers. Transparently migrates the legacy single receipt setting. */
export async function getPrinters(): Promise<PrinterConfig[]> {
  if (cachedPrinters) return cachedPrinters
  const stored = await readStoredPrinters()
  if (stored) {
    cachedPrinters = stored.map(normalizePrinter)
    return cachedPrinters
  }
  // Migration: the old single setting becomes one receipt-role printer.
  let migrated: PrinterConfig[] = []
  try {
    const raw = await SecureStore.getItemAsync(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      migrated = [normalizePrinter({ ...parsed, id: 'receipt-1', name: 'Receipt printer', role: 'receipt' })]
    }
  } catch {
    migrated = []
  }
  cachedPrinters = migrated
  if (migrated.length) {
    try {
      await writeStoredPrinters(migrated)
    } catch {
      // keep the in-memory copy; retried on next save
    }
  }
  return cachedPrinters
}

export async function savePrinters(list: PrinterConfig[]): Promise<void> {
  cachedPrinters = list.map(normalizePrinter)
  await writeStoredPrinters(cachedPrinters)
  // Force a reconnect with the (possibly changed) devices next time we print.
  resetConnections()
}

export async function savePrinter(printer: PrinterConfig): Promise<PrinterConfig[]> {
  const list = [...(await getPrinters())]
  const p = normalizePrinter(printer)
  const i = list.findIndex((x) => x.id === p.id)
  if (i >= 0) list[i] = p
  else list.push(p)
  await savePrinters(list)
  return cachedPrinters as PrinterConfig[]
}

export async function removePrinter(id: string): Promise<PrinterConfig[]> {
  await savePrinters((await getPrinters()).filter((p) => p.id !== id))
  return cachedPrinters as PrinterConfig[]
}

/** The printer used for a role: the first configured (transport != none) one, else the first of that role. */
export async function getPrinterForRole(role: PrinterRole): Promise<PrinterConfig | null> {
  const list = (await getPrinters()).filter((p) => p.role === role)
  return list.find((p) => p.transport !== 'none') || list[0] || null
}

/** Receipt-role printer settings (legacy API used by POS, tender, shifts). */
export async function getPrinterSettings(): Promise<PrinterSettings> {
  return (await getPrinterForRole('receipt')) || { ...DEFAULT_PRINTER_SETTINGS }
}

/** Saves settings for the receipt-role printer (creating it when missing). */
export async function savePrinterSettings(settings: PrinterSettings): Promise<void> {
  const current = (settings as Partial<PrinterConfig>).id ? (settings as PrinterConfig) : await getPrinterForRole('receipt')
  await savePrinter(normalizePrinter({ ...(current || {}), ...settings, id: current?.id || 'receipt-1', name: current?.name || 'Receipt printer', role: 'receipt' }))
}

/** True when some printing transport (raw or system) is configured. */
export function isPrintingEnabled(settings: PrinterSettings): boolean {
  return settings.transport !== 'none'
}

// ---------------------------------------------------------------------------
// Native module (optional)
// ---------------------------------------------------------------------------
interface NativePrinterLib {
  BLEPrinter: {
    init: () => Promise<void>
    getDeviceList: () => Promise<Array<{ device_name: string; inner_mac_address: string }>>
    connectPrinter: (mac: string) => Promise<unknown>
    closeConn: () => Promise<void>
  }
  USBPrinter: {
    init: () => Promise<void>
    getDeviceList: () => Promise<Array<{ device_name: string; vendor_id: string; product_id: string }>>
    connectPrinter: (vendorId: string, productId: string) => Promise<unknown>
    closeConn: () => Promise<void>
  }
  NetPrinter: {
    init: () => Promise<void>
    connectPrinter: (host: string, port: number, timeout?: number) => Promise<unknown>
    closeConn: () => Promise<void>
  }
}

interface RawNativeModule {
  printRawData: (base64: string, errorCallback: (error: unknown) => void) => void
}

let nativeLib: NativePrinterLib | null | undefined
let nativeModules: { ble?: RawNativeModule; usb?: RawNativeModule; net?: RawNativeModule } = {}

function loadNative(): NativePrinterLib | null {
  if (nativeLib !== undefined) return nativeLib
  nativeLib = null
  if (Platform.OS !== 'android') return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RN = require('react-native')
    const mods = RN.NativeModules || {}
    if (!mods.RNBLEPrinter && !mods.RNUSBPrinter && !mods.RNNetPrinter) {
      // Expo Go / module not linked: keep raw transports disabled.
      return null
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const lib = require('react-native-thermal-receipt-printer-image-qr')
    nativeModules = { ble: mods.RNBLEPrinter, usb: mods.RNUSBPrinter, net: mods.RNNetPrinter }
    nativeLib = lib as NativePrinterLib
  } catch {
    nativeLib = null
  }
  return nativeLib
}

/** Whether Bluetooth / USB / network raw printing is available in this build. */
export function isNativePrinterAvailable(): boolean {
  return loadNative() !== null
}

export class PrinterError extends Error {
  constructor(message: string, readonly code: 'unavailable' | 'not_configured' | 'permission' | 'connect' | 'print' = 'print') {
    super(message)
    this.name = 'PrinterError'
  }
}

async function ensureBluetoothPermissions(): Promise<void> {
  if (Platform.OS !== 'android' || Platform.Version < 31) return
  const perms = [PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT, PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN].filter(Boolean) as string[]
  const result = await PermissionsAndroid.requestMultiple(perms as any)
  const denied = perms.filter((p) => result[p as keyof typeof result] !== PermissionsAndroid.RESULTS.GRANTED)
  if (denied.length) throw new PrinterError('Bluetooth permission was not granted. Allow "Nearby devices" for POSLanka in Android settings.', 'permission')
}

export interface BluetoothDevice {
  name: string
  address: string
}

export interface UsbDevice {
  name: string
  vendorId: string
  productId: string
}

/** Paired Bluetooth classic devices (the printer must be paired in Android settings first). */
export async function listBluetoothDevices(): Promise<BluetoothDevice[]> {
  const lib = loadNative()
  if (!lib) throw new PrinterError('Bluetooth printing needs the POSLanka dev-client / EAS build (not available in Expo Go).', 'unavailable')
  await ensureBluetoothPermissions()
  await lib.BLEPrinter.init()
  const list = await lib.BLEPrinter.getDeviceList()
  return (list || []).map((d) => ({ name: d.device_name || 'Unknown device', address: d.inner_mac_address }))
}

export async function listUsbDevices(): Promise<UsbDevice[]> {
  const lib = loadNative()
  if (!lib) throw new PrinterError('USB printing needs the POSLanka dev-client / EAS build (not available in Expo Go).', 'unavailable')
  await lib.USBPrinter.init()
  const list = await lib.USBPrinter.getDeviceList()
  return (list || []).map((d) => ({ name: d.device_name || 'USB printer', vendorId: String(d.vendor_id), productId: String(d.product_id) }))
}

// ---------------------------------------------------------------------------
// Raw transport
// ---------------------------------------------------------------------------
/** Connected device per raw transport (Bluetooth, USB and network can stay open side by side). */
const connectedKeys: Partial<Record<PrinterTransport, string | null>> = {}
let printChain: Promise<unknown> = Promise.resolve()

function resetConnections(transport?: PrinterTransport) {
  if (transport) connectedKeys[transport] = null
  else for (const k of Object.keys(connectedKeys) as PrinterTransport[]) connectedKeys[k] = null
}

function connectionKey(s: PrinterSettings): string {
  switch (s.transport) {
    case 'bluetooth':
      return `bt:${s.bluetoothAddress || ''}`
    case 'usb':
      return `usb:${s.usbVendorId || ''}:${s.usbProductId || ''}`
    case 'network':
      return `net:${s.host || ''}:${s.port || 9100}`
    default:
      return s.transport
  }
}

async function connect(lib: NativePrinterLib, s: PrinterSettings): Promise<RawNativeModule> {
  const key = connectionKey(s)
  let mod: RawNativeModule | undefined
  try {
    switch (s.transport) {
      case 'bluetooth': {
        if (!s.bluetoothAddress) throw new PrinterError('No Bluetooth printer selected. Pick one in Printer settings.', 'not_configured')
        await ensureBluetoothPermissions()
        mod = nativeModules.ble
        if (connectedKeys[s.transport] !== key) {
          await lib.BLEPrinter.init()
          await lib.BLEPrinter.connectPrinter(s.bluetoothAddress)
        }
        break
      }
      case 'usb': {
        if (!s.usbVendorId || !s.usbProductId) throw new PrinterError('No USB printer selected. Pick one in Printer settings.', 'not_configured')
        mod = nativeModules.usb
        if (connectedKeys[s.transport] !== key) {
          await lib.USBPrinter.init()
          await lib.USBPrinter.connectPrinter(s.usbVendorId, s.usbProductId)
        }
        break
      }
      case 'network': {
        if (!s.host) throw new PrinterError('No printer IP address set. Enter it in Printer settings.', 'not_configured')
        mod = nativeModules.net
        if (connectedKeys[s.transport] !== key) {
          await lib.NetPrinter.init()
          await lib.NetPrinter.connectPrinter(s.host.trim(), Number(s.port) || 9100, 4000)
        }
        break
      }
      default:
        throw new PrinterError('Raw printing is not enabled for this transport.', 'not_configured')
    }
  } catch (e) {
    resetConnections(s.transport)
    if (e instanceof PrinterError) throw e
    throw new PrinterError(`Could not connect to the printer: ${e instanceof Error ? e.message : String(e)}`, 'connect')
  }
  if (!mod) {
    resetConnections(s.transport)
    throw new PrinterError('Printer native module is missing in this build.', 'unavailable')
  }
  connectedKeys[s.transport] = key
  return mod
}

function sendRaw(mod: RawNativeModule, bytes: Uint8Array, transport: PrinterTransport): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    // The native side only invokes the callback on failure. Give it a short
    // grace period to report an error before we consider the job queued.
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        resolve()
      }
    }, 400)
    try {
      mod.printRawData(bytesToBase64(bytes), (error: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resetConnections(transport)
        reject(new PrinterError(`Printer error: ${error instanceof Error ? error.message : String(error)}`, 'print'))
      })
    } catch (e) {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resetConnections(transport)
        reject(new PrinterError(`Printer error: ${e instanceof Error ? e.message : String(e)}`, 'print'))
      }
    }
  })
}

/**
 * Sends raw ESC/POS bytes to the configured raw transport. For the `system`
 * transport the bytes are rendered as plain text through the Android print
 * service (used by Test print; sale receipts use printReceipt instead).
 */
export async function printBytes(bytes: Uint8Array, settingsOverride?: PrinterSettings): Promise<void> {
  const s = settingsOverride || (await getPrinterSettings())
  if (s.transport === 'none') throw new PrinterError('No printer configured. Open Printer settings to set one up.', 'not_configured')
  if (s.transport === 'system') {
    await printHtml(`<pre style="font-family:monospace;font-size:12px;white-space:pre-wrap">${escapeHtml(bytesToPlainText(bytes))}</pre>`, s)
    return
  }
  const lib = loadNative()
  if (!lib) throw new PrinterError('Bluetooth / USB / network printing needs the POSLanka dev-client or EAS build. Use "System print" in Expo Go.', 'unavailable')

  // Serialise jobs so two receipts never interleave on the same socket.
  const job = printChain.then(async () => {
    let mod = await connect(lib, s)
    try {
      await sendRaw(mod, bytes, s.transport)
    } catch (e) {
      // One reconnect attempt (sockets drop when the printer sleeps).
      if (e instanceof PrinterError && e.code === 'print') {
        mod = await connect(lib, s)
        await sendRaw(mod, bytes, s.transport)
      } else {
        throw e
      }
    }
  })
  printChain = job.catch(() => undefined)
  return job
}

// ---------------------------------------------------------------------------
// System transport (expo-print)
// ---------------------------------------------------------------------------

async function printHtml(bodyHtml: string, s: PrinterSettings): Promise<void> {
  const widthMm = s.paperWidth === 80 ? 80 : 58
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${widthMm}mm auto; margin: 3mm; }
    body { width: ${widthMm - 6}mm; margin: 0; font-family: "Courier New", monospace; font-size: ${widthMm === 80 ? 12 : 11}px; color: #000; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 1px 0; vertical-align: top; }
    .r { text-align: right; white-space: nowrap; }
    .c { text-align: center; }
    .b { font-weight: bold; }
    .big { font-size: 1.35em; }
    hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
  </style></head><body>${bodyHtml}</body></html>`
  try {
    await Print.printAsync({ html })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // User dismissed the print dialog: not an error worth surfacing.
    if (/cancel|dismiss/i.test(msg)) return
    throw new PrinterError(`System print failed: ${msg}`, 'print')
  }
}

/** Renders the receipt as a PDF and opens the Android share sheet (WhatsApp, Drive, ...). */
export async function shareReceiptPdf(input: ReceiptInput): Promise<void> {
  const s = await getPrinterSettings()
  const widthMm = s.paperWidth === 80 ? 80 : 58
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${widthMm}mm auto; margin: 3mm; }
    body { width: ${widthMm - 6}mm; margin: 0; font-family: "Courier New", monospace; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; } td { padding: 1px 0; vertical-align: top; }
    .r { text-align: right; white-space: nowrap; } .c { text-align: center; } .b { font-weight: bold; } .big { font-size: 1.35em; }
    hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
  </style></head><body>${receiptHtml(input)}</body></html>`
  const { uri } = await Print.printToFileAsync({ html })
  await Share.share(Platform.OS === 'ios' ? { url: uri } : { message: `${input.business.name} receipt ${input.invoiceNo}: ${uri}`, title: input.invoiceNo })
}

export function receiptHtml(input: ReceiptInput): string {
  const lines = input.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.name)}</td><td class="r">${escapeHtml(qtyText(l.qty))}${l.unit ? escapeHtml(l.unit) : ''}</td><td class="r">${money(l.unitPrice)}</td><td class="r">${money(l.total)}</td></tr>`
    )
    .join('')
  const taxes = (input.taxLines || [])
    .filter((t) => Math.abs(t.amount) > 0.004)
    .map((t) => `<tr><td>${escapeHtml(t.name)}</td><td class="r">${money(t.amount)}</td></tr>`)
    .join('')
  const payments = (input.payments || [])
    .map((p) => `<tr><td>${escapeHtml(paymentLabel(p.method))}${p.reference ? ` (${escapeHtml(p.reference)})` : ''}</td><td class="r">${money(p.amount)}</td></tr>`)
    .join('')
  const headerLines = input.headerLines?.length ? input.headerLines : input.header ? [input.header] : []
  const footerLines = input.footerLines?.length ? input.footerLines : [input.footer || 'Thank you for shopping with us!']
  const code = invoiceCodeFor(input)
  const codes = [
    code.barcode ? `<div class="c" style="margin:6px auto 0;width:85%">${code128Svg(code.value, { height: 40 })}</div>` : '',
    code.qr ? `<div class="c" style="margin-top:6px">${receiptQrSvg(code.value)}</div>` : '',
  ].join('')
  return `
    ${businessHeaderHtml(input.business, input.logo)}
    ${headerLines.map((h) => `<div class="c">${escapeHtml(h).replace(/\n/g, '<br>')}</div>`).join('')}
    <hr>
    <div class="b">${input.isReturn ? 'RETURN / CREDIT NOTE' : 'SALES RECEIPT'}</div>
    <table>
      <tr><td>Invoice</td><td class="r">${escapeHtml(input.invoiceNo)}</td></tr>
      <tr><td>Date</td><td class="r">${escapeHtml(formatReceiptDate(input.dateTime))}</td></tr>
      ${input.counter ? `<tr><td>Counter</td><td class="r">${escapeHtml(input.counter)}</td></tr>` : ''}
      ${input.cashier ? `<tr><td>Cashier</td><td class="r">${escapeHtml(input.cashier)}</td></tr>` : ''}
      ${input.customer?.name ? `<tr><td>Customer</td><td class="r">${escapeHtml(input.customer.name)}</td></tr>` : ''}
    </table>
    <hr>
    <table><tr class="b"><td>Item</td><td class="r">Qty</td><td class="r">Price</td><td class="r">Total</td></tr>${lines}</table>
    <hr>
    <table>
      <tr><td>Subtotal</td><td class="r">${money(input.subtotal)}</td></tr>
      ${input.discount && Math.abs(input.discount) > 0.004 ? `<tr><td>Discount</td><td class="r">-${money(Math.abs(input.discount))}</td></tr>` : ''}
      ${taxes}
      <tr class="b big"><td>${input.isReturn ? 'REFUND' : 'TOTAL'}</td><td class="r">LKR ${money(input.total)}</td></tr>
    </table>
    <hr>
    <table>${payments}${input.change && input.change > 0.004 ? `<tr><td>Change</td><td class="r">${money(input.change)}</td></tr>` : ''}</table>
    <br>
    ${footerLines.map((f) => `<div class="c">${escapeHtml(f).replace(/\n/g, '<br>')}</div>`).join('')}
    ${input.returnPolicy ? `<div class="c" style="margin-top:6px;font-size:10px">${escapeHtml(input.returnPolicy)}</div>` : ''}
    ${codes}
    <div class="c" style="margin-top:6px">Powered by POSLanka</div>`
}

/** Real QR (SVG) for HTML / PDF receipts; falls back to the plain value when it cannot be encoded. */
function receiptQrSvg(value: string): string {
  try {
    return qrSvg(value, 110)
  } catch {
    return `<div style="font-size:10px">${escapeHtml(value)}</div>`
  }
}

// ---------------------------------------------------------------------------
// High-level jobs
// ---------------------------------------------------------------------------
export async function printReceipt(input: ReceiptInput, settingsOverride?: PrinterSettings): Promise<void> {
  const s = settingsOverride || (await getPrinterSettings())
  if (s.transport === 'none') throw new PrinterError('No printer configured. Open Printer settings to set one up.', 'not_configured')
  if (s.transport === 'system') {
    await printHtml(receiptHtml(input), s)
    return
  }
  await printBytes(buildReceipt(input, { paperWidth: s.paperWidth, drawerKick: s.drawerKick }), s)
}

export async function printZReport(input: ZReportInput, settingsOverride?: PrinterSettings): Promise<void> {
  const s = settingsOverride || (await getPrinterSettings())
  if (s.transport === 'none') throw new PrinterError('No printer configured. Open Printer settings to set one up.', 'not_configured')
  if (s.transport === 'system') {
    await printHtml(zReportHtml(input), s)
    return
  }
  await printBytes(buildZReport(input, { paperWidth: s.paperWidth }), s)
}

export async function testPrint(settingsOverride?: PrinterSettings): Promise<void> {
  const s = settingsOverride || (await getPrinterSettings())
  const b = new EscPosBuilder(s.paperWidth)
  b.init()
  b.align('center').bold(true).size(2, 2).line('POSLanka').size(1, 1).bold(false)
  b.line('Printer test page').line(formatReceiptDate(new Date())).line()
  b.align('left').rule('=')
  const named = s as Partial<PrinterConfig>
  if (named.name) b.row('Printer', sanitizeAscii(named.name))
  if (named.role) b.row('Role', ROLE_LABELS[named.role] || named.role)
  b.row('Transport', TRANSPORT_LABELS[s.transport])
  b.row('Paper', `${s.paperWidth}mm / ${b.cols} cols`)
  b.rule('-')
  b.line(sanitizeAscii('ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789'))
  b.line('Sinhala/Tamil text prints as ?: ' + sanitizeAscii('අ த'))
  b.rule('-')
  b.align('center').barcodeCode128('INV-TEST-0001').line().qr('INV-TEST-0001', { size: 4 }).align('left')
  b.line().align('center').line('OK - printer is working').align('left')
  b.partialCut()
  await printBytes(b.bytes(), s)
}

export async function openDrawer(settingsOverride?: PrinterSettings): Promise<void> {
  const s = settingsOverride || (await getPrinterSettings())
  if (s.transport === 'system' || s.transport === 'none') {
    throw new PrinterError('The cash drawer can only be opened through a Bluetooth, USB or network receipt printer.', 'not_configured')
  }
  await printBytes(new EscPosBuilder(s.paperWidth).init().drawerKick().bytes(), s)
}

/** Friendly message for any error thrown by this module. */
export function printerErrorMessage(e: unknown): string {
  if (e instanceof PrinterError) return e.message
  if (e instanceof Error) return e.message
  return 'Printing failed.'
}

// ---------------------------------------------------------------------------
// Role-based printing (receipt / kitchen / label)
// ---------------------------------------------------------------------------
async function requireRolePrinter(role: PrinterRole): Promise<PrinterConfig> {
  const p = await getPrinterForRole(role)
  if (!p || p.transport === 'none') {
    throw new PrinterError(`No ${ROLE_LABELS[role].toLowerCase()} configured. Add one in Printer settings.`, 'not_configured')
  }
  return p
}

/** Sends raw bytes to the printer configured for `role`. */
export async function printToRole(role: PrinterRole, bytes: Uint8Array): Promise<void> {
  const p = await requireRolePrinter(role)
  if (role === 'label' && p.transport === 'system') {
    throw new PrinterError('Label printers need a Bluetooth, USB or network connection (system print cannot send TSPL / ZPL / EPL).', 'not_configured')
  }
  await printBytes(bytes, p)
}

export interface LabelPrintOptions {
  currencySymbol?: string
  tenantName?: string
  codeWord?: string
  /** Multiplies every item's quantity. */
  copies?: number
}

export interface LabelPrintResult {
  /** Labels sent (sum of quantities x copies). */
  labels: number
  warnings: string[]
  printer: PrinterConfig
}

/** Encodes labels in the printer's language (TSPL / ZPL / EPL). Throws PrinterError for escpos-raster. */
export async function encodeLabelsForPrinter(
  printer: PrinterConfig,
  template: LabelTemplateLike,
  items: (LabelPrintItem | LabelItemData)[],
  opts: LabelPrintOptions = {}
): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const media = printer.label || DEFAULT_LABEL_MEDIA
  if (media.language === 'escpos-raster') throw new PrinterError(ESCPOS_RASTER_UNSUPPORTED, 'not_configured')
  const res = await encodeLabels(template, items, {
    language: media.language,
    dpi: media.dpi,
    gapMm: media.gapMm,
    darkness: media.darkness,
    speed: media.speed,
    copies: opts.copies,
    currencySymbol: opts.currencySymbol,
    tenantName: opts.tenantName,
    codeWord: opts.codeWord,
  })
  return { bytes: res.bytes, warnings: res.warnings }
}

/** Prints labels on the label-role printer (or `printerOverride`). */
export async function printLabels(
  template: LabelTemplateLike,
  items: LabelPrintItem[],
  opts: LabelPrintOptions = {},
  printerOverride?: PrinterConfig
): Promise<LabelPrintResult> {
  const printer = printerOverride || (await requireRolePrinter('label'))
  if (printer.transport === 'system' || printer.transport === 'none') {
    throw new PrinterError('Label printers need a Bluetooth, USB or network connection (system print cannot send TSPL / ZPL / EPL).', 'not_configured')
  }
  const list = items.filter((i) => i.quantity > 0)
  if (!list.length) throw new PrinterError('Nothing to print: set a quantity of at least 1.', 'print')
  const { bytes, warnings } = await encodeLabelsForPrinter(printer, template, list, opts)
  if (!bytes.length) throw new PrinterError(warnings[0] || 'Nothing to print for this template.', 'print')
  await printBytes(bytes, printer)
  const copies = Math.max(1, Math.round(opts.copies ?? 1))
  return { labels: list.reduce((n, i) => n + Math.max(1, Math.round(i.quantity)) * copies, 0), warnings, printer }
}

/** Test print for any configured printer: ESC/POS test page or a small label in the printer's language. */
export async function testPrintPrinter(printer: PrinterConfig): Promise<string[]> {
  if (printer.transport === 'none') throw new PrinterError('Choose a connection for this printer first.', 'not_configured')
  if (printer.role !== 'label') {
    await testPrint(printer)
    return []
  }
  if (printer.transport === 'system') {
    throw new PrinterError('Label printers need a Bluetooth, USB or network connection (system print cannot send TSPL / ZPL / EPL).', 'not_configured')
  }
  const media = printer.label || DEFAULT_LABEL_MEDIA
  const { bytes, warnings } = await encodeLabelsForPrinter(printer, labelTestTemplate(media.widthMm, media.heightMm), [{ item: null, quantity: 1 }])
  await printBytes(bytes, printer)
  return warnings
}
