'use client'

import type { LabelElement, LabelItemData, DynamicField, LabelTemplate, LabelShape, TextElement } from './types'
import { renderBarcodeDataUrl, getBarcodeFallbackData, validateBarcodeData } from './barcode-renderer'

/**
 * Encode a numeric value using a 10-character code word.
 * Each digit maps to the corresponding letter: 1st=1, 2nd=2, ..., 9th=9, 10th=0
 * Decimal points are preserved as-is.
 */
export function encodePriceCode(value: number, codeWord: string): string {
  if (!codeWord || codeWord.length !== 10) return String(value)
  // Map: digit 1→codeWord[0], 2→codeWord[1], ..., 9→codeWord[8], 0→codeWord[9]
  const digitMap: Record<string, string> = {}
  for (let i = 1; i <= 9; i++) {
    digitMap[String(i)] = codeWord[i - 1]
  }
  digitMap['0'] = codeWord[9]

  const numStr = value.toFixed(2)
  return numStr
    .split('')
    .map(ch => digitMap[ch] ?? ch) // digits→letters, '.' stays as '.'
    .join('')
}

/**
 * Calculate the auto-fit font size that fits text within given dimensions.
 * Uses canvas measureText to binary-search for the largest size that fits.
 */
export function calculateAutoFitFontSize(
  text: string,
  widthPx: number,
  heightPx: number,
  fontWeight: string,
  maxFontSize: number,
  maxLines: number
): number {
  const MIN_FONT = 4
  if (!text || widthPx <= 0 || heightPx <= 0) return maxFontSize

  // Use offscreen canvas to measure text
  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : null
  if (!canvas) return maxFontSize
  const ctx = canvas.getContext('2d')
  if (!ctx) return maxFontSize

  let fontSize = maxFontSize
  while (fontSize >= MIN_FONT) {
    ctx.font = `${fontWeight} ${fontSize}pt sans-serif`
    // Convert pt to px for line height calculation: 1pt = 96/72 px
    const fontSizePx = fontSize * (96 / 72)
    const lineHeightPx = fontSizePx * 1.2

    // Estimate how many lines the text wraps to
    const textWidth = ctx.measureText(text).width
    const linesNeeded = Math.ceil(textWidth / widthPx)
    const effectiveLines = Math.min(linesNeeded, maxLines)
    const totalHeight = effectiveLines * lineHeightPx

    if (totalHeight <= heightPx && (linesNeeded <= maxLines || effectiveLines * lineHeightPx <= heightPx)) {
      return fontSize
    }
    fontSize -= 0.5
  }
  return MIN_FONT
}

/**
 * Resolve a dynamic field value from item data
 */
function resolveField(
  field: DynamicField,
  item: LabelItemData | null,
  customValue?: string,
  currencySymbol?: string,
  tenantName?: string,
  codeWord?: string
): string {
  if (field === 'custom') return customValue || ''
  if (field === 'tenant.name') return tenantName || 'Company'

  if (!item) {
    // Return sample data in designer mode
    const samples: Record<string, string> = {
      'item.name': 'Sample Item Name',
      'item.sku': 'SKU-001',
      'item.barcode': '1234567890128',
      'item.sellingPrice': '9.99',
      'item.costPrice': '5.50',
      'item.brand': 'Brand',
      'item.oemPartNumber': 'OEM-123',
      'item.pluCode': '4011',
      'item.category': 'Category',
      'item.unit': 'pcs',
      'item.weight': '0.5 kg',
      'item.dimensions': '10x5x3 cm',
    }
    // Price code sample data with encoding
    if (field === 'item.priceCode') {
      return codeWord?.length === 10 ? encodePriceCode(5.50, codeWord) : '5.50'
    }
    if (field === 'item.discountCode') {
      // Sample: encode selling price 9.99
      return codeWord?.length === 10 ? encodePriceCode(9.99, codeWord) : '9.99'
    }
    return samples[field] || ''
  }

  switch (field) {
    case 'item.name': return item.name
    case 'item.sku': return item.sku || ''
    case 'item.barcode': return item.barcode || ''
    case 'item.sellingPrice':
      return (currencySymbol || '') + parseFloat(item.sellingPrice).toFixed(2)
    case 'item.costPrice':
      return (currencySymbol || '') + parseFloat(item.costPrice).toFixed(2)
    case 'item.priceCode': {
      const cost = parseFloat(item.costPrice)
      return codeWord?.length === 10 ? encodePriceCode(cost, codeWord) : cost.toFixed(2)
    }
    case 'item.discountCode': {
      const selling = parseFloat(item.sellingPrice)
      return codeWord?.length === 10 ? encodePriceCode(selling, codeWord) : selling.toFixed(2)
    }
    case 'item.brand': return item.brand || ''
    case 'item.oemPartNumber': return item.oemPartNumber || ''
    case 'item.pluCode': return item.pluCode || ''
    case 'item.category': return item.category || ''
    case 'item.unit': return item.unit || ''
    case 'item.weight': return item.weight || ''
    case 'item.dimensions': return item.dimensions || ''
    default: return ''
  }
}

/**
 * Render a single label element to HTML
 */
async function renderElement(
  el: LabelElement,
  item: LabelItemData | null,
  currencySymbol?: string,
  tenantName?: string,
  codeWord?: string
): Promise<string> {
  const baseStyle = `position:absolute;left:${el.x}mm;top:${el.y}mm;width:${el.width}mm;height:${el.height}mm;overflow:hidden;${el.rotation ? `transform:rotate(${el.rotation}deg);` : ''}`

  switch (el.type) {
    case 'barcode': {
      const rawData = resolveField(el.dataField, item, el.customValue, currencySymbol, tenantName)
      const barcodeData = (rawData && !validateBarcodeData(el.format, rawData))
        ? rawData
        : getBarcodeFallbackData(el.format)
      const dataUrl = await renderBarcodeDataUrl(el.format, barcodeData, {
        showText: el.showText,
      })
      return `<div style="${baseStyle}z-index:${el.zIndex};"><img src="${dataUrl}" style="width:100%;height:100%;object-fit:contain;" alt="barcode"/></div>`
    }
    case 'text': {
      const textEl = el as TextElement
      let text = resolveField(el.dataField, item, el.customValue, el.isCurrency ? currencySymbol : undefined, tenantName, codeWord)
      if (el.prefix) text = el.prefix + text
      if (el.suffix) text = text + el.suffix

      let fontSize = el.fontSize
      if (textEl.autoFit && text) {
        const widthPx = el.width * (96 / 25.4)
        const heightPx = el.height * (96 / 25.4)
        fontSize = calculateAutoFitFontSize(text, widthPx, heightPx, el.fontWeight, el.fontSize, el.maxLines)
      }

      const textStyle = `font-size:${fontSize}pt;font-weight:${el.fontWeight};text-align:${el.textAlign};line-height:1.2;word-break:break-word;display:-webkit-box;-webkit-line-clamp:${el.maxLines};-webkit-box-orient:vertical;overflow:hidden;`
      return `<div style="${baseStyle}z-index:${el.zIndex};${textStyle}">${escapeHtml(text)}</div>`
    }
    case 'image': {
      let src = ''
      if (el.source === 'item-image' && item?.imageUrl) {
        src = item.imageUrl
      } else if (el.source === 'custom' && el.customUrl) {
        src = el.customUrl
      }
      if (src) {
        return `<div style="${baseStyle}z-index:${el.zIndex};"><img src="${src}" style="width:100%;height:100%;object-fit:contain;" alt=""/></div>`
      }
      return `<div style="${baseStyle}z-index:${el.zIndex};display:flex;align-items:center;justify-content:center;background:#f9fafb;border:1px dashed #d1d5db;font-size:8pt;color:#9ca3af;">Image</div>`
    }
    case 'shape': {
      const fill = el.fillColor || 'transparent'
      if (el.shape === 'line') {
        return `<div style="${baseStyle}z-index:${el.zIndex};border-top:${el.borderWidth}px ${el.borderStyle} ${el.borderColor};height:0;margin-top:${el.height / 2}mm;"></div>`
      }
      if (el.shape === 'ellipse') {
        return `<div style="${baseStyle}z-index:${el.zIndex};border:${el.borderWidth}px ${el.borderStyle} ${el.borderColor};background:${fill};box-sizing:border-box;border-radius:50%;"></div>`
      }
      const radius = el.shape === 'rounded-rectangle' && el.cornerRadius ? `border-radius:${el.cornerRadius}mm;` : ''
      return `<div style="${baseStyle}z-index:${el.zIndex};border:${el.borderWidth}px ${el.borderStyle} ${el.borderColor};background:${fill};box-sizing:border-box;${radius}"></div>`
    }
  }
}

/**
 * Get CSS border-radius for a label shape
 */
export function getShapeBorderRadius(shape?: LabelShape | string, cornerRadius?: number | null): string {
  switch (shape) {
    case 'circle':
    case 'oval':
      return 'border-radius:50%;'
    case 'rounded-rectangle':
      return `border-radius:${cornerRadius ?? 5}mm;`
    default:
      return ''
  }
}

/**
 * Render a complete label as HTML for one item
 */
export async function renderLabelHtml(
  template: Pick<LabelTemplate, 'widthMm' | 'heightMm' | 'elements'> & { labelShape?: LabelShape | string; cornerRadius?: number | null },
  item: LabelItemData | null,
  currencySymbol?: string,
  tenantName?: string,
  codeWord?: string
): Promise<string> {
  const elements = await Promise.all(
    template.elements.map(el => renderElement(el, item, currencySymbol, tenantName, codeWord))
  )

  const w = Number(template.widthMm)
  const h = Number(template.heightMm)
  const shapeStyle = getShapeBorderRadius(template.labelShape, template.cornerRadius)
  return `<div style="position:relative;width:${w}mm;height:${h}mm;overflow:hidden;background:white;box-sizing:border-box;${shapeStyle}">${elements.join('')}</div>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
