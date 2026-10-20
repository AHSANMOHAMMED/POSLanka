/**
 * Plain-script self test for the ESC/POS encoder.
 * Run with:  npx tsx src/lib/print/escpos/__selftest__.ts
 */
import {
  EscPosBuilder,
  buildReceiptEscPos,
  buildZReportEscPos,
  buildTestPageEscPos,
  buildDrawerKickEscPos,
  encodeCp437,
  wrapText,
  formatMoney,
  type ReceiptInput,
  encodeCp1252,
  hasUnencodable,
} from './encoder'
import { buildReceiptEscPosFromModel } from './receipt-from-model'
import { buildReceiptModel, SAMPLE_RECEIPT_SALE } from '../receipt-model'
import { resolveReceiptSettings, DEFAULT_RECEIPT_SETTINGS } from '../receipt-settings'
import { renderReceiptHtml } from '../receipt-html'

let failures = 0
let passes = 0

function assert(cond: boolean, msg: string) {
  if (cond) {
    passes++
  } else {
    failures++
    console.error(`  FAIL: ${msg}`)
  }
}

function eq(a: Uint8Array, b: number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function indexOfSeq(hay: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

console.log('ESC/POS encoder self-test')

// init
assert(eq(new EscPosBuilder().init().build(), [0x1b, 0x40]), 'init emits ESC @')

// align
assert(eq(new EscPosBuilder().align('center').build(), [0x1b, 0x61, 1]), 'align center = ESC a 1')
assert(eq(new EscPosBuilder().align('right').build(), [0x1b, 0x61, 2]), 'align right = ESC a 2')

// bold / underline
assert(eq(new EscPosBuilder().bold(true).build(), [0x1b, 0x45, 1]), 'bold on = ESC E 1')
assert(eq(new EscPosBuilder().underline(true).build(), [0x1b, 0x2d, 1]), 'underline on = ESC - 1')

// size
assert(eq(new EscPosBuilder().size(2, 2).build(), [0x1d, 0x21, 0x11]), 'size 2x2 = GS ! 0x11')
assert(eq(new EscPosBuilder().size(1, 1).build(), [0x1d, 0x21, 0x00]), 'size 1x1 = GS ! 0')

// feed / cut / drawer
assert(eq(new EscPosBuilder().feed(3).build(), [0x1b, 0x64, 3]), 'feed 3 = ESC d 3')
assert(eq(new EscPosBuilder().cut(true).build(), [0x1d, 0x56, 1]), 'partial cut = GS V 1')
assert(eq(new EscPosBuilder().cut(false).build(), [0x1d, 0x56, 0]), 'full cut = GS V 0')
assert(eq(new EscPosBuilder().drawerKick(2).build(), [0x1b, 0x70, 0, 25, 250]), 'drawer pin 2 = ESC p 0')
assert(eq(new EscPosBuilder().drawerKick(5).build(), [0x1b, 0x70, 1, 25, 250]), 'drawer pin 5 = ESC p 1')
assert(eq(buildDrawerKickEscPos(2), [0x1b, 0x40, 0x1b, 0x70, 0, 25, 250]), 'buildDrawerKickEscPos')

// text encoding
assert(eq(encodeCp437('Hi'), [0x48, 0x69]), 'ASCII passes through')
assert(eq(encodeCp437('රු'), [0x3f, 0x3f]), 'non-ASCII becomes ?')
assert(eq(new EscPosBuilder().line('A').build(), [0x41, 0x0a]), 'line appends LF')

// barcode CODE128
const bc = new EscPosBuilder().barcode('AB', { height: 50, width: 2, hri: 2 }).build()
assert(indexOfSeq(bc, [0x1d, 0x68, 50]) === 0, 'barcode sets height GS h')
assert(indexOfSeq(bc, [0x1d, 0x77, 2]) === 3, 'barcode sets width GS w')
assert(indexOfSeq(bc, [0x1d, 0x48, 2]) === 6, 'barcode sets HRI GS H')
assert(indexOfSeq(bc, [0x1d, 0x6b, 73, 4, 0x7b, 0x42, 0x41, 0x42]) === 9, 'GS k 73 with {B prefix and length')

// QR
const qr = new EscPosBuilder().qr('X', 4).build()
assert(indexOfSeq(qr, [0x1d, 0x28, 0x6b, 4, 0, 49, 65, 50, 0]) === 0, 'QR model select')
assert(indexOfSeq(qr, [0x1d, 0x28, 0x6b, 3, 0, 49, 67, 4]) >= 0, 'QR module size')
assert(indexOfSeq(qr, [0x1d, 0x28, 0x6b, 4, 0, 49, 80, 48, 0x58]) >= 0, 'QR store data (len = k + 3)')
assert(indexOfSeq(qr, [0x1d, 0x28, 0x6b, 3, 0, 49, 81, 48]) >= 0, 'QR print')

// rows / table
const row = new EscPosBuilder({ columns: 32 }).row('Total', '1,000.00').build()
const rowText = String.fromCharCode(...row)
assert(rowText.length === 33 && rowText.endsWith('1,000.00\n'), 'row pads to column width')
assert(rowText.startsWith('Total '), 'row left text')

const tr = new EscPosBuilder({ columns: 48 })
  .tableRow([
    { text: 'Item', width: 36 },
    { text: '9.99', width: 12, align: 'right' },
  ])
  .build()
assert(tr.length === 49 && String.fromCharCode(...tr).endsWith('        9.99\n'), 'tableRow right aligns')

// wrap / money
assert(wrapText('hello world foo', 11).join('|') === 'hello world|foo', 'wrapText')
assert(formatMoney(1234567.891) === '1,234,567.89', 'formatMoney grouping')
assert(formatMoney(-5) === '-5.00', 'formatMoney negative')

// raster
const img = {
  width: 16,
  height: 2,
  data: new Uint8Array(16 * 2 * 4).fill(255),
}
// make pixel (0,0) and (15,1) black
img.data[0] = img.data[1] = img.data[2] = 0
const p = (1 * 16 + 15) * 4
img.data[p] = img.data[p + 1] = img.data[p + 2] = 0
const ras = new EscPosBuilder().rasterImage(img, 576).build()
assert(eq(ras.slice(0, 8), [0x1d, 0x76, 0x30, 0, 2, 0, 2, 0]), 'GS v 0 header xL=2 yL=2')
assert(eq(ras.slice(8), [0x80, 0x00, 0x00, 0x01]), 'raster bits MSB-first')

// raster downscale
const wide = { width: 1152, height: 4, data: new Uint8Array(1152 * 4 * 4).fill(0) }
const rasWide = new EscPosBuilder().rasterImage(wide, 576).build()
assert(rasWide[4] === 72 && rasWide[5] === 0 && rasWide[6] === 2, 'wide image scaled to 576 dots (72 bytes), 2 rows')

// bitmap text via rasterizer
let rasterCalls = 0
const bb = new EscPosBuilder({
  columns: 32,
  rasterizer: () => {
    rasterCalls++
    return { width: 8, height: 1, data: new Uint8Array(32).fill(0) }
  },
})
bb.styledLine('සිංහල')
bb.styledLine('ascii')
assert(rasterCalls === 1, 'rasterizer used only for non-ASCII lines')
assert(indexOfSeq(bb.build(), [0x1d, 0x76, 0x30]) >= 0, 'bitmap text emitted as GS v 0')

// Full receipt
const receipt: ReceiptInput = {
  business: { name: 'Test Shop', address: '12 Galle Rd, Colombo', phone: '011-2345678' },
  header: 'Welcome',
  footer: 'Thank you',
  invoiceNo: 'INV-0001',
  dateTime: '2026-01-01 10:00',
  cashier: 'Nimal',
  counter: 'Counter 1',
  customer: { name: 'Walk-in' },
  lines: [
    { name: 'Rice 5kg', qty: 2, unitPrice: 1500, total: 3000 },
    { name: 'Sugar', qty: 1.5, unit: 'kg', unitPrice: 300, total: 450, discount: 50 },
  ],
  subtotal: 3450,
  discount: 50,
  taxLines: [{ name: 'VAT 18%', amount: 612 }],
  total: 4012,
  payments: [{ method: 'cash', amount: 5000 }],
  change: 988,
  qrPayload: 'INV-0001',
  currency: 'LKR',
}
for (const pw of [58, 80] as const) {
  const bytes = buildReceiptEscPos(receipt, { paperWidth: pw, drawerKick: true })
  assert(bytes[0] === 0x1b && bytes[1] === 0x40, `receipt ${pw}: starts with ESC @`)
  assert(indexOfSeq(bytes, [0x1b, 0x70, 0, 25, 250]) === 2, `receipt ${pw}: drawer kick right after init`)
  assert(eq(bytes.slice(-3), [0x1d, 0x56, 1]), `receipt ${pw}: ends with partial cut`)
  assert(indexOfSeq(bytes, Array.from(encodeCp437('INV-0001'))) >= 0, `receipt ${pw}: invoice number present`)
  assert(indexOfSeq(bytes, [0x1d, 0x28, 0x6b, 3, 0, 49, 81, 48]) >= 0, `receipt ${pw}: QR printed`)
  assert(indexOfSeq(bytes, [0x1d, 0x6b, 73]) >= 0, `receipt ${pw}: CODE128 printed`)
  assert(indexOfSeq(bytes, Array.from(encodeCp437('4,012.00'))) >= 0, `receipt ${pw}: total formatted`)
}
const noCut = buildReceiptEscPos(receipt, { paperWidth: 80, noCut: true })
assert(indexOfSeq(noCut, [0x1d, 0x56, 1]) === -1, 'noCut omits GS V')

// Z report
const z = buildZReportEscPos(
  {
    business: { name: 'Test Shop' },
    entryNumber: 'SHIFT-0007',
    openedAt: '2026-01-01 08:00',
    closedAt: '2026-01-01 20:00',
    summary: { totalSales: 10000, totalReturns: 500, netSales: 9500, totalTransactions: 42, totalVariance: -20 },
    methods: [
      { method: 'cash', opening: 5000, sales: 7000, expected: 12000, actual: 11980, variance: -20 },
      { method: 'card', opening: 0, sales: 2500, expected: 2500, actual: 2500, variance: 0 },
    ],
  },
  { paperWidth: 80 }
)
assert(z[0] === 0x1b && z[1] === 0x40, 'z report: starts with ESC @')
assert(eq(z.slice(-3), [0x1d, 0x56, 1]), 'z report: ends with cut')
assert(indexOfSeq(z, Array.from(encodeCp437('SHIFT-0007'))) >= 0, 'z report: entry number present')

const tp = buildTestPageEscPos({ paperWidth: 58 })
assert(tp[0] === 0x1b && tp[1] === 0x40 && eq(tp.slice(-3), [0x1d, 0x56, 1]), 'test page: init + cut')

// ─── W7: code page, logo, model-based receipts ──────────────────────────
for (const pw of [58, 80] as const) {
  const bytes = buildReceiptEscPos(receipt, { paperWidth: pw, drawerKick: true })
  assert(indexOfSeq(bytes, [0x1b, 0x74, 0]) === 7, `receipt ${pw}: ESC t 0 (CP437) right after init + drawer kick`)
}
const cp1252 = buildReceiptEscPos(receipt, { paperWidth: 80, codePage: 'cp1252' })
assert(indexOfSeq(cp1252, [0x1b, 0x74, 16]) === 2, 'cp1252: ESC t 16 after init')
assert(eq(encodeCp1252('é€'), [0xe9, 0x80]), 'encodeCp1252 maps é and €')
assert(hasUnencodable('café', 'cp437') && !hasUnencodable('café', 'cp1252'), 'hasUnencodable per code page')
assert(hasUnencodable('සිංහල', 'cp1252'), 'Sinhala unencodable in cp1252')
assert(eq(new EscPosBuilder({ codePage: 'cp1252' }).text('é').build(), [0xe9]), 'builder text uses code page')

// packed logo raster (GS v 0 from server bitmap)
const logo = { width: 16, height: 2, data: new Uint8Array([0x80, 0x01, 0xff, 0x00]) }
const withLogo = buildReceiptEscPos(receipt, { paperWidth: 80, logoRaster: logo })
assert(indexOfSeq(withLogo, [0x1d, 0x76, 0x30, 0, 2, 0, 2, 0, 0x80, 0x01, 0xff, 0x00]) >= 0, 'logoRaster emitted as GS v 0 verbatim')
const wideLogo = { width: 640, height: 1, data: new Uint8Array(80).fill(0xaa) }
const cropped = new EscPosBuilder({ columns: 32, widthDots: 384 }).packedRaster(wideLogo).build()
assert(cropped[4] === 48 && cropped.length === 8 + 48, 'packedRaster crops to head width (384 dots = 48 bytes)')

// model-based receipt
const settings = resolveReceiptSettings({ invoiceCode: 'barcode', returnPolicy: 'Returns within 7 days with receipt', footerLines: ['Come again'] }, {
  receiptHeader: 'Counter header',
  showLogoOnReceipt: true,
  receiptSettings: { showBrn: false },
})
assert(settings.invoiceCode === 'barcode' && settings.headerLines[0] === 'Counter header' && settings.showBrn === false, 'resolveReceiptSettings layering')
assert(resolveReceiptSettings({ logoWidthPct: 5, bogus: 1 }).logoWidthPct === DEFAULT_RECEIPT_SETTINGS.logoWidthPct, 'invalid stored values dropped')
const model = buildReceiptModel({
  sale: { ...SAMPLE_RECEIPT_SALE, invoiceNo: 'OFF-ABC123' },
  tenant: { name: 'Test Shop', legalName: 'Test Shop (Pvt) Ltd', taxId: '123456789-7000', brn: 'PV 1234', website: 'shop.lk', email: 'a@shop.lk', logoUrl: 'https://cdn/x.png', currency: 'LKR' },
  settings,
  cashier: 'Nimal',
  counter: 'Counter 1',
})
assert(model.business.lines.includes('Test Shop (Pvt) Ltd') && model.business.lines.includes('VAT/TIN: 123456789-7000'), 'model: legal name + tax id')
assert(!model.business.lines.some((l) => l.startsWith('BRN')), 'model: BRN hidden by profile override')
assert(model.invoiceCode.type === 'barcode' && model.invoiceCode.value === 'OFF-ABC123', 'model: invoice code for offline ref')
const mBytes = buildReceiptEscPosFromModel(model, { paperWidth: 80, logoRaster: logo, drawerKick: true })
assert(indexOfSeq(mBytes, [0x1b, 0x74, 0]) >= 0, 'model receipt: ESC t 0')
assert(indexOfSeq(mBytes, [0x1d, 0x76, 0x30, 0, 2, 0, 2, 0]) >= 0, 'model receipt: logo printed')
assert(indexOfSeq(mBytes, [0x1d, 0x6b, 73]) >= 0, 'model receipt: CODE128 printed')
assert(indexOfSeq(mBytes, [0x1d, 0x28, 0x6b, 3, 0, 49, 81, 48]) === -1, 'model receipt: no QR when invoiceCode=barcode')
assert(indexOfSeq(mBytes, Array.from(encodeCp437('Returns within 7 days'))) >= 0, 'model receipt: return policy')
assert(indexOfSeq(mBytes, Array.from(encodeCp437('Counter header'))) >= 0, 'model receipt: header line')
const noLogo = buildReceiptEscPosFromModel({ ...model, logo: { ...model.logo, show: false } }, { paperWidth: 58, logoRaster: logo })
assert(indexOfSeq(noLogo, [0x1d, 0x76, 0x30]) === -1, 'model receipt: logo suppressed when showLogo=false')
const large = buildReceiptEscPosFromModel({ ...model, fontSize: 'large' }, { paperWidth: 80 })
assert(indexOfSeq(large, [0x1d, 0x21, 0x01]) >= 0, 'model receipt: large font = double height')

async function htmlTests() {
  const html = await renderReceiptHtml({ ...model, invoiceCode: { type: 'both', value: 'INV-1' } }, 80, { logoSrc: 'data:image/png;base64,AAAA' })
  assert(html.includes('<img src="data:image/png;base64,AAAA"'), 'html: logo img')
  assert((html.match(/<svg/g) || []).length === 2, 'html: barcode + QR svgs')
  assert(html.includes('Test Shop (Pvt) Ltd') && html.includes('Returns within 7 days'), 'html: business + policy')
  const evil = await renderReceiptHtml({ ...model, business: { name: '<script>x</script>', lines: [] } }, 58, { logoSrc: 'javascript:alert(1)' })
  assert(!evil.includes('<script>') && !evil.includes('javascript:'), 'html: escaping + unsafe logo src dropped')
}

htmlTests().then(() => {
  console.log(`  ${passes} passed, ${failures} failed`)
  if (failures > 0) process.exit(1)
})
