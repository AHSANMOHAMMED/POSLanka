/**
 * L18 — label print setup (pure, no DB, no printing).
 *
 *  - label preview sanitiser keeps the barcode (inline SVG bars, data:image QR) and drops
 *    script / on* handlers / foreignObject / javascript: / CSS expressions
 *  - "exact" raw printing: one graphic per row in ZPL (^GFA), TSPL (BITMAP), EPL (GW) and
 *    ESC/POS (GS v 0) with the right byte widths / heights at 203 / 300 / 600 dpi
 *  - quick layouts never overlap on common rolls; the cost code no longer sits on the header
 *  - per-element tweaks (move / padding / font / bold / hide / numbers size) reach the printed HTML
 *  - stored setup: sanitiser, lock rules (403 non-manager, 409 locked save, lock / unlock)
 *  - fast-text preview cuts text exactly like the ZPL / TSPL encoders
 *
 * Run: npx tsx scripts/tests/l18-label-print-setup.ts
 */
import { renderLabelHtml } from '../../src/lib/labels/label-renderer'
import { sanitizeLabelHtml, isSafeLabelImageSrc } from '../../src/lib/labels/sanitize-label-html'
import {
  applyElementTweaks,
  applyPrintSetupChange,
  buildQuickLayout,
  DEFAULT_PRINT_SETUP,
  elementAt,
  presetFields,
  QUICK_PRESETS,
  sanitizePrintSetup,
  type LabelPrintSetup,
} from '../../src/lib/labels/print-setup'
import { encodeGraphicRows, fitRaster } from '../../src/lib/print/label/graphic'
import { renderDriverRows } from '../../src/lib/print/label/driver-image'
import { encodeLabels, mmToDots } from '../../src/lib/print/label'
import { hriLayout } from '../../src/lib/print/label/barcode-fit'
import { nativeTextFit } from '../../src/lib/print/label/native-text'
import { sanitizeStickerSetup, setupFromPreset, stickerLayout, STICKER_PRESETS } from '../../src/lib/labels/sticker-stock'
import type { LabelElement, LabelItemData, TextElement } from '../../src/lib/labels/types'
import type { PackedRaster } from '../../src/lib/print/escpos/encoder'

let pass = 0
let fail = 0
function check(cond: boolean, msg: string, extra?: unknown) {
  if (cond) pass++
  else {
    fail++
    console.error(`  FAIL: ${msg}${extra !== undefined ? `\n    ${typeof extra === 'string' ? extra.slice(0, 600) : JSON.stringify(extra).slice(0, 600)}` : ''}`)
  }
}

const item: LabelItemData = {
  id: 'i1',
  name: 'Basmathi Rice Premium Long Grain 5kg Bag',
  sku: 'RICE-5KG',
  barcode: '4791234567891',
  sellingPrice: '1500',
  costPrice: '1200',
  brand: null,
  supplier: 'Lanka Foods',
  oemPartNumber: null,
  pluCode: null,
  category: 'Grocery',
  unit: 'pcs',
  weight: null,
  dimensions: null,
  imageUrl: null,
}

const overlap = (a: LabelElement, b: LabelElement) => a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01 && a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01

async function sanitizerTests() {
  const tpl = {
    widthMm: 50,
    heightMm: 30,
    elements: [
      { id: 'bc', type: 'barcode', format: 'code128', dataField: 'item.sku', showText: true, barWidth: 2, x: 2, y: 2, width: 46, height: 12, rotation: 0, zIndex: 1 },
      { id: 'qr', type: 'barcode', format: 'qrcode', dataField: 'item.sku', showText: false, barWidth: 2, x: 2, y: 15, width: 12, height: 12, rotation: 0, zIndex: 1 },
      { id: 'nm', type: 'text', dataField: 'custom', customValue: '<script>alert(1)</script> & "x"', x: 16, y: 16, width: 30, height: 4, rotation: 0, zIndex: 1, fontSize: 8, fontWeight: 'bold', textAlign: 'left', maxLines: 1 },
    ] as LabelElement[],
  }
  const raw = await renderLabelHtml(tpl, item, 'Rs ', 'Shop', '', 203)
  const clean = sanitizeLabelHtml(raw)
  check(/<svg[^>]*viewBox=/.test(clean), 'sanitiser keeps the inline barcode <svg viewBox>', clean)
  check((clean.match(/<rect /g) || []).length > 20, 'sanitiser keeps the bars (<rect>)')
  check(clean.includes('>RICE-5KG</text>'), 'sanitiser keeps the numbers below the bars (<text>)')
  check(/<img src="data:image\/svg\+xml;base64,/.test(clean), 'sanitiser keeps the QR data:image/svg+xml image')
  check(clean.includes('data-el-id="bc"') && clean.includes('data-el-id="nm"'), 'element ids kept for click-to-adjust')
  check(!/<script/i.test(clean) && clean.includes('&lt;script&gt;'), 'user text stays escaped')

  const evil = [
    '<div onclick="alert(1)" style="left:1mm">a</div>',
    '<img src="x" onerror="alert(1)">',
    '<svg onload="alert(1)"><g><rect width="1" height="1"/></g><foreignObject><div>x</div><script>alert(2)</script></foreignObject></svg>',
    '<script>alert(3)</script><style>body{}</style>',
    '<img src="javascript:alert(4)"><img src="data:text/html;base64,PHNjcmlwdD4=">',
    '<a href="javascript:alert(5)">l</a>',
    '<div style="background:url(javascript:alert(6))">s</div><div style="width:expression(alert(7))">e</div>',
    '<iframe src="https://x"></iframe><svg><script>alert(8)</script></svg>',
    '<img src="jav&#x61;script:alert(9)">',
    '<scr<script>ipt>alert(10)</script>',
  ].join('')
  const out = sanitizeLabelHtml(evil)
  check(!/onclick|onerror|onload/i.test(out), 'on* handlers removed', out)
  check(!/<script|alert\(2\)|alert\(3\)|alert\(8\)/i.test(out), 'script tags and content removed', out)
  check(!/foreignObject/i.test(out) && !/<style|<iframe/i.test(out), 'foreignObject / style / iframe removed', out)
  check(!/javascript:|data:text\/html|jav&#x61;script/i.test(out), 'javascript: / data:text urls removed', out)
  check(!/expression\(|url\(/i.test(out), 'dangerous styles removed', out)
  check(/<svg><g><rect width="1" height="1"\/><\/g><\/svg>/.test(out), 'harmless svg kept', out)
  check(out.includes('style="left:1mm"'), 'safe style kept', out)
  check(!/<scr|<a /i.test(out), 'split / unknown tags dropped', out)
  check(isSafeLabelImageSrc('data:image/png;base64,AAAA') && isSafeLabelImageSrc('/uploads/logo.png') && isSafeLabelImageSrc('https://cdn.example/x.png'), 'image sources: png data / path / https allowed')
  check(!isSafeLabelImageSrc('javascript:alert(1)') && !isSafeLabelImageSrc(' JaVaScRiPt:x') && !isSafeLabelImageSrc('data:text/html,<b>x</b>'), 'javascript: / data:text refused')
}

function bitmap(w: number, h: number): PackedRaster {
  const bpr = Math.ceil(w / 8)
  const data = new Uint8Array(bpr * h)
  // a black frame
  for (let x = 0; x < w; x++) {
    data[x >> 3] |= 0x80 >> (x & 7)
    data[(h - 1) * bpr + (x >> 3)] |= 0x80 >> (x & 7)
  }
  return { width: bpr * 8, height: h, data }
}

async function graphicTests() {
  for (const dpi of [203, 300, 600] as const) {
    const W = mmToDots(80, dpi)
    const H = mmToDots(25, dpi)
    const bpr = Math.ceil(W / 8)
    const a = bitmap(W, H)
    const b = bitmap(W, H)
    const input = { rows: [a, a, a, b], widthDots: W, heightDots: H, dpi, widthMm: 80, heightMm: 25 }
    const z = encodeGraphicRows(input, { language: 'zpl', gapMm: 2, darkness: 18 })
    check(z.text.includes(`^PW${W}`) && z.text.includes(`^LL${H}`), `zpl@${dpi}: page ${W}x${H} dots`, z.text)
    check(z.text.includes(`^GFA,${bpr * H},${bpr * H},${bpr},`), `zpl@${dpi}: ^GFA ${bpr} bytes/row x ${H}`, z.text)
    check((z.text.match(/\^XA/g) || []).length === 2 && z.text.includes('^PQ3,0,1,Y') && z.text.includes('^PQ1,0,1,Y'), `zpl@${dpi}: identical rows merged (3 + 1)`)
    check(z.text.includes('~SD18') && !z.text.includes('^A0'), `zpl@${dpi}: darkness, no printer fonts`)
    // hex payload: exactly 2 chars per byte between the header and ^FS
    const zs = new TextDecoder().decode(z.bytes)
    const hex = zs.split(`^GFA,${bpr * H},${bpr * H},${bpr},`)[1].split('^FS')[0]
    check(hex.length === bpr * H * 2 && /^[0-9A-F]+$/.test(hex), `zpl@${dpi}: hex payload ${bpr * H} bytes`, hex.length)
    check(hex.startsWith('FF'), `zpl@${dpi}: 1 = black (frame top row)`)

    const t = encodeGraphicRows(input, { language: 'tspl', gapMm: 3, darkness: 9, speed: 4, direction: 0 })
    check(t.text.includes('SIZE 80 mm,25 mm\r\n') && t.text.includes('GAP 3 mm,0 mm') && t.text.includes('DIRECTION 0,0'), `tspl@${dpi}: SIZE / GAP / DIRECTION`, t.text)
    check(t.text.includes(`BITMAP 0,0,${bpr},${H},0,`) && t.text.includes('PRINT 3,1') && t.text.includes('DENSITY 9') && t.text.includes('SPEED 4'), `tspl@${dpi}: BITMAP ${bpr}x${H}`, t.text)
    check(!t.text.includes('TEXT '), `tspl@${dpi}: no printer fonts`)
    // TSPL BITMAP data is inverted (0 = black): first byte of the frame row is 0x00
    const tb = t.bytes
    const marker = new TextEncoder().encode(`BITMAP 0,0,${bpr},${H},0,`)
    let at = -1
    for (let i = 0; i < tb.length - marker.length && at < 0; i++) if (marker.every((c, k) => tb[i + k] === c)) at = i + marker.length
    check(at > 0 && tb[at] === 0x00 && tb[at + bpr] === 0xff, `tspl@${dpi}: inverted bits (0 = black)`)

    const e = encodeGraphicRows(input, { language: 'epl', gapMm: 2 })
    check(e.text.includes(`q${W}`) && e.text.includes(`Q${H},${mmToDots(2, dpi)}`) && e.text.includes(`GW0,0,${bpr},${H},`) && e.text.includes('P3,1'), `epl@${dpi}: GW ${bpr}x${H}`, e.text)

    const r = encodeGraphicRows(input, { language: 'escpos-raster', gapMm: 2 })
    check((r.text.match(new RegExp(`GS v 0 ${W}x${H}`, 'g')) || []).length === 4, `escpos@${dpi}: 4 rows of ${W}x${H}`)
  }
  // padding bits past the width are cleared
  const odd = fitRaster(bitmap(13, 2), 13, 2)
  check(odd[1] === 0xf8 && odd.length === 4, 'fitRaster clears padding bits', Array.from(odd))

  // exact rows from the real renderer (barcodes on the dot grid) -> graphic sizes = liner x label at the dpi
  const s = setupFromPreset(STICKER_PRESETS.find((p) => p.id === '38x25x2')!, { id: '38x25x2' })
  const tpl = { widthMm: 38, heightMm: 25, elements: buildQuickLayout(38, 25, presetFields('standard')) }
  for (const dpi of [203, 300] as const) {
    const rows = await renderDriverRows(tpl, [{ item, quantity: 3 }], { dpi, widthMm: 38, heightMm: 25, layout: stickerLayout(s) })
    const enc = encodeGraphicRows(rows, { language: 'zpl' })
    const W = mmToDots(80, dpi)
    check(rows.widthDots === W && rows.rows.length === 2, `exact rows @${dpi}: 2 rows, ${W} dots wide`, { w: rows.widthDots, n: rows.rows.length })
    check(enc.text.includes(`^GFA,${Math.ceil(W / 8) * rows.heightDots},`), `exact zpl @${dpi}: graphic of the whole liner`)
  }
}

async function layoutTests() {
  for (const [w, h] of [
    [38, 25],
    [50, 25],
    [50, 30],
    [32, 25],
    [100, 50],
  ] as const) {
    for (const p of QUICK_PRESETS) {
      const els = buildQuickLayout(w, h, presetFields(p.id))
      let ok = true
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) if (overlap(els[i], els[j])) ok = false
      check(ok, `quick layout "${p.name}" ${w}x${h}: no overlapping parts`, els.map((e) => `${e.id} ${e.x},${e.y} ${e.width}x${e.height}`))
      check(els.every((e) => e.x >= 0 && e.y >= 0 && e.x + e.width <= w + 0.01 && e.y + e.height <= h + 0.01), `quick layout "${p.name}" ${w}x${h}: inside the label`)
    }
  }
  const all = buildQuickLayout(38, 25, presetFields('all'))
  const pc = all.find((e) => e.id === 'dyn-pricecode')!
  const head = all.filter((e) => e.id === 'dyn-company' || e.id === 'dyn-vendor')
  check(!!pc && head.every((hd) => !overlap(hd, pc)), 'cost code no longer overlaps the store / vendor header')

  // Tweaks reach the printed HTML
  const base = buildQuickLayout(50, 30, presetFields('standard'))
  const name = base.find((e) => e.id === 'dyn-name') as TextElement
  const tweaked = applyElementTweaks(base, {
    'dyn-name': { dx: 1.5, dy: -0.5, font: 2, bold: false },
    'dyn-sku': { hidden: true },
    'dyn-price': { pad: 0.5 },
    'dyn-barcode': { font: 1.5, showText: true, dh: -1 },
  })
  const html = await renderLabelHtml({ widthMm: 50, heightMm: 30, elements: tweaked }, item, 'Rs ', 'Shop', '', 203)
  const tn = tweaked.find((e) => e.id === 'dyn-name') as TextElement
  check(tn.x === Math.round((name.x + 1.5) * 100) / 100 && tn.y === Math.round((name.y - 0.5) * 100) / 100, 'tweak moves the element', tn)
  check(html.includes(`data-el-id="dyn-name" style="position:absolute;left:${tn.x}mm;top:${tn.y}mm;`), 'moved position is in the rendered HTML', html.slice(0, 400))
  check(html.includes(`font-size:${name.fontSize + 2}pt;font-weight:normal`), 'font size + weight in the rendered HTML')
  check(!html.includes('data-el-id="dyn-sku"'), 'hidden element is not printed')
  const price = base.find((e) => e.id === 'dyn-price')!
  const tp = tweaked.find((e) => e.id === 'dyn-price')!
  check(tp.x === price.x + 0.5 && tp.width === price.width - 1 && tp.height === price.height - 1, 'padding shrinks the box on every side', tp)
  const tb = tweaked.find((e) => e.id === 'dyn-barcode')
  check(tb?.type === 'barcode' && tb.textSizePt === 7.5, 'numbers below bars size tweak', tb)
  const fs = Math.round((7.5 * 203) / 72)
  check(html.includes(`font-size="${fs}"`), `numbers below bars rendered at ${fs} dots`)
  check(hriLayout(203).band === 21 && hriLayout(203, 10).font === 28 && hriLayout(203, 10).band >= 32, 'hriLayout default / own size')
  check(elementAt(base, name.x + 1, name.y + 1)?.id === 'dyn-name' && elementAt(base, 0.2, 0.2) === null, 'click hit-test finds the element under the pointer')
}

function setupTests() {
  const s = sanitizePrintSetup({
    printer: { brand: 'xprinter', language: 'tspl', dpi: 300, darkness: 99, speed: '3', renderMode: 'fast' },
    media: { labelWidthMm: 38, labelHeightMm: 25, rowGapMm: 2, columns: 9, columnGapMm: 2, marginLeftMm: 1, offsetXMm: 0, offsetYMm: -0.5 },
    chrome: { pageSize: 'A4', noGapSensing: true, rowGapMm: 2.5, offsetYMm: 1 },
    layout: {
      templateId: 'preset-retail-38x25-barcode-2up',
      preset: 'vendor',
      presets: { vendor: { fields: { ...presetFields('vendor'), showSku: false }, tweaks: { 'dyn-name': { dx: 1, evil: 'x' }, __proto__: { dx: 1 } } }, bogus: { fields: {} } },
      templateTweaks: { 'abc-123': { bc: { hidden: true } }, 'bad key!': { a: { dx: 1 } } },
    },
    locked: false,
    lockedBy: 'someone',
  })
  check(s.printer.brand === 'xprinter' && s.printer.language === 'tspl' && s.printer.dpi === 300 && s.printer.darkness === 30 && s.printer.speed === 3 && s.printer.renderMode === 'fast', 'printer settings sanitised', s.printer)
  check(s.media?.columns === 4 && s.media.offsetYMm === -0.5, 'media clamped', s.media)
  check(s.chrome.pageSize === 'A4' && s.chrome.noGapSensing && s.chrome.rowGapMm === 2.5, 'chrome options kept')
  check(s.layout.preset === 'vendor' && s.layout.presets.vendor?.fields?.showSku === false && s.layout.presets.vendor.tweaks?.['dyn-name']?.dx === 1, 'per-preset fields + tweaks kept')
  check(!('bogus' in s.layout.presets) && !('evil' in (s.layout.presets.vendor?.tweaks?.['dyn-name'] || {})), 'unknown presets / tweak keys dropped')
  check(!!s.layout.templateTweaks['abc-123']?.bc?.hidden && !('bad key!' in s.layout.templateTweaks), 'template tweaks keyed by safe ids only')
  check(s.lockedBy === null, 'lock stamp only kept while locked')
  check(sanitizePrintSetup(null).printer.dpi === null && sanitizePrintSetup(undefined).layout.preset === 'custom', 'empty -> defaults')
  check(sanitizeStickerSetup({ dpi: 600 }).dpi === 600, 'sticker setup keeps 600 dpi')

  const mgr = { canManage: true, name: 'Owner A', now: new Date('2026-11-04T10:00:00Z') }
  const staff = { canManage: false, name: 'Cashier' }
  const r1 = applyPrintSetupChange(null, s, 'save', staff)
  check(r1.status === 403, 'non-manager cannot save the shop setup (403)')
  const r2 = applyPrintSetupChange(null, s, 'lock', mgr)
  check(r2.status === 200 && 'setup' in r2 && r2.setup.locked && r2.setup.lockedBy === 'Owner A' && r2.setup.lockedAt === '2026-11-04T10:00:00.000Z', 'manager locks: stamped', r2)
  const lockedSetup = (r2 as { setup: LabelPrintSetup }).setup
  const changed = { ...lockedSetup, printer: { ...lockedSetup.printer, dpi: 203 } }
  check(applyPrintSetupChange(lockedSetup, changed, 'save', mgr).status === 409, 'locked setup: manager save of a change -> 409')
  check(applyPrintSetupChange(lockedSetup, changed, 'save', staff).status === 403, 'locked setup: non-manager -> 403')
  check(applyPrintSetupChange(lockedSetup, changed, 'unlock', staff).status === 403, 'non-manager cannot unlock (403)')
  const same = applyPrintSetupChange(lockedSetup, { ...lockedSetup, lockedBy: 'x' }, 'save', mgr)
  check(same.status === 200 && 'setup' in same && same.setup.locked && same.setup.lockedBy === 'Owner A', 'locked + unchanged save is a no-op (200, still locked)')
  const relock = applyPrintSetupChange(lockedSetup, changed, 'lock', mgr)
  check(relock.status === 200 && 'setup' in relock && relock.setup.printer.dpi === 300, 'lock on a locked setup keeps the locked values')
  const un = applyPrintSetupChange(lockedSetup, undefined, 'unlock', mgr)
  check(un.status === 200 && 'setup' in un && !un.setup.locked && un.setup.lockedBy === null && un.setup.printer.dpi === 300, 'unlock keeps the values, clears the lock')
  const saved = applyPrintSetupChange(DEFAULT_PRINT_SETUP, { ...s, locked: true }, 'save', mgr)
  check(saved.status === 200 && 'setup' in saved && !saved.setup.locked, 'save cannot lock by itself')
}

async function nativeTextTests() {
  const el: TextElement = { id: 'n', type: 'text', dataField: 'item.name', x: 1, y: 1, width: 36, height: 4, rotation: 0, zIndex: 1, fontSize: 8, fontWeight: 'bold', textAlign: 'center', maxLines: 1 }
  const tpl = { widthMm: 38, heightMm: 25, elements: [el] }
  const z = await encodeLabels(tpl, [{ item, quantity: 1 }], { language: 'zpl', dpi: 203 })
  const zCut = nativeTextFit('zpl', 203)(el, item.name)
  check(zCut.length < item.name.length && z.text.includes(`^FD${zCut}^FS`), 'fast-text preview cuts like the ZPL encoder', { zCut, text: z.text })
  const t = await encodeLabels(tpl, [{ item, quantity: 1 }], { language: 'tspl', dpi: 203 })
  const tCut = nativeTextFit('tspl', 203)(el, item.name)
  check(t.text.includes(`"${tCut}"`), 'fast-text preview cuts like the TSPL encoder', { tCut, text: t.text })
}

async function main() {
  console.log('L18 label print setup')
  await sanitizerTests()
  await graphicTests()
  await layoutTests()
  setupTests()
  await nativeTextTests()
  console.log(`  ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
