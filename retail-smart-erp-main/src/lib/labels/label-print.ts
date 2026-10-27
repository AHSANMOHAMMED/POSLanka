'use client'

import type { LabelTemplate, LabelItemData, PrintLabelConfig } from './types'
import { renderLabelHtml, getShapeBorderRadius } from './label-renderer'
import { executePrint } from '@/lib/print/print-executor'
import type { PrinterProfile } from '@/lib/print/printer-profiles'
import { packLabelRows, type LabelPrintItem, type LabelTemplateLike } from '@/lib/print/label/common'
import { stickerLayout, stickerRollWidthMm, type StickerSetup } from './sticker-stock'

const PAGE_SIZES: Record<string, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  Letter: { width: 216, height: 279 },
}

/**
 * Generate CSS for the label print sheet
 */
function generatePrintStyles(
  labelWidth: number,
  labelHeight: number,
  config: PrintLabelConfig,
  shapeCss?: string
): string {
  const isLabelMode = config.pageSize === 'Label'
  const page = isLabelMode
    ? { width: labelWidth, height: labelHeight }
    : PAGE_SIZES[config.pageSize] || PAGE_SIZES.A4

  return `
    @page {
      size: ${page.width}mm ${page.height}mm;
      margin: ${isLabelMode ? '0' : '5mm'};
    }

    * {
      box-sizing: border-box !important;
      margin: 0 !important;
      padding: 0 !important;
    }

    html, body {
      margin: 0 !important;
      padding: 0 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      ${isLabelMode ? `width: ${page.width}mm !important; background: #ffffff !important;` : ''}
    }

    .print-content {
      margin: 0 !important;
      padding: 0 !important;
      ${isLabelMode ? `width: ${page.width}mm !important;` : ''}
    }

    .labels-grid {
      ${isLabelMode
        ? 'display: block !important; margin: 0 !important; padding: 0 !important; width: 100% !important;'
        : `display: flex; flex-wrap: wrap; gap: ${config.gapMm}mm; align-content: flex-start;`}
    }

    .label-page {
      display: block !important;
      position: relative !important;
      width: ${labelWidth}mm !important;
      height: ${labelHeight}mm !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: visible !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    .label-page:not(:last-child) {
      page-break-after: always !important;
      break-after: page !important;
    }

    .label-page:not(:first-child) {
      page-break-before: always !important;
      break-before: page !important;
    }

    .label-page:last-child {
      page-break-after: avoid !important;
      break-after: avoid !important;
    }

    .label-cell {
      width: ${labelWidth}mm !important;
      height: ${labelHeight}mm !important;
      max-width: ${labelWidth}mm !important;
      max-height: ${labelHeight}mm !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
      ${shapeCss || ''}
    }

    @media print {
      @page {
        size: ${page.width}mm ${page.height}mm;
        margin: ${isLabelMode ? '0' : '5mm'};
      }
      .label-page {
        width: ${labelWidth}mm !important;
        height: ${labelHeight}mm !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      .label-page:not(:last-child) {
        page-break-after: always !important;
        break-after: page !important;
      }
      .label-page:not(:first-child) {
        page-break-before: always !important;
        break-before: page !important;
      }
      .label-page:last-child {
        page-break-after: avoid !important;
        break-after: avoid !important;
      }
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
        color-adjust: exact !important;
      }
      img {
        max-width: 100% !important;
        display: block !important;
        image-rendering: -webkit-optimize-contrast !important;
        image-rendering: crisp-edges !important;
      }
    }
  `
}

/**
 * Generate and print a sheet of labels
 */
export async function printLabels(
  template: LabelTemplate,
  items: { item: LabelItemData; quantity: number }[],
  config: PrintLabelConfig,
  currencySymbol?: string,
  tenantName?: string,
  codeWord?: string
): Promise<boolean> {
  const isLabelMode = config.pageSize === 'Label'
  // Generate all label HTML
  const labelHtmls: string[] = []

  for (const { item, quantity } of items) {
    const html = await renderLabelHtml(template, item, currencySymbol, tenantName, codeWord)
    for (let i = 0; i < quantity; i++) {
      if (isLabelMode) {
        labelHtmls.push(`<div class="label-page"><div class="label-cell">${html}</div></div>`)
      } else {
        labelHtmls.push(`<div class="label-cell">${html}</div>`)
      }
    }
  }

  // Use border-radius + overflow:hidden to clip the label to its shape (no border needed)
  const shapeCss = getShapeBorderRadius(template.labelShape, template.cornerRadius)
  const styles = generatePrintStyles(
    Number(template.widthMm),
    Number(template.heightMm),
    config,
    shapeCss
  )

  const content = `<div class="labels-grid">${labelHtmls.join('')}</div>`

  return executePrint('Barcode Labels', styles, content)
}

export interface RollPrintDocument {
  title: string
  styles: string
  content: string
  /** Physical rows = pages the dialog prints. */
  pages: number
  /** Page (= one physical row) size the printer driver's paper must match. */
  pageWidthMm: number
  pageHeightMm: number
}

const r4 = (n: number) => Math.round(n * 10000) / 10000

/**
 * Build the print document (title, styles, page content) for a browser /
 * OS-dialog print on a label roll: exactly one page per physical row, page
 * size = liner width x label height (the paper size the driver must have),
 * every label absolutely placed at its column with the setup's margins, gaps
 * and calibration offsets snapped to whole printer dots, so barcode bars land
 * on the printer's dot grid. Pages are separated by `break-before` only
 * (never break-after), so there is no trailing blank page.
 */
export async function buildRollPrintDocument(
  template: LabelTemplate,
  items: { item: LabelItemData; quantity: number }[],
  setup: StickerSetup,
  currencySymbol?: string,
  tenantName?: string,
  codeWord?: string,
  copies = 1
): Promise<RollPrintDocument> {
  const dpi = setup.dpi === 300 ? 300 : 203
  const dpm = dpi / 25.4
  const snap = (mm: number) => r4(Math.round(mm * dpm) / dpm)
  const rollW = stickerRollWidthMm(setup)
  const h = setup.labelHeightMm
  const cellW = Number(template.widthMm) || setup.labelWidthMm
  const cellH = Number(template.heightMm) || h
  const cache = new Map<string, string>()
  const pages: string[] = []
  for (const row of packLabelRows(items, setup.columns, copies)) {
    const cells: string[] = []
    for (let k = 0; k < row.cells.length; k++) {
      const cell = row.cells[k]
      if (!cell) continue
      const key = cell.item?.id || cell.item?.barcode || cell.item?.sku || cell.item?.name || String(k)
      if (!cache.has(key)) cache.set(key, await renderLabelHtml(template, cell.item, currencySymbol, tenantName, codeWord, dpi))
      const left = snap(setup.marginLeftMm + setup.offsetXMm + k * (setup.labelWidthMm + setup.columnGapMm))
      cells.push(`<div class="cell" data-col="${k + 1}" style="left:${left}mm;top:${snap(setup.offsetYMm)}mm">${cache.get(key)}</div>`)
    }
    const pageHtml = `<div class="page">${cells.join('')}</div>`
    for (let i = 0; i < row.count; i++) pages.push(pageHtml)
  }
  return { title: 'Barcode Labels', styles: rollPageStyles(rollW, h, cellW, cellH), content: pages.join(''), pages: pages.length, pageWidthMm: rollW, pageHeightMm: h }
}

/**
 * CSS for roll printing. Notes:
 *  - @page must not contain !important (Chromium drops the whole size then).
 *  - Each .page is exactly one page tall; separation uses break-before on
 *    every page but the first, never break-after (that adds a blank page).
 */
function rollPageStyles(pageW: number, pageH: number, cellW: number, cellH: number): string {
  return `
    @page { size: ${pageW}mm ${pageH}mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #ffffff; }
    body { font-family: Arial, Helvetica, sans-serif; color: #000; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .print-content { margin: 0; padding: 0; width: ${pageW}mm; }
    .page {
      position: relative; display: block; margin: 0; padding: 0;
      width: ${pageW}mm; height: ${pageH}mm; overflow: hidden;
      break-inside: avoid; page-break-inside: avoid;
    }
    .page + .page { break-before: page; page-break-before: always; }
    .cell { position: absolute; width: ${cellW}mm; height: ${cellH}mm; overflow: hidden; }
    svg { shape-rendering: crispEdges; }
  `
}

/** The exact HTML executePrint() hands to the browser (used by tests / downloads). */
export function rollPrintHtml(doc: Pick<RollPrintDocument, 'title' | 'styles' | 'content'>): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title><style>${doc.styles}</style></head><body><div class="print-content">${doc.content}</div></body></html>`
}

/**
 * Alignment test for the browser path: 2 rows, every label numbered in print
 * order (1, 2 / 3, 4 on a 2-across roll) with a border 0.5 mm inside its edge.
 * Wrong paper size / order shows at once while wasting only 2 rows.
 */
export function buildAlignmentTestDocument(setup: StickerSetup): RollPrintDocument {
  const dpm = (setup.dpi === 300 ? 300 : 203) / 25.4
  const snap = (mm: number) => r4(Math.round(mm * dpm) / dpm)
  const rollW = stickerRollWidthMm(setup)
  const w = setup.labelWidthMm
  const h = setup.labelHeightMm
  const pages: string[] = []
  let n = 1
  for (let row = 0; row < 2; row++) {
    const cells: string[] = []
    for (let k = 0; k < setup.columns; k++) {
      const left = snap(setup.marginLeftMm + setup.offsetXMm + k * (w + setup.columnGapMm))
      cells.push(
        `<div class="cell" data-col="${k + 1}" style="left:${left}mm;top:${snap(setup.offsetYMm)}mm"><div style="position:absolute;left:0.5mm;top:0.5mm;right:0.5mm;bottom:0.5mm;border:0.35mm solid #000;"></div><div style="position:absolute;left:0;right:0;top:${r4(h * 0.12)}mm;text-align:center;font:bold ${Math.max(10, Math.min(40, Math.round(h * 1.1)))}pt Arial,sans-serif;line-height:1;">${n}</div><div style="position:absolute;left:0;right:0;bottom:${r4(h * 0.1)}mm;text-align:center;font:6pt Arial,sans-serif;">${w}x${h} mm - row ${row + 1} col ${k + 1}</div></div>`
      )
      n++
    }
    pages.push(`<div class="page">${cells.join('')}</div>`)
  }
  return { title: 'Label alignment test', styles: rollPageStyles(rollW, h, w, h), content: pages.join(''), pages: 2, pageWidthMm: rollW, pageHeightMm: h }
}

/** Send a roll print document to the OS / browser print dialog. */
export async function printLabelsOnRoll(
  template: LabelTemplate,
  items: { item: LabelItemData; quantity: number }[],
  setup: StickerSetup,
  currencySymbol?: string,
  tenantName?: string,
  codeWord?: string,
  copies = 1
): Promise<boolean> {
  const doc = await buildRollPrintDocument(template, items, setup, currencySymbol, tenantName, codeWord, copies)
  return executePrint(doc.title, doc.styles, doc.content)
}

// ─── Raw label printers (W9: TSPL / ZPL / EPL / ESC/POS raster) ──────────

export interface RawLabelPrintResult {
  ok: boolean
  warnings: string[]
  error?: string
}

const ZEBRA_NAME = /zebra|zdesigner|\bzd\s?-?\d{3}|\bg[kxc]4\d\d|\bzt\s?-?\d{3}/i

/**
 * True when the profile should receive raw printer commands instead of the
 * browser dialog: a label-role printer with a raw language and a real
 * transport (print agent / WebUSB / Bluetooth). Receipt / kitchen printers
 * never get label commands.
 */
export function isRawLabelPrinter(profile: PrinterProfile | null | undefined): profile is PrinterProfile {
  if (!profile || profile.transport === 'browser' || profile.role !== 'label') return false
  return (profile.label?.language || 'tspl') !== 'browser'
}

/**
 * Language actually sent to a label printer: the profile's choice, except
 * that a Zebra (ZDesigner) printer left on the TSPL / raster default gets ZPL
 * (Zebra firmware does not understand TSPL). EPL stays EPL (LP 2844 etc).
 */
export function effectiveLabelLanguage(profile: PrinterProfile): PrinterProfile['label']['language'] {
  const lang = profile.label?.language || 'tspl'
  const names = `${profile.name} ${profile.agentTarget || ''} ${profile.deviceKey || ''}`
  if ((lang === 'tspl' || lang === 'escpos-raster') && ZEBRA_NAME.test(names)) return 'zpl'
  return lang
}

/** Printer resolution for raw printing: 300 if the printer profile or the roll setup says so. */
export function rawLabelDpi(profile: PrinterProfile, setup?: StickerSetup | null): 203 | 300 {
  return profile.label?.dpi === 300 || setup?.dpi === 300 ? 300 : 203
}

/**
 * Encode labels in the printer's language and send them through its transport
 * (print agent / WebUSB / Web Bluetooth). One printer command block per
 * physical row of a multi-across roll, labels strictly in order.
 */
export async function printLabelsRaw(
  profile: PrinterProfile,
  template: LabelTemplateLike,
  items: (LabelPrintItem | LabelItemData)[],
  opts: {
    currencySymbol?: string
    tenantName?: string
    codeWord?: string
    logoUrl?: string | null
    copies?: number
    /** Sticker stock setup: columns, gaps, offsets, dpi, darkness, speed (overrides the profile's media). */
    setup?: StickerSetup | null
  } = {}
): Promise<RawLabelPrintResult> {
  const language = effectiveLabelLanguage(profile)
  const setup = opts.setup || null
  if (language === 'browser') return { ok: false, warnings: [], error: 'Printer is set to browser printing' }
  if (language === 'driver') return printLabelsThroughDriver(profile, template, items, opts)
  const { encodeLabels } = await import('@/lib/print/label')
  const { createCanvasLabelRasterizer, createImageElementRasterizer } = await import('@/lib/print/label/canvas-raster')
  const { sendToPrinter } = await import('@/lib/print/printer-profiles')
  const res = await encodeLabels(template, items, {
    language,
    dpi: rawLabelDpi(profile, setup),
    copies: opts.copies ?? 1,
    codeWord: opts.codeWord,
    currencySymbol: opts.currencySymbol,
    tenantName: opts.tenantName,
    gapMm: setup?.rowGapMm ?? profile.label?.gapMm ?? 2,
    darkness: setup?.darkness ?? profile.label?.darkness,
    speed: setup?.speed ?? profile.label?.speed,
    ...(setup ? { widthMm: setup.labelWidthMm, heightMm: setup.labelHeightMm, layout: stickerLayout(setup) } : {}),
    rasterizeElement: createImageElementRasterizer(opts.logoUrl),
    rasterizeLabel: createCanvasLabelRasterizer(opts.logoUrl),
  })
  if (res.bytes.length === 0) return { ok: false, warnings: res.warnings, error: 'Nothing to print' }
  try {
    await sendToPrinter(profile, res.bytes, { title: 'Labels' })
    return { ok: true, warnings: res.warnings }
  } catch (e) {
    return { ok: false, warnings: res.warnings, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * "Through the driver": render every physical row (columns, gaps, margins,
 * offsets, copies, order) to an exact-size 1-bit PNG at the printer's dpi and
 * let the print agent print it with the installed driver (POST /print-image).
 * Works with drivers that do not accept raw ZPL / TSPL.
 */
export async function printLabelsThroughDriver(
  profile: PrinterProfile,
  template: LabelTemplateLike,
  items: (LabelPrintItem | LabelItemData)[],
  opts: { currencySymbol?: string; tenantName?: string; codeWord?: string; logoUrl?: string | null; copies?: number; setup?: StickerSetup | null } = {}
): Promise<RawLabelPrintResult> {
  if (profile.transport !== 'agent' || !profile.agentTarget) {
    return { ok: false, warnings: [], error: '"Through the driver" printing needs the skyERPOS print agent and an installed printer. Pick the printer under "Print directly".' }
  }
  const setup = opts.setup || null
  const { buildDriverImageJob } = await import('@/lib/print/label/driver-image')
  const { createCanvasLabelRasterizer } = await import('@/lib/print/label/canvas-raster')
  const { PrintAgentTransport } = await import('@/lib/print/escpos/transports')
  const job = await buildDriverImageJob(template, items, {
    dpi: rawLabelDpi(profile, setup),
    copies: opts.copies ?? 1,
    codeWord: opts.codeWord,
    currencySymbol: opts.currencySymbol,
    tenantName: opts.tenantName,
    ...(setup ? { widthMm: setup.labelWidthMm, heightMm: setup.labelHeightMm, layout: stickerLayout(setup) } : {}),
    rasterizeLabel: createCanvasLabelRasterizer(opts.logoUrl),
  })
  if (job.pages.length === 0) return { ok: false, warnings: job.warnings, error: 'Nothing to print' }
  try {
    await new PrintAgentTransport(profile.agentUrl, profile.agentTarget).printImages(job)
    return { ok: true, warnings: job.warnings }
  } catch (e) {
    return { ok: false, warnings: job.warnings, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Raw alignment test: 2 rows of numbered labels (1, 2 / 3, 4 on a 2-across
 * roll) with a border 0.5 mm inside each label, so order, size and offsets
 * can be checked while wasting only two rows.
 */
export async function printAlignmentTestRaw(profile: PrinterProfile, setup: StickerSetup): Promise<RawLabelPrintResult> {
  const w = setup.labelWidthMm
  const h = setup.labelHeightMm
  const template: LabelTemplateLike = {
    widthMm: w,
    heightMm: h,
    elements: [
      { id: 'border', type: 'shape', shape: 'rectangle', x: 0.5, y: 0.5, width: w - 1, height: h - 1, rotation: 0, zIndex: 0, borderWidth: 2, borderColor: '#000', borderStyle: 'solid' },
      { id: 'n', type: 'text', dataField: 'item.name', x: 1, y: h * 0.15, width: w - 2, height: h * 0.5, rotation: 0, zIndex: 1, fontSize: Math.max(10, Math.min(36, Math.round(h * 0.9))), fontWeight: 'bold', textAlign: 'center', maxLines: 1 },
      { id: 'sz', type: 'text', dataField: 'custom', customValue: `${w}x${h}mm`, x: 1, y: h * 0.72, width: w - 2, height: h * 0.2, rotation: 0, zIndex: 1, fontSize: 6, fontWeight: 'normal', textAlign: 'center', maxLines: 1 },
    ],
  }
  const items = Array.from({ length: setup.columns * 2 }, (_, i) => ({
    item: { id: `align-${i + 1}`, name: String(i + 1), sku: null, barcode: null, sellingPrice: '0', costPrice: '0', brand: null, oemPartNumber: null, pluCode: null, category: null, unit: '', weight: null, dimensions: null, imageUrl: null } as LabelItemData,
    quantity: 1,
  }))
  return printLabelsRaw(profile, template, items, { setup })
}

/** Browser alignment test (2 numbered rows) through the print dialog. */
export function printAlignmentTestDialog(setup: StickerSetup): Promise<boolean> {
  const doc = buildAlignmentTestDocument(setup)
  return executePrint(doc.title, doc.styles, doc.content)
}
