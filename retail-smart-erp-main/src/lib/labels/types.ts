// Label template type definitions

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

export const BARCODE_FORMATS: { value: BarcodeFormat; label: string; is2D: boolean }[] = [
  { value: 'code128', label: 'Code 128', is2D: false },
  { value: 'ean13', label: 'EAN-13', is2D: false },
  { value: 'ean8', label: 'EAN-8', is2D: false },
  { value: 'upca', label: 'UPC-A', is2D: false },
  { value: 'code39', label: 'Code 39', is2D: false },
  { value: 'code93', label: 'Code 93', is2D: false },
  { value: 'codabar', label: 'Codabar', is2D: false },
  { value: 'itf14', label: 'ITF-14', is2D: false },
  { value: 'qrcode', label: 'QR Code', is2D: true },
  { value: 'datamatrix', label: 'DataMatrix', is2D: true },
  { value: 'pdf417', label: 'PDF417', is2D: true },
]

// Map our format names to bwip-js symbology names
export const FORMAT_TO_BWIP: Record<BarcodeFormat, string> = {
  code128: 'code128',
  ean13: 'ean13',
  ean8: 'ean8',
  upca: 'upca',
  code39: 'code39',
  qrcode: 'qrcode',
  datamatrix: 'datamatrix',
  pdf417: 'pdf417',
  itf14: 'itf14',
  code93: 'code93',
  codabar: 'rationalizedCodabar',
}

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

export const DYNAMIC_FIELDS: { value: DynamicField; label: string; group: string }[] = [
  { value: 'item.name', label: 'Item Name', group: 'Item' },
  { value: 'item.sku', label: 'SKU', group: 'Item' },
  { value: 'item.barcode', label: 'Barcode Value', group: 'Item' },
  { value: 'item.sellingPrice', label: 'Selling Price', group: 'Item' },
  { value: 'item.costPrice', label: 'Cost Price', group: 'Item' },
  { value: 'item.priceCode', label: 'Price Code (Cost)', group: 'Price Code' },
  { value: 'item.discountCode', label: 'Price Code (Selling)', group: 'Price Code' },
  { value: 'item.brand', label: 'Brand', group: 'Item' },
  { value: 'item.oemPartNumber', label: 'OEM Part #', group: 'Item' },
  { value: 'item.pluCode', label: 'PLU Code', group: 'Item' },
  { value: 'item.category', label: 'Category', group: 'Item' },
  { value: 'item.unit', label: 'Unit', group: 'Item' },
  { value: 'item.weight', label: 'Weight', group: 'Item' },
  { value: 'item.dimensions', label: 'Dimensions', group: 'Item' },
  { value: 'tenant.name', label: 'Company Name', group: 'Company' },
  { value: 'custom', label: 'Custom Text', group: 'Other' },
]

export interface BaseElement {
  id: string
  x: number       // mm from left
  y: number       // mm from top
  width: number   // mm
  height: number  // mm
  rotation: number // degrees
  zIndex: number
}

export interface BarcodeElement extends BaseElement {
  type: 'barcode'
  format: BarcodeFormat
  dataField: DynamicField   // which item field to encode
  showText: boolean         // show human-readable text below barcode
  barWidth: number          // bar module width multiplier (1-4)
  customValue?: string      // when dataField is 'custom'
}

export interface TextElement extends BaseElement {
  type: 'text'
  dataField: DynamicField
  customValue?: string      // when dataField is 'custom'
  fontSize: number          // in pt
  fontWeight: 'normal' | 'bold'
  textAlign: 'left' | 'center' | 'right'
  prefix?: string
  suffix?: string
  maxLines: number
  isCurrency?: boolean      // format as currency
  autoFit?: boolean         // auto-shrink font to fit element bounds
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
  cornerRadius?: number  // mm, for rounded-rectangle
}

export type LabelElement = BarcodeElement | TextElement | ImageElement | ShapeElement

export interface PresetLabelSize {
  name: string
  widthMm: number
  heightMm: number
  group: string
  shape?: LabelShape
  cornerRadius?: number
}

export const PRESET_LABEL_SIZES: PresetLabelSize[] = [
  // Standard Rectangle
  { name: '38 x 25 mm', widthMm: 38, heightMm: 25, group: 'Standard' },
  { name: '50 x 25 mm', widthMm: 50, heightMm: 25, group: 'Standard' },
  { name: '50 x 30 mm', widthMm: 50, heightMm: 30, group: 'Standard' },
  { name: '50 x 50 mm', widthMm: 50, heightMm: 50, group: 'Standard' },
  { name: '100 x 50 mm', widthMm: 100, heightMm: 50, group: 'Standard' },
  { name: '100 x 70 mm', widthMm: 100, heightMm: 70, group: 'Standard' },

  // Retail / Clothing
  { name: '25 x 50 mm (Hang Tag)', widthMm: 25, heightMm: 50, group: 'Retail' },
  { name: '40 x 60 mm (Hang Tag)', widthMm: 40, heightMm: 60, group: 'Retail' },
  { name: '30 x 20 mm (Jewelry)', widthMm: 30, heightMm: 20, group: 'Retail' },

  // Supermarket / Grocery
  { name: '58 x 40 mm (Shelf)', widthMm: 58, heightMm: 40, group: 'Supermarket' },
  { name: '58 x 30 mm (Shelf)', widthMm: 58, heightMm: 30, group: 'Supermarket' },
  { name: '60 x 40 mm (Scale)', widthMm: 60, heightMm: 40, group: 'Supermarket' },

  // Restaurant / Food
  { name: '50 x 25 mm (Food)', widthMm: 50, heightMm: 25, group: 'Restaurant' },
  { name: '76 x 51 mm (Kitchen)', widthMm: 76, heightMm: 51, group: 'Restaurant' },

  // Auto Service / Dealership
  { name: '80 x 40 mm (VIN Label)', widthMm: 80, heightMm: 40, group: 'Auto Service' },
  { name: '100 x 30 mm (Parts)', widthMm: 100, heightMm: 30, group: 'Auto Service' },
  { name: '50 x 25 mm (Key Tag)', widthMm: 50, heightMm: 25, group: 'Auto Service' },

  // Round / Special Shapes
  { name: '25 mm Circle', widthMm: 25, heightMm: 25, group: 'Special', shape: 'circle' },
  { name: '38 mm Circle', widthMm: 38, heightMm: 38, group: 'Special', shape: 'circle' },
  { name: '50 mm Circle', widthMm: 50, heightMm: 50, group: 'Special', shape: 'circle' },
  { name: '50 x 30 mm Oval', widthMm: 50, heightMm: 30, group: 'Special', shape: 'oval' },
  { name: '60 x 40 mm Oval', widthMm: 60, heightMm: 40, group: 'Special', shape: 'oval' },
  { name: '50 x 30 mm Rounded', widthMm: 50, heightMm: 30, group: 'Special', shape: 'rounded-rectangle', cornerRadius: 5 },
]

export interface LabelTemplate {
  id: string
  tenantId: string
  name: string
  description: string | null
  widthMm: number
  heightMm: number
  labelShape: LabelShape
  cornerRadius?: number | null
  elements: LabelElement[]
  isDefault: boolean
  isActive: boolean
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

// Item data shape for label rendering
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

export interface PrintLabelConfig {
  labelsPerRow: number
  gapMm: number
  pageSize: 'Label' | 'A4' | 'Letter'
}
