/**
 * Print layout tests: multi-across label rolls (sticker stock setups) and the
 * receipt format options. Run: npx tsx scripts/tests/ws-print-layout.ts
 */
import { encodeLabels, labelAlignmentTemplate, mmToDots, packLabelRows, type LabelTemplateLike } from '../../src/lib/print/label'
import { encodeLabels as encodeMobile } from '../../apps/mobile/src/lib/label'
import {
  STICKER_PRESETS,
  mergeLockedSetups,
  sanitizeStickerSetup,
  sanitizeStickerSetups,
  setupFromPreset,
  stickerLayout,
  stickerRollWidthMm,
} from '../../src/lib/labels/sticker-stock'
import type { LabelItemData } from '../../src/lib/labels/types'
import { receiptTests } from './ws-receipt-format'

let pass = 0
let fail = 0
export function check(cond: boolean, msg: string, extra?: string) {
  if (cond) pass++
  else {
    fail++
    console.error(`  FAIL: ${msg}${extra ? `\n${extra}` : ''}`)
  }
}

const item = (id: string, name: string): LabelItemData => ({
  id,
  name,
  sku: id.toUpperCase(),
  barcode: null,
  sellingPrice: '100',
  costPrice: '50',
  brand: null,
  oemPartNumber: null,
  pluCode: null,
  category: null,
  unit: 'pcs',
  weight: null,
  dimensions: null,
  imageUrl: null,
})

const tpl: LabelTemplateLike = {
  widthMm: 38,
  heightMm: 25,
  elements: [
    { id: 'name', type: 'text', dataField: 'item.name', x: 1, y: 1, width: 36, height: 4, rotation: 0, zIndex: 1, fontSize: 8, fontWeight: 'bold', textAlign: 'left', maxLines: 1 },
    { id: 'box', type: 'shape', shape: 'rectangle', x: 0, y: 0, width: 38, height: 25, rotation: 0, zIndex: 0, borderWidth: 1, borderColor: '#000', borderStyle: 'solid' },
  ],
}

async function labelTests() {
  console.log('Label roll layout')
  const A = item('a', 'Apple')
  const B = item('b', 'Banana')

  // packing
  const rows = packLabelRows([{ item: A, quantity: 3 }, { item: B, quantity: 2 }], 2)
  check(rows.length === 3, 'pack 5 labels on 2 across -> 3 distinct rows', JSON.stringify(rows.map((r) => [r.cells.map((c) => c?.item?.id ?? '-'), r.count])))
  check(rows[0].count === 1 && rows[0].cells.every((c) => c?.item === A), 'row 1 = A A')
  check(rows[1].cells[0]?.item === A && rows[1].cells[1]?.item === B, 'row 2 = A B')
  check(rows[2].cells[0]?.item === B && rows[2].cells[1] === null, 'row 3 = B blank')
  const merged = packLabelRows([{ item: A, quantity: 6 }], 3, 2)
  check(merged.length === 1 && merged[0].count === 4, '12 identical labels on 3 across -> one row x4')
  const single = packLabelRows([{ item: A, quantity: 3 }], 1, 2)
  check(single.length === 1 && single[0].count === 6, '1 across keeps quantity x copies')

  // presets & sanitising
  const p = STICKER_PRESETS.find((x) => x.id === '38x25x2')!
  const setup = setupFromPreset(p)
  check(stickerRollWidthMm(setup) === 80, '38x25x2 liner = 80 mm', String(stickerRollWidthMm(setup)))
  check(stickerRollWidthMm(setupFromPreset(STICKER_PRESETS.find((x) => x.id === '32x25x3')!)) === 102, '32x25x3 liner = 102 mm')
  const bad = sanitizeStickerSetup({ columns: 9, offsetXMm: -99, dpi: 600 as never, labelWidthMm: 'x' as never, darkness: '' as never })
  check(bad.columns === 4 && bad.offsetXMm === -20 && bad.dpi === 203 && bad.labelWidthMm === 50 && bad.darkness === null, 'sanitize clamps values')
  const two = sanitizeStickerSetups([{ ...setup, isDefault: true }, { ...setup, id: 'x', isDefault: true }])
  check(two.filter((s) => s.isDefault).length === 1, 'only one default setup')

  // lock merge
  const locked = { ...setup, id: 'L', locked: true }
  const m1 = mergeLockedSetups([locked], [{ ...locked, offsetXMm: 3 }])
  check(m1.blocked && m1.list[0].offsetXMm === 0, 'changing a locked setup is blocked')
  const m2 = mergeLockedSetups([locked], [])
  check(m2.blocked && m2.list.length === 1, 'removing a locked setup is blocked')
  const m3 = mergeLockedSetups([locked], [locked, { ...setup, id: 'N' }])
  check(!m3.blocked && m3.list.length === 2, 'adding an unlocked setup next to a locked one is fine')

  // TSPL: SIZE = whole liner, columns placed at x origins
  const layoutSetup = { ...setup, offsetXMm: 0.5, offsetYMm: -0.5, darkness: 10, speed: 3, direction: 0 as const }
  for (const dpi of [203, 300] as const) {
    const t = await encodeLabels(tpl, [{ item: A, quantity: 3 }], {
      language: 'tspl',
      dpi,
      gapMm: layoutSetup.rowGapMm,
      widthMm: 38,
      heightMm: 25,
      darkness: 10,
      speed: 3,
      layout: stickerLayout(layoutSetup),
    })
    const tx = t.text
    check(tx.includes('SIZE 80 mm,25 mm\r\n'), `tspl@${dpi} SIZE = liner width`, tx)
    check(tx.includes('GAP 2 mm,0 mm\r\n'), `tspl@${dpi} GAP = row gap`)
    check(tx.includes('DIRECTION 0,0\r\n'), `tspl@${dpi} DIRECTION from setup`)
    check(tx.includes('DENSITY 10\r\n') && tx.includes('SPEED 3\r\n'), `tspl@${dpi} darkness & speed`)
    const x0 = mmToDots(1 + 0.5 + 1, dpi) // margin + offset + element x
    const x1 = mmToDots(1 + 0.5 + 38 + 2, dpi) + mmToDots(1, dpi)
    const y = Math.max(0, mmToDots(-0.5, dpi) + mmToDots(1, dpi))
    check(tx.includes(`TEXT ${x0},${y},`), `tspl@${dpi} column 1 text at x=${x0}`, tx)
    check(tx.includes(`TEXT ${x1},${y},`), `tspl@${dpi} column 2 text at x=${x1}`, tx)
    const prints = tx.match(/PRINT (\d+),1/g) || []
    check(prints.length === 2 && prints[0] === 'PRINT 1,1' && prints[1] === 'PRINT 1,1', `tspl@${dpi} 3 labels on 2 across = 2 rows`, prints.join('|'))
    const boxes = tx.match(/BOX /g) || []
    check(boxes.length === 3, `tspl@${dpi} 3 label borders (blank cell skipped)`)

    // ZPL: ^PW = liner, ^FO per column
    const z = await encodeLabels(tpl, [{ item: A, quantity: 4 }], { language: 'zpl', dpi, widthMm: 38, heightMm: 25, layout: stickerLayout(setup) })
    check(z.text.includes(`^PW${mmToDots(80, dpi)}\n`), `zpl@${dpi} ^PW = liner`, z.text)
    check(z.text.includes(`^FO${mmToDots(1, dpi) + mmToDots(1, dpi)},`) && z.text.includes(`^FO${mmToDots(41, dpi) + mmToDots(1, dpi)},`), `zpl@${dpi} column origins`, z.text)
    check((z.text.match(/\^XA/g) || []).length === 1 && z.text.includes('^PQ2,0,1,Y'), `zpl@${dpi} 4 identical labels on 2 across = 1 format x2`)

    // EPL: q = liner
    const e = await encodeLabels(tpl, [{ item: A, quantity: 2 }], { language: 'epl', dpi, widthMm: 38, heightMm: 25, gapMm: 2, layout: stickerLayout(setup) })
    check(e.text.includes(`q${mmToDots(80, dpi)}\r\n`), `epl@${dpi} q = liner`, e.text)
    check(e.text.includes('P1,1'), `epl@${dpi} one row`)

    // mobile parity
    for (const language of ['tspl', 'zpl', 'epl'] as const) {
      const opts = { language, dpi, widthMm: 38, heightMm: 25, gapMm: 2, darkness: 8, speed: 4, layout: stickerLayout(layoutSetup) }
      const w = await encodeLabels(tpl, [{ item: A, quantity: 3 }, { item: B, quantity: 1 }], opts)
      const mo = await encodeMobile(tpl as never, [{ item: A, quantity: 3 }, { item: B, quantity: 1 }] as never, opts)
      check(Buffer.from(w.bytes).equals(Buffer.from(mo.bytes)), `mobile ${language}@${dpi} multi-across byte-identical`)
    }
  }

  // ESC/POS raster: composed row bitmap
  const raster = await encodeLabels(tpl, [{ item: A, quantity: 3 }], {
    language: 'escpos-raster',
    dpi: 203,
    widthMm: 38,
    heightMm: 25,
    layout: stickerLayout(setup),
    rasterizeLabel: async (_t, _i, ctx) => {
      const bpr = Math.ceil(ctx.widthDots / 8)
      const data = new Uint8Array(bpr * ctx.heightDots).fill(0xff)
      return { width: ctx.widthDots, height: ctx.heightDots, data }
    },
  })
  check(raster.text.includes(`<GS v 0 ${mmToDots(80, 203)}x${mmToDots(25, 203)}>`), 'raster row = liner width', raster.text)
  check((raster.text.match(/<GS v 0/g) || []).length === 2, 'raster: 2 rows')
  const bytes = raster.bytes
  const idx = bytes.findIndex((b, i) => b === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30)
  const bpr = bytes[idx + 4] | (bytes[idx + 5] << 8)
  const rowStart = idx + 8
  const bit = (x: number) => (bytes[rowStart + (x >> 3)] & (0x80 >> (x & 7))) !== 0
  check(!bit(0) && bit(mmToDots(1, 203) + 1) && !bit(mmToDots(39.5, 203)) && bit(mmToDots(41, 203) + 1), 'raster: margin and gap stay blank', String(bpr))

  // legacy (no layout) output unchanged
  const legacy = await encodeLabels(tpl, [{ item: A, quantity: 2 }], { language: 'tspl', dpi: 203, copies: 2 })
  check(legacy.text.includes('SIZE 38 mm,25 mm\r\n') && legacy.text.includes('DIRECTION 1,0') && legacy.text.includes('PRINT 4,1'), 'no layout = legacy output')

  // alignment template
  const al = labelAlignmentTemplate(38, 25)
  check(al.elements.length === 4 && al.elements[0].type === 'shape', 'alignment template has border + crosshair')
}

async function main() {
  await labelTests()
  const r = await receiptTests(check)
  void r
  console.log(`  ${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
  console.log('PASS')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
