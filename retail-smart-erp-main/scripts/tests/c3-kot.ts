/**
 * Kitchen tickets (KOT) + Z-report branding: npx tsx scripts/tests/c3-kot.ts
 *
 * The KOT bytes are compared against scripts/tests/__snapshots__/c3-kot.hex.
 * Regenerate after an intentional layout change with: UPDATE_SNAPSHOTS=1 npx tsx scripts/tests/c3-kot.ts
 */
import * as fs from 'fs'
import * as path from 'path'
import { buildKitchenTicketEscPos, kitchenModifierLabels, type KitchenTicketInput } from '../../src/lib/print/escpos/kitchen-ticket'
import { buildZReportEscPos, encodeCp437, type ZReportInput } from '../../src/lib/print/escpos/encoder'
import { escposToPlainText } from '../../src/lib/print/escpos/transports'
import { buildBusinessBlock } from '../../src/lib/print/receipt-model'
import { DEFAULT_RECEIPT_SETTINGS } from '../../src/lib/print/receipt-settings'
import { buildZReport, bytesToBase64, type ZReportInput as MobileZReportInput } from '../../apps/mobile/src/lib/escpos'

let pass = 0
let fail = 0
const check = (c: boolean, m: string) => (c ? pass++ : (fail++, console.error('  FAIL: ' + m)))
function idx(hay: Uint8Array, needle: ArrayLike<number>) {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}
const has = (bytes: Uint8Array, s: string) => idx(bytes, encodeCp437(s)) >= 0
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

console.log('C3 kitchen ticket + Z report branding test')

// ─── Kitchen ticket ─────────────────────────────────────────────────────
const fixedFmt = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ')
const ticket: KitchenTicketInput = {
  orderNo: 'RO-000123',
  orderType: 'dine_in',
  table: 'T5',
  tableArea: 'Terrace',
  server: 'Nimal',
  time: new Date('2026-10-21T18:45:00.000Z'),
  items: [
    {
      name: 'Chicken Kottu Roti Extra Large',
      quantity: 2,
      modifiers: kitchenModifierLabels([{ id: 'm1', name: 'Extra cheese', price: 150 }, 'No chilli']),
      notes: 'Allergy: peanuts',
    },
    { name: 'Lime Juice', quantity: 1 },
  ],
}

const kot80 = buildKitchenTicketEscPos(ticket, { paperWidth: 80, formatTime: fixedFmt })
const kot58 = buildKitchenTicketEscPos(ticket, { paperWidth: 58, formatTime: fixedFmt })
const reprint = buildKitchenTicketEscPos({ ...ticket, reprint: true }, { paperWidth: 80, formatTime: fixedFmt })

for (const [label, b] of [['80', kot80], ['58', kot58]] as const) {
  check(b[0] === 0x1b && b[1] === 0x40, `kot ${label}: starts with ESC @`)
  check(idx(b, [0x1d, 0x21, 0x11]) >= 0, `kot ${label}: double-size font (GS ! 0x11)`)
  check(idx(b, [0x1d, 0x56, 1]) === b.length - 3, `kot ${label}: ends with cut`)
  check(has(b, 'RO-000123'), `kot ${label}: order no`)
  check(has(b, 'DINE-IN'), `kot ${label}: order type`)
  check(has(b, 'T5'), `kot ${label}: table`)
  check(has(b, 'Nimal'), `kot ${label}: server`)
  check(has(b, '2026-10-21 18:45'), `kot ${label}: time`)
  check(has(b, '2 x Chicken'), `kot ${label}: qty + item`)
  check(has(b, 'Lime Juice'), `kot ${label}: second item`)
  check(has(b, 'Extra cheese'), `kot ${label}: modifier object label`)
  check(has(b, 'No chilli'), `kot ${label}: modifier string`)
  check(has(b, 'Allergy:'), `kot ${label}: notes`)
  check(!has(b, '150') && !has(b, '.00') && !has(b, 'LKR'), `kot ${label}: no prices`)
  check(!has(b, 'REPRINT'), `kot ${label}: no reprint banner`)
}
check(has(reprint, '** REPRINT **'), 'kot reprint: banner')

const snapDir = path.join(__dirname, '__snapshots__')
const snapFile = path.join(snapDir, 'c3-kot.hex')
const actual = [toHex(kot80), toHex(kot58), toHex(reprint)].join('\n') + '\n'
if (process.env.UPDATE_SNAPSHOTS || !fs.existsSync(snapFile)) {
  fs.mkdirSync(snapDir, { recursive: true })
  fs.writeFileSync(snapFile, actual)
  console.log('  snapshot written: ' + snapFile)
  console.log('  --- decoded 80mm ticket ---\n' + escposToPlainText(kot80).map((l) => '  | ' + l).join('\n'))
  console.log('  --- decoded 58mm ticket ---\n' + escposToPlainText(kot58).map((l) => '  | ' + l).join('\n'))
  console.log('  --- decoded reprint ---\n' + escposToPlainText(reprint).map((l) => '  | ' + l).join('\n'))
}
check(fs.readFileSync(snapFile, 'utf8') === actual, 'kot bytes match snapshot')

// ─── Web Z report branding ──────────────────────────────────────────────
const zBase: ZReportInput = {
  business: { name: 'Test Shop', legalName: 'Test Shop (Pvt) Ltd', taxId: '123456789-7000', brn: 'PV 99', address: '1 Main St' },
  entryNumber: 'SHIFT-0007',
  openedAt: '2026-01-01 08:00',
  closedAt: '2026-01-01 20:00',
  summary: { totalSales: 100, totalReturns: 0, netSales: 100, totalTransactions: 1, totalVariance: 0 },
  methods: [{ method: 'cash', opening: 0, sales: 100, expected: 100, actual: 100, variance: 0 }],
}
const zFallback = buildZReportEscPos(zBase, { paperWidth: 80 })
check(has(zFallback, 'Test Shop (Pvt) Ltd'), 'web z: legal name (business fields)')
check(has(zFallback, 'VAT/TIN: 123456789-7000'), 'web z: tax id (business fields)')
check(has(zFallback, 'BRN: PV 99'), 'web z: brn (business fields)')

const block = buildBusinessBlock({
  name: 'Test Shop',
  legalName: 'Test Shop (Pvt) Ltd',
  taxId: '123456789-7000',
  phone: '011 2345678',
  logoUrl: '/logo.png',
})
check(block.logo.show && block.lines.includes('Test Shop (Pvt) Ltd') && block.lines.includes('VAT/TIN: 123456789-7000'), 'business block lines')
const logoRaster = { width: 16, height: 2, data: new Uint8Array([0xff, 0x00, 0x00, 0xff]) }
const zBranded = buildZReportEscPos({ ...zBase, business: { name: block.name }, businessLines: block.lines }, { paperWidth: 58, logoRaster })
check(has(zBranded, 'Test Shop (Pvt) Ltd'), 'web z: legal name (business block)')
check(has(zBranded, 'VAT/TIN: 123456789-7000'), 'web z: tax id (business block)')
check(has(zBranded, 'Tel: 011 2345678'), 'web z: phone (business block)')
check(idx(zBranded, [0x1d, 0x76, 0x30, 0, 2, 0, 2, 0, 0xff, 0x00, 0x00, 0xff]) >= 0, 'web z: logo raster (GS v 0)')
check(idx(zBranded, [0x1d, 0x76, 0x30]) < idx(zBranded, encodeCp437('Z REPORT')), 'web z: logo before title')
const zHidden = buildBusinessBlock({ name: 'Test Shop', legalName: 'X Ltd', taxId: '99' }, { ...DEFAULT_RECEIPT_SETTINGS, showTaxId: false })
check(!zHidden.lines.some((l) => l.includes('VAT')), 'business block honours showTaxId=false')

// ─── Mobile Z report branding ───────────────────────────────────────────
const mz: MobileZReportInput = {
  business: { name: 'Test Shop', legalName: 'Test Shop (Pvt) Ltd', taxId: '123456789-7000', brn: 'PV 99' },
  entryNumber: 'CLS-1',
  closedAt: new Date('2026-01-01T20:00:00'),
  summary: { totalSales: 100, totalReturns: 0, netSales: 100, totalTransactions: 1, totalVariance: 0 },
  tenders: [{ method: 'cash', expected: 100, actual: 100, variance: 0 }],
  logo: { width: 16, height: 2, data: bytesToBase64(new Uint8Array([0xff, 0x00, 0x00, 0xff])) },
}
for (const pw of [58, 80] as const) {
  const b = buildZReport(mz, { paperWidth: pw })
  check(has(b, 'Test Shop (Pvt) Ltd'), `mobile z ${pw}: legal name`)
  check(has(b, 'VAT/TIN: 123456789-7000'), `mobile z ${pw}: tax id`)
  check(has(b, 'BRN: PV 99'), `mobile z ${pw}: brn`)
  check(idx(b, [0x1d, 0x76, 0x30]) >= 0, `mobile z ${pw}: logo raster`)
}
const mzNoLogo = buildZReport({ ...mz, logo: null }, { paperWidth: 80 })
check(idx(mzNoLogo, [0x1d, 0x76, 0x30]) === -1, 'mobile z: no logo when not given')

console.log(`  ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
