'use client'

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import {
  buildZReportEscPos,
  buildTestPageEscPos,
  buildDrawerKickEscPos,
  concatBytes,
  DOT_WIDTH,
  type ZReportInput,
  type ZReportDetails,
  type ZReportMethod,
  type TextRasterizer,
} from '@/lib/print/escpos/encoder'
import {
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
import { buildReceiptEscPosFromModel } from '@/lib/print/escpos/receipt-from-model'
import {
  fetchLogoRaster,
  fetchTenantInfo,
  loadReceiptModel,
  logoToPackedRaster,
  type TenantReceiptInfo,
} from '@/lib/print/receipt-loader'
import { resolveReceiptSettings, type LegacyProfileReceiptFields } from '@/lib/print/receipt-settings'
import { buildBusinessBlock, num, type ReceiptModel } from '@/lib/print/receipt-model'
import { buildKitchenTicketEscPos, type KitchenTicketInput } from '@/lib/print/escpos/kitchen-ticket'
import {
  getPrinterForRole,
  getPrinterProfilesServerSnapshot,
  getPrinterProfilesSnapshot,
  newPrinterProfile,
  removePrinterProfile,
  sendToPrinter,
  subscribePrinterProfiles,
  touchPrinterProfiles,
  updatePrinterProfile,
  upsertPrinterProfile,
  type PrinterProfile,
  type PrinterRole,
} from '@/lib/print/printer-profiles'

export type { PrinterProfile, PrinterRole } from '@/lib/print/printer-profiles'
import { openReceiptPreview } from '@/components/print/ReceiptPreviewDialog'

// ─── Receipt printer settings (backed by the 'receipt' printer profile) ───

/** @deprecated legacy single-printer key; migrated into `poslanka:printers`. */
export const PRINTER_SETTINGS_KEY = 'poslanka:printer'

export type PrinterTransportKind = TransportKind

/** Settings of the receipt-role printer (subset of PrinterProfile). */
export type PrinterSettings = Pick<
  PrinterProfile,
  'transport' | 'paperWidth' | 'autoPrint' | 'drawerKick' | 'unicodeAsBitmap' | 'agentUrl' | 'agentTarget' | 'copies' | 'codePage'
>

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  transport: 'browser',
  paperWidth: 80,
  autoPrint: true,
  drawerKick: false,
  unicodeAsBitmap: false,
  agentUrl: DEFAULT_AGENT_URL,
  agentTarget: '',
  copies: 1,
  codePage: 'cp437',
}

/** Virtual receipt printer used until one is configured (browser print). */
const VIRTUAL_RECEIPT: PrinterProfile = newPrinterProfile('receipt', { id: 'receipt-default', deviceKey: '' })

function receiptProfile(list: PrinterProfile[]): PrinterProfile {
  return getPrinterForRole('receipt', list) || VIRTUAL_RECEIPT
}

export function loadPrinterSettings(): PrinterSettings {
  return receiptProfile(getPrinterProfilesSnapshot())
}

/** Patch the receipt printer (creates it from the legacy defaults if missing). */
export function savePrinterSettings(patch: Partial<PrinterSettings>): PrinterSettings {
  const list = getPrinterProfilesSnapshot()
  const existing = getPrinterForRole('receipt', list)
  if (existing) {
    const next = updatePrinterProfile(existing.id, patch)
    return receiptProfile(next)
  }
  const next = upsertPrinterProfile({ ...VIRTUAL_RECEIPT, ...patch })
  return receiptProfile(next)
}

function usePrinterProfilesStore(): PrinterProfile[] {
  return useSyncExternalStore(subscribePrinterProfiles, getPrinterProfilesSnapshot, getPrinterProfilesServerSnapshot)
}

type TenantResponse = TenantReceiptInfo

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
  /** H1: Z-report detail from the close response (tax, discounts, voids, returns, cash movements, ledger) */
  zReport?: ZReportDetails | null
  varianceReason?: string | null
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
  // Same business header as receipts (tenant receipt settings toggles applied).
  const block = buildBusinessBlock(tenant, resolveReceiptSettings(tenant.receiptSettingsRaw ?? tenant.receiptSettings ?? {}))
  return {
    business: {
      name: block.name,
      legalName: tenant.legalName ?? null,
      address: tenant.address ?? null,
      phone: tenant.phone ?? null,
      taxId: tenant.taxId ?? null,
      brn: tenant.brn ?? null,
    },
    businessLines: block.lines,
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
    details: src.zReport ?? null,
    varianceReason: src.varianceReason ?? null,
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

function deviceNameOf(p: PrinterProfile): string | null {
  switch (p.transport) {
    case 'webusb':
      return getStoredUsbDeviceName(p.deviceKey)
    case 'webbluetooth':
      return getStoredBleDeviceName(p.deviceKey)
    case 'agent':
      return p.agentTarget || 'default target'
    default:
      return null
  }
}

export interface PrintReceiptOptions {
  /** @deprecated use posProfile; mapped as legacy header lines. */
  header?: string | null
  /** @deprecated use posProfile; mapped as legacy footer lines. */
  footer?: string | null
  /** POS profile: legacy receipt fields + per-counter receiptSettings overrides. */
  posProfile?: LegacyProfileReceiptFields | null
  cashier?: string | null
  counter?: string | null
  copies?: number
  /** Extra per-line notes keyed by item index (e.g. serial numbers). */
  lineNotes?: Record<number, string[]>
}

/** Build ESC/POS bytes for a sale with the given printer profile. */
export async function buildReceiptBytesForSale(
  printerProfile: PrinterProfile,
  saleId: string,
  opts: PrintReceiptOptions = {}
): Promise<{ bytes: Uint8Array; invoiceNo: string }> {
  const posProfile: LegacyProfileReceiptFields | null =
    opts.posProfile ?? (opts.header || opts.footer ? { receiptHeader: opts.header, receiptFooter: opts.footer } : null)
  const { model } = await loadReceiptModel(saleId, {
    posProfile,
    cashier: opts.cashier,
    counter: opts.counter,
    lineNotes: opts.lineNotes,
  })
  return buildReceiptBytesFromModel(printerProfile, model, opts)
}

/** ESC/POS bytes for an already built receipt model (also offline receipts built on the device). */
export async function buildReceiptBytesFromModel(
  printerProfile: PrinterProfile,
  model: ReceiptModel,
  opts: PrintReceiptOptions = {}
): Promise<{ bytes: Uint8Array; invoiceNo: string }> {
  const widthDots = DOT_WIDTH[printerProfile.paperWidth] as 384 | 576
  const logo = model.logo.show ? await fetchLogoRaster(widthDots, model.logo.widthPct, model.logo.url) : null
  const logoRaster = logoToPackedRaster(logo)
  const copies = Math.min(5, Math.max(1, opts.copies ?? printerProfile.copies))
  const kick =
    printerProfile.drawerKick && printerProfile.transport !== 'browser' && !model.isReturn && model.payments.some((p) => p.label.startsWith('Cash'))
  const parts: Uint8Array[] = []
  for (let i = 0; i < copies; i++) {
    parts.push(
      buildReceiptEscPosFromModel(i === 0 ? model : { ...model, copyLabel: 'COPY' }, {
        paperWidth: printerProfile.paperWidth,
        unicodeAsBitmap: printerProfile.unicodeAsBitmap,
        rasterizer: printerProfile.unicodeAsBitmap ? getRasterizer() : null,
        codePage: printerProfile.codePage,
        // Kick the drawer only once, and only for cash sales.
        drawerKick: i === 0 && kick,
        logoRaster,
      })
    )
  }
  return { bytes: concatBytes(parts), invoiceNo: model.invoiceNo }
}

/** Test bytes for a printer profile (receipt / kitchen test page). Labels use the label encoders. */
export async function buildReceiptTestBytes(p: PrinterProfile): Promise<Uint8Array> {
  const tenant = await fetchTenantInfo()
  return buildTestPageEscPos({ paperWidth: p.paperWidth, businessName: tenant.name || undefined, codePage: p.codePage })
}

/** Logo raster for the Z report, using the same cache + settings as receipts. Never throws. */
async function zReportLogo(tenant: TenantResponse, p: PrinterProfile) {
  try {
    const block = buildBusinessBlock(tenant, resolveReceiptSettings(tenant.receiptSettingsRaw ?? tenant.receiptSettings ?? {}))
    if (!block.logo.show) return null
    const widthDots = DOT_WIDTH[p.paperWidth] as 384 | 576
    return logoToPackedRaster(await fetchLogoRaster(widthDots, block.logo.widthPct, block.logo.url))
  } catch {
    return null
  }
}

// ─── Kitchen tickets (KOT) ──────────────────────────────────────────────

export type KitchenPrintResult = 'printed' | 'skipped' | 'failed'

/**
 * Print a kitchen order ticket on this terminal's kitchen-role printer.
 * Returns 'skipped' (silently) when no kitchen printer is configured or there
 * is nothing to print; never throws, so callers can fire-and-forget.
 */
export async function printKitchenTicket(ticket: KitchenTicketInput): Promise<KitchenPrintResult> {
  if (!ticket.items.length) return 'skipped'
  const p = getPrinterForRole('kitchen')
  if (!p) return 'skipped'
  try {
    const one = buildKitchenTicketEscPos(ticket, {
      paperWidth: p.paperWidth,
      codePage: p.codePage,
      unicodeAsBitmap: p.unicodeAsBitmap,
      rasterizer: p.unicodeAsBitmap ? getRasterizer() : null,
    })
    const copies = Math.min(5, Math.max(1, p.copies || 1))
    const bytes = copies > 1 ? concatBytes(Array.from({ length: copies }, () => one)) : one
    await sendToPrinter(p, bytes, { title: `KOT-${ticket.orderNo}` })
    return 'printed'
  } catch (e) {
    console.warn('Kitchen ticket print failed:', errorMessage(e))
    return 'failed'
  }
}

export type PreviewPrintResult = 'printed' | 'cancelled' | 'failed'

/**
 * Send ESC/POS bytes to `profile`, first showing the print preview (Print /
 * Cancel / change printer) when the profile has `previewBeforePrint` (or
 * `forcePreview`). `rebuild` regenerates the bytes when another printer with a
 * different paper width / code page is picked. Throws on transport errors.
 */
export async function printWithOptionalPreview(
  profile: PrinterProfile,
  bytes: Uint8Array,
  opts: { title?: string; rebuild?: (p: PrinterProfile) => Promise<Uint8Array>; forcePreview?: boolean } = {}
): Promise<Exclude<PreviewPrintResult, 'failed'>> {
  let target = profile
  let data = bytes
  if (profile.previewBeforePrint || opts.forcePreview) {
    const choice = await openReceiptPreview({ bytes, title: opts.title, profile, rebuild: opts.rebuild })
    if (!choice) return 'cancelled'
    target = choice.profile
    data = choice.bytes
  }
  await sendToPrinter(target, data, { title: opts.title })
  return 'printed'
}

/** All printer profiles of this terminal + edit helpers. */
export function usePrinters() {
  const printers = usePrinterProfilesStore()
  const [status, setStatus] = useState<PrinterStatus>({ state: 'idle' })

  const addPrinter = useCallback((role: PrinterRole, patch: Partial<PrinterProfile> = {}) => {
    const p = newPrinterProfile(role, patch)
    upsertPrinterProfile(p)
    return p
  }, [])
  const updatePrinter = useCallback((id: string, patch: Partial<PrinterProfile>) => {
    updatePrinterProfile(id, patch)
  }, [])
  const removePrinter = useCallback((id: string) => {
    removePrinterProfile(id)
  }, [])

  const printTo = useCallback(async (p: PrinterProfile, bytes: Uint8Array, browser?: { title?: string; html?: string }) => {
    setStatus({ state: 'printing' })
    try {
      await sendToPrinter(p, bytes, browser)
      setStatus({ state: 'idle', lastPrintedAt: Date.now() })
      return true
    } catch (e) {
      setStatus({ state: 'error', message: errorMessage(e) })
      return false
    }
  }, [])

  /** Send bytes to the first printer with `role`. Returns false if none / failed. */
  const printWithRole = useCallback(
    async (role: PrinterRole, bytes: Uint8Array, browser?: { title?: string; html?: string }) => {
      const p = getPrinterForRole(role, printers)
      if (!p) {
        setStatus({ state: 'error', message: `No ${role} printer configured on this terminal.` })
        return false
      }
      return printTo(p, bytes, browser)
    },
    [printers, printTo]
  )

  const pairDevice = useCallback(async (p: PrinterProfile, showAllDevices = false): Promise<string | null> => {
    setStatus({ state: 'connecting' })
    try {
      let name: string | null = null
      if (p.transport === 'webusb') name = await getUsbTransport(p.deviceKey).requestDevice(showAllDevices)
      else if (p.transport === 'webbluetooth') name = await getBleTransport(p.deviceKey).requestDevice()
      setStatus({ state: 'idle' })
      if (name) {
        const isZebra = /zebra|zd2|zd4|gk4|gx4|zt2|zt4/i.test(name)
        const isGenericName = p.name === 'Receipt printer' || p.name === 'Label printer' || p.name === 'Kitchen printer'
        const patch: Partial<PrinterProfile> = {}
        if (isGenericName) {
          patch.name = name
        }
        if (isZebra) {
          patch.role = 'label'
          patch.label = { ...p.label, language: 'zpl', dpi: 203 }
        }
        if (Object.keys(patch).length > 0) {
          updatePrinter(p.id, patch)
        }
      }
      touchPrinterProfiles()
      return name
    } catch (e) {
      setStatus({ state: 'error', message: errorMessage(e) })
      return null
    }
  }, [updatePrinter])

  const forgetDevice = useCallback(async (p: PrinterProfile) => {
    if (p.transport === 'webusb') await getUsbTransport(p.deviceKey).forget()
    else if (p.transport === 'webbluetooth') await getBleTransport(p.deviceKey).forget()
    touchPrinterProfiles()
  }, [])

  return {
    printers,
    status,
    setStatus,
    addPrinter,
    updatePrinter,
    removePrinter,
    printTo,
    printWithRole,
    pairDevice,
    forgetDevice,
    deviceNameOf,
    getPrinterForRole: (role: PrinterRole) => getPrinterForRole(role, printers),
  }
}

/** Receipt-role printer API (unchanged contract used by the POS). */
export function usePrinter() {
  const printers = usePrinterProfilesStore()
  const profile = receiptProfile(printers)
  const settings: PrinterSettings = profile
  const [status, setStatus] = useState<PrinterStatus>({ state: 'idle' })

  const updateSettings = useCallback((patch: Partial<PrinterSettings>) => savePrinterSettings(patch), [])

  const support = useMemo(
    () => ({
      webusb: supportsWebUsb(),
      webbluetooth: supportsWebBluetooth(),
    }),
    []
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const deviceName = useMemo(() => deviceNameOf(profile), [profile.transport, profile.agentTarget, profile.deviceKey, printers])

  /** Send raw ESC/POS bytes through the receipt printer's transport. */
  const printBytes = useCallback(
    async (bytes: Uint8Array, browserTitle?: string): Promise<boolean> => {
      setStatus({ state: 'connecting' })
      try {
        setStatus({ state: 'printing' })
        await sendToPrinter(profile, bytes, { title: browserTitle })
        setStatus({ state: 'idle', lastPrintedAt: Date.now() })
        return true
      } catch (e) {
        setStatus({ state: 'error', message: errorMessage(e) })
        return false
      }
    },
    [profile]
  )

  /** Result of the last receipt print ('cancelled' = closed in the print preview). */
  const [lastPrintResult, setLastPrintResult] = useState<PreviewPrintResult | null>(null)

  /**
   * Receipt bytes -> (optional preview) -> printer. A preview cancel resolves
   * true ("handled") so callers do not fall back to browser printing; check
   * `lastPrintResult` / use `printReceiptEx` to tell it apart.
   */
  const printBuiltReceipt = useCallback(
    async (build: (p: PrinterProfile) => Promise<{ bytes: Uint8Array; invoiceNo: string }>): Promise<PreviewPrintResult> => {
      let built: { bytes: Uint8Array; invoiceNo: string }
      try {
        built = await build(profile)
      } catch (e) {
        setStatus({ state: 'error', message: errorMessage(e) })
        setLastPrintResult('failed')
        return 'failed'
      }
      try {
        setStatus({ state: 'printing' })
        const result = await printWithOptionalPreview(profile, built.bytes, {
          title: `Receipt-${built.invoiceNo}`,
          rebuild: async (p) => (await build(p)).bytes,
        })
        setStatus(result === 'printed' ? { state: 'idle', lastPrintedAt: Date.now() } : { state: 'idle' })
        setLastPrintResult(result)
        return result
      } catch (e) {
        setStatus({ state: 'error', message: errorMessage(e) })
        setLastPrintResult('failed')
        return 'failed'
      }
    },
    [profile]
  )

  const printReceiptEx = useCallback(
    (saleId: string, opts: PrintReceiptOptions = {}) => printBuiltReceipt((p) => buildReceiptBytesForSale(p, saleId, opts)),
    [printBuiltReceipt]
  )

  const printReceiptModelEx = useCallback(
    (model: ReceiptModel, opts: PrintReceiptOptions = {}) => printBuiltReceipt((p) => buildReceiptBytesFromModel(p, model, opts)),
    [printBuiltReceipt]
  )

  const printReceipt = useCallback(
    async (saleId: string, opts: PrintReceiptOptions = {}): Promise<boolean> => (await printReceiptEx(saleId, opts)) !== 'failed',
    [printReceiptEx]
  )

  /** Print a receipt model built on the device (offline sale, OFF- number). */
  const printReceiptModel = useCallback(
    async (model: ReceiptModel, opts: PrintReceiptOptions = {}): Promise<boolean> => (await printReceiptModelEx(model, opts)) !== 'failed',
    [printReceiptModelEx]
  )

  const printZReport = useCallback(
    async (closing: ZReportSource | ZReportInput): Promise<boolean> => {
      const tenant = await fetchTenantInfo()
      const input: ZReportInput =
        'methods' in closing && Array.isArray((closing as ZReportInput).methods)
          ? (closing as ZReportInput)
          : closingToZReportInput(closing as ZReportSource, tenant)
      const logo = await zReportLogo(tenant, profile)
      const bytes = buildZReportEscPos(input, {
        paperWidth: profile.paperWidth,
        unicodeAsBitmap: profile.unicodeAsBitmap,
        rasterizer: profile.unicodeAsBitmap ? getRasterizer() : null,
        codePage: profile.codePage,
        logoRaster: logo,
      })
      return printBytes(bytes, `Z-Report-${input.entryNumber}`)
    },
    [profile, printBytes]
  )

  const openDrawer = useCallback(async (): Promise<boolean> => {
    if (profile.transport === 'browser') {
      setStatus({ state: 'error', message: 'Cash drawer needs a USB, Bluetooth or print-agent printer.' })
      return false
    }
    return printBytes(buildDrawerKickEscPos(2))
  }, [profile.transport, printBytes])

  const testPrint = useCallback(async (): Promise<boolean> => {
    return printBytes(await buildReceiptTestBytes(profile), 'Printer test')
  }, [profile, printBytes])

  /** Show the browser's device picker for USB / Bluetooth. Returns the device name. */
  const pairDevice = useCallback(
    async (kind?: 'webusb' | 'webbluetooth', showAllDevices = false): Promise<string | null> => {
      const k = kind || profile.transport
      setStatus({ state: 'connecting' })
      try {
        let name: string
        if (k === 'webusb') name = await getUsbTransport(profile.deviceKey).requestDevice(showAllDevices)
        else if (k === 'webbluetooth') name = await getBleTransport(profile.deviceKey).requestDevice()
        else {
          setStatus({ state: 'idle' })
          return null
        }
        setStatus({ state: 'idle' })
        // Persist the receipt profile (if virtual) and nudge subscribers so deviceName re-reads storage.
        savePrinterSettings({})
        return name
      } catch (e) {
        setStatus({ state: 'error', message: errorMessage(e) })
        return null
      }
    },
    [profile.transport, profile.deviceKey]
  )

  const forgetDevice = useCallback(
    async (kind?: 'webusb' | 'webbluetooth') => {
      const k = kind || profile.transport
      if (k === 'webusb') await getUsbTransport(profile.deviceKey).forget()
      else if (k === 'webbluetooth') await getBleTransport(profile.deviceKey).forget()
      savePrinterSettings({})
    },
    [profile.transport, profile.deviceKey]
  )

  return {
    settings,
    profile,
    updateSettings,
    status,
    support,
    deviceName,
    transportLabel: TRANSPORT_LABELS[settings.transport],
    /** True when receipts should go straight to a raw ESC/POS printer. */
    isRawPrinter: settings.transport !== 'browser',
    printReceipt,
    printReceiptModel,
    /** Like printReceipt but returns 'printed' | 'cancelled' | 'failed'. */
    printReceiptEx,
    printReceiptModelEx,
    lastPrintResult,
    printZReport,
    openDrawer,
    testPrint,
    pairDevice,
    forgetDevice,
    printBytes,
  }
}

export type UsePrinterReturn = ReturnType<typeof usePrinter>
export type UsePrintersReturn = ReturnType<typeof usePrinters>
