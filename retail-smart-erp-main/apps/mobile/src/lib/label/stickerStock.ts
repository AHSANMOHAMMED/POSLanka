/**
 * Sticker stock / label roll setups, read from the server (GET /api/label-settings
 * `stickerSetups`, managed in the web app under Barcode & Labels > Settings).
 * Mirror of the web src/lib/labels/sticker-stock.ts (types + stickerLayout).
 * The mobile app never edits setups: an admin calibrates and locks them on the web.
 */
import type { LabelSheetLayout } from './common'

export interface StickerSetup {
  id: string
  name: string
  labelWidthMm: number
  labelHeightMm: number
  columns: number
  columnGapMm: number
  rowGapMm: number
  marginLeftMm: number
  offsetXMm: number
  offsetYMm: number
  dpi: 203 | 300
  language: 'tspl' | 'zpl' | 'epl' | 'escpos-raster' | 'browser' | null
  darkness: number | null
  speed: number | null
  direction: 0 | 1
  warehouseId: string | null
  locked: boolean
  isDefault: boolean
}

const n = (v: unknown, min: number, max: number, d: number) => {
  const x = Number(v)
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : d
}
const opt = (v: unknown, min: number, max: number) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : n(v, min, max, min))

export function sanitizeStickerSetups(raw: unknown): StickerSetup[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r) => r && typeof r === 'object' && typeof (r as StickerSetup).id === 'string')
    .slice(0, 50)
    .map((r: any): StickerSetup => ({
      id: String(r.id),
      name: String(r.name || 'Label roll'),
      labelWidthMm: n(r.labelWidthMm, 10, 220, 50),
      labelHeightMm: n(r.labelHeightMm, 5, 400, 25),
      columns: Math.round(n(r.columns, 1, 4, 1)),
      columnGapMm: n(r.columnGapMm, 0, 30, 0),
      rowGapMm: n(r.rowGapMm, 0, 30, 2),
      marginLeftMm: n(r.marginLeftMm, 0, 30, 0),
      offsetXMm: n(r.offsetXMm, -20, 20, 0),
      offsetYMm: n(r.offsetYMm, -20, 20, 0),
      dpi: Number(r.dpi) === 300 ? 300 : 203,
      language: ['tspl', 'zpl', 'epl', 'escpos-raster', 'browser'].includes(r.language) ? r.language : null,
      darkness: opt(r.darkness, 0, 30),
      speed: opt(r.speed, 1, 14),
      direction: r.direction === 0 ? 0 : 1,
      warehouseId: typeof r.warehouseId === 'string' ? r.warehouseId : null,
      locked: !!r.locked,
      isDefault: !!r.isDefault,
    }))
}

/** The setup a device uses: the one linked to the printer, else the default (or first locked) one. */
export function pickStickerSetup(list: StickerSetup[], linkedId?: string | null): StickerSetup | null {
  if (linkedId) {
    const s = list.find((x) => x.id === linkedId)
    if (s) return s
  }
  return list.find((s) => s.isDefault) || list.find((s) => s.locked) || null
}

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

export function stickerRollWidthMm(s: StickerSetup): number {
  return Math.round((s.marginLeftMm * 2 + s.columns * s.labelWidthMm + (s.columns - 1) * s.columnGapMm) * 100) / 100
}
