/**
 * L6: raw label roll output (TSPL / ZPL) for multi-across sticker rolls.
 *
 * Byte-level assertions: SIZE / GAP / ^PW / ^LL / ^MNY, one PRINT (or ^XA
 * block) per physical row, columns strictly left -> right, rows top -> bottom,
 * partial last row, quantities, native barcode commands (no rasters) with an
 * integer module >= 2 dots @203 / 3 dots @300 and quiet zones inside the
 * label. Then a simulated print head: every BARCODE / ^BY..^FD command is
 * drawn on a dot bitmap of the row (liner width x label height) and decoded
 * with zxing-cpp per column, in print order (needs L6_PYTHON or python3 with
 * zxing-cpp + pillow; skipped otherwise).
 *
 * Run: npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/l6-label-roll.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import * as bwipjs from 'bwip-js/browser'
import { encodeLabels, mmToDots, packLabelRows, type LabelPrintItem } from '../../src/lib/print/label'
import { code128SymbolCount, guessLabelPrinter, isLikelyLabelPrinter, isValidGtin, planLinear, preflightLabels } from '../../src/lib/print/label'
import { setupFromPreset, stickerLayout, STICKER_PRESETS, type StickerSetup } from '../../src/lib/labels/sticker-stock'
import type { LabelItemData, LabelTemplate } from '../../src/lib/labels/types'
import { ITEMS, check, decodeImages, decoderPython, expectedValue, finish, lookupFinds, mkItem, standardTemplate, tmpDir, writePgm } from './l6-shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bwip = bwipjs as any

function preset(id: string, patch: Partial<StickerSetup> = {}): StickerSetup {
  return setupFromPreset(STICKER_PRESETS.find((x) => x.id === id)!, { id, ...patch })
}

const q1 = (list: LabelItemData[]): LabelPrintItem[] => list.map((item) => ({ item, quantity: 1 }))

async function encode(language: 'tspl' | 'zpl', template: LabelTemplate, items: LabelPrintItem[], s: StickerSetup, copies = 1) {
  return encodeLabels(template, items, {
    language,
    dpi: s.dpi,
    copies,
    gapMm: s.rowGapMm,
    widthMm: s.labelWidthMm,
    heightMm: s.labelHeightMm,
    layout: stickerLayout(s),
  })
}

interface Bc {
  x: number
  y: number
  h: number
  module: number
  sym: string
  data: string
}
interface Row {
  count: number
  barcodes: Bc[]
  texts: { x: number; y: number; w: number; h: number }[]
}

const TSPL_FONT: Record<string, [number, number]> = { '1': [8, 12], '2': [12, 20], '3': [16, 24], '4': [24, 32], '5': [32, 48] }

function parseTspl(text: string): { size: [number, number]; gap: number; rows: Row[] } {
  const size = /SIZE ([\d.]+) mm,([\d.]+) mm/.exec(text)!
  const gap = /GAP ([\d.]+) mm,0 mm/.exec(text)!
  const rows: Row[] = []
  let cur: Row | null = null
  for (const line of text.split('\r\n')) {
    if (line === 'CLS') cur = { count: 0, barcodes: [], texts: [] }
    let m = /^BARCODE (\d+),(\d+),"(\w+)",(\d+),[01],0,(\d+),(\d+),"(.*)"$/.exec(line)
    if (m && cur) cur.barcodes.push({ x: +m[1], y: +m[2], sym: m[3], h: +m[4], module: +m[5], data: m[7] })
    m = /^TEXT (\d+),(\d+),"(\d)",0,(\d+),(\d+),"(.*)"$/.exec(line)
    if (m && cur) {
      const [cw, ch] = TSPL_FONT[m[3]]
      const len = m[6].replace(/\\\["\]/g, '"').length
      cur.texts.push({ x: +m[1], y: +m[2], w: len * cw * +m[4], h: ch * +m[5] })
    }
    m = /^PRINT (\d+),1$/.exec(line)
    if (m && cur) {
      cur.count = +m[1]
      rows.push(cur)
      cur = null
    }
  }
  return { size: [+size[1], +size[2]], gap: +gap[1], rows }
}

function parseZpl(text: string): { pw: number; ll: number; rows: Row[]; mny: boolean } {
  const rows: Row[] = []
  let pw = 0
  let ll = 0
  let mny = true
  for (const block of text.split('^XA').slice(1)) {
    pw = Number(/\^PW(\d+)/.exec(block)?.[1] ?? 0)
    ll = Number(/\^LL(\d+)/.exec(block)?.[1] ?? 0)
    mny = mny && block.includes('^MNY')
    const row: Row = { count: Number(/\^PQ(\d+),0,1,Y/.exec(block)?.[1] ?? 0), barcodes: [], texts: [] }
    for (const m of block.matchAll(/\^BY(\d+),[\d.]+,(\d+)\^FO(\d+),(\d+)\^(BC|BE|BU|B8|B3)[^^]*(\^FH\\)?\^FD([^^]*)\^FS/g)) {
      const data = m[6] ? m[7].replace(/\\([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))) : m[7]
      row.barcodes.push({ module: +m[1], h: +m[2], x: +m[3], y: +m[4], sym: m[5], data })
    }
    rows.push(row)
  }
  return { pw, ll, rows, mny }
}

/** Printer symbology -> bwip-js id + the full data a scanner returns. */
function bwipOf(sym: string, data: string): { bcid: string; text: string } {
  switch (sym) {
    case 'EAN13':
    case 'BE':
      return { bcid: 'ean13', text: data }
    case 'UPCA':
    case 'BU':
      return { bcid: 'upca', text: data }
    case 'EAN8':
    case 'B8':
      return { bcid: 'ean8', text: data }
    case '39':
    case 'B3':
      return { bcid: 'code39', text: data }
    default:
      return { bcid: 'code128', text: data }
  }
}

function symbolModules(b: Bc): number[] {
  const { bcid, text } = bwipOf(b.sym, b.data)
  const sbs = bwip.raw(bcid, text, '')[0].sbs as number[]
  return bcid === 'code39' ? sbs.map((w) => (w > 1 ? 2 : 1)) : sbs // printers use wide = 2 x narrow
}

/** Simulated print head: draw the row's barcodes on a dot bitmap. */
function rasterRow(row: Row, wDots: number, hDots: number): Uint8Array {
  const px = new Uint8Array(wDots * hDots)
  for (const b of row.barcodes) {
    let x = b.x
    symbolModules(b).forEach((w, i) => {
      const dw = w * b.module
      if (i % 2 === 0) for (let yy = b.y; yy < Math.min(hDots, b.y + b.h); yy++) for (let xx = x; xx < Math.min(wDots, x + dw); xx++) px[yy * wDots + xx] = 1
      x += dw
    })
  }
  return px
}

const symbolDots = (b: Bc) => symbolModules(b).reduce((a, c) => a + c, 0) * b.module
const quietModules = (b: Bc) => (['EAN13', 'BE', 'UPCA', 'BU'].includes(b.sym) ? 11 : 10)

interface RollCase {
  name: string
  setup: StickerSetup
  template: LabelTemplate
  items: LabelPrintItem[]
  copies?: number
}

const CASES: RollCase[] = [
  { name: '38x25 2-across, 6 items', setup: preset('38x25x2'), template: standardTemplate(38, 25, 2), items: q1(ITEMS.slice(0, 6)) },
  { name: '38x25 2-across, 7 items (odd)', setup: preset('38x25x2'), template: standardTemplate(38, 25, 2), items: q1(ITEMS) },
  { name: '38x25 2-across, qty 3+2', setup: preset('38x25x2'), template: standardTemplate(38, 25, 2), items: [{ item: ITEMS[1], quantity: 3 }, { item: ITEMS[3], quantity: 2 }] },
  { name: '38x25 2-across, qty 4 (merged rows)', setup: preset('38x25x2'), template: standardTemplate(38, 25, 2), items: [{ item: ITEMS[0], quantity: 4 }] },
  { name: '38x25 1-across, 3 items x2 copies', setup: preset('38x25x1'), template: standardTemplate(38, 25, 1), items: q1(ITEMS.slice(0, 3)), copies: 2 },
  // 32 mm = 256 dots @203: a 9-char mixed SKU (Code 128, 123 modules) cannot fit with quiet zones - asserted separately below
  { name: '32x25 3-across, 7 items', setup: preset('32x25x3'), template: standardTemplate(32, 25, 3), items: q1([ITEMS[0], ITEMS[2], ITEMS[3], ITEMS[4], ITEMS[5], ITEMS[6], ITEMS[0]]) },
  { name: '50x25 1-across, 7 items', setup: preset('50x25x1'), template: standardTemplate(50, 25, 1), items: q1(ITEMS) },
  { name: '50x25 2-across, 5 items', setup: preset('50x25x2'), template: standardTemplate(50, 25, 2), items: q1(ITEMS.slice(0, 5)) },
  { name: '38x25 2-across @300dpi', setup: preset('38x25x2', { dpi: 300 }), template: standardTemplate(38, 25, 2), items: q1(ITEMS.slice(0, 6)) },
]

async function main() {
  console.log('L6 raw label roll (TSPL / ZPL)')
  const py = decoderPython()
  if (!py) console.log('  NOTE: zxing-cpp not available (set L6_PYTHON) - simulated decode skipped')
  const dir = tmpDir('raw')
  let decoded = 0
  const jobs: { file: string; crops: number[][]; expect: (LabelItemData | null)[]; label: string }[] = []

  // ── core helpers
  check(code128SymbolCount('ABC-12345') === 10 && code128SymbolCount('SKU0001') === 8 && code128SymbolCount('2000000000015') === 10, 'Code 128 optimal symbol counts (B/C subsets)')
  check(isValidGtin('4791234567891') && !isValidGtin('4791234567892') && isValidGtin('012345678905'), 'GTIN check digits')

  for (const c of CASES) {
    const s = c.setup
    const seq = packLabelRows(c.items, s.columns, c.copies ?? 1).flatMap((r) => Array.from({ length: r.count }, () => r.cells.map((x) => (x ? x.item : null)))).flat()
    const flat = c.items.flatMap(({ item, quantity }) => Array.from({ length: quantity * (c.copies ?? 1) }, () => item))
    const physRows = Math.ceil(flat.length / s.columns)
    const rollW = s.marginLeftMm * 2 + s.columns * s.labelWidthMm + (s.columns - 1) * s.columnGapMm
    const dpi = s.dpi
    const minM = dpi === 300 ? 3 : 2
    const labelW = mmToDots(s.labelWidthMm, dpi)
    const colX = (k: number) => mmToDots(s.marginLeftMm + s.offsetXMm + k * (s.labelWidthMm + s.columnGapMm), dpi)
    // packing order == flat order (left -> right, top -> bottom, blanks only at the end)
    check(seq.slice(0, flat.length).every((it, i) => it === flat[i]) && seq.slice(flat.length).every((x) => x === null), `${c.name}: labels packed in order, blanks only after the last label`)

    for (const language of ['tspl', 'zpl'] as const) {
      const res = await encode(language, c.template, c.items, s, c.copies)
      const tag = `${c.name} [${language}]`
      check(!res.warnings.some((w) => /too long|no barcode/.test(w)), `${tag}: no unscannable-barcode warnings`, res.warnings.join(' | '))
      check(!/BITMAP|\^GFA/.test(res.text), `${tag}: no raster images (native barcode commands only)`)
      check(!res.text.includes('"1001"') && !res.text.includes('^FD1001^'), `${tag}: no invented placeholder code`)
      let rows: Row[]
      if (language === 'tspl') {
        const t = parseTspl(res.text)
        check(t.size[0] === Math.round(rollW * 100) / 100 && t.size[1] === s.labelHeightMm, `${tag}: SIZE ${rollW} mm,${s.labelHeightMm} mm (full liner x label height)`, `got ${t.size}`)
        check(t.gap === s.rowGapMm, `${tag}: GAP ${s.rowGapMm} mm`)
        check((res.text.match(/^CLS\r$/gm) || []).length === t.rows.length, `${tag}: CLS once per row`)
        check(/DIRECTION [01],0\r\n/.test(res.text) && res.text.includes('REFERENCE 0,0\r\n'), `${tag}: DIRECTION + REFERENCE`)
        rows = t.rows
      } else {
        const z = parseZpl(res.text)
        check(z.pw === mmToDots(rollW, dpi), `${tag}: ^PW${mmToDots(rollW, dpi)} (liner width in dots)`, `got ${z.pw}`)
        check(z.ll === mmToDots(s.labelHeightMm, dpi), `${tag}: ^LL${mmToDots(s.labelHeightMm, dpi)} (label height in dots)`, `got ${z.ll}`)
        check(z.mny && res.text.includes('^LH0,0'), `${tag}: ^MNY gap sensing + ^LH0,0`)
        rows = z.rows
      }
      const printed = rows.reduce((n, r) => n + r.count, 0)
      check(printed === physRows, `${tag}: ${physRows} physical rows printed (sum of PRINT / ^PQ counts)`, `got ${printed}`)
      // Rows expanded by count must reproduce the label sequence, column by column.
      const expanded: Bc[][] = rows.flatMap((r) => Array.from({ length: r.count }, () => r.barcodes))
      expanded.forEach((bcs, r) => {
        for (let k = 0; k < s.columns; k++) {
          const want = flat[r * s.columns + k] ?? null
          const inCol = bcs.filter((b) => b.x >= colX(k) && b.x < colX(k) + labelW)
          if (!want) {
            check(inCol.length === 0, `${tag}: row ${r + 1} col ${k + 1} is blank`)
            continue
          }
          check(inCol.length === 1, `${tag}: row ${r + 1} col ${k + 1} has exactly one barcode`, JSON.stringify(bcs))
          const b = inCol[0]
          if (!b) continue
          const value = expectedValue(want)
          const sentMatches = b.data === value || (['EAN13', 'BE'].includes(b.sym) && b.data === value.slice(0, 12)) || (['UPCA', 'BU'].includes(b.sym) && b.data === value.slice(0, 11))
          check(sentMatches, `${tag}: row ${r + 1} col ${k + 1} encodes ${value}`, `${b.sym} ${b.data}`)
          check(Number.isInteger(b.module) && b.module >= minM, `${tag}: module ${b.module} dots >= ${minM}`)
          const sw = symbolDots(b)
          const qz = quietModules(b) * b.module
          check(b.x - colX(k) >= qz && colX(k) + labelW - (b.x + sw) >= qz, `${tag}: row ${r + 1} col ${k + 1} quiet zones (${qz} dots) inside the label`, `x=${b.x} col=${colX(k)} w=${sw} label=${labelW}`)
          check(b.h >= mmToDots(8, dpi), `${tag}: bars >= 8 mm tall`, `${b.h} dots`)
          if (/^\d{13}$/.test(value) && isValidGtin(value)) check(['EAN13', 'BE'].includes(b.sym), `${tag}: valid EAN-13 ${value} printed as EAN-13`)
          if (/[A-Z-]/.test(value)) check(['128', 'BC'].includes(b.sym), `${tag}: alphanumeric ${value} printed as Code 128`)
        }
      })
      // Text boxes never cut into a barcode's quiet zone (TSPL fonts are fixed-size).
      if (language === 'tspl') {
        for (const r of rows)
          for (const b of r.barcodes) {
            const qz = quietModules(b) * b.module
            const x0 = b.x - qz
            const x1 = b.x + symbolDots(b) + qz
            const hit = r.texts.find((t) => t.x < x1 && t.x + t.w > x0 && t.y < b.y + b.h && t.y + t.h > b.y)
            check(!hit, `${tag}: no text inside barcode ${b.data} area`, JSON.stringify(hit))
          }
      }
      // Simulated print head bitmap per printed row
      if (py) {
        const wD = mmToDots(rollW, dpi)
        const hD = mmToDots(s.labelHeightMm, dpi)
        rows.forEach((r, ri) => {
          const file = path.join(dir, `${c.name.replace(/\W+/g, '_')}-${language}-${ri}.pgm`)
          writePgm(file, wD, hD, rasterRow(r, wD, hD))
          const firstIdx = rows.slice(0, ri).reduce((n, x) => n + x.count, 0) * s.columns
          jobs.push({
            file,
            label: `${tag} row ${ri + 1}`,
            crops: Array.from({ length: s.columns }, (_, k) => [colX(k), 0, labelW, hD]),
            expect: Array.from({ length: s.columns }, (_, k) => flat[firstIdx + k] ?? null),
          })
        })
      }
    }
  }

  // ── The owner's case: 6 items on the 38 x 25 mm 2-across roll = exactly 3 rows, in order
  const six = await encode('tspl', standardTemplate(38, 25, 2), q1(ITEMS.slice(0, 6)), preset('38x25x2'))
  const sixRows = six.text.split('CLS\r\n').slice(1)
  check((six.text.match(/PRINT 1,1\r\n/g) || []).length === 3 && sixRows.length === 3, '6 items on 38x25 2-across: exactly 3 x PRINT 1,1')
  const order = sixRows.map((r) => [...r.matchAll(/BARCODE (\d+),\d+,"\w+",\d+,\d,0,\d+,\d+,"([^"]*)"/g)].sort((a, b) => +a[1] - +b[1]).map((m) => m[2]).join(' | '))
  check(order.join(' || ') === '200000000001 | ABC-12345 || SKU0001 | 479123456789 || 12345678 | 01234567890', '6 items: rows = (1,2) (3,4) (5,6) left -> right', order.join(' || '))
  console.log('  38x25x2, 6 items (TSPL):\n    ' + six.text.trim().split('\r\n').filter((l) => /^(SIZE|GAP|CLS|BARCODE|PRINT)/.test(l)).join('\n    '))

  // ── Zebra 203 vs 300 dpi
  const t38 = standardTemplate(38, 25, 2)
  const z203 = await encode('zpl', t38, q1(ITEMS.slice(0, 2)), preset('38x25x2'))
  const z300 = await encode('zpl', t38, q1(ITEMS.slice(0, 2)), preset('38x25x2', { dpi: 300 }))
  check(z203.text.includes('^PW639\n') && z203.text.includes('^LL200\n'), 'Zebra 203 dpi: ^PW639 ^LL200 (80 x 25 mm = 639.4 x 199.8 dots)')
  check(z300.text.includes('^PW945\n') && z300.text.includes('^LL295\n'), 'Zebra 300 dpi: ^PW945 ^LL295 (80 x 25 mm)')
  const by203 = [...z203.text.matchAll(/\^BY(\d+),/g)].map((m) => +m[1])
  const by300 = [...z300.text.matchAll(/\^BY(\d+),/g)].map((m) => +m[1])
  check(by203.every((m) => m >= 2) && by300.every((m) => m >= 3), `Zebra module widths: 203 dpi ${by203} (>= 0.25 mm), 300 dpi ${by300} (>= 0.254 mm)`)

  // ── symbology / data rules
  const bad = await encodeLabels(
    { widthMm: 50, heightMm: 25, elements: [{ id: 'e', type: 'barcode', format: 'ean13', dataField: 'item.barcode', showText: true, barWidth: 2, x: 2, y: 2, width: 46, height: 14, rotation: 0, zIndex: 1 }] },
    [mkItem('b', 'Bad check digit', '4791234567892', null)],
    { language: 'tspl', dpi: 203 }
  )
  check(/BARCODE \d+,\d+,"128",.*"4791234567892"/.test(bad.text) && bad.warnings.some((w) => /not a valid EAN-13/.test(w)), 'EAN-13 template + wrong check digit -> Code 128 of the exact stored code (scan still finds the item)')
  const none = await encodeLabels(t38, [mkItem('n', 'No codes', null, null)], { language: 'zpl', dpi: 203 })
  check(!/\^BC|\^BE/.test(none.text) && none.warnings.some((w) => /no barcode data/.test(w)), 'item without barcode/SKU: no invented barcode, warning instead')
  const caret = await encodeLabels(t38, [mkItem('c', 'Caret', null, 'A^B~C')], { language: 'zpl', dpi: 203 })
  check(caret.text.includes('^FH\\^FDA\\5EB\\7EC^FS'), 'ZPL: ^ and ~ in a SKU are hex-escaped, not dropped')
  const long = await encodeLabels(standardTemplate(25, 15), [mkItem('l', 'Long', null, 'VERY-LONG-SKU-CODE-0001234')], { language: 'tspl', dpi: 203 })
  check(long.warnings.some((w) => /too long/.test(w)), 'too-long code on a 25 mm label -> warning')
  const pf = preflightLabels(standardTemplate(25, 15), [{ item: mkItem('l', 'Long', null, 'VERY-LONG-SKU-CODE-0001234') }, { item: mkItem('n', 'None', null, null) }, { item: ITEMS[0] }], { dpi: 203 })
  // 25 mm = 200 dots: even EAN-13 (117 modules incl. quiet zones = 234 dots) does not fit
  check(pf.errors === 3 && pf.issues.some((i) => /too long/.test(i.message)) && pf.issues.some((i) => /No barcode/.test(i.message)), 'preflight reports too-long and missing codes before printing', JSON.stringify(pf.issues))
  const w32 = await encode('tspl', standardTemplate(32, 25, 3), q1([ITEMS[1]]), preset('32x25x3'))
  check(w32.warnings.some((w) => /"ABC-12345" is too long for a 32 mm/.test(w)), '9-char mixed SKU on a 32 mm label -> clear "too long" warning')
  const p38 = planLinear('code128', 'ABC-12345', 203, mmToDots(2, 203), mmToDots(34, 203), mmToDots(38, 203))
  check(p38.fits && p38.module === 2, 'ABC-12345 fits a 38 mm label at 2-dot modules with quiet zones')

  // ── printer detection
  const det = (n: string, d?: string) => guessLabelPrinter(n, d)
  check(det('ZDesigner ZD230-203dpi ZPL', 'ZDesigner ZD230-203dpi ZPL').language === 'zpl' && det('ZDesigner ZD230-203dpi ZPL').dpi === 203, 'ZDesigner ZD230 -> ZPL 203')
  check(det('ZDesigner ZD421-300dpi ZPL').dpi === 300, 'ZD421-300dpi -> 300 dpi')
  check(det('ZDesigner LP 2844').language === 'epl', 'LP 2844 -> EPL')
  check(det('Zebra_Technologies_ZTC_ZD230_203dpi_ZPL_ahsan_s_MacBook_Pro', 'ZPL Label Printer').language === 'zpl' && det('Zebra_Technologies_ZTC_ZD421_300dpi_ZPL').dpi === 300, 'CUPS Zebra queue names (macOS / Linux) -> ZPL, dpi from name')
  check(det('Xprinter XP-365B').language === 'tspl' && det('TSC TTP-244 Pro').language === 'tspl' && det('TSC TTP-345').dpi === 300, 'Xprinter / TSC -> TSPL (TTP-345 300 dpi)')
  check(det('DBL Label Printer', 'Label Printer').language === 'tspl' && det('Gprinter GP-1324D').language === 'tspl', 'DBL / Gprinter -> TSPL')
  check(det('Godex G500').language === 'zpl' && !det('Godex G500').confident && !!det('Godex G500').note, 'Godex -> ZPL emulation (flagged to check)')
  check(isLikelyLabelPrinter('ZDesigner GK420t') && isLikelyLabelPrinter('POS-80', 'Xprinter XP-T80') && !isLikelyLabelPrinter('HP LaserJet P1102', 'HP LaserJet P1102') && !isLikelyLabelPrinter('Microsoft Print to PDF'), 'label printer recognition')

  // ── simulated decode
  if (py && jobs.length) {
    const res = decodeImages(py, jobs.map(({ file, crops }) => ({ file, crops })))
    res.forEach((row, j) =>
      row.forEach((cell, k) => {
        const want = jobs[j].expect[k]
        if (!want) return check(cell.dark === 0, `${jobs[j].label} col ${k + 1}: blank`)
        const value = expectedValue(want)
        const ok = cell.text === value || lookupFinds(cell.text, value)
        check(ok, `${jobs[j].label} col ${k + 1}: decodes to ${value}`, JSON.stringify(cell))
        if (ok) decoded++
      })
    )
    console.log(`  simulated print head: decoded ${decoded} barcodes from ${jobs.length} TSPL/ZPL rows (203 + 300 dpi)`)
  }
  if (!process.env.L6_KEEP) fs.rmSync(dir, { recursive: true, force: true })
  else console.log(`  output kept in ${dir}`)
  finish()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
