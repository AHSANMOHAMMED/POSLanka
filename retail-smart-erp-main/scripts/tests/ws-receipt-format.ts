/** Receipt format tests (run through ws-print-layout.ts). */
import { buildReceiptModel, SAMPLE_RECEIPT_SALE, RECEIPT_FONT_PX, type ReceiptModel } from '../../src/lib/print/receipt-model'
import { DEFAULT_RECEIPT_SETTINGS, resolveReceiptSettings, type ReceiptSettings } from '../../src/lib/print/receipt-settings'
import { buildReceiptEscPosFromModel, alignPackedRaster } from '../../src/lib/print/escpos/receipt-from-model'
import { decodeEscPosPreview } from '../../src/lib/print/escpos/preview'
import { renderReceiptHtmlSync } from '../../src/lib/print/receipt-html'
import { buildInvoiceVerifyUrl, invoiceNoFromScan } from '../../src/lib/print/invoice-verify'
import { buildReceipt, bytesToPlainText, type ReceiptInput } from '../../apps/mobile/src/lib/escpos'
import { receiptHtml } from '../../apps/mobile/src/lib/printHtml'

type Check = (cond: boolean, msg: string, extra?: string) => void

const sale = {
  ...SAMPLE_RECEIPT_SALE,
  items: [
    ...(SAMPLE_RECEIPT_SALE.items || []),
    { itemName: 'Anchor Full Cream Milk Powder 400g Pack Special Offer', quantity: 12, unitPrice: 12345.5, total: 148146, sku: 'ANC-400', item: { barcode: '9300605000957' } },
  ],
  total: 151596,
}
const tenant = { name: 'Perera Super Stores Kandy Road Branch', address: '12 Main St', logoUrl: 'https://cdn/x.png', currency: 'LKR', taxId: null }

function model(patch: Partial<ReceiptSettings> = {}, extra: Partial<Parameters<typeof buildReceiptModel>[0]> = {}): ReceiptModel {
  return buildReceiptModel({ sale, tenant, settings: { ...DEFAULT_RECEIPT_SETTINGS, ...patch }, cashier: 'Nimal', counter: 'Counter 1', ...extra })
}

export async function receiptTests(check: Check) {
  console.log('Receipt format')

  // settings: defaults keep today's look, unknown / old values tolerated
  check(DEFAULT_RECEIPT_SETTINGS.itemLayout === 'two_line' && DEFAULT_RECEIPT_SETTINGS.itemSeparator === 'none' && DEFAULT_RECEIPT_SETTINGS.fontSize === 'normal', 'defaults preserve layout')
  check(DEFAULT_RECEIPT_SETTINGS.showPoweredBy === true && DEFAULT_RECEIPT_SETTINGS.qrContent === 'invoice_no', 'powered-by on, QR = invoice no by default')
  const old = resolveReceiptSettings({ fontSize: 'large', logoWidthPct: 60 })
  check(old.fontSize === 'large' && old.itemLayout === 'two_line' && old.logoAlign === 'center', 'old stored settings resolve with new defaults')
  check(resolveReceiptSettings({ fontSize: 'huge', itemSeparator: 'wavy' }).fontSize === 'normal', 'invalid values dropped')

  // ESC/POS: no line wider than the head, for every size / layout / width
  for (const paperWidth of [58, 80] as const) {
    for (const fontSize of ['small', 'normal', 'large'] as const) {
      for (const itemLayout of ['two_line', 'one_line'] as const) {
        const m = model({ fontSize, itemLayout, itemSeparator: 'dashed', showItemSku: true, showItemBarcode: true })
        const lines = decodeEscPosPreview(buildReceiptEscPosFromModel(m, { paperWidth }))
        const cols = fontSize === 'small' ? (paperWidth === 58 ? 42 : 64) : paperWidth === 58 ? 32 : 48
        const tooWide = lines.filter((l) => l.kind === 'text' && l.text.length * l.w > cols)
        check(tooWide.length === 0, `escpos ${paperWidth}mm ${fontSize} ${itemLayout}: lines fit ${cols} cols`, tooWide.map((l) => `${l.w}x "${l.text}"`).join('\n'))
        const total = lines.find((l) => l.kind === 'text' && l.text.startsWith('TOTAL'))
        check(!!total && total.bold && total.h === 2 && total.w === 1 && total.text.includes('151,596.00'), `escpos ${paperWidth}mm ${fontSize} ${itemLayout}: TOTAL bold double height on one line`, JSON.stringify(total))
        const name = lines.filter((l) => l.kind === 'text' && l.w === 2 && l.bold)
        check(name.length >= 2 && name.every((l) => l.text.length * 2 <= cols), `escpos ${paperWidth}mm ${fontSize}: long shop name wraps at double width`)
        if (itemLayout === 'one_line' && paperWidth === 80) {
          check(lines.some((l) => /^Item\s+Qty\s+Price\s+Total$/.test(l.text.trim())), `escpos 80mm ${fontSize} one_line: column header`)
        }
        check(lines.some((l) => l.text.includes('9300605000957')), `escpos ${paperWidth}mm ${fontSize} ${itemLayout}: item barcode printed`)
      }
    }
  }

  const base = model()
  const bytes = buildReceiptEscPosFromModel(base, { paperWidth: 58 })
  const dec = decodeEscPosPreview(bytes)
  check(dec.some((l) => l.text === 'Powered by skyERPOS' && l.align === 'center'), 'powered-by line printed')
  check(!decodeEscPosPreview(buildReceiptEscPosFromModel(model({ showPoweredBy: false }), { paperWidth: 58 })).some((l) => l.text.includes('Powered by')), 'powered-by toggle off')
  const idx = (hay: Uint8Array, n: number[]) => {
    outer: for (let i = 0; i + n.length <= hay.length; i++) {
      for (let j = 0; j < n.length; j++) if (hay[i + j] !== n[j]) continue outer
      return i
    }
    return -1
  }
  check(idx(buildReceiptEscPosFromModel(model({ fontSize: 'small' }), { paperWidth: 80 }), [0x1b, 0x4d, 1]) >= 0, 'small = ESC M 1 (font B)')
  check(idx(bytes, [0x1b, 0x4d, 1]) === -1, 'normal: font A')
  const dashed = decodeEscPosPreview(buildReceiptEscPosFromModel(model({ itemSeparator: 'dashed' }), { paperWidth: 58 }))
  check(dashed.filter((l) => /^(- )+-$/.test(l.text)).length === 2, 'dashed separator between 3 items = 2 lines')
  const solid = decodeEscPosPreview(buildReceiptEscPosFromModel(model({ itemSeparator: 'solid' }), { paperWidth: 58 }))
  check(solid.filter((l) => l.kind === 'image' && l.height === 2).length === 2, 'solid separator = 2-dot raster rule')

  // QR content
  const url = buildInvoiceVerifyUrl('https://app.example.lk/', 'PL123456', 'INV-000123', -151596)
  check(url === 'https://app.example.lk/v/PL123456/INV-000123?a=151596.00', 'verify url format', url)
  check(invoiceNoFromScan(url) === 'INV-000123' && invoiceNoFromScan(' INV-9 ') === 'INV-9', 'invoiceNoFromScan')
  const vm = model({ qrContent: 'verify_url', invoiceCode: 'both' }, { verifyBaseUrl: 'https://app.example.lk', businessId: 'PL123456' })
  check(vm.invoiceCode.qrValue.startsWith('https://app.example.lk/v/PL123456/INV-000123?a=') && vm.invoiceCode.value === 'INV-000123', 'model: QR = verify url, barcode = invoice no')
  const vdec = decodeEscPosPreview(buildReceiptEscPosFromModel(vm, { paperWidth: 58 }))
  check(vdec.some((l) => l.kind === 'qr' && l.text === vm.invoiceCode.qrValue) && vdec.some((l) => l.kind === 'barcode' && l.text === 'INV-000123'), 'escpos: QR carries URL, Code128 the number')
  const off = buildReceiptModel({ sale: { ...sale, invoiceNo: 'OFF-ABC-1' }, tenant, settings: { ...DEFAULT_RECEIPT_SETTINGS, qrContent: 'verify_url' }, verifyBaseUrl: 'https://x', businessId: 'PL123456' })
  check(off.invoiceCode.qrValue === 'OFF-ABC-1', 'offline receipts keep the number in the QR')
  check(model({ qrContent: 'verify_url' }).invoiceCode.qrValue === 'INV-000123', 'no base url -> invoice number')

  // logo alignment
  const r = { width: 16, height: 1, data: new Uint8Array([0x01, 0x80]) } // ink at x=7..8 (centred)
  const left = alignPackedRaster(r, 'left')
  const right = alignPackedRaster(r, 'right')
  check(left.data[0] === 0xc0 && left.data[1] === 0, 'logo align left', Array.from(left.data).join(','))
  check(right.data[0] === 0 && right.data[1] === 0x03, 'logo align right', Array.from(right.data).join(','))
  check(alignPackedRaster(r, 'center') === r, 'logo centre untouched')

  // HTML: same options
  const h = renderReceiptHtmlSync(model({ itemSeparator: 'solid', fontSize: 'small', itemLayout: 'one_line', showItemBarcode: true, logoAlign: 'left' }), 80, { logoSrc: 'https://cdn/x.png' })
  check(h.includes(`font-size:${RECEIPT_FONT_PX[80].small}px`), 'html: small font px')
  check((h.match(/border-top:1px solid #000;margin:3px 0/g) || []).length === 2, 'html: solid separators between items')
  check(h.includes('grid-template-columns') && h.includes('>Qty<'), 'html: one-line 80mm grid with header')
  check(h.includes('9300605000957'), 'html: item barcode')
  check(h.includes('margin:0 auto 4px 0'), 'html: logo left')
  check(h.includes('Powered by skyERPOS'), 'html: powered-by')
  const h58 = renderReceiptHtmlSync(model({ itemLayout: 'one_line' }), 58)
  check(h58.includes('2 x Basmathi Rice 5kg') && !h58.includes('grid-template-columns'), 'html 58mm one-line: qty x name row')
  const hDefault = renderReceiptHtmlSync(model(), 58)
  check(hDefault.includes(`font-size:${RECEIPT_FONT_PX[58].normal}px`) && hDefault.includes('font-weight:600">Basmathi Rice 5kg'), 'html default two-line look')

  // Mobile receipts follow the same settings
  const input: ReceiptInput = {
    business: { name: 'Perera Super Stores Kandy Road Branch' },
    invoiceNo: 'INV-000123',
    dateTime: '2026-01-15T10:30:00.000Z',
    lines: [
      { name: 'Basmathi Rice 5kg', qty: 2, unitPrice: 1500, total: 3000, sku: 'RICE-5KG', barcode: '4791234567892' },
      { name: 'Anchor Full Cream Milk Powder 400g Pack Special Offer', qty: 12, unitPrice: 12345.5, total: 148146 },
    ],
    subtotal: 151146,
    discount: 0,
    taxLines: [],
    total: 151146,
    payments: [{ method: 'cash', amount: 151146 }],
    invoiceCode: 'both',
    qrPayload: 'https://app.example.lk/v/PL123456/INV-000123?a=151146.00',
    barcodePayload: 'INV-000123',
    format: { fontSize: 'normal', itemLayout: 'two_line', itemSeparator: 'dashed', showItemSku: true, showItemBarcode: true, poweredBy: true, logoAlign: 'center' },
  }
  for (const paperWidth of [58, 80] as const) {
    for (const fontSize of ['small', 'normal', 'large'] as const) {
      for (const itemLayout of ['two_line', 'one_line'] as const) {
        const mb = buildReceipt({ ...input, format: { ...input.format!, fontSize, itemLayout } }, { paperWidth })
        const lines = decodeEscPosPreview(mb)
        const cols = fontSize === 'small' ? (paperWidth === 58 ? 42 : 64) : paperWidth === 58 ? 32 : 48
        const tooWide = lines.filter((l) => l.kind === 'text' && l.text.length * l.w > cols)
        check(tooWide.length === 0, `mobile ${paperWidth}mm ${fontSize} ${itemLayout}: lines fit`, tooWide.map((l) => `${l.w}x "${l.text}"`).join('\n'))
        check(lines.some((l) => l.kind === 'qr' && l.text.startsWith('https://')) && lines.some((l) => l.kind === 'barcode' && l.text === 'INV-000123'), `mobile ${paperWidth}mm: QR url + Code128 number`)
      }
    }
  }
  const plain = bytesToPlainText(buildReceipt(input, { paperWidth: 58 }))
  check(plain.includes('4791234567892') && plain.includes('Powered by skyERPOS'), 'mobile: item barcode + powered-by')
  const noPb = bytesToPlainText(buildReceipt({ ...input, format: { ...input.format!, poweredBy: false } }, { paperWidth: 58 }))
  check(!noPb.includes('Powered by'), 'mobile: powered-by off')
  const legacyPlain = bytesToPlainText(buildReceipt({ ...input, format: undefined, barcodePayload: undefined, qrPayload: 'INV-000123' }, { paperWidth: 58 }))
  check(legacyPlain.includes('Powered by skyERPOS'), 'mobile: legacy input keeps powered-by')
  const mh = receiptHtml({ ...input, format: { ...input.format!, itemSeparator: 'solid', fontSize: 'large' } }, 80)
  check(mh.includes(`font-size:${RECEIPT_FONT_PX[80].large}px`) && mh.includes('border-top:1px solid #000'), 'mobile html: size scale + separator', mh.slice(0, 400))
}
