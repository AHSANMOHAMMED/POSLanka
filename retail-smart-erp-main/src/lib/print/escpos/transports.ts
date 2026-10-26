'use client'

/**
 * Printer transports for raw ESC/POS bytes.
 *
 *  - WebUsbTransport        navigator.usb  (Chrome/Edge, desktop + Android)
 *  - WebBluetoothTransport  navigator.bluetooth (BLE receipt printers)
 *  - PrintAgentTransport    local HTTP agent (tools/print-agent) -> TCP 9100 / system / serial
 *  - BrowserPrintTransport  decodes the ESC/POS stream to plain text and uses the
 *                           existing HTML print path (`quickPrint`) as a fallback
 *
 * All feature detection is defensive: constructing a transport never throws on
 * browsers lacking the API; `connect()` rejects with a readable message instead.
 */

import { quickPrint } from '@/hooks/usePrint'
import type { PaperSize } from '@/lib/print/types'

export type TransportKind = 'browser' | 'webusb' | 'webbluetooth' | 'agent'

export interface PrinterTransport {
  readonly kind: TransportKind
  connect(): Promise<void>
  write(bytes: Uint8Array): Promise<void>
  close(): Promise<void>
  /** Human readable description of the connected device, if any. */
  describe?(): string
}

export class TransportError extends Error {
  constructor(message: string, public readonly code: 'unsupported' | 'no-device' | 'cancelled' | 'io' | 'network' = 'io') {
    super(message)
    this.name = 'TransportError'
  }
}

// ─── Feature detection ────────────────────────────────────────────────────

export function isSecureContextSafe(): boolean {
  return typeof window !== 'undefined' && (window.isSecureContext ?? true)
}

export function supportsWebUsb(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as unknown as { usb?: unknown }).usb && isSecureContextSafe()
}

export function supportsWebBluetooth(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!(navigator as unknown as { bluetooth?: unknown }).bluetooth &&
    isSecureContextSafe()
  )
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ─── WebUSB ───────────────────────────────────────────────────────────────

/** Minimal structural typings for the WebUSB API (not in lib.dom). */
interface UsbEndpointLike {
  endpointNumber: number
  direction: 'in' | 'out'
  type: 'bulk' | 'interrupt' | 'isochronous'
}
interface UsbAlternateLike {
  alternateSetting: number
  interfaceClass: number
  endpoints: UsbEndpointLike[]
}
interface UsbInterfaceLike {
  interfaceNumber: number
  alternates: UsbAlternateLike[]
  claimed: boolean
}
interface UsbConfigurationLike {
  configurationValue: number
  interfaces: UsbInterfaceLike[]
}
interface UsbDeviceLike {
  vendorId: number
  productId: number
  productName?: string
  manufacturerName?: string
  serialNumber?: string
  opened: boolean
  configuration: UsbConfigurationLike | null
  configurations: UsbConfigurationLike[]
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(v: number): Promise<void>
  claimInterface(n: number): Promise<void>
  releaseInterface(n: number): Promise<void>
  transferOut(endpoint: number, data: Uint8Array): Promise<{ status: string; bytesWritten: number }>
}
interface UsbLike {
  requestDevice(opts: { filters: Array<{ vendorId?: number; productId?: number; classCode?: number }> }): Promise<UsbDeviceLike>
  getDevices(): Promise<UsbDeviceLike[]>
}

const USB_STORAGE_KEY = 'poslanka:printer:usb'
const USB_PRINTER_CLASS = 7

/**
 * Universal USB vendor/class filters for POS receipt and label desktop printers.
 * Explicitly includes Zebra Technologies (ZD220, ZD230, ZD420, etc.) which may
 * advertise vendor-specific class codes under Windows/Linux rather than Class 7.
 */
export const PRINTER_USB_FILTERS: Array<{ vendorId?: number; productId?: number; classCode?: number }> = [
  { classCode: USB_PRINTER_CLASS },
  { vendorId: 0x0a5f }, // Zebra Technologies (ZD220, ZD230, ZD420, ZD421, GK420d, GX420d, ZT series)
  { vendorId: 0x04b8 }, // Seiko Epson
  { vendorId: 0x04f9 }, // Brother Industries
  { vendorId: 0x0fe6 }, // HPRT / Rongta / Citizen
  { vendorId: 0x20d1 }, // Xprinter / Posiflex
  { vendorId: 0x1fc9 }, // NXP Semiconductors (thermal receipt/label boards)
  { vendorId: 0x1a86 }, // QinHeng (CH340/CH341 USB-to-Serial POS printer boards)
  { vendorId: 0x0416 }, // Winbond Electronics
  { vendorId: 0x0483 }, // STMicroelectronics (common in ESC/POS and TSPL boards)
  { vendorId: 0x1203 }, // TSC Auto ID Technology
  { vendorId: 0x6868 }, // Rongta
  { vendorId: 0x0525 }, // Netchip
  { vendorId: 0x10c4 }, // Silicon Labs CP210x POS
  { vendorId: 0x28e9 }, // GigaDevice POS
  { vendorId: 0x0bda }, // Realtek
]

interface StoredUsbDevice {
  vendorId: number
  productId: number
  serialNumber?: string
  name?: string
}

/** Per-printer storage key; '' / undefined = legacy single-printer key. */
function usbKey(deviceKey?: string): string {
  return deviceKey ? `${USB_STORAGE_KEY}:${deviceKey}` : USB_STORAGE_KEY
}

function readStoredUsb(deviceKey?: string): StoredUsbDevice | null {
  try {
    const raw = localStorage.getItem(usbKey(deviceKey))
    return raw ? (JSON.parse(raw) as StoredUsbDevice) : null
  } catch {
    return null
  }
}

function storeUsb(d: UsbDeviceLike | null, deviceKey?: string) {
  try {
    if (!d) localStorage.removeItem(usbKey(deviceKey))
    else
      localStorage.setItem(
        usbKey(deviceKey),
        JSON.stringify({
          vendorId: d.vendorId,
          productId: d.productId,
          serialNumber: d.serialNumber,
          name: d.productName,
        } satisfies StoredUsbDevice)
      )
  } catch {
    /* ignore */
  }
}

export function getStoredUsbDeviceName(deviceKey?: string): string | null {
  const s = readStoredUsb(deviceKey)
  if (!s) return null
  return s.name || `USB ${s.vendorId.toString(16).padStart(4, '0')}:${s.productId.toString(16).padStart(4, '0')}`
}

export class WebUsbTransport implements PrinterTransport {
  readonly kind = 'webusb' as const
  private device: UsbDeviceLike | null = null
  private ifaceNumber = -1
  private outEndpoint = -1
  private chunkSize = 4096

  constructor(private readonly deviceKey: string = '') {}

  private get usb(): UsbLike | null {
    if (!supportsWebUsb()) return null
    return (navigator as unknown as { usb: UsbLike }).usb
  }

  /** Prompt the user to pick a USB printer. Remembers the choice. */
  async requestDevice(showAllDevices = false): Promise<string> {
    const usb = this.usb
    if (!usb) throw new TransportError('WebUSB is not available in this browser (use Chrome/Edge over HTTPS).', 'unsupported')
    let dev: UsbDeviceLike
    try {
      dev = await usb.requestDevice({ filters: showAllDevices ? [] : PRINTER_USB_FILTERS })
    } catch (e) {
      throw new TransportError(e instanceof Error ? e.message : 'No device selected', 'cancelled')
    }
    await this.close()
    this.device = dev
    storeUsb(dev, this.deviceKey)
    await this.open()
    return this.describe()
  }

  /** Reconnect silently to the remembered device via getDevices(). */
  async connect(): Promise<void> {
    if (this.device?.opened && this.outEndpoint >= 0) return
    const usb = this.usb
    if (!usb) throw new TransportError('WebUSB is not available in this browser.', 'unsupported')
    if (!this.device) {
      const stored = readStoredUsb(this.deviceKey)
      const devices = await usb.getDevices()
      const match =
        (stored &&
          devices.find(
            (d) =>
              d.vendorId === stored.vendorId &&
              d.productId === stored.productId &&
              (!stored.serialNumber || !d.serialNumber || d.serialNumber === stored.serialNumber)
          )) ||
        (devices.length === 1 ? devices[0] : null)
      if (!match) throw new TransportError('No paired USB printer. Open printer settings and select the device.', 'no-device')
      this.device = match
    }
    await this.open()
  }

  private async open(): Promise<void> {
    const d = this.device
    if (!d) throw new TransportError('No USB device', 'no-device')
    if (!d.opened) await d.open()
    if (!d.configuration) await d.selectConfiguration(d.configurations[0]?.configurationValue ?? 1)
    const cfg = d.configuration
    if (!cfg) throw new TransportError('USB device has no configuration', 'io')

    // Prefer the printer-class interface, else any interface with a bulk OUT endpoint.
    let chosen: { iface: UsbInterfaceLike; alt: UsbAlternateLike; ep: UsbEndpointLike } | null = null
    for (const iface of cfg.interfaces) {
      for (const alt of iface.alternates) {
        const ep = alt.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk')
        if (!ep) continue
        if (!chosen || (alt.interfaceClass === USB_PRINTER_CLASS && chosen.alt.interfaceClass !== USB_PRINTER_CLASS)) {
          chosen = { iface, alt, ep }
        }
      }
    }
    if (!chosen) throw new TransportError('USB device has no bulk OUT endpoint (is it a printer?)', 'io')
    if (!chosen.iface.claimed) {
      try {
        await d.claimInterface(chosen.iface.interfaceNumber)
      } catch (e) {
        throw new TransportError(
          `Could not claim USB interface: ${e instanceof Error ? e.message : e}. If you have the Zebra Windows driver or Setup Utilities active, simply switch to "Browser" print connection above to print directly via the installed driver on any OS! (Or use Zadig to replace driver with WinUSB for raw access).`,
          'io'
        )
      }
    }
    this.ifaceNumber = chosen.iface.interfaceNumber
    this.outEndpoint = chosen.ep.endpointNumber
  }

  async write(bytes: Uint8Array): Promise<void> {
    await this.connect()
    const d = this.device
    if (!d) throw new TransportError('No USB device', 'no-device')
    for (let i = 0; i < bytes.length; i += this.chunkSize) {
      const chunk = bytes.subarray(i, Math.min(bytes.length, i + this.chunkSize))
      const res = await d.transferOut(this.outEndpoint, chunk)
      if (res.status !== 'ok') throw new TransportError(`USB transfer failed (${res.status})`, 'io')
    }
  }

  async close(): Promise<void> {
    const d = this.device
    this.device = null
    this.outEndpoint = -1
    if (!d) return
    try {
      if (this.ifaceNumber >= 0 && d.opened) await d.releaseInterface(this.ifaceNumber)
    } catch {
      /* ignore */
    }
    try {
      if (d.opened) await d.close()
    } catch {
      /* ignore */
    }
    this.ifaceNumber = -1
  }

  /** Forget the remembered device. */
  async forget(): Promise<void> {
    await this.close()
    storeUsb(null, this.deviceKey)
  }

  describe(): string {
    const d = this.device
    if (d) {
      if (d.productName) {
        return d.manufacturerName && !d.productName.toLowerCase().includes(d.manufacturerName.toLowerCase())
          ? `${d.manufacturerName} ${d.productName}`
          : d.productName
      }
      if (d.vendorId === 0x0a5f) {
        return `Zebra Direct Thermal Printer (${d.productId.toString(16).padStart(4, '0')})`
      }
      return `USB ${d.vendorId.toString(16).padStart(4, '0')}:${d.productId.toString(16).padStart(4, '0')}`
    }
    return getStoredUsbDeviceName(this.deviceKey) || 'USB printer'
  }
}

// ─── Web Bluetooth ────────────────────────────────────────────────────────

interface BtCharacteristicLike {
  uuid: string
  properties: { write?: boolean; writeWithoutResponse?: boolean }
  writeValue(data: Uint8Array): Promise<void>
  writeValueWithoutResponse?(data: Uint8Array): Promise<void>
  writeValueWithResponse?(data: Uint8Array): Promise<void>
}
interface BtServiceLike {
  uuid: string
  getCharacteristic(uuid: string | number): Promise<BtCharacteristicLike>
  getCharacteristics(): Promise<BtCharacteristicLike[]>
}
interface BtServerLike {
  connected: boolean
  connect(): Promise<BtServerLike>
  disconnect(): void
  getPrimaryService(uuid: string | number): Promise<BtServiceLike>
}
interface BtDeviceLike {
  id: string
  name?: string
  gatt?: BtServerLike
  addEventListener(type: 'gattserverdisconnected', cb: () => void): void
}
interface BluetoothLike {
  requestDevice(opts: {
    filters?: Array<{ services?: Array<string | number>; namePrefix?: string }>
    acceptAllDevices?: boolean
    optionalServices?: Array<string | number>
  }): Promise<BtDeviceLike>
  getDevices?(): Promise<BtDeviceLike[]>
}

const BT_STORAGE_KEY = 'poslanka:printer:ble'
/** Standard "Internet Printing"-style BLE printer service and the common vendor UART service. */
const BLE_SERVICES: Array<{ service: string; characteristic: string }> = [
  { service: '000018f0-0000-1000-8000-00805f9b34fb', characteristic: '00002af1-0000-1000-8000-00805f9b34fb' },
  { service: '0000ffe0-0000-1000-8000-00805f9b34fb', characteristic: '0000ffe1-0000-1000-8000-00805f9b34fb' },
  { service: '49535343-fe7d-4ae5-8fa9-9fafd205e455', characteristic: '49535343-8841-43f4-a8d4-ecbe34729bb3' },
  { service: '0000ff00-0000-1000-8000-00805f9b34fb', characteristic: '0000ff02-0000-1000-8000-00805f9b34fb' },
]

function bleKey(deviceKey?: string): string {
  return deviceKey ? `${BT_STORAGE_KEY}:${deviceKey}` : BT_STORAGE_KEY
}

export function getStoredBleDeviceName(deviceKey?: string): string | null {
  try {
    const raw = localStorage.getItem(bleKey(deviceKey))
    if (!raw) return null
    const s = JSON.parse(raw) as { id: string; name?: string }
    return s.name || 'Bluetooth printer'
  } catch {
    return null
  }
}

export class WebBluetoothTransport implements PrinterTransport {
  readonly kind = 'webbluetooth' as const
  private device: BtDeviceLike | null = null
  private characteristic: BtCharacteristicLike | null = null
  private chunkSize = 100
  private chunkDelayMs = 20

  constructor(private readonly deviceKey: string = '') {}

  private get bluetooth(): BluetoothLike | null {
    if (!supportsWebBluetooth()) return null
    return (navigator as unknown as { bluetooth: BluetoothLike }).bluetooth
  }

  async requestDevice(): Promise<string> {
    const bt = this.bluetooth
    if (!bt) throw new TransportError('Web Bluetooth is not available in this browser (use Chrome/Edge over HTTPS).', 'unsupported')
    let dev: BtDeviceLike
    try {
      dev = await bt.requestDevice({
        filters: BLE_SERVICES.map((s) => ({ services: [s.service] })),
        optionalServices: BLE_SERVICES.map((s) => s.service),
      })
    } catch {
      try {
        dev = await bt.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES.map((s) => s.service) })
      } catch (e) {
        throw new TransportError(e instanceof Error ? e.message : 'No device selected', 'cancelled')
      }
    }
    await this.close()
    this.device = dev
    try {
      localStorage.setItem(bleKey(this.deviceKey), JSON.stringify({ id: dev.id, name: dev.name }))
    } catch {
      /* ignore */
    }
    await this.connect()
    return this.describe()
  }

  async connect(): Promise<void> {
    if (this.characteristic && this.device?.gatt?.connected) return
    const bt = this.bluetooth
    if (!bt) throw new TransportError('Web Bluetooth is not available in this browser.', 'unsupported')
    if (!this.device) {
      // Silent reconnect only works where getDevices() is enabled (chrome://flags or enterprise policy).
      let stored: { id: string } | null = null
      try {
        const raw = localStorage.getItem(bleKey(this.deviceKey))
        stored = raw ? JSON.parse(raw) : null
      } catch {
        /* ignore */
      }
      if (stored && bt.getDevices) {
        try {
          const devices = await bt.getDevices()
          this.device = devices.find((d) => d.id === stored!.id) || null
        } catch {
          /* ignore */
        }
      }
      if (!this.device) throw new TransportError('No paired Bluetooth printer. Open printer settings and pair the device.', 'no-device')
    }
    const dev = this.device
    if (!dev.gatt) throw new TransportError('Bluetooth device has no GATT server', 'io')
    const server = dev.gatt.connected ? dev.gatt : await dev.gatt.connect()
    dev.addEventListener('gattserverdisconnected', () => {
      this.characteristic = null
    })

    let found: BtCharacteristicLike | null = null
    for (const s of BLE_SERVICES) {
      try {
        const service = await server.getPrimaryService(s.service)
        try {
          found = await service.getCharacteristic(s.characteristic)
        } catch {
          const chars = await service.getCharacteristics()
          found = chars.find((c) => c.properties.writeWithoutResponse || c.properties.write) || null
        }
        if (found) break
      } catch {
        /* try next */
      }
    }
    if (!found) throw new TransportError('Printer does not expose a known writable BLE characteristic (18F0/2AF1 or FFE0/FFE1).', 'io')
    this.characteristic = found
  }

  async write(bytes: Uint8Array): Promise<void> {
    await this.connect()
    const c = this.characteristic
    if (!c) throw new TransportError('Bluetooth printer not connected', 'no-device')
    for (let i = 0; i < bytes.length; i += this.chunkSize) {
      const chunk = bytes.subarray(i, Math.min(bytes.length, i + this.chunkSize))
      if (c.properties.writeWithoutResponse && c.writeValueWithoutResponse) await c.writeValueWithoutResponse(chunk)
      else if (c.writeValueWithResponse) await c.writeValueWithResponse(chunk)
      else await c.writeValue(chunk)
      await sleep(this.chunkDelayMs)
    }
  }

  async close(): Promise<void> {
    const d = this.device
    this.characteristic = null
    this.device = null
    try {
      if (d?.gatt?.connected) d.gatt.disconnect()
    } catch {
      /* ignore */
    }
  }

  async forget(): Promise<void> {
    await this.close()
    try {
      localStorage.removeItem(bleKey(this.deviceKey))
    } catch {
      /* ignore */
    }
  }

  describe(): string {
    return this.device?.name || getStoredBleDeviceName(this.deviceKey) || 'Bluetooth printer'
  }
}

// ─── Local print agent ────────────────────────────────────────────────────

export const DEFAULT_AGENT_URL = 'http://127.0.0.1:9123'

export interface PrintAgentTarget {
  name: string
  type: 'tcp' | 'system' | 'serial'
  description?: string
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)))
  }
  return btoa(binary)
}

export class PrintAgentTransport implements PrinterTransport {
  readonly kind = 'agent' as const
  constructor(private readonly baseUrl: string = DEFAULT_AGENT_URL, private readonly target: string = '') {}

  private url(path: string) {
    return `${this.baseUrl.replace(/\/+$/, '')}${path}`
  }

  async connect(): Promise<void> {
    const ok = await PrintAgentTransport.health(this.baseUrl)
    if (!ok) throw new TransportError(`Print agent not reachable at ${this.baseUrl}. Start tools/print-agent on this PC.`, 'network')
  }

  static async health(baseUrl = DEFAULT_AGENT_URL, timeoutMs = 1500): Promise<boolean> {
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), timeoutMs)
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/health`, { signal: ctl.signal })
      clearTimeout(t)
      return res.ok
    } catch {
      return false
    }
  }

  static async listTargets(baseUrl = DEFAULT_AGENT_URL): Promise<PrintAgentTarget[]> {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/printers`)
    if (!res.ok) throw new TransportError(`Agent returned ${res.status}`, 'network')
    const data = (await res.json()) as { printers?: PrintAgentTarget[] } | PrintAgentTarget[]
    return Array.isArray(data) ? data : data.printers || []
  }

  async write(bytes: Uint8Array): Promise<void> {
    let res: Response
    try {
      res = await fetch(this.url('/print'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: this.target || undefined, data: bytesToBase64(bytes) }),
      })
    } catch (e) {
      throw new TransportError(`Print agent not reachable at ${this.baseUrl}: ${e instanceof Error ? e.message : e}`, 'network')
    }
    if (!res.ok) {
      let msg = `Agent returned ${res.status}`
      try {
        const data = await res.json()
        if (data?.error) msg = data.error
      } catch {
        /* ignore */
      }
      throw new TransportError(msg, 'io')
    }
  }

  async close(): Promise<void> {
    /* stateless */
  }

  describe(): string {
    return this.target ? `Agent: ${this.target}` : 'Print agent'
  }
}

// ─── Browser (HTML) fallback ──────────────────────────────────────────────

/**
 * Decode an ESC/POS stream into plain text lines (commands stripped, raster
 * images rendered as a placeholder). Used to feed the HTML print dialog.
 */
export function escposToPlainText(bytes: Uint8Array): string[] {
  const lines: string[] = []
  let cur = ''
  let i = 0
  const n = bytes.length
  const flush = () => {
    lines.push(cur.replace(/\s+$/, ''))
    cur = ''
  }
  while (i < n) {
    const b = bytes[i]
    if (b === 0x0a) {
      flush()
      i++
      continue
    }
    if (b === 0x1b) {
      const c = bytes[i + 1]
      if (c === 0x40) i += 2 // ESC @
      else if (c === 0x61 || c === 0x45 || c === 0x2d || c === 0x4d || c === 0x21) i += 3 // ESC a/E/-/M/! n
      else if (c === 0x64) {
        const k = bytes[i + 2] || 0
        for (let f = 0; f < k; f++) lines.push('')
        i += 3
      } else if (c === 0x70) i += 5 // ESC p m t1 t2
      else i += 2
      continue
    }
    if (b === 0x1d) {
      const c = bytes[i + 1]
      if (c === 0x21 || c === 0x68 || c === 0x77 || c === 0x48 || c === 0x56) {
        i += 3
      } else if (c === 0x6b) {
        // GS k m n data
        const m = bytes[i + 2]
        if (m >= 65) {
          const len = bytes[i + 3] || 0
          const data = Array.from(bytes.subarray(i + 4, i + 4 + len))
            .map((x) => String.fromCharCode(x))
            .join('')
            .replace(/^\{[A-C]/, '')
          if (cur) flush()
          lines.push(`[barcode ${data}]`)
          i += 4 + len
        } else {
          // NUL-terminated form
          let j = i + 3
          while (j < n && bytes[j] !== 0) j++
          i = j + 1
        }
      } else if (c === 0x28) {
        // GS ( x pL pH ...
        const len = (bytes[i + 3] || 0) + 256 * (bytes[i + 4] || 0)
        const fn = bytes[i + 2]
        if (fn === 0x6b && bytes[i + 6] === 80) {
          const data = Array.from(bytes.subarray(i + 8, i + 5 + len))
          try {
            const text = new TextDecoder().decode(Uint8Array.from(data))
            if (cur) flush()
            lines.push(`[QR ${text}]`)
          } catch {
            /* ignore */
          }
        }
        i += 5 + len
      } else if (c === 0x76 && bytes[i + 2] === 0x30) {
        const xl = bytes[i + 4] || 0
        const xh = bytes[i + 5] || 0
        const yl = bytes[i + 6] || 0
        const yh = bytes[i + 7] || 0
        const size = (xl + 256 * xh) * (yl + 256 * yh)
        if (cur) flush()
        lines.push('[image]')
        i += 8 + size
      } else {
        i += 2
      }
      continue
    }
    if (b >= 0x20 && b <= 0x7e) cur += String.fromCharCode(b)
    i++
  }
  if (cur) flush()
  return lines
}

export interface BrowserPrintOptions {
  title?: string
  paperWidth?: 58 | 80
  /** Pre-rendered HTML; when supplied the byte stream is ignored. */
  html?: string
}

export class BrowserPrintTransport implements PrinterTransport {
  readonly kind = 'browser' as const
  constructor(private readonly options: BrowserPrintOptions = {}) {}

  async connect(): Promise<void> {
    /* always available */
  }

  async write(bytes: Uint8Array): Promise<void> {
    const paperSize: PaperSize = this.options.paperWidth === 58 ? 'thermal_58mm' : 'thermal_80mm'
    const html =
      this.options.html ??
      `<pre style="font-family:'Courier New',monospace;font-size:${this.options.paperWidth === 58 ? 10 : 11}px;line-height:1.25;white-space:pre;margin:0">${escposToPlainText(bytes)
        .map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
        .join('\n')}</pre>`
    const ok = await quickPrint('receipt', this.options.title || 'Receipt', html, { paperSize })
    if (!ok) throw new TransportError('Browser print was blocked (popup blocked?)', 'io')
  }

  async close(): Promise<void> {
    /* nothing */
  }

  describe(): string {
    return 'Browser print dialog'
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────

export interface TransportConfig {
  transport: TransportKind
  agentUrl?: string
  agentTarget?: string
  paperWidth?: 58 | 80
  /** Distinguishes several USB / Bluetooth printers ('' = legacy single printer). */
  deviceKey?: string
}

const usbSingletons = new Map<string, WebUsbTransport>()
const bleSingletons = new Map<string, WebBluetoothTransport>()

/** Returns a (cached for USB/BLE) transport for the given config. */
export function getTransport(cfg: TransportConfig, browserOptions?: BrowserPrintOptions): PrinterTransport {
  switch (cfg.transport) {
    case 'webusb':
      return getUsbTransport(cfg.deviceKey)
    case 'webbluetooth':
      return getBleTransport(cfg.deviceKey)
    case 'agent':
      return new PrintAgentTransport(cfg.agentUrl || DEFAULT_AGENT_URL, cfg.agentTarget || '')
    case 'browser':
    default:
      return new BrowserPrintTransport({ paperWidth: cfg.paperWidth, ...browserOptions })
  }
}

export function getUsbTransport(deviceKey = ''): WebUsbTransport {
  let t = usbSingletons.get(deviceKey)
  if (!t) {
    t = new WebUsbTransport(deviceKey)
    usbSingletons.set(deviceKey, t)
  }
  return t
}

export function getBleTransport(deviceKey = ''): WebBluetoothTransport {
  let t = bleSingletons.get(deviceKey)
  if (!t) {
    t = new WebBluetoothTransport(deviceKey)
    bleSingletons.set(deviceKey, t)
  }
  return t
}

export const TRANSPORT_LABELS: Record<TransportKind, string> = {
  browser: 'Browser',
  webusb: 'USB',
  webbluetooth: 'Bluetooth',
  agent: 'Print agent',
}
