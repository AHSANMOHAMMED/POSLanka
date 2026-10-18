'use client'

import type { LabelTemplate, LabelItemData, PrintLabelConfig } from './types'
import { renderLabelHtml, getShapeBorderRadius } from './label-renderer'
import { executePrint } from '@/lib/print/print-executor'

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
