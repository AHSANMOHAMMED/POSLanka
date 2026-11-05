/**
 * Preview helper for the "fast text" raw mode (printer's built-in fonts): cut a
 * text the way the TSPL / ZPL / EPL encoders cut it, so the preview shows what
 * the printer will really print (same character limits and line wrapping), and
 * the CSS font family that best resembles the printer font.
 */
import type { TextElement } from '@/lib/labels/types'
import { asciiOnly, mmToDots, ptToDots, wrapChars, type RawLabelLanguage } from './common'
import { pickBitmapFont, TSPL_FONTS } from './tspl'
import { EPL_FONTS } from './epl'

/** CSS font that looks like the printer fonts (fixed-width bitmap fonts / Zebra's condensed ^A0). */
export function nativeFontFamily(language: RawLabelLanguage | 'driver' | 'browser'): string {
  return language === 'zpl' ? "'Arial Narrow', 'Roboto Condensed', Arial, sans-serif" : "'Courier New', Courier, monospace"
}

/** The text the printer prints for this element (truncated / wrapped by characters, ASCII only for TSPL / EPL). */
export function nativeTextFit(language: RawLabelLanguage | 'driver' | 'browser', dpi: number) {
  return (el: TextElement, text: string): string => {
    const w = Math.max(1, mmToDots(el.width, dpi))
    const h = Math.max(1, mmToDots(el.height, dpi))
    const maxLinesWanted = Math.max(1, el.maxLines || 1)
    if (language === 'zpl') {
      const fh = ptToDots(el.fontSize, dpi)
      const fw = el.fontWeight === 'bold' ? fh : Math.round(fh * 0.85)
      if (maxLinesWanted === 1) {
        const maxChars = Math.max(4, Math.floor(w / Math.max(1, Math.round(fw * 0.58))))
        return text.length > maxChars ? text.slice(0, maxChars) : text
      }
      return text
    }
    if (language === 'tspl' || language === 'epl') {
      const fonts = language === 'tspl' ? TSPL_FONTS : EPL_FONTS[dpi >= 300 ? 300 : 203]
      const f = pickBitmapFont(ptToDots(el.fontSize, dpi), fonts)
      const charW = f.cw * f.mul
      const lineH = f.ch * f.mul
      const maxLines = Math.max(1, Math.min(maxLinesWanted, Math.floor(h / lineH) || 1))
      const maxChars = Math.max(1, Math.floor(w / charW))
      let t = asciiOnly(text)
      if (maxLines === 1 && t.length > maxChars) t = t.slice(0, maxChars)
      return wrapChars(t, maxChars, maxLines).join(' ')
    }
    return text
  }
}
