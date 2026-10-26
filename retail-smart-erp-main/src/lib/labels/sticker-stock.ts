/**
 * Sticker stock / label printer setup.
 *
 * Label rolls come 1, 2, 3 or 4 labels across (e.g. 38 x 25 mm x 2, 32 x 25 mm x 3).
 * A setup describes the physical roll (label size, columns, gaps, liner margin),
 * the calibration offsets and the printer settings (DPI, darkness, speed,
 * direction). Setups are stored per tenant in the `label_settings` settings row
 * (`stickerSetups`), optionally scoped to a branch (warehouse). An admin can
 * lock a setup once it is calibrated: cashiers then print with it as is.
 *
 * Pure module (web + server; the mobile app reads the same JSON from
 * GET /api/label-settings and mirrors `stickerLayout` in apps/mobile/src/lib/label/stickerStock.ts).
 */
import { z } from 'zod'
import type { LabelSheetLayout } from '@/lib/print/label/common'

export const STICKER_LANGUAGES = ['tspl', 'zpl', 'epl', 'escpos-raster', 'browser'] as const

export interface StickerSetup {
  id: string
  name: string
  labelWidthMm: number
  labelHeightMm: number
  /** Labels across the roll (1..4). */
  columns: number
  /** Horizontal gap between labels in a row. */
  columnGapMm: number
  /** Vertical gap between rows (die-cut gap; TSPL GAP / EPL Q). */
  rowGapMm: number
  /** Liner margin left of the first label (= right of the last). */
  marginLeftMm: number
  /** Calibration shift, + = right / down. */
  offsetXMm: number
  offsetYMm: number
  dpi: 203 | 300
  /** Preferred printer language ('browser' = print dialog). Null = use the printer profile's. */
  language: (typeof STICKER_LANGUAGES)[number] | null
  /** 0..15 (TSPL / EPL) or 0..30 (ZPL). Null = printer default. */
  darkness: number | null
  /** Inches per second. Null = printer default. */
  speed: number | null
  /** TSPL DIRECTION (0 or 1). */
  direction: 0 | 1
  /** Branch (warehouse) this setup belongs to. Null = all branches. */
  warehouseId: string | null
  /** Locked by an admin: values cannot be changed at print time. */
  locked: boolean
  lockedBy?: string | null
  lockedAt?: string | null
  isDefault: boolean
}

const num = (min: number, max: number) => z.coerce.number().min(min).max(max)

export const stickerSetupSchema = z.object({
  id: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(60),
  labelWidthMm: num(10, 220),
  labelHeightMm: num(5, 400),
  columns: z.coerce.number().int().min(1).max(4),
  columnGapMm: num(0, 30),
  rowGapMm: num(0, 30),
  marginLeftMm: num(0, 30),
  offsetXMm: num(-20, 20),
  offsetYMm: num(-20, 20),
  dpi: z.union([z.literal(203), z.literal(300)]),
  language: z.enum(STICKER_LANGUAGES).nullable(),
  darkness: num(0, 30).nullable(),
  speed: num(1, 14).nullable(),
  direction: z.union([z.literal(0), z.literal(1)]),
  warehouseId: z.string().uuid().nullable(),
  locked: z.boolean(),
  lockedBy: z.string().max(120).nullable().optional(),
  lockedAt: z.string().max(40).nullable().optional(),
  isDefault: z.boolean(),
})

export const stickerSetupsSchema = z.array(stickerSetupSchema).max(50)

export const DEFAULT_STICKER_SETUP: Omit<StickerSetup, 'id' | 'name'> = {
  labelWidthMm: 50,
  labelHeightMm: 25,
  columns: 1,
  columnGapMm: 0,
  rowGapMm: 2,
  marginLeftMm: 0,
  offsetXMm: 0,
  offsetYMm: 0,
  dpi: 203,
  language: null,
  darkness: null,
  speed: null,
  direction: 1,
  warehouseId: null,
  locked: false,
  lockedBy: null,
  lockedAt: null,
  isDefault: false,
}

export interface StickerPreset {
  id: string
  name: string
  labelWidthMm: number
  labelHeightMm: number
  columns: number
  columnGapMm: number
  rowGapMm: number
  marginLeftMm: number
  note: string
}

/** Common rolls sold in Sri Lanka (Pettah / supplier stock). Liner width = margins + labels + gaps. */
export const STICKER_PRESETS: StickerPreset[] = [
  { id: '38x25x2', name: '🦓 Zebra 38 x 25 mm (Twin / 80mm Roll - 2 across)', labelWidthMm: 38, labelHeightMm: 25, columns: 2, columnGapMm: 2, rowGapMm: 2, marginLeftMm: 1, note: 'Standard retail barcode twin roll (80 mm liner)' },
  { id: '38x25x1', name: '🦓 Zebra 38 x 25 mm (Single - 1 across)', labelWidthMm: 38, labelHeightMm: 25, columns: 1, columnGapMm: 0, rowGapMm: 2, marginLeftMm: 0, note: 'Standard retail barcode single sticker (38 mm liner)' },
  { id: '32x25x3', name: '🦓 Zebra 32 x 25 mm (Triple / 102mm Roll - 3 across)', labelWidthMm: 32, labelHeightMm: 25, columns: 3, columnGapMm: 2, rowGapMm: 2, marginLeftMm: 1, note: 'Small price tags (102 mm liner)' },
  { id: '35x25x3', name: '🦓 Zebra 35 x 25 mm (Triple / 110mm Roll - 3 across)', labelWidthMm: 35, labelHeightMm: 25, columns: 3, columnGapMm: 2, rowGapMm: 2, marginLeftMm: 1, note: 'Standard triple roll (110 mm liner)' },
  { id: '50x30x1', name: '🦓 Zebra 50 x 30 mm Direct Thermal (Standard)', labelWidthMm: 50, labelHeightMm: 30, columns: 1, columnGapMm: 0, rowGapMm: 2, marginLeftMm: 0, note: 'Standard single roll (Zebra ZD220 / ZD230)' },
  { id: '80x50x1', name: '🦓 Zebra 80 mm Thermal Label (80 x 50 mm)', labelWidthMm: 80, labelHeightMm: 50, columns: 1, columnGapMm: 0, rowGapMm: 2, marginLeftMm: 0, note: '80 mm wide direct thermal roll' },
  { id: '80x40x1', name: '🦓 Zebra 80 mm Thermal Label (80 x 40 mm)', labelWidthMm: 80, labelHeightMm: 40, columns: 1, columnGapMm: 0, rowGapMm: 2, marginLeftMm: 0, note: '80 mm wide direct thermal roll' },
  { id: '25x15x4', name: '25 x 15 mm, 4 across', labelWidthMm: 25, labelHeightMm: 15, columns: 4, columnGapMm: 2, rowGapMm: 2, marginLeftMm: 1, note: 'Jewellery / pharmacy mini labels' },
  { id: '40x30x2', name: '40 x 30 mm, 2 across', labelWidthMm: 40, labelHeightMm: 30, columns: 2, columnGapMm: 2, rowGapMm: 2, marginLeftMm: 1, note: '84 mm liner' },
  { id: '50x25x2', name: '50 x 25 mm, 2 across', labelWidthMm: 50, labelHeightMm: 25, columns: 2, columnGapMm: 2, rowGapMm: 2, marginLeftMm: 1, note: '104 mm liner' },
  { id: '50x25x1', name: '50 x 25 mm, 1 across', labelWidthMm: 50, labelHeightMm: 25, columns: 1, columnGapMm: 0, rowGapMm: 2, marginLeftMm: 0, note: 'Single-row roll' },
  { id: '100x50x1', name: '100 x 50 mm, 1 across', labelWidthMm: 100, labelHeightMm: 50, columns: 1, columnGapMm: 0, rowGapMm: 3, marginLeftMm: 0, note: 'Shipping / carton labels' },
  { id: '100x150x1', name: '100 x 150 mm, 1 across', labelWidthMm: 100, labelHeightMm: 150, columns: 1, columnGapMm: 0, rowGapMm: 3, marginLeftMm: 0, note: 'Courier waybill' },
]

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function newStickerSetup(patch: Partial<StickerSetup> = {}): StickerSetup {
  return sanitizeStickerSetup({ ...DEFAULT_STICKER_SETUP, id: randomId(), name: 'Label roll', ...patch })
}

export function setupFromPreset(p: StickerPreset, patch: Partial<StickerSetup> = {}): StickerSetup {
  return newStickerSetup({
    name: p.name,
    labelWidthMm: p.labelWidthMm,
    labelHeightMm: p.labelHeightMm,
    columns: p.columns,
    columnGapMm: p.columnGapMm,
    rowGapMm: p.rowGapMm,
    marginLeftMm: p.marginLeftMm,
    ...patch,
  })
}

const clamp = (v: unknown, min: number, max: number, d: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d
}
const round2 = (n: number) => Math.round(n * 100) / 100

/** Lenient normaliser for stored / client values (never throws). */
export function sanitizeStickerSetup(raw: Partial<StickerSetup> | null | undefined): StickerSetup {
  const r = raw || {}
  const d = DEFAULT_STICKER_SETUP
  const lang = STICKER_LANGUAGES.includes(r.language as never) ? (r.language as StickerSetup['language']) : null
  const opt = (v: unknown, min: number, max: number) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : clamp(v, min, max, min))
  return {
    id: typeof r.id === 'string' && r.id ? r.id.slice(0, 64) : randomId(),
    name: (typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Label roll').slice(0, 60),
    labelWidthMm: round2(clamp(r.labelWidthMm, 10, 220, d.labelWidthMm)),
    labelHeightMm: round2(clamp(r.labelHeightMm, 5, 400, d.labelHeightMm)),
    columns: Math.round(clamp(r.columns, 1, 4, 1)),
    columnGapMm: round2(clamp(r.columnGapMm, 0, 30, d.columnGapMm)),
    rowGapMm: round2(clamp(r.rowGapMm, 0, 30, d.rowGapMm)),
    marginLeftMm: round2(clamp(r.marginLeftMm, 0, 30, d.marginLeftMm)),
    offsetXMm: round2(clamp(r.offsetXMm, -20, 20, 0)),
    offsetYMm: round2(clamp(r.offsetYMm, -20, 20, 0)),
    dpi: Number(r.dpi) === 300 ? 300 : 203,
    language: lang,
    darkness: opt(r.darkness, 0, 30),
    speed: opt(r.speed, 1, 14),
    direction: r.direction === 0 ? 0 : 1,
    warehouseId: typeof r.warehouseId === 'string' && /^[0-9a-f-]{36}$/i.test(r.warehouseId) ? r.warehouseId : null,
    locked: !!r.locked,
    lockedBy: r.locked ? (r.lockedBy ?? null) : null,
    lockedAt: r.locked ? (r.lockedAt ?? null) : null,
    isDefault: !!r.isDefault,
  }
}

export function sanitizeStickerSetups(raw: unknown): StickerSetup[] {
  if (!Array.isArray(raw)) return []
  const list = raw.slice(0, 50).map((x) => sanitizeStickerSetup(x as Partial<StickerSetup>))
  // at most one default
  let seen = false
  for (const s of list) {
    if (s.isDefault && !seen) seen = true
    else s.isDefault = false
  }
  return list
}

/** Total liner width (mm): margins + labels + gaps. */
export function stickerRollWidthMm(s: Pick<StickerSetup, 'labelWidthMm' | 'columns' | 'columnGapMm' | 'marginLeftMm'>): number {
  return round2(s.marginLeftMm * 2 + s.columns * s.labelWidthMm + (s.columns - 1) * s.columnGapMm)
}

/** Encoder layout for a setup. */
export function stickerLayout(s: StickerSetup): LabelSheetLayout {
  return {
    columns: s.columns,
    columnGapMm: s.columnGapMm,
    marginLeftMm: s.marginLeftMm,
    offsetXMm: s.offsetXMm,
    offsetYMm: s.offsetYMm,
    direction: s.direction,
  }
}

/** Setups usable at a branch: unscoped ones plus the branch's own. */
export function setupsForBranch(list: StickerSetup[], warehouseIds: string[] | null): StickerSetup[] {
  if (!warehouseIds) return list
  return list.filter((s) => !s.warehouseId || warehouseIds.includes(s.warehouseId))
}

/** Default setup: the flagged default, else the first locked one, else the first. */
export function defaultStickerSetup(list: StickerSetup[]): StickerSetup | null {
  return list.find((s) => s.isDefault) || list.find((s) => s.locked) || list[0] || null
}

/** Label positions (mm, top-left) of one physical row, for previews. */
export function stickerRowPositions(s: StickerSetup): { x: number; y: number }[] {
  return Array.from({ length: s.columns }, (_, i) => ({
    x: round2(s.marginLeftMm + i * (s.labelWidthMm + s.columnGapMm)),
    y: 0,
  }))
}

/**
 * Apply an existing locked setup's protected values to an incoming update
 * (non-admin users may not change a locked setup). Returns the merged list and
 * whether anything protected was attempted.
 */
export function mergeLockedSetups(prev: StickerSetup[], next: StickerSetup[]): { list: StickerSetup[]; blocked: boolean } {
  let blocked = false
  const byId = new Map(prev.map((s) => [s.id, s]))
  const list = next.map((s) => {
    const old = byId.get(s.id)
    if (old?.locked) {
      if (JSON.stringify(old) !== JSON.stringify(s)) blocked = true
      return old
    }
    return s
  })
  for (const old of prev) if (old.locked && !next.some((s) => s.id === old.id)) {
    blocked = true
    list.push(old)
  }
  return { list, blocked }
}
