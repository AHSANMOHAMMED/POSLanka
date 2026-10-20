'use client'

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import {
  buildReceiptEscPos,
  buildZReportEscPos,
  buildTestPageEscPos,
  buildDrawerKickEscPos,
  concatBytes,
  type PaperWidth,
  type ReceiptBusiness,
  type ReceiptInput,
  type ZReportInput,
  type ZReportMethod,
  type TextRasterizer,
} from '@/lib/print/escpos/encoder'
import {
  getTransport,
  getUsbTransport,
  getBleTransport,
  supportsWebUsb,
  supportsWebBluetooth,
  getStoredUsbDeviceName,
  getStoredBleDeviceName,
  TransportError,
  TRANSPORT_LABELS,
  DEFAULT_AGENT_URL,
  type TransportKind,
} from '@/lib/print/escpos/transports'
import { createCanvasTextRasterizer } from '@/lib/print/escpos/text-raster'

// ─── Settings store (localStorage: poslanka:printer) ──────────────────────

export const PRINTER_SETTINGS_KEY = 'poslanka:printer'

export type PrinterTransportKind = TransportKind

export interface PrinterSettings {
  transport: PrinterTransportKind
  paperWidth: PaperWidth
  autoPrint: boolean
  drawerKick: boolean
  unicodeAsBitmap: boolean
  agentUrl: string
  agentTarget: string
  copies: number
}

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  transport: 'browser',
  paperWidth: 80,
  autoPrint: true,
  drawerKick: false,
  unicodeAsBitmap: false,
  agentUrl: DEFAULT_AGENT_URL,
  agentTarget: '',
  copies: 1,
}

function sanitize(raw: Partial<PrinterSettings> | null | undefined): PrinterSettings {
  const s = { ...DEFAULT_PRINTER_SETTINGS, ...(raw || {}) }
  if (!['browser', 'webusb', 'webbluetooth', 'agent'].includes(s.transport)) s.transport = 'browser'
  s.paperWidth = s.paperWidth === 58 ? 58 : 80
  s.copies = Math.min(5, Math.max(1, Math.round(Number(s.copies) || 1)))
  s.agentUrl = (s.agentUrl || DEFAULT_AGENT_URL).trim()
  s.agentTarget = (s.agentTarget || '').trim()
  return s
}

export function loadPrinterSettings(): PrinterSettings {
  if (typeof window === 'undefined') return DEFAULT_PRINTER_SETTINGS
  try {
    const raw = localStorage.getItem(PRINTER_SETTINGS_KEY)
    return sanitize(raw ? (JSON.parse(raw) as Partial<PrinterSettings>) : null)
  } catch {
    return DEFAULT_PRINTER_SETTINGS
  }
}

let cached: PrinterSettings | null = null
const listeners = new Set<() => void>()

function getSnapshot(): PrinterSettings {
  if (!cached) cached = loadPrinterSettings()
  return cached
}

function getServerSnapshot(): PrinterSettings {
  return DEFAULT_PRINTER_SETTINGS
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key === PRINTER_SETTINGS_KEY) {
      cached = null
      cb()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

export function savePrinterSettings(patch: Partial<PrinterSettings>): PrinterSettings {
  const next = sanitize({ ...getSnapshot(), ...patch })
  cached = next
  try {
    localStorage.setItem(PRINTER_SETTINGS_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota / private mode */
  }
  listeners.forEach((l) => l())
  return next
}

// ─── Tenant / business info cache ─────────────────────────────────────────

interface TenantResponse {
  name?: string
  address?: string | null
  phone?: string | null
  currency?: string | null
  taxInclusive?: boolean
  taxId?: string | null
}

let tenantCache: { at: number; data: TenantResponse } | null = null

async function fetchTenant(): Promise<TenantResponse> {
  if (tenantCache && Date.now() - tenantCache.at < 5 * 60_000) return tenantCache.data
  try {
    const res = await fetch('/api/tenant')
    if (res.ok) {
      const data = (await res.json()) as TenantResponse
      tenantCache = { at: Date.now(), data }
      return data
    }
  } catch {
    /* offline */
  }
  return tenantCache?.data || {}
}

// ─── Sale mapping ─────────────────────────────────────────────────────────

interface SaleItemResponse {
  itemName: string
  quantity: string | number
  unitPrice: string | number
  total: string | number
  discount?: string | number | null
  unit?: string | null
}
interface SalePaymentResponse {
  method: string
  amount: string | number
  reference?: string | null
}
interface SaleResponse {
  id: string
  invoiceNo: string
  createdAt: string
  customerName?: string | null
  customerPhone?: string | null
  isReturn?: boolean | null
  subtotal: string | number
  discountAmount?: string | number | null
  taxAmount?: string | number | null
  taxBreakdown?: unknown
  total: string | number
  paidAmount?: string | number | null
  changeAmount?: string | number | null
  loyaltyPointsEarned?: string | number | null
  items?: SaleItemResponse[]
  payments?: SalePaymentResponse[]
}

const num = (v: string | number | null | undefined) => {
  const n = typeof v === 'string' ? parseFloat(v) : v ?? 0
  return Number.isFinite(n) ? n : 0
}

function taxLinesFrom(sale: SaleResponse, taxInclusive: boolean): ReceiptInput['taxLines'] {
  const tb = sale.taxBreakdown
  if (Array.isArray(tb) && tb.length > 0) {
    const lines = tb
      .map((t) => {
        const o = t as { taxName?: string; name?: string; amount?: string | number; rate?: number }
        const name = o.taxName || o.name || 'Tax'
        return { name: o.rate != null ? `${name} ${o.rate}%` : name, amount: num(o.amount) }
      })
      .filter((t) => t.amount !== 0)
    if (lines.length > 0) return lines
  }
  const tax = num(sale.taxAmount)
  return tax > 0 ? [{ name: taxInclusive ? 'Tax' : 'Tax', amount: tax }] : []
}

export interface PrintReceiptOptions {
  header?: string | null
  footer?: string | null
  business?: Partial<ReceiptBusiness>
  cashier?: string | null
  counter?: string | null
  copies?: number
  /** Extra per-line notes keyed by item index (e.g. serial numbers). */
  lineNotes?: Record<number, string[]>
}

export function saleToReceiptInput(
  sale: SaleResponse,
  tenant: TenantResponse,
  opts: PrintReceiptOptions = {}
): ReceiptInput {
  const total = num(sale.total)
  const paid = num(sale.paidAmount)
  const change = sale.changeAmount != null ? num(sale.changeAmount) : paid > total ? paid - total : 0
  const lines = (sale.items || []).map((it, idx) => ({
    name: it.itemName,
    qty: num(it.quantity),
    unit: it.unit || null,
    unitPrice: num(it.unitPrice),
    total: num(it.total),
    discount: num(it.discount),
    notes: opts.lineNotes?.[idx],
  }))
  return {
    business: {
      name: opts.business?.name || tenant.name || 'Business',
      address: opts.business?.address ?? tenant.address ?? null,
      phone: opts.business?.phone ?? tenant.phone ?? null,
      taxId: opts.business?.taxId ?? tenant.taxId ?? null,
    },
    header: opts.header ?? null,
    footer: opts.footer ?? 'Thank you for your purchase!',
    invoiceNo: sale.invoiceNo,
    dateTime: new Date(sale.createdAt).toLocaleString(),
    cashier: opts.cashier ?? null,
    counter: opts.counter ?? null,
    customer: sale.customerName ? { name: sale.customerName, phone: sale.customerPhone ?? null } : null,
    lines,
    subtotal: num(sale.subtotal),
    discount: num(sale.discountAmount),
    taxLines: taxLinesFrom(sale, !!tenant.taxInclusive),
    taxInclusive: !!tenant.taxInclusive,
    total,
    payments: (sale.payments || []).map((p) => ({ method: p.method, amount: num(p.amount), reference: p.reference ?? null })),
    change: change > 0 ? change : null,
    loyalty: sale.loyaltyPointsEarned != null && num(sale.loyaltyPointsEarned) > 0 ? { earned: num(sale.loyaltyPointsEarned) } : null,
    isReturn: !!sale.isReturn,
    qrPayload: sale.invoiceNo,
    currency: tenant.currency || null,
  }
}

// ─── Z report mapping ─────────────────────────────────────────────────────

/** Loose shape of `POST /api/pos-opening-entries/[id]/close` plus the shift being closed. */
export interface ZReportSource {
  closingEntry?: { entryNumber?: string; closingTime?: string; createdAt?: string; notes?: string | null } | null
  summary?: { totalSales?: number; totalReturns?: number; netSales?: number; totalTransactions?: number; totalVariance?: number }
  paymentMethodBreakdown?: {
    openingBalances?: Record<string, number>
    salesByMethod?: Record<string, number>
    expectedAmounts?: Record<string, number>
    varianceByMethod?: Record<string, number>
    totalVariance?: number
  }
  reconciliation?: Array<{ paymentMethod: string; expectedAmount?: string | number; actualAmount?: string | number; variance?: number }>
  shift?: { entryNumber?: string; openingTime?: string; posProfile?: { name?: string } | null } | null
  cashier?: string | null
}

export function closingToZReportInput(src: ZReportSource, tenant: TenantResponse): ZReportInput {
  const pm = src.paymentMethodBreakdown || {}
  const methodsSet = new Set<string>([
    ...Object.keys(pm.openingBalances || {}),
    ...Object.keys(pm.salesByMethod || {}),
    ...Object.keys(pm.expectedAmounts || {}),
    ...(src.reconciliation || []).map((r) => r.paymentMethod),
  ])
  const recMap = new Map((src.reconciliation || []).map((r) => [r.paymentMethod, r]))
  const methods: ZReportMethod[] = Array.from(methodsSet).map((m) => {
    const rec = recMap.get(m)
    const expected = pm.expectedAmounts?.[m] ?? num(rec?.expectedAmount)
    const actual = rec?.actualAmount != null ? num(rec.actualAmount) : null
    return {
      method: m,
      opening: pm.openingBalances?.[m] ?? 0,
      sales: pm.salesByMethod?.[m] ?? 0,
      expected,
      actual,
      variance: pm.varianceByMethod?.[m] ?? rec?.variance ?? (actual != null ? actual - expected : null),
    }
  })
  const closedAt = src.closingEntry?.closingTime || src.closingEntry?.createdAt || new Date().toISOString()
  return {
    business: { name: tenant.name || 'Business', address: tenant.address ?? null, phone: tenant.phone ?? null },
    entryNumber: src.shift?.entryNumber || src.closingEntry?.entryNumber || '-',
    counter: src.shift?.posProfile?.name ?? null,
    cashier: src.cashier ?? null,
    openedAt: src.shift?.openingTime ? new Date(src.shift.openingTime).toLocaleString() : '-',
    closedAt: new Date(closedAt).toLocaleString(),
    summary: {
      totalSales: src.summary?.totalSales ?? 0,
      totalReturns: src.summary?.totalReturns ?? 0,
      netSales: src.summary?.netSales ?? 0,
      totalTransactions: src.summary?.totalTransactions ?? 0,
      totalVariance: src.summary?.totalVariance ?? pm.totalVariance ?? null,
    },
    methods,
    notes: src.closingEntry?.notes ?? null,
    currency: tenant.currency || null,
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────

export interface PrinterStatus {
  state: 'idle' | 'connecting' | 'printing' | 'error'
  message?: string
  lastPrintedAt?: number
}

let rasterizerSingleton: TextRasterizer | null = null
function getRasterizer(): TextRasterizer {
  if (!rasterizerSingleton) rasterizerSingleton = createCanvasTextRasterizer()
  return rasterizerSingleton
}

function errorMessage(e: unknown): string {
  if (e instanceof TransportError) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}

export function usePrinter() {
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const [status, setStatus] = useState<PrinterStatus>({ state: 'idle' })

  const updateSettings = useCallback((patch: Partial<PrinterSettings>) => savePrinterSettings(patch), [])

  const support = useMemo(
    () => ({
      webusb: supportsWebUsb(),
      webbluetooth: supportsWebBluetooth(),
    }),
    []
  )

  const deviceName = useMemo(() => {
    switch (settings.transport) {
      case 'webusb':
        return getStoredUsbDeviceName()
      case 'webbluetooth':
        return getStoredBleDeviceName()
      case 'agent':
        return settings.agentTarget || 'default target'
      default:
        return null
    }
  }, [settings.transport, settings.agentTarget])

  /** Send raw ESC/POS bytes through the configured transport. */
  const printBytes = useCallback(
    async (bytes: Uint8Array, browserTitle?: string): Promise<boolean> => {
      const transport = getTransport(
        { transport: settings.transport, agentUrl: settings.agentUrl, agentTarget: settings.agentTarget, paperWidth: settings.paperWidth },
        { title: browserTitle, paperWidth: settings.paperWidth }
      )
      setStatus({ state: 'connecting' })
      try {
        await transport.connect()
        setStatus({ state: 'printing' })
        await transport.write(bytes)
        setStatus({ state: 'idle', lastPrintedAt: Date.now() })
        return true
      } catch (e) {
        const message = errorMessage(e)
        setStatus({ state: 'error', message })
        if (settings.transport === 'webusb' || settings.transport === 'webbluetooth') {
          // Force a fresh connection next time (device may have been unplugged).
          try {
            await transport.close()
          } catch {
            /* ignore */
          }
        }
        return false
      }
    },
    [settings.transport, settings.agentUrl, settings.agentTarget, settings.paperWidth]
  )

  const buildOpts = useCallback(
    (drawerKick: boolean) => ({
      paperWidth: settings.paperWidth,
      unicodeAsBitmap: settings.unicodeAsBitmap,
      rasterizer: settings.unicodeAsBitmap ? getRasterizer() : null,
      drawerKick,
    }),
    [settings.paperWidth, settings.unicodeAsBitmap]
  )

  const printReceipt = useCallback(
    async (saleId: string, opts: PrintReceiptOptions = {}): Promise<boolean> => {
      let sale: SaleResponse
      try {
        const res = await fetch(`/api/sales/${saleId}`)
        if (!res.ok) {
          setStatus({ state: 'error', message: 'Failed to load sale for printing' })
          return false
        }
        sale = (await res.json()) as SaleResponse
      } catch (e) {
        setStatus({ state: 'error', message: errorMessage(e) })
        return false
      }
      const tenant = await fetchTenant()
      const input = saleToReceiptInput(sale, tenant, opts)
      const copies = Math.min(5, Math.max(1, opts.copies ?? settings.copies))
      const parts: Uint8Array[] = []
      for (let i = 0; i < copies; i++) {
        parts.push(
          buildReceiptEscPos(
            i === 0 ? input : { ...input, copyLabel: 'COPY' },
            // Kick the drawer only once, and only for cash sales.
            buildOpts(i === 0 && settings.drawerKick && !input.isReturn && input.payments.some((p) => p.method === 'cash'))
          )
        )
      }
      return printBytes(concatBytes(parts), `Receipt-${sale.invoiceNo}`)
    },
    [settings.copies, settings.drawerKick, buildOpts, printBytes]
  )

  const printZReport = useCallback(
    async (closing: ZReportSource | ZReportInput): Promise<boolean> => {
      const tenant = await fetchTenant()
      const input: ZReportInput =
        'methods' in closing && Array.isArray((closing as ZReportInput).methods)
          ? (closing as ZReportInput)
          : closingToZReportInput(closing as ZReportSource, tenant)
      const bytes = buildZReportEscPos(input, buildOpts(false))
      return printBytes(bytes, `Z-Report-${input.entryNumber}`)
    },
    [buildOpts, printBytes]
  )

  const openDrawer = useCallback(async (): Promise<boolean> => {
    if (settings.transport === 'browser') {
      setStatus({ state: 'error', message: 'Cash drawer needs a USB, Bluetooth or print-agent printer.' })
      return false
    }
    return printBytes(buildDrawerKickEscPos(2))
  }, [settings.transport, printBytes])

  const testPrint = useCallback(async (): Promise<boolean> => {
    const tenant = await fetchTenant()
    const bytes = buildTestPageEscPos({ paperWidth: settings.paperWidth, businessName: tenant.name, drawerKick: false })
    return printBytes(bytes, 'Printer test')
  }, [settings.paperWidth, printBytes])

  /** Show the browser's device picker for USB / Bluetooth. Returns the device name. */
  const pairDevice = useCallback(
    async (kind?: 'webusb' | 'webbluetooth'): Promise<string | null> => {
      const k = kind || settings.transport
      setStatus({ state: 'connecting' })
      try {
        let name: string
        if (k === 'webusb') name = await getUsbTransport().requestDevice()
        else if (k === 'webbluetooth') name = await getBleTransport().requestDevice()
        else {
          setStatus({ state: 'idle' })
          return null
        }
        setStatus({ state: 'idle' })
        // Nudge subscribers so deviceName re-reads localStorage.
        savePrinterSettings({})
        return name
      } catch (e) {
        setStatus({ state: 'error', message: errorMessage(e) })
        return null
      }
    },
    [settings.transport]
  )

  const forgetDevice = useCallback(async (kind?: 'webusb' | 'webbluetooth') => {
    const k = kind || settings.transport
    if (k === 'webusb') await getUsbTransport().forget()
    else if (k === 'webbluetooth') await getBleTransport().forget()
    savePrinterSettings({})
  }, [settings.transport])

  return {
    settings,
    updateSettings,
    status,
    support,
    deviceName,
    transportLabel: TRANSPORT_LABELS[settings.transport],
    /** True when receipts should go straight to a raw ESC/POS printer. */
    isRawPrinter: settings.transport !== 'browser',
    printReceipt,
    printZReport,
    openDrawer,
    testPrint,
    pairDevice,
    forgetDevice,
    printBytes,
  }
}

export type UsePrinterReturn = ReturnType<typeof usePrinter>
