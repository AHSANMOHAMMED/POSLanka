/**
 * Browser-side loaders for receipt printing (W7): tenant business profile,
 * sale + serial numbers, and the logo raster (memory + localStorage cache so
 * receipts keep their logo while offline).
 */
import { base64ToBytes, type PackedRaster } from './escpos/encoder'
import {
  buildReceiptModel,
  type ReceiptModel,
  type ReceiptSaleItemSource,
  type ReceiptSaleSource,
  type ReceiptTenantInfo,
} from './receipt-model'
import { resolveReceiptSettings, type LegacyProfileReceiptFields, type ReceiptSettings } from './receipt-settings'

export interface TenantReceiptInfo extends ReceiptTenantInfo {
  id?: string
  taxInclusive?: boolean
  /** Effective tenant-level settings (defaults merged). */
  receiptSettings?: Partial<ReceiptSettings> | null
  /** Stored tenant-level settings (partial). */
  receiptSettingsRaw?: Partial<ReceiptSettings> | null
}

const TENANT_LS_KEY = 'poslanka:receipt-tenant'
let tenantCache: { at: number; data: TenantReceiptInfo } | null = null

export async function fetchTenantInfo(force = false): Promise<TenantReceiptInfo> {
  if (!force && tenantCache && Date.now() - tenantCache.at < 5 * 60_000) return tenantCache.data
  try {
    const res = await fetch('/api/tenant')
    if (res.ok) {
      const data = (await res.json()) as TenantReceiptInfo
      tenantCache = { at: Date.now(), data }
      try {
        localStorage.setItem(TENANT_LS_KEY, JSON.stringify(data))
      } catch {
        /* ignore */
      }
      return data
    }
  } catch {
    /* offline */
  }
  if (tenantCache) return tenantCache.data
  try {
    const raw = localStorage.getItem(TENANT_LS_KEY)
    if (raw) return JSON.parse(raw) as TenantReceiptInfo
  } catch {
    /* ignore */
  }
  return {}
}

export function invalidateTenantInfo() {
  tenantCache = null
}

// ─── Logo raster ──────────────────────────────────────────────────────────

export interface LogoRasterResponse {
  width: number
  height: number
  data: string
  pngBase64?: string
  logoWidth?: number
}

interface CachedLogo extends LogoRasterResponse {
  logoUrl: string
}

const logoMem = new Map<string, CachedLogo | null>()
const logoKey = (width: number, pct: number) => `poslanka:logo-raster:${width}:${pct}`

/**
 * Fetch (and cache) the tenant logo raster for a paper dot width. The cache is
 * keyed by logoUrl so a new upload invalidates it. Returns null when there is
 * no logo or it cannot be loaded (and nothing cached).
 */
export async function fetchLogoRaster(width: 384 | 576, pct: number, logoUrl: string | null | undefined): Promise<LogoRasterResponse | null> {
  if (!logoUrl) return null
  const key = logoKey(width, pct)
  const mem = logoMem.get(key)
  if (mem && mem.logoUrl === logoUrl) return mem
  let stored: CachedLogo | null = null
  try {
    const raw = localStorage.getItem(key)
    stored = raw ? (JSON.parse(raw) as CachedLogo) : null
  } catch {
    stored = null
  }
  if (stored && stored.logoUrl === logoUrl) {
    logoMem.set(key, stored)
    return stored
  }
  try {
    const res = await fetch(`/api/settings/logo/raster?width=${width}&pct=${pct}`)
    if (res.ok) {
      const data = (await res.json()) as LogoRasterResponse
      const entry: CachedLogo = { ...data, logoUrl }
      logoMem.set(key, entry)
      try {
        localStorage.setItem(key, JSON.stringify(entry))
      } catch {
        /* quota: keep memory cache only */
      }
      return entry
    }
  } catch {
    /* offline */
  }
  return stored // stale (old logo) is better than none offline
}

export function logoToPackedRaster(r: LogoRasterResponse | null): PackedRaster | null {
  if (!r || !r.data) return null
  return { width: r.width, height: r.height, data: base64ToBytes(r.data) }
}

// ─── Sale ─────────────────────────────────────────────────────────────────

export interface SaleForReceipt extends ReceiptSaleSource {
  id: string
  items?: (ReceiptSaleItemSource & { serialNumberIds?: string[] | null })[]
  user?: { fullName?: string | null } | null
}

export async function fetchSaleForReceipt(saleId: string): Promise<SaleForReceipt> {
  const res = await fetch(`/api/sales/${saleId}`)
  if (!res.ok) throw new Error('Failed to load sale for printing')
  return (await res.json()) as SaleForReceipt
}

/** Resolve serial numbers into per-line notes ("S/N: ..."). Non-critical. */
export async function fetchSerialNotes(sale: SaleForReceipt): Promise<Record<number, string[]>> {
  const items = sale.items || []
  const ids = items.flatMap((i) => i.serialNumberIds || [])
  if (ids.length === 0) return {}
  try {
    const res = await fetch(`/api/serial-numbers/by-ids?ids=${ids.map(encodeURIComponent).join(',')}`)
    if (!res.ok) return {}
    const data = (await res.json()) as { id: string; serialNumber: string }[]
    const map = new Map(data.map((d) => [d.id, d.serialNumber]))
    const notes: Record<number, string[]> = {}
    items.forEach((it, idx) => {
      const sns = (it.serialNumberIds || []).map((id) => map.get(id)).filter(Boolean) as string[]
      if (sns.length) notes[idx] = [`S/N: ${sns.join(', ')}`]
    })
    return notes
  } catch {
    return {}
  }
}

export interface LoadReceiptOptions {
  /** POS profile (legacy header/footer/showLogo + receiptSettings overrides). */
  posProfile?: LegacyProfileReceiptFields | null
  cashier?: string | null
  counter?: string | null
  copyLabel?: string | null
  lineNotes?: Record<number, string[]>
}

/** Load sale + tenant and build the shared receipt model. */
export async function loadReceiptModel(
  saleId: string,
  opts: LoadReceiptOptions = {}
): Promise<{ model: ReceiptModel; sale: SaleForReceipt; tenant: TenantReceiptInfo; settings: ReceiptSettings }> {
  const [sale, tenant] = await Promise.all([fetchSaleForReceipt(saleId), fetchTenantInfo()])
  if (sale.isReturn && sale.returnAgainst && !sale.originalInvoiceNo) {
    // A credit note must quote the invoice it adjusts. Non-critical (offline: printed without it).
    try {
      const orig = await fetchSaleForReceipt(sale.returnAgainst)
      sale.originalInvoiceNo = orig.invoiceNo
    } catch {
      /* ignore */
    }
  }
  const lineNotes = opts.lineNotes ?? (await fetchSerialNotes(sale))
  return modelFromSale(sale, tenant, { ...opts, lineNotes })
}

/**
 * Receipt model for a sale that exists only on this device (queued offline, OFF- number): built
 * from the cart with the cached tenant profile / receipt settings, no server round trip.
 */
export async function buildLocalReceiptModel(
  sale: SaleForReceipt,
  opts: LoadReceiptOptions = {}
): Promise<{ model: ReceiptModel; sale: SaleForReceipt; tenant: TenantReceiptInfo; settings: ReceiptSettings }> {
  const tenant = await fetchTenantInfo()
  return modelFromSale(sale, tenant, opts)
}

function modelFromSale(sale: SaleForReceipt, tenant: TenantReceiptInfo, opts: LoadReceiptOptions) {
  const lineNotes = opts.lineNotes || {}
  const settings = resolveReceiptSettings(tenant.receiptSettingsRaw ?? tenant.receiptSettings ?? {}, opts.posProfile)
  const model = buildReceiptModel({
    sale,
    tenant,
    settings,
    cashier: opts.cashier ?? sale.user?.fullName ?? null,
    counter: opts.counter ?? null,
    copyLabel: opts.copyLabel ?? null,
    lineNotes,
  })
  return { model, sale, tenant, settings }
}
