/**
 * ESC/POS raster labels: render each label to a 1-bit bitmap (via the injected
 * `rasterizeLabel`, the browser canvas implementation lives in canvas-raster.ts)
 * and send it with GS v 0, feeding the label gap between labels. Lets a plain
 * receipt printer print labels on die-cut or continuous media.
 */
import { EscPosBuilder } from '@/lib/print/escpos/encoder'
import { CommandBuffer, mmToDots, type EncodeLabelOptions, type LabelPrintItem, type LabelTemplateLike } from './common'

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
  for (const { item, quantity } of items) {
    const bmp = await o.rasterizeLabel(template, item, {
      dpi,
      widthDots,
      heightDots,
      currencySymbol: o.currencySymbol,
      tenantName: o.tenantName,
      codeWord: o.codeWord,
    })
    if (!bmp) {
      warnings.push(`Label for ${item?.name ?? 'item'} could not be rendered`)
      continue
    }
    const one = new EscPosBuilder({ widthDots: Math.max(widthDots, bmp.width) }).packedRaster(bmp)
    // ESC J n: feed n dots (max 255 per command)
    let g = gapDots
    while (g > 0) {
      const n = Math.min(255, g)
      one.raw([0x1b, 0x4a, n])
      g -= n
    }
    const bytes = one.build()
    const n = quantity * copies
    for (let i = 0; i < n; i++) buf.binary(bytes, `<GS v 0 ${bmp.width}x${bmp.height}><ESC J ${gapDots}>\n`)
  }
  return { buf, warnings }
}
