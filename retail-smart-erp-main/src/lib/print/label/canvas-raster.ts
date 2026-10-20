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
import { mmToDots, ptToDots, pxToDots, resolveText, sortedElements, isDarkColor, type ElementRasterizer, type LabelRasterizer } from './common'
import { resolveField } from '@/lib/labels/label-renderer'

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
      dpi: (dpi === 300 ? 300 : 203) as 203 | 300,
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
        const size = ptToDots(el.fontSize, dpi) * 1.33
        ctx.font = `${el.fontWeight === 'bold' ? 'bold ' : ''}${size}px sans-serif`
        ctx.textBaseline = 'top'
        ctx.textAlign = el.textAlign
        const tx = el.textAlign === 'center' ? x + w / 2 : el.textAlign === 'right' ? x + w : x
        // simple word wrap
        const words = text.split(/\s+/)
        const lines: string[] = []
        let cur = ''
        for (const wd of words) {
          const test = cur ? `${cur} ${wd}` : wd
          if (ctx.measureText(test).width > w && cur) {
            lines.push(cur)
            cur = wd
          } else cur = test
        }
        if (cur) lines.push(cur)
        lines.slice(0, Math.max(1, el.maxLines || 1)).forEach((ln, i) => ctx.fillText(ln, tx, y + i * size * 1.15, w))
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
