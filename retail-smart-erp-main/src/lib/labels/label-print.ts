'use client'

import type { LabelTemplate, LabelItemData, PrintLabelConfig } from './types'
import { renderLabelHtml, getShapeBorderRadius } from './label-renderer'
import { executePrint } from '@/lib/print/print-executor'
import type { PrinterProfile } from '@/lib/print/printer-profiles'
import type { LabelPrintItem, LabelTemplateLike } from '@/lib/print/label/common'

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

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .labels-grid {
      display: flex;
      flex-wrap: wrap;
      gap: ${isLabelMode ? '0' : `${config.gapMm}mm`};
      align-content: flex-start;
    }

    .label-cell {
      width: ${labelWidth}mm;
      height: ${labelHeight}mm;
      overflow: hidden;
      page-break-inside: avoid;
      break-inside: avoid;
      ${shapeCss || ''}
      ${isLabelMode ? 'page-break-after: always;' : ''}
    }

    .label-cell:last-child {
      page-break-after: auto;
    }

    @media print {
      * {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        color-adjust: exact;
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
  // Generate all label HTML
  const labelHtmls: string[] = []

  for (const { item, quantity } of items) {
    const html = await renderLabelHtml(template, item, currencySymbol, tenantName, codeWord)
    for (let i = 0; i < quantity; i++) {
      labelHtmls.push(`<div class="label-cell">${html}</div>`)
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

// ─── Raw label printers (W9: TSPL / ZPL / EPL / ESC/POS raster) ──────────

export interface RawLabelPrintResult {
  ok: boolean
  warnings: string[]
  error?: string
}

/** True when the profile should receive raw printer commands instead of the browser dialog. */
export function isRawLabelPrinter(profile: PrinterProfile | null | undefined): profile is PrinterProfile {
  return !!profile && profile.role === 'label' && profile.label.language !== 'browser' && profile.transport !== 'browser'
}

/**
 * Encode labels in the printer's language and send them through its transport
 * (WebUSB / Web Bluetooth / print agent).
 */
export async function printLabelsRaw(
  profile: PrinterProfile,
  template: LabelTemplateLike,
  items: (LabelPrintItem | LabelItemData)[],
  opts: { currencySymbol?: string; tenantName?: string; codeWord?: string; logoUrl?: string | null; copies?: number } = {}
): Promise<RawLabelPrintResult> {
  const language = profile.label.language
  if (language === 'browser') return { ok: false, warnings: [], error: 'Printer is set to browser printing' }
  const { encodeLabels } = await import('@/lib/print/label')
  const { createCanvasLabelRasterizer, createImageElementRasterizer } = await import('@/lib/print/label/canvas-raster')
  const { sendToPrinter } = await import('@/lib/print/printer-profiles')
  const res = await encodeLabels(template, items, {
    language,
    dpi: profile.label.dpi,
    copies: opts.copies ?? 1,
    codeWord: opts.codeWord,
    currencySymbol: opts.currencySymbol,
    tenantName: opts.tenantName,
    gapMm: profile.label.gapMm,
    darkness: profile.label.darkness,
    speed: profile.label.speed,
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
