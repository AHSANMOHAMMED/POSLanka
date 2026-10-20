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

const SETTINGS_KEY = 'poslanka_printer_settings'

let cachedSettings: PrinterSettings | null = null

export async function getPrinterSettings(): Promise<PrinterSettings> {
  if (cachedSettings) return cachedSettings
  try {
    const raw = await SecureStore.getItemAsync(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      cachedSettings = { ...DEFAULT_PRINTER_SETTINGS, ...parsed, paperWidth: parsed?.paperWidth === 80 ? 80 : 58 }
      return cachedSettings
    }
  } catch {
    // fall through to defaults
  }
  cachedSettings = { ...DEFAULT_PRINTER_SETTINGS }
  return cachedSettings
}

export async function savePrinterSettings(settings: PrinterSettings): Promise<void> {
  cachedSettings = { ...settings }
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(cachedSettings))
  // Force a reconnect with the new device next time we print.
  connectedKey = null
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
let connectedKey: string | null = null
let printChain: Promise<unknown> = Promise.resolve()

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
        if (connectedKey !== key) {
          await lib.BLEPrinter.init()
          await lib.BLEPrinter.connectPrinter(s.bluetoothAddress)
        }
        break
      }
      case 'usb': {
        if (!s.usbVendorId || !s.usbProductId) throw new PrinterError('No USB printer selected. Pick one in Printer settings.', 'not_configured')
        mod = nativeModules.usb
        if (connectedKey !== key) {
          await lib.USBPrinter.init()
          await lib.USBPrinter.connectPrinter(s.usbVendorId, s.usbProductId)
        }
        break
      }
      case 'network': {
        if (!s.host) throw new PrinterError('No printer IP address set. Enter it in Printer settings.', 'not_configured')
        mod = nativeModules.net
        if (connectedKey !== key) {
          await lib.NetPrinter.init()
          await lib.NetPrinter.connectPrinter(s.host.trim(), Number(s.port) || 9100, 4000)
        }
        break
      }
      default:
        throw new PrinterError('Raw printing is not enabled for this transport.', 'not_configured')
    }
  } catch (e) {
    connectedKey = null
    if (e instanceof PrinterError) throw e
    throw new PrinterError(`Could not connect to the printer: ${e instanceof Error ? e.message : String(e)}`, 'connect')
  }
  if (!mod) {
    connectedKey = null
    throw new PrinterError('Printer native module is missing in this build.', 'unavailable')
  }
  connectedKey = key
  return mod
}

function sendRaw(mod: RawNativeModule, bytes: Uint8Array): Promise<void> {
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
        connectedKey = null
        reject(new PrinterError(`Printer error: ${error instanceof Error ? error.message : String(error)}`, 'print'))
      })
    } catch (e) {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        connectedKey = null
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
      await sendRaw(mod, bytes)
    } catch (e) {
      // One reconnect attempt (sockets drop when the printer sleeps).
      if (e instanceof PrinterError && e.code === 'print') {
        mod = await connect(lib, s)
        await sendRaw(mod, bytes)
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
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

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
  const biz = input.business
  const bizLines = [
    biz.legalName && biz.legalName.trim().toLowerCase() !== biz.name.trim().toLowerCase() ? biz.legalName : null,
    biz.address,
    biz.phone ? `Tel: ${biz.phone}` : null,
    biz.email,
    biz.website,
    biz.taxId ? `VAT/TIN: ${biz.taxId}` : null,
    biz.brn ? `BRN: ${biz.brn}` : null,
  ]
    .filter(Boolean)
    .map((l) => `<div class="c">${escapeHtml(String(l))}</div>`)
    .join('')
  const headerLines = input.headerLines?.length ? input.headerLines : input.header ? [input.header] : []
  const footerLines = input.footerLines?.length ? input.footerLines : [input.footer || 'Thank you for shopping with us!']
  const logo =
    input.logo?.pngBase64 && /^[A-Za-z0-9+/=]+$/.test(input.logo.pngBase64)
      ? `<div class="c"><img src="data:image/png;base64,${input.logo.pngBase64}" style="width:${Math.min(100, Math.max(40, input.logo.widthPct || 60))}%;height:auto" alt=""></div>`
      : ''
  const code = invoiceCodeFor(input)
  const codes = [
    code.barcode ? `<div class="c" style="margin:6px auto 0;width:85%">${code128Svg(code.value, { height: 40 })}</div>` : '',
    // No QR encoder on device: print the value under the barcode, or as text when QR-only.
    code.qr && !code.barcode ? `<div class="c" style="margin-top:6px;font-size:10px">${escapeHtml(code.value)}</div>` : '',
  ].join('')
  return `
    ${logo}
    <div class="c b big">${escapeHtml(biz.name)}</div>
    ${bizLines}
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

function zReportHtml(input: ZReportInput): string {
  const tenders = input.tenders
    .map((t) => {
      const variance = t.variance ?? (t.actual ?? 0) - (t.expected ?? 0)
      return `<tr><td>${escapeHtml(paymentLabel(t.method))}</td><td class="r">${money(t.expected ?? 0)}</td><td class="r">${money(t.actual ?? 0)}</td><td class="r">${variance > 0 ? '+' : ''}${money(variance)}</td></tr>`
    })
    .join('')
  const tv = input.summary.totalVariance
  return `
    <div class="c b big">${escapeHtml(input.business.name)}</div>
    <div class="c b">${escapeHtml(input.title || 'Z REPORT - SHIFT CLOSE')}</div>
    <hr>
    <table>
      ${input.entryNumber ? `<tr><td>Closing</td><td class="r">${escapeHtml(input.entryNumber)}</td></tr>` : ''}
      ${input.counter ? `<tr><td>Counter</td><td class="r">${escapeHtml(input.counter)}</td></tr>` : ''}
      ${input.cashier ? `<tr><td>Cashier</td><td class="r">${escapeHtml(input.cashier)}</td></tr>` : ''}
      ${input.openedAt ? `<tr><td>Opened</td><td class="r">${escapeHtml(formatReceiptDate(input.openedAt))}</td></tr>` : ''}
      <tr><td>Closed</td><td class="r">${escapeHtml(formatReceiptDate(input.closedAt || new Date()))}</td></tr>
    </table>
    <hr>
    <table>
      <tr><td>Gross sales</td><td class="r">${money(input.summary.totalSales)}</td></tr>
      <tr><td>Returns</td><td class="r">-${money(Math.abs(input.summary.totalReturns))}</td></tr>
      <tr class="b"><td>Net sales</td><td class="r">${money(input.summary.netSales)}</td></tr>
      <tr><td>Transactions</td><td class="r">${input.summary.totalTransactions}</td></tr>
    </table>
    <hr>
    <table><tr class="b"><td>Tender</td><td class="r">Expected</td><td class="r">Counted</td><td class="r">Variance</td></tr>${tenders}</table>
    <hr>
    <table><tr class="b big"><td>TOTAL VARIANCE</td><td class="r">${tv > 0 ? '+' : ''}${money(tv)}</td></tr></table>
    ${input.notes ? `<p>Notes: ${escapeHtml(input.notes)}</p>` : ''}
    <p>Signature: ____________________</p>
    <div class="c">Powered by POSLanka</div>`
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
