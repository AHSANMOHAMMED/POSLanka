/**
 * Per-terminal printer profiles (W9). Stored in localStorage
 * `poslanka:printers` as an array of `PrinterProfile`. The legacy single
 * printer config (`poslanka:printer`) is migrated into a "Receipt printer"
 * profile on first load.
 *
 * Client-side module (localStorage); safe to import on the server (falls back
 * to defaults when `window` is undefined).
 */
import { DEFAULT_AGENT_URL, getTransport, TransportError, type TransportKind } from './escpos/transports'
import type { CodePage, PaperWidth } from './escpos/encoder'

export const PRINTERS_KEY = 'poslanka:printers'
export const LEGACY_PRINTER_KEY = 'poslanka:printer'

export type PrinterRole = 'receipt' | 'label' | 'kitchen'
export type LabelLanguage = 'tspl' | 'zpl' | 'epl' | 'escpos-raster' | 'browser'
export const LABEL_LANGUAGES: LabelLanguage[] = ['tspl', 'zpl', 'epl', 'escpos-raster', 'browser']
export const LABEL_LANGUAGE_LABELS: Record<LabelLanguage, string> = {
  tspl: 'TSPL (TSC, Xprinter, Gainscha...)',
  zpl: 'ZPL (Zebra)',
  epl: 'EPL2 (older Zebra / Eltron)',
  'escpos-raster': 'ESC/POS raster (receipt printer)',
  browser: 'Browser print dialog',
}

export interface LabelPrinterConfig {
  widthMm: number
  heightMm: number
  gapMm: number
  dpi: 203 | 300
  language: LabelLanguage
  /** 0..15 (TSPL DENSITY / EPL D) or 0..30 (ZPL ~SD); clamped per language. */
  darkness?: number
  /** Inches per second. */
  speed?: number
  /** Sticker stock / printer setup (GET /api/label-settings/sticker-setups) this printer uses. */
  stickerSetupId?: string | null
}

export interface PrinterProfile {
  id: string
  name: string
  role: PrinterRole
  transport: TransportKind
  /** Receipt / kitchen paper width. */
  paperWidth: PaperWidth
  label: LabelPrinterConfig
  agentUrl: string
  agentTarget: string
  autoPrint: boolean
  drawerKick: boolean
  copies: number
  codePage: CodePage
  unicodeAsBitmap: boolean
  /** Key for remembered USB / Bluetooth device ('' = legacy single-printer slot). */
  deviceKey: string
}

export const DEFAULT_LABEL_CONFIG: LabelPrinterConfig = {
  widthMm: 50,
  heightMm: 30,
  gapMm: 2,
  dpi: 203,
  language: 'tspl',
}

export const ROLE_LABELS: Record<PrinterRole, string> = {
  receipt: 'Receipt',
  label: 'Label',
  kitchen: 'Kitchen',
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function newPrinterProfile(role: PrinterRole, patch: Partial<PrinterProfile> = {}): PrinterProfile {
  const id = patch.id || randomId()
  return sanitizePrinterProfile({
    id,
    name: role === 'receipt' ? 'Receipt printer' : role === 'label' ? 'Label printer' : 'Kitchen printer',
    role,
    transport: 'browser',
    paperWidth: 80,
    label: { ...DEFAULT_LABEL_CONFIG },
    agentUrl: DEFAULT_AGENT_URL,
    agentTarget: '',
    autoPrint: role === 'receipt',
    drawerKick: false,
    copies: 1,
    codePage: 'cp437',
    unicodeAsBitmap: false,
    deviceKey: id,
    ...patch,
  })
}

const clampNum = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, n))
}

export function sanitizeLabelConfig(raw: Partial<LabelPrinterConfig> | null | undefined): LabelPrinterConfig {
  const r = raw || {}
  const out: LabelPrinterConfig = {
    widthMm: clampNum(r.widthMm, 10, 220, DEFAULT_LABEL_CONFIG.widthMm),
    heightMm: clampNum(r.heightMm, 5, 400, DEFAULT_LABEL_CONFIG.heightMm),
    gapMm: clampNum(r.gapMm, 0, 20, DEFAULT_LABEL_CONFIG.gapMm),
    dpi: Number(r.dpi) === 300 ? 300 : 203,
    language: LABEL_LANGUAGES.includes(r.language as LabelLanguage) ? (r.language as LabelLanguage) : DEFAULT_LABEL_CONFIG.language,
  }
  if (r.darkness != null && Number.isFinite(Number(r.darkness))) out.darkness = clampNum(r.darkness, 0, 30, 8)
  if (r.speed != null && Number.isFinite(Number(r.speed))) out.speed = clampNum(r.speed, 1, 14, 4)
  if (typeof r.stickerSetupId === 'string' && r.stickerSetupId) out.stickerSetupId = r.stickerSetupId.slice(0, 64)
  return out
}

export function sanitizePrinterProfile(raw: Partial<PrinterProfile>): PrinterProfile {
  const role: PrinterRole = raw.role === 'label' || raw.role === 'kitchen' ? raw.role : 'receipt'
  const transport: TransportKind = (['browser', 'webusb', 'webbluetooth', 'agent'] as const).includes(raw.transport as TransportKind)
    ? (raw.transport as TransportKind)
    : 'browser'
  const id = typeof raw.id === 'string' && raw.id ? raw.id : randomId()
  return {
    id,
    name: (typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `${ROLE_LABELS[role]} printer`).slice(0, 60),
    role,
    transport,
    paperWidth: raw.paperWidth === 58 ? 58 : 80,
    label: sanitizeLabelConfig(raw.label),
    agentUrl: (raw.agentUrl || DEFAULT_AGENT_URL).trim(),
    agentTarget: (raw.agentTarget || '').trim(),
    autoPrint: raw.autoPrint ?? role === 'receipt',
    drawerKick: !!raw.drawerKick,
    copies: Math.round(clampNum(raw.copies, 1, 5, 1)),
    codePage: raw.codePage === 'cp1252' ? 'cp1252' : 'cp437',
    unicodeAsBitmap: !!raw.unicodeAsBitmap,
    deviceKey: typeof raw.deviceKey === 'string' ? raw.deviceKey : id,
  }
}

/** Legacy `poslanka:printer` value -> receipt profile (keeps the legacy USB/BLE device slot). */
export function migrateLegacyPrinter(raw: Record<string, unknown>): PrinterProfile {
  return sanitizePrinterProfile({
    ...(raw as Partial<PrinterProfile>),
    id: 'receipt-default',
    name: 'Receipt printer',
    role: 'receipt',
    deviceKey: '',
  })
}

export function loadPrinterProfiles(): PrinterProfile[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(PRINTERS_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.map((p) => sanitizePrinterProfile(p as Partial<PrinterProfile>))
    }
    const legacy = localStorage.getItem(LEGACY_PRINTER_KEY)
    if (legacy) {
      const migrated = [migrateLegacyPrinter(JSON.parse(legacy) as Record<string, unknown>)]
      try {
        localStorage.setItem(PRINTERS_KEY, JSON.stringify(migrated))
      } catch {
        /* ignore */
      }
      return migrated
    }
  } catch {
    /* corrupted storage */
  }
  return []
}

// ─── External store ───────────────────────────────────────────────────────

let cached: PrinterProfile[] | null = null
const listeners = new Set<() => void>()
const EMPTY: PrinterProfile[] = []

export function getPrinterProfilesSnapshot(): PrinterProfile[] {
  if (typeof window === 'undefined') return EMPTY
  if (!cached) cached = loadPrinterProfiles()
  return cached
}

export function getPrinterProfilesServerSnapshot(): PrinterProfile[] {
  return EMPTY
}

export function subscribePrinterProfiles(cb: () => void): () => void {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key === PRINTERS_KEY || e.key === LEGACY_PRINTER_KEY) {
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

export function savePrinterProfiles(list: PrinterProfile[]): PrinterProfile[] {
  const next = list.map((p) => sanitizePrinterProfile(p))
  cached = next
  try {
    localStorage.setItem(PRINTERS_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota / private mode */
  }
  listeners.forEach((l) => l())
  return next
}

/** Notify subscribers without changing data (e.g. after pairing a device). */
export function touchPrinterProfiles() {
  cached = cached ? [...cached] : null
  listeners.forEach((l) => l())
}

export function upsertPrinterProfile(profile: PrinterProfile): PrinterProfile[] {
  const list = getPrinterProfilesSnapshot()
  const idx = list.findIndex((p) => p.id === profile.id)
  const next = idx >= 0 ? list.map((p, i) => (i === idx ? profile : p)) : [...list, profile]
  return savePrinterProfiles(next)
}

export function updatePrinterProfile(id: string, patch: Partial<PrinterProfile>): PrinterProfile[] {
  const list = getPrinterProfilesSnapshot()
  return savePrinterProfiles(
    list.map((p) => (p.id === id ? { ...p, ...patch, label: patch.label ? { ...p.label, ...patch.label } : p.label } : p))
  )
}

export function removePrinterProfile(id: string): PrinterProfile[] {
  return savePrinterProfiles(getPrinterProfilesSnapshot().filter((p) => p.id !== id))
}

/** First configured printer for a role. */
export function getPrinterForRole(role: PrinterRole, list = getPrinterProfilesSnapshot()): PrinterProfile | null {
  return list.find((p) => p.role === role) || null
}

/** Send raw bytes to a printer profile through its transport. */
export async function sendToPrinter(
  profile: PrinterProfile,
  bytes: Uint8Array,
  browser?: { title?: string; html?: string }
): Promise<void> {
  const transport = getTransport(
    {
      transport: profile.transport,
      agentUrl: profile.agentUrl,
      agentTarget: profile.agentTarget,
      paperWidth: profile.paperWidth,
      deviceKey: profile.deviceKey,
    },
    { title: browser?.title, html: browser?.html, paperWidth: profile.paperWidth }
  )
  try {
    await transport.connect()
    await transport.write(bytes)
  } catch (e) {
    if (profile.transport === 'webusb' || profile.transport === 'webbluetooth') {
      try {
        await transport.close()
      } catch {
        /* ignore */
      }
    }
    throw e instanceof TransportError || e instanceof Error ? e : new Error(String(e))
  }
}
