/**
 * Paper sizes for document printing (invoices, quotations, credit notes, purchase orders, job
 * cards, warranty cards …) and the page-level HTML/CSS shared by every A4 / A5 / dot-matrix
 * print path.
 *
 * Sizes are portrait millimetres; `landscape` swaps width and height. The two "continuous" sizes
 * are tractor-feed stock for 9-pin / 24-pin dot matrix printers (Epson LQ-310, LX-350 …):
 * 9.5" wide including the sprocket strips, 11" (full) or 5.5" (half) between perforations.
 *
 * Pure module (no DOM / server imports): safe in tests, server code and the browser.
 */

export const MM_PER_INCH = 25.4

export const DOC_PAPER_SIZES = [
  'a4', 'a5', 'a6', 'letter', 'legal', 'half_letter', 'cont_9_5x11', 'cont_9_5x5_5', 'custom',
] as const
export type DocPaperSize = (typeof DOC_PAPER_SIZES)[number]
export type DocOrientation = 'portrait' | 'landscape'

export const DOC_PAPER_MM: Record<DocPaperSize, { width: number; height: number; label: string }> = {
  a4: { width: 210, height: 297, label: 'A4' },
  a5: { width: 148, height: 210, label: 'A5' },
  a6: { width: 105, height: 148, label: 'A6' },
  letter: { width: 215.9, height: 279.4, label: 'Letter' },
  legal: { width: 215.9, height: 355.6, label: 'Legal' },
  half_letter: { width: 139.7, height: 215.9, label: 'Half letter (5.5 × 8.5 in)' },
  cont_9_5x11: { width: 241.3, height: 279.4, label: 'Continuous 9.5 × 11 in (dot matrix)' },
  cont_9_5x5_5: { width: 241.3, height: 139.7, label: 'Continuous 9.5 × 5.5 in (dot matrix, half)' },
  custom: { width: 210, height: 297, label: 'Custom size (mm)' },
}

/** Custom paper limits (mm). */
export const CUSTOM_PAPER_MIN_MM = 40
export const CUSTOM_PAPER_MAX_MM = 1200

export function isDocPaperSize(v: unknown): v is DocPaperSize {
  return typeof v === 'string' && (DOC_PAPER_SIZES as readonly string[]).includes(v)
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** Round to 2 decimals (keeps CSS output short and stable). */
export function roundMm(n: number): number {
  return Math.round(n * 100) / 100
}

export function inchesToMm(inches: number): number {
  return roundMm(inches * MM_PER_INCH)
}

export function mmToInches(mm: number): number {
  return mm / MM_PER_INCH
}

/**
 * Page size in mm after orientation. Unknown sizes fall back to A4; `custom` uses the given
 * width / height (clamped), defaulting to A4 when missing.
 */
export function resolvePageMm(
  size: string | null | undefined,
  orientation: string | null | undefined = 'portrait',
  custom?: { widthMm?: number | null; heightMm?: number | null } | null,
): { width: number; height: number } {
  let w: number
  let h: number
  if (size === 'custom') {
    const cw = Number(custom?.widthMm)
    const ch = Number(custom?.heightMm)
    w = Number.isFinite(cw) && cw > 0 ? clamp(cw, CUSTOM_PAPER_MIN_MM, CUSTOM_PAPER_MAX_MM) : DOC_PAPER_MM.a4.width
    h = Number.isFinite(ch) && ch > 0 ? clamp(ch, CUSTOM_PAPER_MIN_MM, CUSTOM_PAPER_MAX_MM) : DOC_PAPER_MM.a4.height
  } else {
    const p = isDocPaperSize(size) ? DOC_PAPER_MM[size] : DOC_PAPER_MM.a4
    w = p.width
    h = p.height
  }
  return orientation === 'landscape' ? { width: h, height: w } : { width: w, height: h }
}

export interface PageMarginsMm {
  top: number
  right: number
  bottom: number
  left: number
}

/** `@page` rule for a page of the given size (mm) and margins (mm). */
export function pageRuleCss(widthMm: number, heightMm: number, marginsMm: PageMarginsMm | number = 0): string {
  const m = typeof marginsMm === 'number' ? { top: marginsMm, right: marginsMm, bottom: marginsMm, left: marginsMm } : marginsMm
  const v = (n: number) => `${roundMm(Math.max(0, Number(n) || 0))}mm`
  return `@page { size: ${roundMm(widthMm)}mm ${roundMm(heightMm)}mm; margin: ${v(m.top)} ${v(m.right)} ${v(m.bottom)} ${v(m.left)}; }`
}

/** True for tractor-feed (dot matrix) stock. */
export function isContinuousPaper(size: string | null | undefined): boolean {
  return size === 'cont_9_5x11' || size === 'cont_9_5x5_5'
}

export interface HtmlPageOptions {
  /** Paper size key (default A4). */
  paperSize?: DocPaperSize | string | null
  orientation?: DocOrientation | string | null
  /** For paperSize 'custom'. */
  customWidthMm?: number | null
  customHeightMm?: number | null
  /** Page margins in mm (default 10 on every side). */
  marginsMm?: Partial<PageMarginsMm> | number | null
  /** Document <title> (also the default PDF file name in "Save as PDF"). */
  title?: string
  /** Extra CSS appended after the base page CSS. */
  css?: string
  /** Screen preview look: grey backdrop with a paper-sized white sheet. */
  preview?: boolean
}

function escapeTitle(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Wrap an HTML body fragment into a complete, self-contained page sized for the chosen paper.
 * Used by printHtmlPage() (document-print.ts) and by other modules that build their own
 * document markup (job cards, warranty cards …). The body is inserted as-is: callers escape
 * their data.
 */
export function buildHtmlPage(bodyHtml: string, opts: HtmlPageOptions = {}): string {
  const { width, height } = resolvePageMm(opts.paperSize || 'a4', opts.orientation || 'portrait', {
    widthMm: opts.customWidthMm, heightMm: opts.customHeightMm,
  })
  const mRaw = opts.marginsMm
  const base = typeof mRaw === 'number' ? mRaw : 10
  const mo = typeof mRaw === 'object' && mRaw ? mRaw : {}
  const m: PageMarginsMm = {
    top: Number(mo.top ?? base), right: Number(mo.right ?? base), bottom: Number(mo.bottom ?? base), left: Number(mo.left ?? base),
  }
  const css = `${pageRuleCss(width, height, m)}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: 'Helvetica Neue', Helvetica, Arial, 'Noto Sans Sinhala', 'Noto Sans Tamil', sans-serif; font-size: 10pt; line-height: 1.35; color: #111;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media screen {
  body { background: ${opts.preview ? '#e5e7eb' : '#fff'}; }
  .doc-page { ${opts.preview ? `width: ${roundMm(width)}mm; min-height: ${roundMm(height)}mm; margin: 16px auto; background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.18);` : `max-width: ${roundMm(width)}mm; margin: 0 auto;`} padding: ${roundMm(m.top)}mm ${roundMm(m.right)}mm ${roundMm(m.bottom)}mm ${roundMm(m.left)}mm; }
}
@media print { .doc-page { padding: 0; } }
${(opts.css || '').replace(/<\/?style/gi, '')}`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeTitle(opts.title || 'Document')}</title><style>${css}</style></head><body><div class="doc-page">${bodyHtml}</div></body></html>`
}
