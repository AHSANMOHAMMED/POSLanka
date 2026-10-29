/**
 * L12 — receipt PDF (src/lib/print/receipt-pdf.ts), sent on WhatsApp. No database.
 *
 *   npx tsx scripts/tests/l12-receipt-pdf.ts [outDir]   (outDir: also write the PDFs to look at)
 */
import { writeFileSync } from 'fs'
import { PDFDocument } from 'pdf-lib'
import { toBuffer } from 'bwip-js/node'
import { buildReceiptModel, SAMPLE_RECEIPT_SALE } from '../../src/lib/print/receipt-model'
import { DEFAULT_RECEIPT_SETTINGS, type ReceiptSettings } from '../../src/lib/print/receipt-settings'
import { buildReceiptPdf } from '../../src/lib/print/receipt-pdf'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${JSON.stringify(detail)}` : ''}`)
}

async function main() {
  const out = process.argv[2]
  const sale = {
    ...SAMPLE_RECEIPT_SALE,
    customerName: 'Nimal Perera',
    customerPhone: '0771234567',
    customer: { name: 'Nimal Perera', phone: '0771234567' },
    items: [
      ...(SAMPLE_RECEIPT_SALE.items || []),
      { itemName: 'Ladies Denim Slim Fit Dark Blue Size 32 Extra Long Name Row', quantity: 2, unitPrice: 3990, total: 7980 },
      { itemName: 'සිංහල නම Sinhala item', quantity: 1, unitPrice: 100, total: 100 },
    ],
  }
  const tenant = { name: 'ALISHA Fashion', address: '12 Main Street, Colombo 03', phone: '011 234 5678', currency: 'Rs' }
  const qr = await toBuffer({ bcid: 'qrcode', text: 'INV-000123', scale: 4 })
  const bc = await toBuffer({ bcid: 'code128', text: 'INV-000123', scale: 3, height: 10, includetext: true })
  const variants: Array<[string, Partial<ReceiptSettings>, 58 | 80]> = [
    ['two-line-80', {}, 80],
    ['table-coupon-80', { itemLayout: 'table', couponEnabled: true, couponTitle: 'LUCKY DRAW COUPON', couponText: 'Drop in the box. Draw on 31 Dec!' }, 80],
    ['table-58', { itemLayout: 'table', fontFamily: 'mono' }, 58],
    ['one-line-colour', { itemLayout: 'one_line', textColor: '#1a237e', textWeight: 'normal' }, 80],
  ]
  for (const [name, patch, w] of variants) {
    const model = buildReceiptModel({ sale: sale as never, tenant, settings: { ...DEFAULT_RECEIPT_SETTINGS, ...patch }, cashier: 'Kamal' })
    let bytes: Uint8Array | null = null
    try {
      bytes = await buildReceiptPdf(model, w, { qrPng: qr, barcodePng: bc })
    } catch (e) {
      check(`${name}: builds`, false, e instanceof Error ? e.message : String(e))
      continue
    }
    if (out) writeFileSync(`${out}/${name}.pdf`, bytes)
    const doc = await PDFDocument.load(bytes)
    const page = doc.getPage(0)
    const { width, height } = page.getSize()
    check(`${name}: one page, ${w} mm wide, content height`, doc.getPageCount() === 1 && Math.abs(width - (w * 72) / 25.4) < 0.5 && height > 200 && height < 2000, { width, height })
  }
  console.log(`\n${pass}/${pass + fail} passed`)
  process.exit(fail ? 1 : 0)
}
main()
