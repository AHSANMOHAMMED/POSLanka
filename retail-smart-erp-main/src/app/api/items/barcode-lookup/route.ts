import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { items, warehouseStock, tenants } from '@/lib/db/schema'
import { eq, and, inArray, or } from 'drizzle-orm'
import { findExtraBarcodes, type ExtraBarcodeMatch } from '@/lib/pricing/catalog'
import { validateSearchParams } from '@/lib/validation/helpers'
import { barcodeLookupSchema } from '@/lib/validation/schemas/items'
import { analyseScan, normalizeScaleConfig, type ScaleBarcodeConfig } from '@/lib/inventory/barcode-parse'
import { logError } from '@/lib/ai/error-logger'

// GET /api/items/barcode-lookup?barcode=xxx&warehouseId=yyy
// Fast exact-match lookup for POS scanning. Understands EAN-13/8, UPC-A/E, ITF-14,
// Code128/39 SKUs, GS1-128 / GS1 DataMatrix (GTIN, batch, expiry, weight) and
// weighing-scale price/weight-embedded labels (tenant setting `scaleBarcode`).
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, barcodeLookupSchema)
    if (!parsed.success) return parsed.response
    const { barcode, warehouseId } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, session.user.tenantId),
        columns: { settings: true },
      })
      const scaleConfig = normalizeScaleConfig(((tenant?.settings || {}) as { scaleBarcode?: Partial<ScaleBarcodeConfig> }).scaleBarcode)
      const scan = analyseScan(barcode, scaleConfig)

      const barcodeValues = scan.candidates.filter((c) => c.field === 'barcode').map((c) => c.lookup)
      const pluValues = scan.candidates.filter((c) => c.field === 'plu').map((c) => c.lookup)
      const skuValues = scan.candidates.filter((c) => c.field === 'sku').map((c) => c.lookup)

      // H5: additional barcodes (item_barcodes) and unit barcodes (item_uoms)
      const extras = await findExtraBarcodes(db, session.user.tenantId, barcodeValues)

      const conditions = []
      if (barcodeValues.length) conditions.push(inArray(items.barcode, barcodeValues))
      if (extras.length) conditions.push(inArray(items.id, extras.map((e) => e.itemId)))
      if (pluValues.length) conditions.push(inArray(items.pluCode, pluValues))
      if (skuValues.length) conditions.push(inArray(items.sku, skuValues))
      if (conditions.length === 0) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }

      const matches = await db.query.items.findMany({
        where: and(eq(items.isActive, true), or(...conditions)),
        with: { category: { columns: { name: true } } },
        limit: 10,
      })
      if (matches.length === 0) {
        return NextResponse.json({ error: 'Item not found', scan: { symbology: scan.symbology, normalized: scan.normalized } }, { status: 404 })
      }

      // Pick the match for the highest-priority candidate
      let result = matches[0]
      let matchedBy: string = 'barcode'
      let extra: ExtraBarcodeMatch | null = null
      outer: for (const cand of scan.candidates) {
        for (const m of matches) {
          const val = cand.field === 'barcode' ? m.barcode : cand.field === 'plu' ? m.pluCode : m.sku
          if (val && val === cand.lookup) { result = m; matchedBy = cand.field; break outer }
          const x = cand.field === 'barcode' ? extras.find((e) => e.itemId === m.id && e.barcode === cand.lookup) : undefined
          if (x) { result = m; matchedBy = x.source; extra = x; break outer }
        }
      }

      // Get warehouse stock
      let currentStockVal = '0'
      let reservedStockVal = '0'
      let availableStockVal = '0'

      if (warehouseId) {
        const stock = await db.query.warehouseStock.findFirst({
          where: and(
            eq(warehouseStock.itemId, result.id),
            eq(warehouseStock.warehouseId, warehouseId)
          ),
        })
        if (stock) {
          currentStockVal = stock.currentStock || '0'
          reservedStockVal = stock.reservedStock || '0'
          availableStockVal = String(Math.round((parseFloat(currentStockVal) - parseFloat(reservedStockVal)) * 100) / 100)
        }
      }

      // Scan-derived quantity / price (weighing scale, GS1 net weight / count / price)
      const scanInfo: Record<string, unknown> = {
        symbology: scan.symbology,
        normalized: scan.normalized,
        matchedBy,
        gtinValid: scan.gtinValid,
      }
      // Scale weight/price only applies when the item was found via the label's PLU,
      // not when the full code matched an item's own barcode.
      if (scan.scale && matchedBy === 'plu') {
        if (scan.scale.valueType === 'weight') {
          scanInfo.quantity = scan.scale.value
        } else {
          // price-embedded label: derive the weight from the item's per-kg price when possible
          const unitPrice = parseFloat(result.sellingPrice)
          scanInfo.lineTotal = scan.scale.value
          scanInfo.quantity = unitPrice > 0 ? Math.round((scan.scale.value / unitPrice) * 1000) / 1000 : 1
          scanInfo.unitPrice = unitPrice > 0 ? unitPrice : scan.scale.value
        }
        scanInfo.plu = scan.scale.plu
      }
      if (scan.gs1) {
        if (scan.gs1.gtin) scanInfo.gtin = scan.gs1.gtin
        if (scan.gs1.batchNo) scanInfo.batchNo = scan.gs1.batchNo
        if (scan.gs1.serial) scanInfo.serial = scan.gs1.serial
        if (scan.gs1.expiryDate) scanInfo.expiryDate = scan.gs1.expiryDate
        if (scan.gs1.productionDate) scanInfo.productionDate = scan.gs1.productionDate
        if (scan.gs1.netWeightKg) scanInfo.quantity = scan.gs1.netWeightKg
        else if (scan.gs1.count) scanInfo.quantity = scan.gs1.count
        if (scan.gs1.price) {
          // AI 392n is the amount payable for the pack (line total), not a per-unit price:
          // a 1.25 kg pack labelled 875.00 is 700.00/kg, not 875.00 × 1.25
          const qty = typeof scanInfo.quantity === 'number' && scanInfo.quantity > 0 ? scanInfo.quantity : 1
          scanInfo.lineTotal = scan.gs1.price
          // 4 decimals so quantity × unitPrice reproduces the amount to the cent
          scanInfo.unitPrice = Math.round((scan.gs1.price / qty) * 10000) / 10000
        }
      }

      // H5: unit of measure of the scanned code. uom-aware clients use uom / uomFactor / packQty /
      // uomPrice; older clients get the same sale expressed in base units through scan.quantity /
      // scan.unitPrice / scan.lineTotal (stock is always kept in base units).
      const basePrice = parseFloat(result.sellingPrice)
      const uomFactor = extra?.factor ?? 1
      const packQty = extra?.packQty ?? 1
      const uomPrice = extra
        ? (extra.priceOverride ?? extra.uomPrice ?? Math.round(basePrice * uomFactor * 100) / 100)
        : basePrice
      if (extra && scanInfo.quantity === undefined && (packQty !== 1 || uomFactor !== 1 || extra.priceOverride !== null)) {
        const baseQty = Math.round(packQty * uomFactor * 1000) / 1000
        scanInfo.quantity = baseQty
        scanInfo.lineTotal = Math.round(packQty * uomPrice * 100) / 100
        scanInfo.unitPrice = Math.round(((packQty * uomPrice) / baseQty) * 10000) / 10000
      }

      return NextResponse.json({
        id: result.id,
        productType: result.productType,
        uom: extra?.uom ?? null,
        uomFactor,
        packQty,
        uomPrice,
        /** item_barcodes.price_override: the code fixes the price (client sends priceLocked) */
        priceOverride: extra?.priceOverride ?? null,
        /** the additional / unit barcode that matched (sent back on the sale line as `barcode`) */
        matchedBarcode: extra?.barcode ?? null,
        barcodeLabel: extra?.label ?? null,
        name: result.name,
        sku: result.sku,
        barcode: result.barcode,
        sellingPrice: result.sellingPrice,
        currentStock: currentStockVal,
        reservedStock: reservedStockVal,
        availableStock: availableStockVal,
        trackStock: result.trackStock,
        trackSerialNumbers: result.trackSerialNumbers,
        trackBatches: result.trackBatches,
        unit: result.unit,
        oemPartNumber: result.oemPartNumber,
        supplierPartNumber: result.supplierPartNumber,
        alternatePartNumbers: result.alternatePartNumbers,
        categoryId: result.categoryId,
        categoryName: result.category?.name || null,
        isWeighable: result.isWeighable,
        pluCode: result.pluCode,
        coreCharge: result.coreCharge,
        taxTemplateId: result.taxTemplateId,
        imageUrl: result.imageUrl,
        scan: scanInfo,
      })
    })
  } catch (error) {
    logError('api/items/barcode-lookup', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
