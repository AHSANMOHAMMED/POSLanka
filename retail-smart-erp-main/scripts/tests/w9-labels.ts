/**
 * W9 raw label encoder tests (TSPL / ZPL / EPL / ESC/POS raster).
 * Run: npx tsx scripts/tests/w9-labels.ts
 */
import { encodeLabels, mmToDots, labelTestTemplate, type LabelTemplateLike } from '../../src/lib/print/label'
import type { LabelItemData } from '../../src/lib/labels/types'

let pass = 0
let fail = 0
function check(cond: boolean, msg: string, extra?: string) {
  if (cond) pass++
  else {
    fail++
    console.error(`  FAIL: ${msg}${extra ? `\n${extra}` : ''}`)
  }
}
const has = (text: string, line: string, label: string) => check(text.includes(line), `${label}: contains ${JSON.stringify(line)}`, text)

const template: LabelTemplateLike = {
  widthMm: 50,
  heightMm: 30,
  elements: [
    { id: 'name', type: 'text', dataField: 'item.name', x: 2, y: 1, width: 46, height: 5, rotation: 0, zIndex: 1, fontSize: 10, fontWeight: 'bold', textAlign: 'center', maxLines: 1 },
    { id: 'c128', type: 'barcode', format: 'code128', dataField: 'item.sku', showText: true, barWidth: 2, x: 2, y: 7, width: 30, height: 10, rotation: 0, zIndex: 1 },
    { id: 'ean', type: 'barcode', format: 'ean13', dataField: 'item.barcode', showText: true, barWidth: 2, x: 2, y: 18, width: 30, height: 11, rotation: 0, zIndex: 1 },
    { id: 'qr', type: 'barcode', format: 'qrcode', dataField: 'item.sku', showText: false, barWidth: 2, x: 34, y: 8, width: 14, height: 14, rotation: 0, zIndex: 1 },
    { id: 'img', type: 'image', source: 'logo', x: 34, y: 23, width: 6, height: 6, rotation: 0, zIndex: 1 },
  ],
}

const item: LabelItemData = {
  id: 'i1',
  name: 'Rice "Keeri" 5kg',
  sku: 'RICE-5KG',
  barcode: '4791234567891', // valid EAN-13 (check digit 1)
  sellingPrice: '1500',
  costPrice: '1200',
  brand: null,
  oemPartNumber: null,
  pluCode: null,
  category: null,
  unit: 'pcs',
  weight: null,
  dimensions: null,
  imageUrl: null,
}

async function main() {
  console.log('W9 label encoder tests')

  for (const dpi of [203, 300] as const) {
    const W = mmToDots(50, dpi)
    const H = mmToDots(30, dpi)
    check(W === (dpi === 203 ? 400 : 591), `mmToDots 50mm @${dpi}`)
    check(H === (dpi === 203 ? 240 : 354), `mmToDots 30mm @${dpi}`)

    // ── TSPL
    const t = await encodeLabels(template, [{ item, quantity: 3 }], { language: 'tspl', dpi, copies: 2, gapMm: 2 })
    const tl = t.text
    has(tl, 'SIZE 50 mm,30 mm\r\n', `tspl@${dpi}`)
    has(tl, 'GAP 2 mm,0 mm\r\n', `tspl@${dpi}`)
    has(tl, 'DIRECTION 1,0\r\n', `tspl@${dpi}`)
    has(tl, 'CLS\r\n', `tspl@${dpi}`)
    check(/TEXT \d+,\d+,"\d",0,\d+,\d+,"Rice \\\["\]Keeri\\\["\]( 5k(g)?)?"\r\n/.test(tl), `tspl@${dpi}: TEXT with escaped quotes`, tl)
    check(new RegExp(`BARCODE \\d+,${mmToDots(7, dpi)},"128",\\d+,1,0,\\d+,\\d+,"RICE-5KG"`).test(tl), `tspl@${dpi}: BARCODE 128`, tl)
    check(new RegExp(`BARCODE \\d+,${mmToDots(18, dpi)},"EAN13",\\d+,1,0,\\d+,\\d+,"479123456789"`).test(tl), `tspl@${dpi}: BARCODE EAN13 (12 digits)`, tl)
    check(new RegExp(`QRCODE ${mmToDots(34, dpi)},${mmToDots(8, dpi)},M,\\d+,A,0,"RICE-5KG"`).test(tl), `tspl@${dpi}: QRCODE`, tl)
    has(tl, 'PRINT 6,1\r\n', `tspl@${dpi} (qty 3 x copies 2)`)
    check(t.warnings.some((w) => w.includes('Image img skipped')), `tspl@${dpi}: image without rasterizer -> warning`)
    check(t.bytes.length === tl.length, `tspl@${dpi}: bytes match ASCII text`)

    // TSPL bitmap with rasterizer (image)
    const withImg = await encodeLabels(template, [item], {
      language: 'tspl',
      dpi,
      rasterizeElement: async (_el, c) => ({ width: 16, height: 2, data: new Uint8Array([0xff, 0x00, 0x0f, 0xf0]) }),
    })
    const bmPrefix = `BITMAP ${mmToDots(34, dpi)},${mmToDots(23, dpi)},2,2,0,`
    const idx = indexOfAscii(withImg.bytes, bmPrefix)
    check(idx >= 0, `tspl@${dpi}: BITMAP command`)
    const payload = withImg.bytes.slice(idx + bmPrefix.length, idx + bmPrefix.length + 4)
    check(eq(payload, [0x00, 0xff, 0xf0, 0x0f]), `tspl@${dpi}: BITMAP payload inverted (0 = black)`)

    // ── ZPL
    const z = await encodeLabels(template, [{ item, quantity: 2 }], { language: 'zpl', dpi })
    const zl = z.text
    has(zl, '^XA\n', `zpl@${dpi}`)
    has(zl, `^PW${W}\n`, `zpl@${dpi}`)
    has(zl, `^LL${H}\n`, `zpl@${dpi}`)
    check(new RegExp(`\\^FO${mmToDots(2, dpi)},${mmToDots(1, dpi)}\\^A0N,\\d+,\\d+\\^FB${mmToDots(46, dpi)},1,0,C,0\\^FH\\\\\\^FDRice "Keeri" 5kg\\^FS`).test(zl), `zpl@${dpi}: ^FO ^A0N ^FB ^FD text`, zl)
    check(/\^BY\d+,3\.0,\d+\^FO\d+,\d+\^BCN,\d+,Y,N,N(,A)?\^FDRICE-5KG\^FS/.test(zl), `zpl@${dpi}: ^BY + ^BC code128`, zl)
    check(/\^BEN,\d+,Y,N\^FD479123456789\^FS/.test(zl), `zpl@${dpi}: ^BE ean13`, zl)
    check(/\^BQN,2,\d+\^FH\\\^FDMA,RICE-5KG\^FS/.test(zl), `zpl@${dpi}: ^BQN qr`, zl)
    has(zl, '^PQ2,0,1,Y\n', `zpl@${dpi}`)
    has(zl, '^XZ\n', `zpl@${dpi}`)
    const zImg = await encodeLabels(template, [item], {
      language: 'zpl',
      dpi,
      rasterizeElement: async () => ({ width: 16, height: 2, data: new Uint8Array([0xff, 0x00, 0x0f, 0xf0]) }),
    })
    has(zImg.text, '^GFA,4,4,2,FF000FF0^FS', `zpl@${dpi}: ^GFA image`)

    // ── EPL
    const e = await encodeLabels(template, [item], { language: 'epl', dpi, gapMm: 3 })
    const el = e.text
    has(el, `q${W}\r\n`, `epl@${dpi}`)
    has(el, `Q${H},${mmToDots(3, dpi)}\r\n`, `epl@${dpi}`)
    has(el, 'N\r\n', `epl@${dpi}`)
    check(/A\d+,\d+,0,\d,\d+,\d+,N,"Rice \\"Keeri\\" 5kg"\r\n/.test(el), `epl@${dpi}: A text`, el)
    check(/B\d+,\d+,0,1,\d+,\d+,\d+,B,"RICE-5KG"\r\n/.test(el), `epl@${dpi}: B code128`, el)
    check(/B\d+,\d+,0,E30,\d+,\d+,\d+,B,"479123456789"\r\n/.test(el), `epl@${dpi}: B EAN13`, el)
    check(/b\d+,\d+,Q,m2,s\d+,eM,"RICE-5KG"\r\n/.test(el), `epl@${dpi}: b QR`, el)
    has(el, 'P1,1\r\n', `epl@${dpi}`)

    // ── ESC/POS raster
    const r = await encodeLabels(template, [{ item, quantity: 2 }], {
      language: 'escpos-raster',
      dpi,
      rasterizeLabel: async (_t, _i, c) => ({ width: Math.ceil(c.widthDots / 8) * 8, height: c.heightDots, data: new Uint8Array(Math.ceil(c.widthDots / 8) * c.heightDots) }),
    })
    const bpr = Math.ceil(W / 8)
    const gsv = [0x1d, 0x76, 0x30, 0, bpr & 0xff, bpr >> 8, H & 0xff, H >> 8]
    check(countSeq(r.bytes, gsv) === 2, `escpos-raster@${dpi}: 2 x GS v 0 ${bpr}x${H}`)
    check(r.bytes[0] === 0x1b && r.bytes[1] === 0x40, `escpos-raster@${dpi}: ESC @ init`)
    const rNo = await encodeLabels(template, [item], { language: 'escpos-raster', dpi })
    check(rNo.bytes.length === 0 && rNo.warnings.length === 1, `escpos-raster@${dpi}: no rasterizer -> warning`)
  }

  // Invalid EAN data skipped with a warning
  const bad = await encodeLabels(template, [{ ...item, barcode: 'ABC' }], { language: 'zpl', dpi: 203 })
  check(bad.warnings.some((w) => w.includes('EAN-13')), 'invalid EAN-13 data -> warning')
  check(!bad.text.includes('^BEN'), 'invalid EAN-13 not encoded')

  // ZPL escaping
  const esc = await encodeLabels(
    { widthMm: 40, heightMm: 20, elements: [{ id: 't', type: 'text', dataField: 'custom', customValue: 'A^B~C\\D', x: 0, y: 0, width: 40, height: 5, rotation: 0, zIndex: 0, fontSize: 8, fontWeight: 'normal', textAlign: 'left', maxLines: 1 }] },
    [null as unknown as LabelItemData],
    { language: 'zpl', dpi: 203 }
  )
  has(esc.text, '^FDA\\5EB\\7EC\\5CD^FS', 'zpl escaping of ^ ~ \\')

  // test label template encodes in all languages
  for (const language of ['tspl', 'zpl', 'epl'] as const) {
    const t = await encodeLabels(labelTestTemplate(50, 30), [null as unknown as LabelItemData], { language, dpi: 203 })
    check(t.bytes.length > 50 && t.warnings.length === 0, `test label encodes in ${language}`, t.warnings.join('; '))
  }

  // snapshot print (for humans)
  const snap = await encodeLabels(template, [item], { language: 'tspl', dpi: 203 })
  console.log('--- TSPL snapshot @203 ---\n' + snap.text.trim())

  console.log(`  ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

function eq(a: Uint8Array, b: number[]) {
  return a.length === b.length && b.every((v, i) => a[i] === v)
}
function indexOfAscii(hay: Uint8Array, s: string) {
  const needle = Array.from(s).map((c) => c.charCodeAt(0))
  return indexOfSeq(hay, needle)
}
function indexOfSeq(hay: Uint8Array, needle: number[], from = 0) {
  outer: for (let i = from; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}
function countSeq(hay: Uint8Array, needle: number[]) {
  let n = 0
  let i = indexOfSeq(hay, needle)
  while (i >= 0) {
    n++
    i = indexOfSeq(hay, needle, i + 1)
  }
  return n
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
