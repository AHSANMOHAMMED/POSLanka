'use client'

/**
 * Browser-side text rasterizer: renders a line of text (any script, incl.
 * Sinhala / Tamil) onto an offscreen canvas and returns RGBA pixels for
 * `EscPosBuilder.rasterImage`. Returns null when no canvas is available.
 */

import type { RasterImageData, TextRasterizer } from './encoder'

type CanvasLike = HTMLCanvasElement | OffscreenCanvas

function makeCanvas(w: number, h: number): CanvasLike | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  } catch {
    /* fall through */
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  }
  return null
}

export interface RasterizerOptions {
  /** Font stack; the default includes common Sinhala/Tamil system fonts. */
  fontFamily?: string
  /** Base font size in px for size=1 (thermal Font A is ~24 dots tall). */
  fontSize?: number
  /** Vertical padding in px. */
  padding?: number
}

const DEFAULT_FONT =
  '"Noto Sans Sinhala", "Iskoola Pota", "Nirmala UI", "Noto Sans Tamil", "Latha", "Noto Sans", Arial, Helvetica, sans-serif'

export function createCanvasTextRasterizer(opts: RasterizerOptions = {}): TextRasterizer {
  const fontFamily = opts.fontFamily || DEFAULT_FONT
  const baseSize = opts.fontSize || 22
  const padding = opts.padding ?? 2

  return (text, { widthDots, bold, size, align }) => {
    const fontPx = baseSize * size
    const height = Math.ceil(fontPx * 1.35) + padding * 2
    const canvas = makeCanvas(widthDots, height)
    if (!canvas) return null
    const ctx = (canvas as HTMLCanvasElement).getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null
    if (!ctx) return null

    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, widthDots, height)
    ctx.fillStyle = '#000'
    ctx.font = `${bold ? 'bold ' : ''}${fontPx}px ${fontFamily}`
    ctx.textBaseline = 'middle'

    // Shrink to fit if the line is too wide.
    let measured = ctx.measureText(text).width
    let scale = 1
    if (measured > widthDots - 4) {
      scale = (widthDots - 4) / measured
      measured = widthDots - 4
    }
    const x = align === 'center' ? (widthDots - measured) / 2 : align === 'right' ? widthDots - measured - 2 : 2
    ctx.save()
    ctx.translate(x, height / 2)
    if (scale !== 1) ctx.scale(scale, 1)
    ctx.fillText(text, 0, 0)
    ctx.restore()

    const img = ctx.getImageData(0, 0, widthDots, height)
    const result: RasterImageData = { width: img.width, height: img.height, data: img.data }
    return result
  }
}

/** Load an image URL (e.g. tenant logo) into RGBA pixels, scaled to `maxWidth`. */
export async function loadImageData(url: string, maxWidth = 384): Promise<RasterImageData | null> {
  if (typeof Image === 'undefined') return null
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const scale = img.width > maxWidth ? maxWidth / img.width : 1
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = makeCanvas(w, h)
      const ctx = canvas ? ((canvas as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D | null) : null
      if (!ctx) return resolve(null)
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      try {
        const d = ctx.getImageData(0, 0, w, h)
        resolve({ width: d.width, height: d.height, data: d.data })
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}
