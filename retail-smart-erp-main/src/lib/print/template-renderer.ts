// Letter heads (letter_heads table) applied to printed documents.
// Heights are millimetres (the letter-head settings page labels them "mm"); the header / footer
// HTML is sanitised (no scripts / event handlers) because it is written into a same-origin print frame.
import { sanitizeHtml } from '@/lib/utils/sanitize-html'

export interface LetterHeadConfig {
  headerHtml?: string | null
  footerHtml?: string | null
  headerImage?: string | null
  footerImage?: string | null
  /** mm */
  headerHeight: number
  /** mm */
  footerHeight: number
  alignment: 'left' | 'center' | 'right'
}

export interface PrintTemplateConfig {
  paperSize: string
  orientation: string
  margins: { top: number; right: number; bottom: number; left: number }
  showLogo: boolean
  showHeader: boolean
  showFooter: boolean
  customCss?: string | null
  letterHead?: LetterHeadConfig | null
}

/** Only http(s), same-origin paths and data:image URLs. */
function safeUrl(v: string | null | undefined): string {
  const s = (v || '').trim()
  if (!s) return ''
  if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(s)) return s
  if (/^https?:\/\/[^\s"'<>]+$/i.test(s)) return s
  if (/^\/[^\s"'<>]*$/.test(s) && !s.startsWith('//')) return s
  return ''
}

function heightMm(v: unknown, dflt: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.min(150, n) : dflt
}

/**
 * The letter-head header or footer block (empty string when it has no content). Height is a
 * minimum height in mm; the image is limited to that height.
 */
export function letterHeadBlockHtml(letterHead: LetterHeadConfig | null | undefined, part: 'header' | 'footer'): string {
  if (!letterHead) return ''
  const align = ['left', 'center', 'right'].includes(letterHead.alignment) ? letterHead.alignment : 'center'
  const img = safeUrl(part === 'header' ? letterHead.headerImage : letterHead.footerImage)
  const html = sanitizeHtml((part === 'header' ? letterHead.headerHtml : letterHead.footerHtml) || '')
  if (!img && !html.trim()) return ''
  const h = part === 'header' ? heightMm(letterHead.headerHeight, 60) : heightMm(letterHead.footerHeight, 30)
  return `<div class="lh-${part}" style="text-align:${align};min-height:${h}mm">${img ? `<img src="${img.replace(/"/g, '&quot;')}" alt="" style="max-height:${h}mm;max-width:100%">` : ''}${html}</div>`
}

/** CSS for letter-head blocks inside a printed document. */
export const LETTER_HEAD_CSS = `.lh-header { margin-bottom: 4mm; overflow: hidden; }
.lh-footer { margin-top: 4mm; overflow: hidden; }
.lh-header img, .lh-footer img { display: inline-block; object-fit: contain; }`

export function renderWithLetterHead(
  content: string,
  letterHead: LetterHeadConfig | null | undefined
): string {
  if (!letterHead) return content
  return `${letterHeadBlockHtml(letterHead, 'header')}${content}${letterHeadBlockHtml(letterHead, 'footer')}`
}

export function buildTemplateStyles(
  config: PrintTemplateConfig,
  width: number,
  height: number
): string {
  let css = `
    @page {
      size: ${width}mm ${height}mm;
      margin: ${config.margins.top}mm ${config.margins.right}mm ${config.margins.bottom}mm ${config.margins.left}mm;
    }
  `

  if (config.letterHead) css += `\n${LETTER_HEAD_CSS}`

  if (config.customCss) {
    css += '\n' + config.customCss
  }

  return css
}
