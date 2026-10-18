'use client'

import { FORMAT_TO_BWIP, type BarcodeFormat } from './types'

/**
 * Render a barcode as a data URL (SVG base64) using bwip-js.
 * Uses toSVG() for reliability — no Canvas dependency, works in all contexts,
 * and produces resolution-independent output ideal for print.
 * Falls back to toCanvas() if SVG fails, then to placeholder.
 */
export async function renderBarcodeDataUrl(
  format: BarcodeFormat,
  data: string,
  options?: {
    width?: number    // bar module width in mils (1/1000 inch)
    height?: number   // bar height in mils
    showText?: boolean
  }
): Promise<string> {
  if (!data) return getPlaceholderDataUrl(format)

  try {
    const bwipjs = await import('bwip-js/browser')

    const is2D = ['qrcode', 'datamatrix', 'pdf417'].includes(format)
    const symbology = FORMAT_TO_BWIP[format]

    const renderOpts = {
      bcid: symbology,
      text: data,
      scale: 3,
      height: is2D ? 10 : (options?.height ?? 10),
      ...(is2D ? { width: 10 } : {}),
      includetext: options?.showText ?? !is2D,
      textxalign: 'center' as const,
      barcolor: '000000',
      backgroundcolor: 'FFFFFF',
    }

    // Prefer SVG: no canvas dependency, resolution-independent, best for print
    try {
      const svg = bwipjs.toSVG(renderOpts)
      return `data:image/svg+xml;base64,${btoa(svg)}`
    } catch {
      // Fallback to canvas if SVG fails
    }

    // Canvas fallback
    const canvas = document.createElement('canvas')
    bwipjs.toCanvas(canvas, renderOpts)
    return canvas.toDataURL('image/png')
  } catch (err) {
    console.error(`[barcode-renderer] Failed to render ${format} barcode:`, err)
    return getPlaceholderDataUrl(format)
  }
}

/**
 * Simple SVG placeholder for when barcode generation fails
 */
function getPlaceholderDataUrl(format: BarcodeFormat): string {
  const is2D = ['qrcode', 'datamatrix', 'pdf417'].includes(format)
  const w = is2D ? 80 : 120
  const h = is2D ? 80 : 50

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <rect width="${w}" height="${h}" fill="#f3f4f6" stroke="#d1d5db" stroke-width="1"/>
    <text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="central" fill="#9ca3af" font-size="10" font-family="sans-serif">${format}</text>
  </svg>`

  return `data:image/svg+xml;base64,${btoa(svg)}`
}

/**
 * Return format-appropriate sample/fallback data for barcode rendering.
 * Each format has strict data requirements, so a single generic string won't work.
 */
export function getBarcodeFallbackData(format: BarcodeFormat): string {
  switch (format) {
    case 'ean13':       return '0000000000000'   // 13 digits
    case 'ean8':        return '00000000'         // 8 digits
    case 'upca':        return '000000000000'     // 12 digits
    case 'itf14':       return '00000000000000'   // 14 digits (must be even length)
    case 'codabar':     return 'A00000A'          // needs A-D start/stop chars
    case 'code39':      return '0000000000000'
    case 'code93':      return '0000000000000'
    case 'code128':     return '0000000000000'
    case 'qrcode':      return '0000000000000'
    case 'datamatrix':  return '0000000000000'
    case 'pdf417':      return '0000000000000'
    default:            return '0000000000000'
  }
}

/**
 * Validate that the data is compatible with the barcode format
 */
export function validateBarcodeData(format: BarcodeFormat, data: string): string | null {
  if (!data) return 'No data provided'

  switch (format) {
    case 'ean13':
      if (!/^\d{12,13}$/.test(data)) return 'EAN-13 requires 12-13 digits'
      break
    case 'ean8':
      if (!/^\d{7,8}$/.test(data)) return 'EAN-8 requires 7-8 digits'
      break
    case 'upca':
      if (!/^\d{11,12}$/.test(data)) return 'UPC-A requires 11-12 digits'
      break
    case 'itf14':
      if (!/^\d{13,14}$/.test(data)) return 'ITF-14 requires 13-14 digits'
      break
    case 'codabar':
      if (!/^[A-Da-d][0-9\-$:/.+]+[A-Da-d]$/.test(data)) return 'Invalid Codabar format'
      break
  }
  return null
}
