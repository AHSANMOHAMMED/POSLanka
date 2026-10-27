'use client'

import { FORMAT_TO_BWIP, type BarcodeElement, type BarcodeFormat } from './types'
import { chooseSymbology, planLinear, TWO_D_FORMATS, type SymbolChoice } from '@/lib/print/label/barcode-fit'

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
    scale?: number
    showText?: boolean
  }
): Promise<string> {
  if (!data) return getPlaceholderDataUrl(format)

  try {
    const bwipjs = await import('bwip-js/browser')

    const is2D = ['qrcode', 'datamatrix', 'pdf417'].includes(format)
    const symbology = FORMAT_TO_BWIP[format]

    // ISO barcode standard quiet zones:
    // Minimum 10-12 modules of white margin on both sides for 1D optical scanners (Code 128 / EAN).
    // Minimum 4 modules for 2D QR codes / DataMatrix.
    const renderOpts = {
      bcid: symbology,
      text: data,
      scale: options?.scale ? Math.max(2, Math.min(6, options.scale)) : 4,
      height: is2D ? 12 : (options?.height ? Math.max(8, options.height) : 12),
      ...(is2D ? { width: 12 } : {}),
      includetext: options?.showText ?? !is2D,
      textxalign: 'center' as const,
      paddingwidth: is2D ? 4 : 8,
      paddingheight: is2D ? 4 : 2,
      barcolor: '000000',
      backgroundcolor: 'FFFFFF',
    }

    // Prefer SVG: no canvas dependency, crisp vector rendering
    try {
      let svg = bwipjs.toSVG(renderOpts)
      // Inject shape-rendering="crispEdges" to prevent thermal print spoolers and Chrome
      // from anti-aliasing edges with gray pixels (which direct thermal printers dither into dot noise).
      if (!svg.includes('shape-rendering')) {
        svg = svg.replace('<svg ', '<svg shape-rendering="crispEdges" ')
      }
      const base64 = typeof window !== 'undefined'
        ? btoa(unescape(encodeURIComponent(svg)))
        : Buffer.from(svg).toString('base64')
      return `data:image/svg+xml;base64,${base64}`
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

const escXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Bar/space widths (modules, bar first) of a linear symbol, via bwip-js. */
export async function linearBarsAndSpaces(choice: SymbolChoice): Promise<number[] | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import('bwip-js/browser')) as any
    // ESM build: the named export `raw` is the 'raw' symbology; the encoder API is default.raw (ToRaw).
    const api = mod.default && typeof mod.default.raw === 'function' ? mod.default : mod
    const raw = api.raw(FORMAT_TO_BWIP[choice.format], ['ean13', 'upca', 'ean8', 'itf14'].includes(choice.format) ? choice.value : choice.data, '') as Array<{ sbs?: number[] }>
    const sbs = raw?.[0]?.sbs
    return Array.isArray(sbs) && sbs.length ? sbs : null
  } catch {
    return null
  }
}

/**
 * HTML for one barcode element of a browser-printed label, drawn on the
 * printer's dot grid: integer-dot module, bars at whole-dot positions (inline
 * SVG, crisp edges, black on white, no image scaling), quiet zones kept white
 * inside the label. `raw` is the value to encode (see barcodeSourceValue).
 * The cell holding the label must start on a whole printer dot.
 */
export async function renderBarcodeElementHtml(
  el: BarcodeElement,
  raw: string,
  labelWidthMm: number,
  dpi = 203
): Promise<string> {
  const z = `z-index:${el.zIndex};`
  const box = `position:absolute;left:${el.x}mm;top:${el.y}mm;width:${el.width}mm;height:${el.height}mm;`
  const choice = chooseSymbology(el.format, raw)
  if ('error' in choice) {
    return `<div style="${box}${z}border:0.3mm dashed #000;background:#fff;display:flex;align-items:center;justify-content:center;font:bold 6pt sans-serif;color:#000;text-align:center;" data-barcode-error="1">NO BARCODE</div>`
  }
  const rot = ((Math.round(Number(el.rotation) || 0) % 360) + 360) % 360
  if (TWO_D_FORMATS.includes(choice.format) || rot !== 0) {
    const is2D = TWO_D_FORMATS.includes(choice.format)
    const dataUrl = await renderBarcodeDataUrl(choice.format, choice.format === 'ean13' || choice.format === 'upca' ? choice.value : choice.data, {
      showText: el.showText,
      height: is2D ? 12 : Math.max(8, Math.round(el.height - (el.showText ? 4 : 1))),
    })
    return `<div style="${box}${z}${rot ? `transform:rotate(${rot}deg);` : ''}background:#fff;display:flex;align-items:center;justify-content:center;"><img src="${dataUrl}" style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated;display:block;" alt="barcode"/></div>`
  }
  const sbs = await linearBarsAndSpaces(choice)
  if (!sbs) {
    return `<div style="${box}${z}border:0.3mm dashed #000;display:flex;align-items:center;justify-content:center;font:bold 6pt sans-serif;" data-barcode-error="1">BARCODE ERROR</div>`
  }
  const dpm = dpi / 25.4
  const modules = sbs.reduce((a, b) => a + b, 0)
  const labelW = Math.round(labelWidthMm * dpm)
  const plan = planLinear(choice.format, choice.data, dpi, Math.round(el.x * dpm), Math.max(1, Math.round(el.width * dpm)), labelW, modules)
  const m = plan.module
  const hDots = Math.max(8, Math.round(el.height * dpm))
  const hri = el.showText ? Math.round(2.6 * dpm) : 0
  const barH = Math.max(8, hDots - hri)
  const W = plan.symbolDots + 2 * plan.quietDots
  const left = plan.x - plan.quietDots
  let x = plan.quietDots
  let rects = ''
  for (let i = 0; i < sbs.length; i++) {
    const w = sbs[i] * m
    if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${barH}"/>`
    x += w
  }
  let text = ''
  if (el.showText) {
    const fs = Math.max(6, Math.min(Math.round(hri * 0.9), Math.floor(W / Math.max(1, choice.value.length * 0.62))))
    text = `<text x="${W / 2}" y="${hDots - Math.max(1, Math.round((hri - fs) / 2))}" font-size="${fs}" font-family="Arial, Helvetica, sans-serif" text-anchor="middle" fill="#000">${escXml(choice.value)}</text>`
  }
  const mm = (d: number) => Math.round((d / dpm) * 10000) / 10000
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${mm(W)}mm" height="${mm(hDots)}mm" viewBox="0 0 ${W} ${hDots}" preserveAspectRatio="none" shape-rendering="crispEdges" style="display:block"><rect width="${W}" height="${hDots}" fill="#fff"/><g fill="#000">${rects}</g>${text}</svg>`
  return `<div style="position:absolute;left:${mm(left)}mm;top:${el.y}mm;width:${mm(W)}mm;height:${mm(hDots)}mm;${z}overflow:visible;" data-barcode="${escXml(choice.value)}" data-symbology="${choice.format}" data-module-dots="${m}" data-fits="${plan.fits ? 1 : 0}">${svg}</div>`
}
