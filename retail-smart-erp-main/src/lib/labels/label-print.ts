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

/**
 * Build the full print document (title, styles, page content) for a browser /
 * OS-dialog print on a multi-across roll: one page per physical row (page size
 * = liner width x label height), every label absolutely placed at its column
 * with the setup's margins, gaps and calibration offsets.
 */
export async function buildRollPrintDocument(
  template: LabelTemplate,
  items: { item: LabelItemData; quantity: number }[],
  setup: StickerSetup,
  currencySymbol?: string,
  tenantName?: string,
  codeWord?: string,
  copies = 1
): Promise<{ title: string; styles: string; content: string }> {
  const isSingleCol = setup.columns === 1
  const rollW = isSingleCol
    ? (setup.marginLeftMm > 0 ? setup.labelWidthMm + setup.marginLeftMm * 2 : setup.labelWidthMm)
    : stickerRollWidthMm(setup)
  const h = setup.labelHeightMm
  const safeH = Math.max(1, h - 0.25)
  const cache = new Map<string, string>()
  const pages: string[] = []
  for (const row of packLabelRows(items, setup.columns, copies)) {
    const cells: string[] = []
    for (let k = 0; k < row.cells.length; k++) {
      const cell = row.cells[k]
      if (!cell) continue
      const key = cell.item?.id || cell.item?.barcode || cell.item?.sku || cell.item?.name || String(k)
      if (!cache.has(key)) cache.set(key, await renderLabelHtml(template, cell.item, currencySymbol, tenantName, codeWord))
      const left = isSingleCol
        ? Math.max(0, setup.offsetXMm)
        : setup.marginLeftMm + setup.offsetXMm + k * (setup.labelWidthMm + setup.columnGapMm)
      cells.push(`<div class="cell" style="left:${left}mm;top:${setup.offsetYMm}mm">${cache.get(key)}</div>`)
    }
    // Each row wrapped in a .page container — Chrome sees each .page as a
    // separate page even when it ignores the small @page size and falls back
    // to A4/Letter.  The .row inside is sized to the physical sticker.
    const rowHtml = `<div class="row">${cells.join('')}</div>`
    const pageHtml = `<div class="page">${rowHtml}</div>`
    for (let i = 0; i < row.count; i++) pages.push(pageHtml)
  }

  // ── Robust CSS: works whether Chrome honours the custom @page size or
  //    falls back to A4/Letter.  The key trick is that each .page is a block
  //    with `page-break-after: always` + `break-after: page` so Chrome
  //    treats it as a full page boundary.  When the custom page size IS
  //    honoured the .page is exactly 1 label high; when Chrome falls back to
  //    A4 the .page still forces a page boundary, so each physical page
  //    contains exactly one row of labels (top-aligned) with empty space
  //    below.  Users can then set the OS printer paper size to the sticker
  //    dimensions to eliminate the blank area.
  //
  //    NOTE: @page descriptor rules MUST NOT include `!important` or `padding`
  //    as CSS Paged Media 3 treats `!important` in @page as invalid, causing
  //    Chromium to drop the page size and default to A4!
  const styles = `
    @page {
      size: ${rollW}mm ${h}mm;
      margin: 0;
    }
    * {
      box-sizing: border-box !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: ${rollW}mm !important;
      height: auto !important;
      min-height: 0 !important;
      background: #ffffff !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .print-content {
      margin: 0 !important;
      padding: 0 !important;
      width: ${rollW}mm !important;
      height: auto !important;
      display: block !important;
    }
    .page {
      display: block !important;
      position: relative !important;
      width: ${rollW}mm !important;
      height: ${safeH}mm !important;
      min-height: ${safeH}mm !important;
      max-height: ${safeH}mm !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: visible !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    .page:not(:last-child) {
      page-break-after: always !important;
      break-after: page !important;
    }
    .page:not(:first-child) {
      page-break-before: always !important;
      break-before: page !important;
    }
    .page:last-child {
      page-break-after: avoid !important;
      break-after: avoid !important;
    }
    .row {
      display: block !important;
      position: relative !important;
      width: ${rollW}mm !important;
      height: ${safeH}mm !important;
      max-height: ${safeH}mm !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    .cell {
      position: absolute !important;
      width: ${Number(template.widthMm)}mm !important;
      height: ${Number(template.heightMm)}mm !important;
      max-width: ${Number(template.widthMm)}mm !important;
      max-height: ${Number(template.heightMm)}mm !important;
      overflow: hidden !important;
      box-sizing: border-box !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
      font-size: initial !important;
      line-height: normal !important;
    }
    @media print {
      @page {
        size: ${rollW}mm ${h}mm;
        margin: 0;
      }
      html, body {
        width: ${rollW}mm !important;
        height: auto !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .print-content {
        width: ${rollW}mm !important;
        margin: 0 !important;
        padding: 0 !important;
        display: block !important;
      }
      .page {
        width: ${rollW}mm !important;
        height: ${safeH}mm !important;
        min-height: ${safeH}mm !important;
        max-height: ${safeH}mm !important;
        overflow: visible !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      .page:not(:last-child) {
        page-break-after: always !important;
        break-after: page !important;
      }
      .page:not(:first-child) {
        page-break-before: always !important;
        break-before: page !important;
      }
      .page:last-child {
        page-break-after: avoid !important;
        break-after: avoid !important;
      }
      .row {
        width: ${rollW}mm !important;
        height: ${safeH}mm !important;
        max-height: ${safeH}mm !important;
        overflow: hidden !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
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
  return { title: 'Barcode Labels', styles, content: pages.join('') }
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

/** True when the profile should receive raw printer commands instead of the browser dialog. */
export function isRawLabelPrinter(profile: PrinterProfile | null | undefined): profile is PrinterProfile {
  if (!profile || profile.transport === 'browser') return false
  const isZebra = /zebra|zd2|zd4|gk4|gx4|zt2|zt4/i.test(profile.name)
  return profile.role === 'label' || isZebra || profile.label?.language !== 'browser'
}

/**
 * Encode labels in the printer's language and send them through its transport
 * (WebUSB / Web Bluetooth / print agent).
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
  let language = profile.label?.language || 'tspl'
  const isZebra = /zebra|zd2|zd4|gk4|gx4|zt2|zt4/i.test(profile.name) || /zebra|zd2|zd4|gk4|gx4|zt2|zt4/i.test(profile.deviceKey)
  if (isZebra) {
    language = 'zpl'
  }
  const setup = opts.setup || null
  if (language === 'browser') return { ok: false, warnings: [], error: 'Printer is set to browser printing' }
  const { encodeLabels } = await import('@/lib/print/label')
  const { createCanvasLabelRasterizer, createImageElementRasterizer } = await import('@/lib/print/label/canvas-raster')
  const { sendToPrinter } = await import('@/lib/print/printer-profiles')
  const res = await encodeLabels(template, items, {
    language,
    dpi: setup?.dpi ?? profile.label?.dpi ?? 203,
    copies: opts.copies ?? 1,
    codeWord: opts.codeWord,
    currencySymbol: opts.currencySymbol,
    tenantName: opts.tenantName,
    gapMm: setup?.rowGapMm ?? profile.label?.gapMm ?? 2,
    darkness: setup?.darkness ?? profile.label?.darkness ?? 20,
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
