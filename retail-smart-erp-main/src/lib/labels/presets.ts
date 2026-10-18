import type { LabelElement, LabelShape } from './types'

export interface LabelPreset {
  id: string
  name: string
  description: string
  businessTypes: string[]  // which business types this is relevant for ('all' for universal)
  widthMm: number
  heightMm: number
  labelShape: LabelShape
  cornerRadius?: number
  elements: LabelElement[]
}

let nextId = 1
function elId() {
  return `preset-${nextId++}`
}

export const LABEL_PRESETS: LabelPreset[] = [
  // ─── Retail ──────────────────────────────────────────────
  {
    id: 'retail-price-tag',
    name: 'Standard Price Tag',
    description: 'Barcode + name + price (50 x 30 mm)',
    businessTypes: ['retail', 'all'],
    widthMm: 50,
    heightMm: 30,
    labelShape: 'rectangle',
    elements: [
      { id: elId(), type: 'text', x: 1, y: 1, width: 48, height: 5, rotation: 0, zIndex: 10, dataField: 'item.name', fontSize: 8, fontWeight: 'bold', textAlign: 'center', maxLines: 1 },
      { id: elId(), type: 'barcode', x: 5, y: 7, width: 40, height: 12, rotation: 0, zIndex: 10, format: 'code128', dataField: 'item.barcode', showText: true, barWidth: 2 },
      { id: elId(), type: 'text', x: 1, y: 21, width: 48, height: 7, rotation: 0, zIndex: 10, dataField: 'item.sellingPrice', fontSize: 14, fontWeight: 'bold', textAlign: 'center', maxLines: 1, isCurrency: true },
    ],
  },
  {
    id: 'retail-jewelry',
    name: 'Jewelry Tag',
    description: 'Compact name + price (30 x 20 mm)',
    businessTypes: ['retail'],
    widthMm: 30,
    heightMm: 20,
    labelShape: 'rectangle',
    elements: [
      { id: elId(), type: 'text', x: 1, y: 1, width: 28, height: 5, rotation: 0, zIndex: 10, dataField: 'item.name', fontSize: 6, fontWeight: 'bold', textAlign: 'center', maxLines: 2 },
      { id: elId(), type: 'text', x: 1, y: 7, width: 28, height: 4, rotation: 0, zIndex: 10, dataField: 'item.sku', fontSize: 5, fontWeight: 'normal', textAlign: 'center', maxLines: 1 },
      { id: elId(), type: 'text', x: 1, y: 13, width: 28, height: 6, rotation: 0, zIndex: 10, dataField: 'item.sellingPrice', fontSize: 10, fontWeight: 'bold', textAlign: 'center', maxLines: 1, isCurrency: true },
    ],
  },
  {
    id: 'retail-clothing-tag',
    name: 'Clothing Hang Tag',
    description: 'Name + barcode + price + brand (40 x 60 mm)',
    businessTypes: ['retail'],
    widthMm: 40,
    heightMm: 60,
    labelShape: 'rectangle',
    elements: [
      { id: elId(), type: 'text', x: 2, y: 2, width: 36, height: 5, rotation: 0, zIndex: 10, dataField: 'item.brand', fontSize: 7, fontWeight: 'normal', textAlign: 'center', maxLines: 1 },
      { id: elId(), type: 'text', x: 2, y: 8, width: 36, height: 8, rotation: 0, zIndex: 10, dataField: 'item.name', fontSize: 8, fontWeight: 'bold', textAlign: 'center', maxLines: 2 },
      { id: elId(), type: 'shape', x: 2, y: 17, width: 36, height: 0.5, rotation: 0, zIndex: 5, shape: 'line', borderWidth: 1, borderColor: '#cccccc', borderStyle: 'solid' },
      { id: elId(), type: 'barcode', x: 5, y: 19, width: 30, height: 18, rotation: 0, zIndex: 10, format: 'code128', dataField: 'item.barcode', showText: true, barWidth: 2 },
      { id: elId(), type: 'text', x: 2, y: 40, width: 36, height: 8, rotation: 0, zIndex: 10, dataField: 'item.sellingPrice', fontSize: 16, fontWeight: 'bold', textAlign: 'center', maxLines: 1, isCurrency: true },
      { id: elId(), type: 'text', x: 2, y: 50, width: 36, height: 5, rotation: 0, zIndex: 10, dataField: 'item.sku', fontSize: 6, fontWeight: 'normal', textAlign: 'center', maxLines: 1 },
    ],
  },

  // ─── Restaurant ──────────────────────────────────────────
  {
    id: 'restaurant-food',
    name: 'Food Label',
    description: 'Name + date + custom notes (50 x 25 mm)',
    businessTypes: ['restaurant'],
    widthMm: 50,
    heightMm: 25,
    labelShape: 'rectangle',
    elements: [
      { id: elId(), type: 'text', x: 1, y: 1, width: 48, height: 5, rotation: 0, zIndex: 10, dataField: 'item.name', fontSize: 8, fontWeight: 'bold', textAlign: 'left', maxLines: 1 },
      { id: elId(), type: 'text', x: 1, y: 7, width: 48, height: 4, rotation: 0, zIndex: 10, dataField: 'custom', customValue: 'Prep Date: ___/___/___', fontSize: 6, fontWeight: 'normal', textAlign: 'left', maxLines: 1 },
      { id: elId(), type: 'text', x: 1, y: 12, width: 48, height: 4, rotation: 0, zIndex: 10, dataField: 'custom', customValue: 'Use By: ___/___/___', fontSize: 6, fontWeight: 'normal', textAlign: 'left', maxLines: 1 },
      { id: elId(), type: 'text', x: 1, y: 17, width: 48, height: 7, rotation: 0, zIndex: 10, dataField: 'custom', customValue: 'Allergens: ____________', fontSize: 6, fontWeight: 'normal', textAlign: 'left', maxLines: 2 },
    ],
  },
  {
    id: 'restaurant-kitchen',
    name: 'Kitchen Prep Label',
    description: 'Name + date + prep notes (76 x 51 mm)',
    businessTypes: ['restaurant'],
    widthMm: 76,
    heightMm: 51,
    labelShape: 'rectangle',
    elements: [
      { id: elId(), type: 'text', x: 2, y: 2, width: 72, height: 7, rotation: 0, zIndex: 10, dataField: 'item.name', fontSize: 12, fontWeight: 'bold', textAlign: 'center', maxLines: 1 },
      { id: elId(), type: 'shape', x: 2, y: 10, width: 72, height: 0.5, rotation: 0, zIndex: 5, shape: 'line', borderWidth: 1, borderColor: '#000000', borderStyle: 'solid' },
      { id: elId(), type: 'text', x: 2, y: 12, width: 35, height: 5, rotation: 0, zIndex: 10, dataField: 'custom', customValue: 'Prep Date:', fontSize: 8, fontWeight: 'normal', textAlign: 'left', maxLines: 1 },
      { id: elId(), type: 'text', x: 2, y: 18, width: 35, height: 5, rotation: 0, zIndex: 10, dataField: 'custom', customValue: 'Use By:', fontSize: 8, fontWeight: 'normal', textAlign: 'left', maxLines: 1 },
      { id: elId(), type: 'text', x: 40, y: 12, width: 34, height: 5, rotation: 0, zIndex: 10, dataField: 'custom', customValue: 'Prepared By:', fontSize: 8, fontWeight: 'normal', textAlign: 'left', maxLines: 1 },
      { id: elId(), type: 'text', x: 2, y: 26, width: 72, height: 22, rotation: 0, zIndex: 10, dataField: 'custom', customValue: 'Notes:', fontSize: 8, fontWeight: 'normal', textAlign: 'left', maxLines: 5 },
    ],
  },

  // ─── Supermarket ─────────────────────────────────────────
  {
    id: 'supermarket-shelf',
    name: 'Shelf Label',
    description: 'Name + barcode + price + unit (58 x 40 mm)',
    businessTypes: ['supermarket'],
    widthMm: 58,
    heightMm: 40,
    labelShape: 'rectangle',
    elements: [
      { id: elId(), type: 'text', x: 1, y: 1, width: 56, height: 5, rotation: 0, zIndex: 10, dataField: 'item.name', fontSize: 8, fontWeight: 'bold', textAlign: 'left', maxLines: 1 },
      { id: elId(), type: 'barcode', x: 4, y: 7, width: 50, height: 12, rotation: 0, zIndex: 10, format: 'ean13', dataField: 'item.barcode', showText: true, barWidth: 2 },
      { id: elId(), type: 'text', x: 1, y: 21, width: 56, height: 10, rotation: 0, zIndex: 10, dataField: 'item.sellingPrice', fontSize: 18, fontWeight: 'bold', textAlign: 'center', maxLines: 1, isCurrency: true },
      { id: elId(), type: 'text', x: 1, y: 33, width: 56, height: 5, rotation: 0, zIndex: 10, dataField: 'item.unit', fontSize: 6, fontWeight: 'normal', textAlign: 'right', maxLines: 1, prefix: 'per ' },
    ],
  },
  {
    id: 'supermarket-plu',
    name: 'PLU Label',
    description: 'PLU code + name + price (38 x 25 mm)',
    businessTypes: ['supermarket'],
    widthMm: 38,
    heightMm: 25,
    labelShape: 'rectangle',
    elements: [
      { id: elId(), type: 'text', x: 1, y: 1, width: 36, height: 6, rotation: 0, zIndex: 10, dataField: 'item.pluCode', fontSize: 12, fontWeight: 'bold', textAlign: 'center', maxLines: 1 },
      { id: elId(), type: 'text', x: 1, y: 8, width: 36, height: 5, rotation: 0, zIndex: 10, dataField: 'item.name', fontSize: 6, fontWeight: 'normal', textAlign: 'center', maxLines: 2 },
      { id: elId(), type: 'text', x: 1, y: 16, width: 36, height: 7, rotation: 0, zIndex: 10, dataField: 'item.sellingPrice', fontSize: 12, fontWeight: 'bold', textAlign: 'center', maxLines: 1, isCurrency: true },
    ],
  },
  {
    id: 'supermarket-scale',
    name: 'Scale Label',
    description: 'Name + barcode + price/kg (60 x 40 mm)',
    businessTypes: ['supermarket'],
    widthMm: 60,
    heightMm: 40,
    labelShape: 'rectangle',
    elements: [
      { id: elId(), type: 'text', x: 1, y: 1, width: 58, height: 5, rotation: 0, zIndex: 10, dataField: 'item.name', fontSize: 9, fontWeight: 'bold', textAlign: 'center', maxLines: 1 },
      { id: elId(), type: 'barcode', x: 5, y: 7, width: 50, height: 12, rotation: 0, zIndex: 10, format: 'ean13', dataField: 'item.barcode', showText: true, barWidth: 2 },
      { id: elId(), type: 'text', x: 1, y: 21, width: 58, height: 10, rotation: 0, zIndex: 10, dataField: 'item.sellingPrice', fontSize: 18, fontWeight: 'bold', textAlign: 'center', maxLines: 1, isCurrency: true },
      { id: elId(), type: 'text', x: 1, y: 33, width: 58, height: 5, rotation: 0, zIndex: 10, dataField: 'item.weight', fontSize: 7, fontWeight: 'normal', textAlign: 'right', maxLines: 1 },
    ],
  },

  // ─── Auto Service / Dealership ───────────────────────────
  {
    id: 'auto-parts',
    name: 'Parts Label',
    description: 'Name + OEM# + barcode + price (100 x 30 mm)',
    businessTypes: ['auto_service', 'dealership'],
    widthMm: 100,
    heightMm: 30,
    labelShape: 'rectangle',
    elements: [
      { id: elId(), type: 'text', x: 1, y: 1, width: 60, height: 5, rotation: 0, zIndex: 10, dataField: 'item.name', fontSize: 8, fontWeight: 'bold', textAlign: 'left', maxLines: 1 },
      { id: elId(), type: 'text', x: 62, y: 1, width: 37, height: 5, rotation: 0, zIndex: 10, dataField: 'item.sellingPrice', fontSize: 10, fontWeight: 'bold', textAlign: 'right', maxLines: 1, isCurrency: true },
      { id: elId(), type: 'text', x: 1, y: 7, width: 50, height: 4, rotation: 0, zIndex: 10, dataField: 'item.oemPartNumber', fontSize: 6, fontWeight: 'normal', textAlign: 'left', maxLines: 1, prefix: 'OEM: ' },
      { id: elId(), type: 'barcode', x: 5, y: 13, width: 55, height: 14, rotation: 0, zIndex: 10, format: 'code128', dataField: 'item.barcode', showText: true, barWidth: 2 },
      { id: elId(), type: 'text', x: 65, y: 13, width: 34, height: 4, rotation: 0, zIndex: 10, dataField: 'item.sku', fontSize: 6, fontWeight: 'normal', textAlign: 'right', maxLines: 1, prefix: 'SKU: ' },
    ],
  },
  {
    id: 'auto-key-tag',
    name: 'Key Tag',
    description: 'Customer name + vehicle info (50 x 25 mm)',
    businessTypes: ['auto_service', 'dealership'],
    widthMm: 50,
    heightMm: 25,
    labelShape: 'rounded-rectangle',
    cornerRadius: 3,
    elements: [
      { id: elId(), type: 'text', x: 2, y: 2, width: 46, height: 5, rotation: 0, zIndex: 10, dataField: 'custom', customValue: 'Customer Name', fontSize: 8, fontWeight: 'bold', textAlign: 'center', maxLines: 1 },
      { id: elId(), type: 'shape', x: 2, y: 8, width: 46, height: 0.5, rotation: 0, zIndex: 5, shape: 'line', borderWidth: 1, borderColor: '#cccccc', borderStyle: 'solid' },
      { id: elId(), type: 'text', x: 2, y: 10, width: 46, height: 5, rotation: 0, zIndex: 10, dataField: 'custom', customValue: 'Vehicle: ____________', fontSize: 7, fontWeight: 'normal', textAlign: 'center', maxLines: 1 },
      { id: elId(), type: 'text', x: 2, y: 16, width: 46, height: 5, rotation: 0, zIndex: 10, dataField: 'custom', customValue: 'Plate: ____________', fontSize: 7, fontWeight: 'normal', textAlign: 'center', maxLines: 1 },
    ],
  },
  {
    id: 'dealership-vin',
    name: 'VIN Label',
    description: 'VIN barcode + vehicle details (80 x 40 mm)',
    businessTypes: ['dealership', 'auto_service'],
    widthMm: 80,
    heightMm: 40,
    labelShape: 'rectangle',
    elements: [
      { id: elId(), type: 'text', x: 2, y: 2, width: 76, height: 5, rotation: 0, zIndex: 10, dataField: 'item.name', fontSize: 9, fontWeight: 'bold', textAlign: 'center', maxLines: 1 },
      { id: elId(), type: 'barcode', x: 5, y: 8, width: 70, height: 15, rotation: 0, zIndex: 10, format: 'code39', dataField: 'item.barcode', showText: true, barWidth: 2 },
      { id: elId(), type: 'text', x: 2, y: 25, width: 76, height: 5, rotation: 0, zIndex: 10, dataField: 'item.sku', fontSize: 7, fontWeight: 'normal', textAlign: 'center', maxLines: 1 },
      { id: elId(), type: 'text', x: 2, y: 32, width: 76, height: 5, rotation: 0, zIndex: 10, dataField: 'item.sellingPrice', fontSize: 10, fontWeight: 'bold', textAlign: 'center', maxLines: 1, isCurrency: true },
    ],
  },

  // ─── Special Shapes ──────────────────────────────────────
  {
    id: 'circle-price',
    name: 'Circle Price Sticker',
    description: 'Round price sticker (38 mm circle)',
    businessTypes: ['retail', 'supermarket', 'all'],
    widthMm: 38,
    heightMm: 38,
    labelShape: 'circle',
    elements: [
      { id: elId(), type: 'text', x: 4, y: 6, width: 30, height: 6, rotation: 0, zIndex: 10, dataField: 'item.name', fontSize: 6, fontWeight: 'normal', textAlign: 'center', maxLines: 2 },
      { id: elId(), type: 'text', x: 4, y: 15, width: 30, height: 10, rotation: 0, zIndex: 10, dataField: 'item.sellingPrice', fontSize: 14, fontWeight: 'bold', textAlign: 'center', maxLines: 1, isCurrency: true },
    ],
  },
]

/**
 * Get presets relevant for a given business type
 */
export function getPresetsForBusinessType(businessType?: string): LabelPreset[] {
  if (!businessType) return LABEL_PRESETS
  return LABEL_PRESETS.filter(p =>
    p.businessTypes.includes(businessType) || p.businessTypes.includes('all')
  )
}
