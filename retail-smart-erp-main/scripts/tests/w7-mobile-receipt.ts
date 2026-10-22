/**
 * Mobile ESC/POS receipt (logo + invoice codes): npx tsx scripts/tests/w7-mobile-receipt.ts
 */
import { buildReceipt, base64ToBytes, bytesToBase64, invoiceCodeFor, type ReceiptInput } from '../../apps/mobile/src/lib/escpos'

let pass = 0
let fail = 0
const check = (c: boolean, m: string) => (c ? pass++ : (fail++, console.error('  FAIL: ' + m)))
function idx(hay: Uint8Array, needle: number[]) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0))

console.log('Mobile receipt test')
const bits = new Uint8Array(48 * 2).fill(0)
bits[0] = 0x80
const logoB64 = bytesToBase64(bits)
check(base64ToBytes(logoB64).length === 96 && base64ToBytes(logoB64)[0] === 0x80, 'base64 round trip')

const base: ReceiptInput = {
  business: { name: 'Test Shop', legalName: 'Test Shop (Pvt) Ltd', taxId: '1234-7000', brn: 'PV 99', website: 'shop.lk', email: 'a@shop.lk' },
  headerLines: ['Welcome'],
  footerLines: ['Come again', 'Bye'],
  returnPolicy: 'Exchange within 7 days',
  invoiceNo: 'OFF-ABC12',
  qrPayload: 'OFF-ABC12',
  invoiceCode: 'both',
  logo: { width: 384, height: 2, data: logoB64 },
  dateTime: new Date('2026-01-01T10:00:00'),
  lines: [{ name: 'Rice', qty: 1, unitPrice: 100, total: 100 }],
  subtotal: 100,
  discount: 0,
  taxLines: [],
  total: 100,
  payments: [{ method: 'cash', amount: 100 }],
}
const b = buildReceipt(base, { paperWidth: 58 })
check(idx(b, [0x1b, 0x74, 0]) >= 0, 'ESC t 0')
check(idx(b, [0x1d, 0x76, 0x30, 0, 48, 0, 2, 0, 0x80]) >= 0, 'logo GS v 0 48 bytes x 2 rows')
check(idx(b, [0x1d, 0x6b, 73]) >= 0, 'CODE128 for OFF- ref')
check(idx(b, [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]) >= 0, 'QR printed')
for (const s of ['Test Shop (Pvt) Ltd', 'VAT/TIN: 1234-7000', 'BRN: PV 99', 'shop.lk', 'Welcome', 'Come again', 'Exchange within 7 days'])
  check(idx(b, ascii(s)) >= 0, `contains ${s}`)

const wide = buildReceipt({ ...base, logo: { width: 576, height: 1, data: bytesToBase64(new Uint8Array(72).fill(0xff)) } }, { paperWidth: 58 })
check(idx(wide, [0x1d, 0x76, 0x30, 0, 48, 0, 1, 0]) >= 0, '576-dot logo cropped to 48 bytes on 58mm')

const qrOnly = buildReceipt({ ...base, invoiceCode: 'qr', logo: null }, { paperWidth: 80 })
check(idx(qrOnly, [0x1d, 0x6b, 73]) < 0 && idx(qrOnly, [0x1d, 0x76, 0x30]) < 0, 'qr-only: no barcode, no logo')
const none = buildReceipt({ ...base, invoiceCode: 'none' }, { paperWidth: 80 })
check(idx(none, [0x1d, 0x6b, 73]) < 0 && idx(none, [0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]) < 0, 'none: no codes')
check(!invoiceCodeFor({ invoiceNo: 'Sale recorded', qrPayload: 'Sale recorded', invoiceCode: 'both' }).barcode, 'placeholder text not encoded')
const legacy = buildReceipt({ ...base, invoiceCode: undefined, qrPayload: 'INV-1', headerLines: undefined, footerLines: undefined, header: 'Old header' }, { paperWidth: 58 })
check(idx(legacy, [0x1d, 0x6b, 73]) < 0 && idx(legacy, ascii('Old header')) >= 0, 'legacy input: QR only, header text')

// H2: tax invoice (VAT-registered seller, VAT charged) — title, buyer, per-line VAT, excl./incl. totals
const taxInv: ReceiptInput = {
  ...base,
  invoiceCode: 'none',
  logo: null,
  customer: { name: 'Lanka Hardware' },
  lines: [{ name: 'Chair', qty: 1, unitPrice: 1000, total: 1000, vatRate: 18, vatAmount: 180 }],
  subtotal: 1000,
  taxLines: [{ name: 'VAT 18%', amount: 180 }],
  total: 1180,
  taxInvoice: {
    kind: 'tax_invoice', supplierVatNo: '1234-7000', originalInvoiceNo: null,
    buyer: { name: 'Lanka Hardware', vatNo: '114999888-7000', address: '5 Kandy Rd' },
    totalExclVat: 1000, totalVat: 180, totalInclVat: 1180,
  },
}
for (const w of [58, 80] as const) {
  const t = buildReceipt(taxInv, { paperWidth: w })
  for (const s2 of ['TAX INVOICE', 'Invoice No', 'Buyer VAT No', '114999888-7000', '5 Kandy Rd', 'VAT 18%', '180.00', 'Total excl. VAT', 'Total incl. VAT'])
    check(idx(t, ascii(s2)) >= 0, `${w}mm tax invoice contains ${s2}`)
  check(idx(t, ascii('SALES RECEIPT')) < 0, `${w}mm tax invoice is not titled SALES RECEIPT`)
}
const cn = buildReceipt({ ...taxInv, isReturn: true, total: -1180, taxInvoice: { ...taxInv.taxInvoice!, kind: 'credit_note', originalInvoiceNo: 'INV-000777' } }, { paperWidth: 58 })
check(idx(cn, ascii('CREDIT NOTE')) >= 0 && idx(cn, ascii('INV-000777')) >= 0, 'VAT return prints CREDIT NOTE against the original invoice')
check(idx(b, ascii('SALES RECEIPT')) >= 0 && idx(b, ascii('Total excl. VAT')) < 0, 'ordinary receipt unchanged (no tax invoice block)')

console.log(`  ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
