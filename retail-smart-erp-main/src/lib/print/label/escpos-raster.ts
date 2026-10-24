/**
 * ESC/POS raster labels: render each label to a 1-bit bitmap (via the injected
 * `rasterizeLabel`, the browser canvas implementation lives in canvas-raster.ts)
 * and send it with GS v 0, feeding the label gap between labels. Lets a plain
 * receipt printer print labels on die-cut or continuous media.
 */
import { EscPosBuilder } from '@/lib/print/escpos/encoder'
import {
  CommandBuffer,
  blitPacked,
  columnOrigins,
  mediaWidthMm,
  mmToDots,
  normalizeLayout,
  packLabelRows,
  type EncodeLabelOptions,
  type LabelPrintItem,
  type LabelTemplateLike,
} from './common'
import type { PackedRaster } from '@/lib/print/escpos/encoder'
import type { LabelItemData } from '@/lib/labels/types'

export async function encodeEscPosRaster(
  template: LabelTemplateLike,
  items: LabelPrintItem[],
  o: EncodeLabelOptions
): Promise<{ buf: CommandBuffer; warnings: string[] }> {
  const warnings: string[] = []
  const buf = new CommandBuffer('\n')
  if (!o.rasterizeLabel) {
    warnings.push('ESC/POS raster labels need a label rasterizer (browser canvas); nothing encoded')
    return { buf, warnings }
  }
  const dpi = o.dpi
  const widthDots = mmToDots(o.widthMm ?? Number(template.widthMm), dpi)
  const heightDots = mmToDots(o.heightMm ?? Number(template.heightMm), dpi)
  const gapDots = mmToDots(o.gapMm ?? 2, dpi)
  const copies = Math.max(1, Math.round(o.copies ?? 1))

  const init = new EscPosBuilder({ widthDots }).init().align('center')
  buf.binary(init.build(), '<ESC @><ESC a 1>\n')

  const cache = new Map<LabelItemData | null, PackedRaster | null>()
  const render = async (item: LabelItemData | null) => {
    if (cache.has(item)) return cache.get(item) ?? null
    const bmp = await o.rasterizeLabel!(template, item, {
      dpi,
      widthDots,
      heightDots,
      currencySymbol: o.currencySymbol,
      tenantName: o.tenantName,
      codeWord: o.codeWord,
    })
    if (!bmp) warnings.push(`Label for ${item?.name ?? 'item'} could not be rendered`)
    cache.set(item, bmp)
    return bmp
  }
  const feedGap = (b: EscPosBuilder) => {
    // ESC J n: feed n dots (max 255 per command)
    let g = gapDots
    while (g > 0) {
      const n = Math.min(255, g)
      b.raw([0x1b, 0x4a, n])
      g -= n
    }
  }

  if (!o.layout) {
    // One label across: each label bitmap as is (legacy output).
    for (const { item, quantity } of items) {
      const bmp = await render(item)
      if (!bmp) continue
      const one = new EscPosBuilder({ widthDots: Math.max(widthDots, bmp.width) }).packedRaster(bmp)
      feedGap(one)
      const bytes = one.build()
      const n = quantity * copies
      for (let i = 0; i < n; i++) buf.binary(bytes, `<GS v 0 ${bmp.width}x${bmp.height}><ESC J ${gapDots}>\n`)
    }
    return { buf, warnings }
  }

  // Multi-across: compose each row (all columns, gaps and offsets) into one bitmap.
  const layout = normalizeLayout(o.layout)
  const rowW = mmToDots(mediaWidthMm(template, o), dpi)
  const { xs, y: oy } = columnOrigins(template, o)
  for (const row of packLabelRows(items, layout.columns, copies)) {
    const dst: PackedRaster = { width: rowW, height: heightDots, data: new Uint8Array(Math.ceil(rowW / 8) * heightDots) }
    for (let k = 0; k < row.cells.length; k++) {
      const cell = row.cells[k]
      if (!cell) continue
      const bmp = await render(cell.item)
      if (bmp) blitPacked(dst, bmp, xs[k] ?? 0, oy)
    }
    const one = new EscPosBuilder({ widthDots: rowW }).packedRaster(dst)
    feedGap(one)
    const bytes = one.build()
    for (let i = 0; i < row.count; i++) buf.binary(bytes, `<GS v 0 ${rowW}x${heightDots}><ESC J ${gapDots}>\n`)
  }
  return { buf, warnings }
}
