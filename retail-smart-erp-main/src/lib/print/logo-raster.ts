/**
 * Server-side logo rasterisation for thermal printers (W7).
 *
 * Produces a 1-bit bitmap in ESC/POS `GS v 0` layout: rows packed MSB-first,
 * `ceil(width / 8)` bytes per row, bit = 1 means a black dot. The logo is scaled
 * to `pct`% of the paper dot width, flattened on white, Floyd–Steinberg
 * dithered and centered on a canvas exactly `paperDots` wide so clients can send
 * it without any further alignment.
 *
 * Server only (uses sharp).
 */
import sharp from 'sharp'

export interface LogoRaster {
  /** Bitmap width in dots (= paper dot width, multiple of 8). */
  width: number
  height: number
  /** Packed 1-bit rows, base64. */
  data: string
  /** Grayscale PNG of the scaled logo (not padded) for HTML receipts, base64. */
  pngBase64: string
  /** Width of the logo itself inside the bitmap (dots). */
  logoWidth: number
}

export const LOGO_PAPER_WIDTHS = [384, 576] as const
/** Logos taller than this (in dots) are scaled down further. */
export const MAX_LOGO_HEIGHT = 240

export async function rasterizeLogo(
  input: Buffer,
  opts: { paperDots: number; pct: number; maxHeight?: number; dither?: boolean }
): Promise<LogoRaster> {
  const paperDots = Math.max(8, Math.floor(opts.paperDots / 8) * 8)
  const pct = Math.min(100, Math.max(10, opts.pct))
  const maxH = opts.maxHeight ?? MAX_LOGO_HEIGHT
  const targetW = Math.max(8, Math.round((paperDots * pct) / 100))

  // Flatten transparency on white, grayscale, fit inside targetW x maxH.
  const { data: gray, info } = await sharp(input)
    .flatten({ background: '#ffffff' })
    .resize({ width: targetW, height: maxH, fit: 'inside', withoutEnlargement: false })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const w = info.width
  const h = info.height
  const channels = info.channels
  const lum = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) lum[i] = gray[i * channels]

  const bytesPerRow = paperDots / 8
  const bitmap = new Uint8Array(bytesPerRow * h)
  const offsetX = Math.floor((paperDots - w) / 2)
  const dither = opts.dither !== false

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const old = lum[i]
      const black = old < 128
      if (black) {
        const px = x + offsetX
        bitmap[y * bytesPerRow + (px >> 3)] |= 0x80 >> (px & 7)
      }
      if (dither) {
        const err = old - (black ? 0 : 255)
        if (x + 1 < w) lum[i + 1] += (err * 7) / 16
        if (y + 1 < h) {
          if (x > 0) lum[i + w - 1] += (err * 3) / 16
          lum[i + w] += (err * 5) / 16
          if (x + 1 < w) lum[i + w + 1] += err / 16
        }
      }
    }
  }

  const png = await sharp(gray, { raw: { width: w, height: h, channels: channels as 1 | 2 | 3 | 4 } })
    .png({ compressionLevel: 9 })
    .toBuffer()

  return {
    width: paperDots,
    height: h,
    data: Buffer.from(bitmap).toString('base64'),
    pngBase64: png.toString('base64'),
    logoWidth: w,
  }
}
