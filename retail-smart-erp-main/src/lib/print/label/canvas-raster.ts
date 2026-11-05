'use client'

/**
 * Browser canvas rasterisers for label printing:
 *   - rasterizeLabelCanvas: whole label -> 1-bit bitmap (ESC/POS raster labels)
 *   - rasterizeImageElementCanvas: one image element -> bitmap (TSPL BITMAP / ZPL ^GFA / EPL GW)
 */
import type { LabelElement, LabelItemData } from '@/lib/labels/types'
import { FORMAT_TO_BWIP } from '@/lib/labels/types'
import { getBarcodeFallbackData, validateBarcodeData } from '@/lib/labels/barcode-renderer'
import type { PackedRaster } from '@/lib/print/escpos/encoder'
import { mmToDots, normDpi, pxToDots, resolveText, sortedElements, isDarkColor, type ElementRasterizer, type LabelRasterizer, type LabelTemplateLike } from './common'
import { calculateAutoFitFontSize, resolveField } from '@/lib/labels/label-renderer'
import { LABEL_FONT_FAMILY } from '@/lib/labels/barcode-renderer'
import type { TextElement } from '@/lib/labels/types'

/**
 * Draw a text element the way the browser preview lays it out (renderLabelHtml):
 * same font family and size (pt at the printer dpi), line height 1.2, one line
 * cut with an ellipsis, or word-wrapped to maxLines with an ellipsis on the
 * last line, auto-fit shrinking, clipped to the element box.
 */
function drawTextLikeCss(ctx: CanvasRenderingContext2D, el: TextElement, text: string, x: number, y: number, w: number, h: number, dpi: number) {
  const maxLines = Math.max(1, el.maxLines || 1)
  let pt = Number(el.fontSize) || 8
  if (el.autoFit) pt = calculateAutoFitFontSize(text, el.width * (96 / 25.4), el.height * (96 / 25.4), el.fontWeight, pt, maxLines)
  const size = Math.max(1, (pt * dpi) / 72)
  ctx.font = `${el.fontWeight === 'bold' ? 'bold ' : ''}${size}px ${LABEL_FONT_FAMILY}`
  const fits = (s: string) => ctx.measureText(s).width <= w
  const ellipsize = (s: string) => {
    if (fits(s)) return s
    let t = s
    while (t.length > 0 && !fits(`${t}\u2026`)) t = t.slice(0, -1)
    return `${t.trimEnd()}\u2026`
  }
  let lines: string[]
  if (maxLines === 1) {
    lines = [ellipsize(text)]
  } else {
    lines = []
    let cur = ''
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const test = cur ? `${cur} ${word}` : word
      if (fits(test)) {
        cur = test
        continue
      }
      if (cur) lines.push(cur)
      // break-word: split a word longer than the line
      let rest = word
      while (!fits(rest) && rest.length > 1) {
        let n = rest.length - 1
        while (n > 1 && !fits(rest.slice(0, n))) n--
        lines.push(rest.slice(0, n))
        rest = rest.slice(n)
      }
      cur = rest
    }
    if (cur) lines.push(cur)
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines)
      kept[maxLines - 1] = ellipsize(`${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`)
      lines = kept
    }
  }
  const lineH = size * 1.2
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.textBaseline = 'middle'
  ctx.textAlign = el.textAlign
  const tx = el.textAlign === 'center' ? x + w / 2 : el.textAlign === 'right' ? x + w : x
  lines.forEach((ln, i) => ctx.fillText(ln, tx, y + lineH * (i + 0.5)))
  ctx.restore()
}

/**
 * 1-bit picture of one label exactly as the exact (graphic) print sends it:
 * barcodes on the printer's dot grid (driver-image) plus text / shapes / images
 * from the canvas, at `dpi`. Returned as a PNG data URL for the preview.
 */
export async function rasterLabelPreviewDataUrl(
  template: Pick<LabelTemplateLike, 'widthMm' | 'heightMm' | 'elements'>,
  item: LabelItemData | null,
  o: { dpi: number; currencySymbol?: string; tenantName?: string; codeWord?: string; logoUrl?: string | null }
): Promise<{ url: string; widthDots: number; heightDots: number } | null> {
  const { renderDriverRows, encodePng1Bit } = await import('./driver-image')
  const dpi = normDpi(o.dpi)
  const res = await renderDriverRows({ widthMm: template.widthMm, heightMm: template.heightMm, elements: template.elements }, [{ item, quantity: 1 }], {
    dpi,
    currencySymbol: o.currencySymbol,
    tenantName: o.tenantName,
    codeWord: o.codeWord,
    rasterizeLabel: createCanvasLabelRasterizer(o.logoUrl),
  })
  const row = res.rows[0]
  if (!row) return null
  const png = await encodePng1Bit(row, res.widthDots, dpi)
  let bin = ''
  for (let i = 0; i < png.length; i += 0x8000) bin += String.fromCharCode(...png.subarray(i, i + 0x8000))
  return { url: `data:image/png;base64,${btoa(bin)}`, widthDots: res.widthDots, heightDots: res.heightDots }
}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, w)
  c.height = Math.max(1, h)
  return c
}

export function packCanvas(canvas: HTMLCanvasElement, threshold = 128): PackedRaster {
  const ctx = canvas.getContext('2d')!
  const { width, height } = canvas
  const img = ctx.getImageData(0, 0, width, height).data
  const bpr = Math.ceil(width / 8)
  const data = new Uint8Array(bpr * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (img[i + 3] < 128) continue
      const lum = 0.299 * img[i] + 0.587 * img[i + 1] + 0.114 * img[i + 2]
      if (lum < threshold) data[y * bpr + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return { width: bpr * 8, height, data }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function imageSrc(el: LabelElement, item: LabelItemData | null, logoUrl?: string | null): string | null {
  if (el.type !== 'image') return null
  if (el.source === 'item-image') return item?.imageUrl || null
  if (el.source === 'custom') return el.customUrl || null
  if (el.source === 'logo') return logoUrl || null
  return null
}

function drawContain(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / img.width, h / img.height)
  const dw = img.width * s
  const dh = img.height * s
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

export function createImageElementRasterizer(logoUrl?: string | null): ElementRasterizer {
  return async (el, { item, widthDots, heightDots }) => {
    const src = imageSrc(el, item, logoUrl)
    if (!src) return null
    const img = await loadImage(src)
    if (!img) return null
    const c = newCanvas(widthDots, heightDots)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    drawContain(ctx, img, 0, 0, widthDots, heightDots)
    try {
      return packCanvas(c)
    } catch {
      return null // tainted canvas (CORS)
    }
  }
}

export function createCanvasLabelRasterizer(logoUrl?: string | null): LabelRasterizer {
  return async (template, item, ctxInfo) => {
    const { dpi, widthDots, heightDots } = ctxInfo
    const c = newCanvas(widthDots, heightDots)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.fillStyle = '#000'
    ctx.strokeStyle = '#000'
    const opts = {
      language: 'escpos-raster' as const,
      dpi: normDpi(dpi),
      currencySymbol: ctxInfo.currencySymbol,
      tenantName: ctxInfo.tenantName,
      codeWord: ctxInfo.codeWord,
    }
    let bwip: typeof import('bwip-js/browser') | null = null

    for (const el of sortedElements(template)) {
      const x = mmToDots(el.x, dpi)
      const y = mmToDots(el.y, dpi)
      const w = Math.max(1, mmToDots(el.width, dpi))
      const h = Math.max(1, mmToDots(el.height, dpi))
      ctx.save()
      if (el.rotation) {
        ctx.translate(x + w / 2, y + h / 2)
        ctx.rotate((el.rotation * Math.PI) / 180)
        ctx.translate(-(x + w / 2), -(y + h / 2))
      }
      if (el.type === 'text') {
        const text = resolveText(el, item, opts)
        if (text) drawTextLikeCss(ctx, el, text, x, y, w, h, dpi)
      } else if (el.type === 'barcode') {
        const raw = resolveField(el.dataField, item, el.customValue, undefined, ctxInfo.tenantName)
        const data = raw && !validateBarcodeData(el.format, raw) ? raw : getBarcodeFallbackData(el.format)
        try {
          bwip = bwip || (await import('bwip-js/browser'))
          const tmp = document.createElement('canvas')
          const is2D = ['qrcode', 'datamatrix', 'pdf417'].includes(el.format)
          bwip.toCanvas(tmp, {
            bcid: FORMAT_TO_BWIP[el.format],
            text: data,
            scale: 2,
            height: is2D ? 10 : Math.max(5, (el.height - (el.showText ? 3 : 0)) * 0.9),
            includetext: el.showText && !is2D,
            textxalign: 'center',
          })
          ctx.imageSmoothingEnabled = false
          drawContain(ctx, tmp, x, y, w, h)
        } catch {
          /* invalid data: skip */
        }
      } else if (el.type === 'shape') {
        const t = pxToDots(el.borderWidth || 1, dpi)
        ctx.lineWidth = t
        if (el.shape === 'line') {
          ctx.fillRect(x, y + (h - t) / 2, w, t)
        } else if (el.shape === 'ellipse') {
          ctx.beginPath()
          ctx.ellipse(x + w / 2, y + h / 2, w / 2 - t / 2, h / 2 - t / 2, 0, 0, Math.PI * 2)
          if (isDarkColor(el.fillColor)) ctx.fill()
          ctx.stroke()
        } else if (isDarkColor(el.fillColor)) {
          ctx.fillRect(x, y, w, h)
        } else {
          ctx.strokeRect(x + t / 2, y + t / 2, w - t, h - t)
        }
      } else if (el.type === 'image') {
        const src = imageSrc(el, item, logoUrl)
        const img = src ? await loadImage(src) : null
        if (img) drawContain(ctx, img, x, y, w, h)
      }
      ctx.restore()
    }
    try {
      return packCanvas(c)
    } catch {
      return null
    }
  }
}
