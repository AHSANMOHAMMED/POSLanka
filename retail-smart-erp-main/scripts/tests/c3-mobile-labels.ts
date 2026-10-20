/**
 * C3: mobile label encoders (apps/mobile/src/lib/label) must produce byte-identical
 * output to the web encoders (src/lib/print/label) for TSPL / ZPL / EPL.
 * Image elements are skipped (with the same warning) on both sides; ESC/POS
 * raster is refused on mobile with a clear warning.
 * Run: npx tsx scripts/tests/c3-mobile-labels.ts
 */
import * as web from '../../src/lib/print/label'
import * as mobile from '../../apps/mobile/src/lib/label'

let pass = 0
let fail = 0
function check(cond: boolean, msg: string, extra?: string) {
  if (cond) pass++
  else {
    fail++
    console.error(`  FAIL: ${msg}${extra ? `\n${extra}` : ''}`)
  }
}

type AnyTemplate = web.LabelTemplateLike

const item = {
  id: 'i1',
  name: 'Rice "Keeri" Samba premium quality 5kg bag',
  sku: 'RICE-5KG',
  barcode: '4791234567892',
  sellingPrice: '1500',
  costPrice: '1234.5',
  brand: 'Araliya',
  oemPartNumber: null,
  pluCode: '4011',
  category: 'Grocery',
  unit: 'pcs',
  weight: '5 kg',
  dimensions: null,
  imageUrl: null,
}
const item2 = { ...item, id: 'i2', name: 'Dhal ^~\\ මයිසූර් 1kg', sku: 'DHAL-1', barcode: '96385074', sellingPrice: '420.5', costPrice: '380' }
const badItem = { ...item, id: 'i3', name: 'Bad codes', barcode: 'ABC', sku: 'lower case sku' }

const text = (id: string, extra: Record<string, unknown>) => ({ id, type: 'text', dataField: 'item.name', x: 2, y: 1, width: 46, height: 6, rotation: 0, zIndex: 1, fontSize: 10, fontWeight: 'normal', textAlign: 'left', maxLines: 1, ...extra })
const bc = (id: string, format: string, extra: Record<string, unknown> = {}) => ({ id, type: 'barcode', format, dataField: 'item.barcode', showText: true, barWidth: 2, x: 2, y: 8, width: 40, height: 12, rotation: 0, zIndex: 2, ...extra })
const shape = (id: string, s: string, extra: Record<string, unknown> = {}) => ({ id, type: 'shape', shape: s, x: 1, y: 1, width: 48, height: 28, rotation: 0, zIndex: 0, borderWidth: 2, borderColor: '#000', borderStyle: 'solid', ...extra })

const templates: Array<{ name: string; t: AnyTemplate }> = [
  {
    name: 'retail 50x30',
    t: {
      widthMm: 50,
      heightMm: 30,
      elements: [
        text('name', { fontWeight: 'bold', textAlign: 'center', maxLines: 2 }),
        text('price', { dataField: 'item.sellingPrice', isCurrency: true, prefix: 'Price ', suffix: ' only', textAlign: 'right', y: 24, fontSize: 12 }),
        bc('ean', 'ean13'),
        bc('qr', 'qrcode', { dataField: 'item.sku', x: 34, y: 8, width: 14, height: 14, showText: false }),
        shape('line', 'line', { x: 1, y: 22, width: 48, height: 1 }),
        shape('vline', 'line', { x: 33, y: 7, width: 0.5, height: 15, borderWidth: 1 }),
        { id: 'img', type: 'image', source: 'logo', x: 40, y: 23, width: 6, height: 6, rotation: 0, zIndex: 3 },
      ],
    } as unknown as AnyTemplate,
  },
  {
    name: 'all symbologies 100x70',
    t: {
      widthMm: '100',
      heightMm: '70',
      elements: [
        shape('box', 'rectangle', { width: 98, height: 68 }),
        shape('rbox', 'rounded-rectangle', { x: 5, y: 5, width: 30, height: 20, cornerRadius: 3 }),
        shape('fill', 'rectangle', { x: 60, y: 60, width: 10, height: 5, fillColor: '#000000' }),
        shape('ell', 'ellipse', { x: 75, y: 55, width: 10, height: 10 }),
        shape('ellf', 'ellipse', { x: 86, y: 55, width: 8, height: 8, fillColor: 'black' }),
        bc('c128', 'code128', { dataField: 'item.sku', x: 2, y: 2, width: 45 }),
        bc('c128n', 'code128', { dataField: 'custom', customValue: '0123456789', x: 50, y: 2, width: 45 }),
        bc('ean8', 'ean8', { dataField: 'custom', customValue: '96385074', x: 2, y: 16 }),
        bc('upca', 'upca', { dataField: 'custom', customValue: '036000291452', x: 50, y: 16 }),
        bc('c39', 'code39', { dataField: 'item.sku', x: 2, y: 30, showText: false }),
        bc('c93', 'code93', { dataField: 'item.sku', x: 50, y: 30 }),
        bc('coda', 'codabar', { dataField: 'custom', customValue: 'a12345b', x: 2, y: 44 }),
        bc('itf', 'itf14', { dataField: 'custom', customValue: '1540014128876', x: 50, y: 44 }),
        bc('dm', 'datamatrix', { dataField: 'item.sku', x: 2, y: 56, width: 12, height: 12 }),
        bc('pdf', 'pdf417', { dataField: 'item.sku', x: 16, y: 56, width: 40, height: 12 }),
        bc('qr2', 'qrcode', { dataField: 'custom', customValue: 'https://poslanka.lk/i/RICE-5KG?ref=label&utm=mobile-parity-test', x: 80, y: 2, width: 18, height: 18 }),
      ],
    } as unknown as AnyTemplate,
  },
  {
    name: 'rotations + fields 58x40',
    t: {
      widthMm: 58,
      heightMm: 40,
      elements: [
        text('r90', { rotation: 90, x: 50, y: 2, width: 30, height: 5 }),
        text('r180', { rotation: 180, dataField: 'item.brand' }),
        text('r270', { rotation: 270, dataField: 'item.category', x: 2, y: 30 }),
        text('r45', { rotation: 45, dataField: 'item.unit', y: 20 }),
        text('pc', { dataField: 'item.priceCode', y: 10 }),
        text('dc', { dataField: 'item.discountCode', y: 14, textAlign: 'center', fontSize: 6 }),
        text('cost', { dataField: 'item.costPrice', y: 18, fontSize: 30, maxLines: 3, height: 20 }),
        text('ten', { dataField: 'tenant.name', y: 30, fontSize: 4 }),
        text('empty', { dataField: 'item.dimensions', y: 33 }),
        bc('r90bc', 'code128', { dataField: 'item.sku', rotation: 90, x: 40, y: 5, width: 30, height: 10 }),
        bc('r90qr', 'qrcode', { dataField: 'item.name', rotation: 270, x: 40, y: 20, width: 15, height: 15 }),
      ],
    } as unknown as AnyTemplate,
  },
  { name: 'test label 50x30', t: web.labelTestTemplate(50, 30) },
  { name: 'test label 38x25', t: web.labelTestTemplate(38, 25) },
]

const optionSets: Array<Partial<web.EncodeLabelOptions>> = [
  {},
  { copies: 2, gapMm: 3, currencySymbol: 'Rs. ', tenantName: 'Lanka Stores', codeWord: 'MAKEPROFIT' },
  { darkness: 12, speed: 4, widthMm: 52, heightMm: 32.5, currencySymbol: 'LKR ' },
]
const itemSets: Array<{ name: string; items: unknown[] }> = [
  { name: 'items', items: [{ item, quantity: 3 }, { item: item2, quantity: 1 }, badItem] },
  { name: 'designer (null item)', items: [null] },
]

async function main() {
  console.log('C3 mobile label parity tests')
  const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')
  for (const language of ['tspl', 'zpl', 'epl'] as const) {
    for (const dpi of [203, 300] as const) {
      for (const { name, t } of templates) {
        for (const opts of optionSets) {
          for (const set of itemSets) {
            const o = { language, dpi, ...opts }
            const w = await web.encodeLabels(t, set.items as never, o)
            const m = await mobile.encodeLabels(t as never, set.items as never, o as mobile.EncodeLabelOptions)
            const label = `${language}@${dpi} ${name} ${JSON.stringify(opts)} ${set.name}`
            const identical = w.bytes.length === m.bytes.length && hex(w.bytes) === hex(m.bytes)
            check(identical, `${label}: bytes identical`, identical ? undefined : `web:\n${w.text}\nmobile:\n${m.text}`)
            check(w.text === m.text, `${label}: text identical`)
            check(JSON.stringify(w.warnings) === JSON.stringify(m.warnings), `${label}: warnings identical`, `${w.warnings}\n${m.warnings}`)
            check(m.bytes.length > 0, `${label}: non-empty`)
          }
        }
      }
    }
  }

  // Image elements are skipped with a warning on mobile
  const img = await mobile.encodeLabels(templates[0].t as never, [item], { language: 'tspl', dpi: 203 })
  check(img.warnings.some((x) => x.includes('Image img skipped')), 'mobile: image element skipped with a warning')

  // ESC/POS raster is refused on mobile with a clear message
  const r = await mobile.encodeLabels(templates[0].t as never, [item], { language: 'escpos-raster', dpi: 203 })
  check(r.bytes.length === 0 && r.warnings.length === 1 && /not supported on mobile/.test(r.warnings[0]), 'mobile: escpos-raster refused')

  // test template helper identical
  check(JSON.stringify(mobile.labelTestTemplate(40, 30)) === JSON.stringify(web.labelTestTemplate(40, 30)), 'labelTestTemplate identical')

  // UTF-8 field data (ZPL ^CI28) identical incl. Sinhala
  const z = await mobile.encodeLabels(templates[0].t as never, [item2], { language: 'zpl', dpi: 203 })
  check(z.text.includes('මයිසූර්') && z.text.includes('\\5E\\7E\\5C'), 'mobile zpl: UTF-8 + escapes')

  console.log(`  ${pass} passed, ${fail} failed`)
  console.log(fail ? 'FAIL' : 'PASS')
  if (fail) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
