// Label template types + field resolution, ported from the web app
// (src/lib/labels/types.ts, src/lib/labels/label-renderer.ts). Pure TS.

export type LabelShape = 'rectangle' | 'rounded-rectangle' | 'circle' | 'oval'

export type BarcodeFormat =
  | 'code128'
  | 'ean13'
  | 'ean8'
  | 'upca'
  | 'code39'
  | 'qrcode'
  | 'datamatrix'
  | 'pdf417'
  | 'itf14'
  | 'code93'
  | 'codabar'

export type DynamicField =
  | 'item.name'
  | 'item.sku'
  | 'item.barcode'
  | 'item.sellingPrice'
  | 'item.costPrice'
  | 'item.priceCode'
  | 'item.discountCode'
  | 'item.brand'
  | 'item.oemPartNumber'
  | 'item.pluCode'
  | 'item.category'
  | 'item.unit'
  | 'item.weight'
  | 'item.dimensions'
  | 'tenant.name'
  | 'custom'

export interface BaseElement {
  id: string
  x: number // mm from left
  y: number // mm from top
  width: number // mm
  height: number // mm
  rotation: number // degrees
  zIndex: number
}

export interface BarcodeElement extends BaseElement {
  type: 'barcode'
  format: BarcodeFormat
  dataField: DynamicField
  showText: boolean
  barWidth: number
  customValue?: string
}

export interface TextElement extends BaseElement {
  type: 'text'
  dataField: DynamicField
  customValue?: string
  fontSize: number // pt
  fontWeight: 'normal' | 'bold'
  textAlign: 'left' | 'center' | 'right'
  prefix?: string
  suffix?: string
  maxLines: number
  isCurrency?: boolean
  autoFit?: boolean
}

export interface ImageElement extends BaseElement {
  type: 'image'
  source: 'logo' | 'item-image' | 'custom'
  customUrl?: string
}

export interface ShapeElement extends BaseElement {
  type: 'shape'
  shape: 'line' | 'rectangle' | 'rounded-rectangle' | 'ellipse'
  borderWidth: number
  borderColor: string
  borderStyle: 'solid' | 'dashed' | 'dotted'
  fillColor?: string
  cornerRadius?: number
}

export type LabelElement = BarcodeElement | TextElement | ImageElement | ShapeElement

/** Row returned by GET /api/label-templates (decimals arrive as strings). */
export interface LabelTemplate {
  id: string
  name: string
  description?: string | null
  widthMm: number | string
  heightMm: number | string
  labelShape?: LabelShape
  cornerRadius?: number | null
  elements: LabelElement[]
  isDefault?: boolean
  isActive?: boolean
}

export interface LabelItemData {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  sellingPrice: string
  costPrice: string
  brand: string | null
  oemPartNumber: string | null
  pluCode: string | null
  category: string | null
  unit: string
  weight: string | null
  dimensions: string | null
  imageUrl: string | null
}

/** Encode a number with a 10-letter code word (1st letter = 1 ... 10th = 0). */
export function encodePriceCode(value: number, codeWord: string): string {
  if (!codeWord || codeWord.length !== 10) return String(value)
  const digitMap: Record<string, string> = {}
  for (let i = 1; i <= 9; i++) digitMap[String(i)] = codeWord[i - 1]
  digitMap['0'] = codeWord[9]
  return value
    .toFixed(2)
    .split('')
    .map((ch) => digitMap[ch] ?? ch)
    .join('')
}

/** Same semantics as the web resolveField (sample data when item is null). */
export function resolveField(
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
    if (field === 'item.priceCode') return codeWord?.length === 10 ? encodePriceCode(5.5, codeWord) : '5.50'
    if (field === 'item.discountCode') return codeWord?.length === 10 ? encodePriceCode(9.99, codeWord) : '9.99'
    return samples[field] || ''
  }

  switch (field) {
    case 'item.name':
      return item.name
    case 'item.sku':
      return item.sku || ''
    case 'item.barcode':
      return item.barcode || ''
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
    case 'item.brand':
      return item.brand || ''
    case 'item.oemPartNumber':
      return item.oemPartNumber || ''
    case 'item.pluCode':
      return item.pluCode || ''
    case 'item.category':
      return item.category || ''
    case 'item.unit':
      return item.unit || ''
    case 'item.weight':
      return item.weight || ''
    case 'item.dimensions':
      return item.dimensions || ''
    default:
      return ''
  }
}
