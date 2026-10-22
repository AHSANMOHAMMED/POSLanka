// H5: additional barcodes and unit-of-measure barcodes for offline scanning (pure, no React Native
// imports, so scripts/tests can run it with tsx). Data comes from the offline bundle's `pricing`
// block (GET /api/pos/offline-bundle → src/lib/pricing/load-context.ts loadPricingBundle) and the
// maths mirrors GET /api/items/barcode-lookup.

export interface OfflinePricingBundle {
  timezone: string
  priceLists: unknown[]
  promotions: unknown[]
  units: Array<{ code: string; name: string; allowFraction: boolean }>
  itemUoms: Array<{ itemId: string; uom: string; factor: number; barcode: string | null; sellingPrice: number | null }>
  itemBarcodes: Array<{ itemId: string; barcode: string; uom: string | null; packQty: number; priceOverride: number | null }>
}

export interface ExtraBarcode {
  source: 'item_barcode' | 'uom_barcode'
  itemId: string
  /** null = base unit */
  uom: string | null
  /** base units per 1 uom */
  factor: number
  /** quantity (in uom) one scan adds */
  packQty: number
  priceOverride: number | null
  uomPrice: number | null
}

/** barcode → match, built once per bundle. */
export function buildExtraBarcodeIndex(pricing: OfflinePricingBundle | null | undefined): Map<string, ExtraBarcode> {
  const index = new Map<string, ExtraBarcode>()
  if (!pricing) return index
  const uoms = new Map<string, { factor: number; sellingPrice: number | null }>()
  for (const u of pricing.itemUoms || []) {
    uoms.set(`${u.itemId}|${u.uom.toLowerCase()}`, { factor: Number(u.factor) || 1, sellingPrice: u.sellingPrice ?? null })
    if (u.barcode) {
      index.set(u.barcode, {
        source: 'uom_barcode', itemId: u.itemId, uom: u.uom.toLowerCase(), factor: Number(u.factor) || 1,
        packQty: 1, priceOverride: null, uomPrice: u.sellingPrice ?? null,
      })
    }
  }
  for (const b of pricing.itemBarcodes || []) {
    const uom = b.uom ? b.uom.toLowerCase() : null
    const conv = uom ? uoms.get(`${b.itemId}|${uom}`) : undefined
    index.set(b.barcode, {
      source: 'item_barcode', itemId: b.itemId, uom, factor: conv?.factor ?? 1,
      packQty: Number(b.packQty) || 1, priceOverride: b.priceOverride ?? null, uomPrice: conv?.sellingPrice ?? null,
    })
  }
  return index
}

export interface ExtraBarcodeScan {
  uom: string | null
  uomFactor: number
  packQty: number
  /** price of 1 uom */
  uomPrice: number
  /** the same sale in base units, for carts that do not know units (stock is kept in base units) */
  quantity?: number
  unitPrice?: number
  lineTotal?: number
}

/** Same numbers as the server's barcode-lookup response (uom fields + scan.quantity / unitPrice / lineTotal). */
export function extraBarcodeScan(match: ExtraBarcode, basePrice: number): ExtraBarcodeScan {
  const uomPrice = match.priceOverride ?? match.uomPrice ?? Math.round(basePrice * match.factor * 100) / 100
  const out: ExtraBarcodeScan = { uom: match.uom, uomFactor: match.factor, packQty: match.packQty, uomPrice }
  if (match.packQty !== 1 || match.factor !== 1 || match.priceOverride !== null) {
    const baseQty = Math.round(match.packQty * match.factor * 1000) / 1000
    out.quantity = baseQty
    out.lineTotal = Math.round(match.packQty * uomPrice * 100) / 100
    out.unitPrice = Math.round(((match.packQty * uomPrice) / baseQty) * 10000) / 10000
  }
  return out
}
