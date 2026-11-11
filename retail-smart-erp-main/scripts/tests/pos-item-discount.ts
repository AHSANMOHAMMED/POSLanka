/**
 * POS Per-Item Discount tests (feature flags, math, supervisor controls, schemas, and all bill/invoice prints).
 * No database required. Run: npx tsx --tsconfig tsconfig.json scripts/tests/pos-item-discount.ts
 */
import { PDFDocument } from 'pdf-lib'
import { toBuffer } from 'bwip-js/node'
import {
  DEFAULT_VENDOR_FEATURE_FLAGS,
  FEATURE_DEFS,
  FEATURE_FLAGS,
  isFeatureEnabled,
  mergedTypePresets,
} from '../../src/lib/features/flags'
import {
  applyQuoteToCart,
  calcLineDiscount,
  lineGross,
  lineNet,
  syncCartLineDiscount,
  withLineDiscount,
} from '../../src/components/pos/price-quote'
import type { CartItem } from '../../src/components/pos/types'
import { evaluateSaleControls } from '../../src/lib/pos/sale-controls'
import { matchPosShortcut, POS_CONTEXT_SHORTCUTS } from '../../src/lib/pos/shortcuts'
import { createSaleSchema } from '../../src/lib/validation/schemas/sales'
import { createHeldSaleSchema } from '../../src/lib/validation/schemas/held-sales'
import { createPosProfileSchema } from '../../src/lib/validation/schemas/pos'
import { buildReceiptModel, lineDiscountLabel, SAMPLE_RECEIPT_SALE } from '../../src/lib/print/receipt-model'
import { DEFAULT_RECEIPT_SETTINGS, type ReceiptItemLayout } from '../../src/lib/print/receipt-settings'
import { buildReceiptEscPosFromModel } from '../../src/lib/print/escpos/receipt-from-model'
import { decodeEscPosPreview } from '../../src/lib/print/escpos/preview'
import { renderReceiptHtml } from '../../src/lib/print/receipt-html'
import { buildReceiptPdf } from '../../src/lib/print/receipt-pdf'
import { mergeTemplateConfig, renderInvoiceHtml } from '../../src/lib/print/invoice-template'
import { layoutTextDocument } from '../../src/lib/print/text-document'
import { FIXED_COMPANY, FIXED_DOC } from './fixtures-print-docs'

let pass = 0
let fail = 0
function check(cond: boolean, msg: string, detail?: unknown) {
  if (cond) pass++
  else {
    fail++
    console.error(`  FAIL: ${msg}${detail !== undefined ? `\n    detail: ${JSON.stringify(detail)}` : ''}`)
  }
}

function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
  const unitPrice = overrides.unitPrice ?? 5000
  const quantity = overrides.quantity ?? 1
  return {
    cartLineId: 'line-1',
    itemId: '00000000-0000-4000-8000-000000000001',
    name: 'Premium Polo Shirt',
    quantity,
    unitPrice,
    total: unitPrice * quantity,
    ...overrides,
  }
}

async function main() {
  // ─── 1. Feature flag defaults & per-business-type presets ───────────────
  console.log('1. Feature flag & business-type defaults')
  check(FEATURE_FLAGS.includes('item_discounts'), 'item_discounts registered in FEATURE_FLAGS')
  const def = FEATURE_DEFS.find((d) => d.key === 'item_discounts')
  check(!!def && def.default === false && def.group === 'Sales & POS', 'FEATURE_DEFS default is false under Sales & POS')
  check(DEFAULT_VENDOR_FEATURE_FLAGS.item_discounts === false, 'DEFAULT_VENDOR_FEATURE_FLAGS.item_discounts is false')
  check(!isFeatureEnabled(undefined, 'item_discounts'), 'disabled when flags undefined')
  check(!isFeatureEnabled({ item_discounts: false }, 'item_discounts'), 'disabled when explicitly false')
  check(isFeatureEnabled({ item_discounts: true }, 'item_discounts'), 'enabled when explicitly true')
  const defaultPresets = mergedTypePresets()
  check(defaultPresets.retail?.item_discounts !== true, 'retail preset keeps item_discounts off by default')
  const overridden = mergedTypePresets({ retail: { item_discounts: true } })
  check(overridden.retail?.item_discounts === true && overridden.restaurant?.item_discounts !== true, 'business-type preset enables per type only')

  // ─── 2. Line discount math & live sync ──────────────────────────────────
  console.log('2. Line discount calculation & cart mutations')
  check(lineGross({ quantity: 1, unitPrice: 5000 }) === 5000, 'lineGross 1 x 5000 = 5000')
  check(calcLineDiscount(5000, 'percentage', 10) === 500, '10% of 5000 = 500')
  check(calcLineDiscount(5000, 'fixed', 750) === 750, 'fixed 750 of 5000 = 750')
  check(calcLineDiscount(500, 'fixed', 750) === 500, 'fixed discount capped at gross 500')
  check(calcLineDiscount(5000, 'percentage', 150) === 5000, 'percentage > 100 capped at 100%')

  const baseLine = makeCartItem({ unitPrice: 5000, quantity: 1 })
  const pct10 = withLineDiscount(baseLine, { type: 'percentage', value: 10 })
  check(
    pct10.discount === 500 && pct10.discountType === 'percentage' && pct10.discountValue === 10 && lineNet(pct10) === 4500 && pct10.total === 4500,
    '5000 with 10% discount -> discount=500, net=4500',
    pct10
  )

  const qty2Pct = syncCartLineDiscount({ ...pct10, quantity: 2 })
  check(
    qty2Pct.discount === 1000 && lineNet(qty2Pct) === 9000 && qty2Pct.total === 9000,
    'qty 1 -> 2 with 10% scales discount to 1000, net 9000',
    qty2Pct
  )

  const fixed500 = withLineDiscount(baseLine, { type: 'fixed', value: 500 })
  const qty2Fixed = syncCartLineDiscount({ ...fixed500, quantity: 2 })
  check(
    qty2Fixed.discount === 500 && lineNet(qty2Fixed) === 9500 && qty2Fixed.total === 9500,
    'qty 1 -> 2 with fixed 500 keeps discount=500, net=9500',
    qty2Fixed
  )

  const cleared = withLineDiscount(pct10, null)
  check(
    (cleared.discount ?? 0) === 0 && !cleared.discountType && cleared.discountValue == null && cleared.total === 5000,
    'null discount clears metadata and restores 5000'
  )

  const quoted = applyQuoteToCart([pct10], {
    lines: [{ key: pct10.cartLineId, unitPrice: 4000, basePrice: 5000, priceListName: 'VIP', promotionDiscount: 0, promotions: [] }],
    cartPromotions: [],
    totals: { cartDiscount: 0 },
  })
  check(
    quoted[0].unitPrice === 4000 && quoted[0].discount === 400 && quoted[0].total === 3600,
    'price list change preserves 10% item discount (4000 - 400 = 3600)',
    quoted[0]
  )

  // ─── 3. Shortcuts & POS controls ────────────────────────────────────────
  console.log('3. Shortcuts, POS controls & validation schemas')
  check(
    POS_CONTEXT_SHORTCUTS.some((s) => s.keys === 'D' && s.label.toLowerCase().includes('discount')),
    'POS_CONTEXT_SHORTCUTS documents D for item discount'
  )
  // 'D' must remain unmapped at global page level so cart selection handler owns it without interfering with search typing
  check(matchPosShortcut({ key: 'd' }, { inTextInput: false }) === null, 'plain D is not intercepted globally outside inputs')

  const profileAllowed = { allowDiscountChange: true, allowRateChange: true, maxDiscountPercent: '15', receiptSettings: { cashierPermissions: { allowItemDiscount: true } } }
  const profileBlocked = { allowDiscountChange: true, allowRateChange: true, maxDiscountPercent: '100', receiptSettings: { cashierPermissions: { allowItemDiscount: false } } }
  const oneDiscountedLine = [{ name: 'Polo', unitPrice: 5000, catalogPrice: 5000, quantity: 1, discount: 500, isWeighable: false }]
  const oneTooHighLine = [{ name: 'Polo', unitPrice: 5000, catalogPrice: 5000, quantity: 1, discount: 1000, isWeighable: false }]
  check(!evaluateSaleControls(profileAllowed, { lines: oneDiscountedLine, cartDiscount: 0 }).needsDiscountApproval, '10% <= 15% allowed without supervisor PIN')
  check(evaluateSaleControls(profileAllowed, { lines: oneTooHighLine, cartDiscount: 0 }).needsDiscountApproval, '20% > 15% requires supervisor PIN')
  check(evaluateSaleControls(profileBlocked, { lines: oneDiscountedLine, cartDiscount: 0 }).needsDiscountApproval, 'allowItemDiscount=false requires supervisor PIN even when maxDiscountPercent=100')

  const validSale = createSaleSchema.safeParse({
    cartItems: [{
      itemId: '00000000-0000-4000-8000-000000000001',
      name: 'Polo',
      quantity: 1,
      unitPrice: 5000,
      discount: 500,
      discountType: 'percentage',
      discountValue: 10,
      tax: 0,
      total: 4500,
    }],
    paymentMethod: 'cash',
    subtotal: 4500,
    discount: 0,
    tax: 0,
    total: 4500,
  })
  check(validSale.success, 'createSaleSchema accepts percentage item discount', validSale.success ? undefined : validSale.error.issues)

  const invalidPctSale = createSaleSchema.safeParse({
    cartItems: [{
      itemId: '00000000-0000-4000-8000-000000000001',
      name: 'Polo',
      quantity: 1,
      unitPrice: 5000,
      discount: 5500,
      discountType: 'percentage',
      discountValue: 110,
      tax: 0,
      total: 0,
    }],
    paymentMethod: 'cash',
    subtotal: 0,
    discount: 0,
    tax: 0,
    total: 0,
  })
  check(!invalidPctSale.success, 'createSaleSchema rejects percentage > 100%')

  const validHeld = createHeldSaleSchema.safeParse({
    cartItems: [{
      itemId: '00000000-0000-4000-8000-000000000001',
      name: 'Polo',
      quantity: 1,
      unitPrice: 5000,
      discount: 500,
      discountType: 'percentage',
      discountValue: 10,
      total: 4500,
    }],
    subtotal: 4500,
    discountAmount: 0,
    taxAmount: 0,
    total: 4500,
  })
  check(validHeld.success, 'createHeldSaleSchema preserves item discount metadata')

  const validProfile = createPosProfileSchema.safeParse({
    name: 'Front Counter',
    warehouseId: '00000000-0000-4000-8000-000000000002',
    costCenterId: '00000000-0000-4000-8000-000000000003',
    userAssignments: [{ userId: '00000000-0000-4000-8000-000000000004', isDefault: true }],
    receiptSettings: { cashierPermissions: { allowItemDiscount: false } },
  })
  check(validProfile.success, 'createPosProfileSchema strict cashierPermissions accepts allowItemDiscount', validProfile.success ? undefined : validProfile.error.issues)

  // ─── 4. Thermal ESC/POS, HTML, PDF receipts (discounted vs untouched) ──
  console.log('4. Thermal ESC/POS, HTML & PDF receipts')
  check(lineDiscountLabel({ discountType: 'percentage', discountValue: 10 }) === 'Discount (10%)', 'long discount label')
  check(lineDiscountLabel({ discountType: 'percentage', discountValue: 10 }, true) === 'Disc (10%)', 'short discount label')
  check(lineDiscountLabel({ discountType: 'fixed', discountValue: 500 }) === 'Discount', 'fixed discount label has no %')

  const discountedSale = {
    ...SAMPLE_RECEIPT_SALE,
    subtotal: 5500,
    discountAmount: 0,
    total: 5500,
    items: [
      { itemName: 'Standard Notebook', quantity: 1, unitPrice: 1000, discount: 0, total: 1000 },
      { itemName: 'Premium Polo Shirt', quantity: 1, unitPrice: 5000, discount: 500, discountType: 'percentage', discountValue: 10, total: 4500 },
    ],
  }
  const fixedDiscountSale = {
    ...SAMPLE_RECEIPT_SALE,
    subtotal: 4500,
    discountAmount: 0,
    total: 4500,
    items: [
      { itemName: 'Premium Polo Shirt', quantity: 1, unitPrice: 5000, discount: 500, discountType: 'fixed', discountValue: 500, total: 4500 },
    ],
  }
  const plainSale = {
    ...SAMPLE_RECEIPT_SALE,
    subtotal: 5000,
    discountAmount: 0,
    total: 5000,
    items: [
      { itemName: 'Standard Item', quantity: 1, unitPrice: 5000, discount: 0, total: 5000 },
    ],
  }
  const tenant = { name: 'POSLanka Test Store', address: '12 Main Rd', phone: '0112345678', currency: 'LKR' }

  const layouts: ReceiptItemLayout[] = ['two_line', 'one_line', 'table']
  for (const w of [58, 80] as const) {
    const cols = w === 58 ? 32 : 48
    for (const layout of layouts) {
      const settings = { ...DEFAULT_RECEIPT_SETTINGS, itemLayout: layout }

      // Non-discounted item must never gain Discount/Net sub-lines
      const plainModel = buildReceiptModel({ sale: plainSale as never, tenant, settings, cashier: 'Kasun' })
      const plainLines = decodeEscPosPreview(buildReceiptEscPosFromModel(plainModel, { paperWidth: w }))
        .filter((l) => l.kind === 'text')
        .map((l) => l.text)
      check(!plainLines.some((t) => /Discount|Disc \(|Net 5,000\.00/.test(t)), `ESC/POS ${w}mm ${layout}: zero-discount item stays clean`)

      // Discounted item shows selling price 5,000.00, 10%, -500.00, and net 4,500.00 within col width
      const model = buildReceiptModel({ sale: discountedSale as never, tenant, settings, cashier: 'Kasun' })
      check(model.items[1].grossTotal === 5000 && model.items[1].discount === 500 && model.items[1].total === 4500, `model preserves selling/discount/net (${w}mm ${layout})`)
      const previewLines = decodeEscPosPreview(buildReceiptEscPosFromModel(model, { paperWidth: w }))
        .filter((l) => l.kind === 'text')
        .map((l) => l.text)
      const joined = previewLines.join('\n')
      const normalized = previewLines.join(' ')
      check(previewLines.every((t) => t.length <= cols), `ESC/POS ${w}mm ${layout}: all lines <= ${cols} cols`, previewLines.filter((t) => t.length > cols))
      check(joined.includes('5,000.00'), `ESC/POS ${w}mm ${layout}: shows original selling price 5,000.00`)
      const expectedDiscText = layout === 'two_line' ? joined.includes('Discount (10%)') && joined.includes('-500.00') : normalized.includes('Disc (10%)') && normalized.includes('500.00 = 4,500.00')
      check(expectedDiscText, `ESC/POS ${w}mm ${layout}: shows 10% discount and 500.00 deduction`, joined)
      check(joined.includes('4,500.00'), `ESC/POS ${w}mm ${layout}: shows subtracted net 4,500.00`)

      // HTML receipt
      const html = await renderReceiptHtml(model, w)
      const htmlHasDisc = layout === 'two_line'
        ? html.includes('Discount (10%)') && html.includes('-500.00')
        : html.includes('Disc (10%)') && html.includes('500.00 = 4,500.00')
      check(html.includes('5,000.00') && htmlHasDisc && html.includes('4,500.00'), `HTML ${w}mm ${layout}: renders selling price, discount calculation, and net 4,500.00`)
      const plainHtml = await renderReceiptHtml(plainModel, w)
      check(!plainHtml.includes('Discount ('), `HTML ${w}mm ${layout}: zero-discount receipt has no item discount row`)
    }

    // Fixed amount discount
    const fixedModel = buildReceiptModel({ sale: fixedDiscountSale as never, tenant, settings: DEFAULT_RECEIPT_SETTINGS, cashier: 'Kasun' })
    const fixedText = decodeEscPosPreview(buildReceiptEscPosFromModel(fixedModel, { paperWidth: w })).map((l) => l.text).join('\n')
    check(fixedText.includes('Discount') && !fixedText.includes('Discount (') && fixedText.includes('-500.00') && fixedText.includes('4,500.00'), `ESC/POS ${w}mm fixed discount prints cleanly without %`)
  }

  // Receipt PDF (80mm & 58mm)
  const qr = await toBuffer({ bcid: 'qrcode', text: 'INV-000123', scale: 4 })
  const bc = await toBuffer({ bcid: 'code128', text: 'INV-000123', scale: 3, height: 10, includetext: true })
  for (const w of [58, 80] as const) {
    const m = buildReceiptModel({ sale: discountedSale as never, tenant, settings: DEFAULT_RECEIPT_SETTINGS, cashier: 'Kasun' })
    const pdfBytes = await buildReceiptPdf(m, w, { qrPng: qr, barcodePng: bc })
    const pdf = await PDFDocument.load(pdfBytes)
    check(pdf.getPageCount() === 1, `PDF ${w}mm discounted receipt builds valid 1-page PDF`)
  }

  // ─── 5. A4 Invoice & Dot-Matrix Text Documents ──────────────────────────
  console.log('5. A4 Invoice & Dot-Matrix text documents')
  const invDoc = {
    ...FIXED_DOC,
    lines: [{
      name: 'Premium Polo Shirt',
      sku: 'POLO-01',
      quantity: 1,
      unit: 'Nos',
      unitPrice: 5000,
      discount: 500,
      discountType: 'percentage' as const,
      discountValue: 10,
      amount: 4500,
    }],
    subtotal: 4500,
    tax: 0,
    taxBreakdown: null,
    total: 4500,
  }
  // Without discount column
  const a4NoDiscCol = renderInvoiceHtml(mergeTemplateConfig({}), invDoc, FIXED_COMPANY)
  check(
    a4NoDiscCol.includes('5,000.00') && a4NoDiscCol.includes('Discount (10%): -500.00') && a4NoDiscCol.includes('4,500.00'),
    'A4 invoice without discount column prints Discount (10%): -500.00 under item'
  )
  // With discount column enabled
  const a4WithDiscCol = renderInvoiceHtml(mergeTemplateConfig({ table: { columns: { discount: { show: true } } } }), invDoc, FIXED_COMPANY)
  check(
    a4WithDiscCol.includes('500.00') && a4WithDiscCol.includes('(10%)') && a4WithDiscCol.includes('4,500.00'),
    'A4 invoice with discount column shows 500.00 (10%)'
  )
  // Dot-matrix 80 cols (no discount col) and 136 cols (with discount col)
  for (const cols of [40, 80, 136]) {
    const pages = layoutTextDocument(invDoc, FIXED_COMPANY, { cols, linesPerPage: 66 })
    const all = pages.flat()
    check(all.every((l) => l.text.length <= cols), `Dot-Matrix ${cols} cols fits width`)
    const textAll = all.map((l) => l.text).join('\n')
    check(
      textAll.includes('5,000.00') && textAll.includes('10%') && textAll.includes('4,500.00'),
      `Dot-Matrix ${cols} cols prints rate, 10%, and net`
    )
  }

  console.log(`\npos-item-discount: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
