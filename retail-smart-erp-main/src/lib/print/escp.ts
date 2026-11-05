/**
 * ESC/P (ESC/P2) encoder for 9-pin / 24-pin dot matrix printers in text mode — Epson LQ-310,
 * LX-350, FX/LQ series and compatibles (Star, Wipro, TVS in Epson emulation).
 *
 * Only what fixed-width documents need: reset, pitch (10 / 12 / 15 / 17 / 20 cpi), bold, line
 * spacing 1/6", page length (inches or lines) and form feed. No graphics: the printer's own
 * resident fonts are used, which is fast and sharp on continuous tractor paper.
 *
 * Pure module (no DOM / server imports). Bytes go to the printer through the print agent's raw
 * POST /print (Windows RAW spooler / CUPS raw / TCP 9100) or WebUSB.
 */

export const ESC = 0x1b
export const SI = 0x0f // condensed on
export const DC2 = 0x12 // condensed off
export const FF = 0x0c // form feed (next top-of-form)
export const CR = 0x0d
export const LF = 0x0a

export type EscpCpi = 10 | 12 | 15 | 17 | 20
export const ESCP_CPIS: EscpCpi[] = [10, 12, 15, 17, 20]

/** Fold to printable ASCII: accents dropped, other non-ASCII (Sinhala / Tamil …) → '?'. */
export function toEscpText(s: string): string {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7e]/g, '?')
}

export class EscpEncoder {
  private out: number[] = []

  private push(...b: number[]): this {
    this.out.push(...b)
    return this
  }

  /** ESC @ — reset to power-on defaults (clears pitch, bold, margins). */
  init(): this {
    return this.push(ESC, 0x40)
  }

  /**
   * Character pitch. 10 = ESC P, 12 = ESC M, 15 = ESC g; 17 / 20 = 10 / 12 cpi condensed (SI).
   * Condensed is cancelled (DC2) for the other pitches.
   */
  pitch(cpi: EscpCpi): this {
    switch (cpi) {
      case 12: return this.push(ESC, 0x4d, DC2)
      case 15: return this.push(ESC, 0x67, DC2)
      case 17: return this.push(ESC, 0x50, SI)
      case 20: return this.push(ESC, 0x4d, SI)
      default: return this.push(ESC, 0x50, DC2)
    }
  }

  /** ESC x n — 0 draft (fast), 1 letter quality (NLQ / LQ). */
  quality(letterQuality: boolean): this {
    return this.push(ESC, 0x78, letterQuality ? 1 : 0)
  }

  /** ESC 2 — 1/6 inch line spacing (6 lines per inch). */
  lineSpacingSixth(): this {
    return this.push(ESC, 0x32)
  }

  /** ESC C NUL n — page length in whole inches (1..22). */
  pageLengthInches(inches: number): this {
    return this.push(ESC, 0x43, 0, Math.min(22, Math.max(1, Math.round(inches))))
  }

  /** ESC C n — page length in lines at the current line spacing (1..127). */
  pageLengthLines(lines: number): this {
    return this.push(ESC, 0x43, Math.min(127, Math.max(1, Math.round(lines))))
  }

  /** ESC E / ESC F — emphasized (bold) on / off. */
  bold(on: boolean): this {
    return this.push(ESC, on ? 0x45 : 0x46)
  }

  /** ESC W n — double width on / off. */
  doubleWidth(on: boolean): this {
    return this.push(ESC, 0x57, on ? 1 : 0)
  }

  text(s: string): this {
    const t = toEscpText(s)
    for (let i = 0; i < t.length; i++) this.out.push(t.charCodeAt(i))
    return this
  }

  newline(): this {
    return this.push(CR, LF)
  }

  formFeed(): this {
    return this.push(FF)
  }

  raw(bytes: ArrayLike<number>): this {
    for (let i = 0; i < bytes.length; i++) this.out.push(bytes[i] & 0xff)
    return this
  }

  encode(): Uint8Array {
    return Uint8Array.from(this.out)
  }
}

export interface TextLine {
  text: string
  bold?: boolean
}

export interface EscpPageOptions {
  cpi: EscpCpi
  /** Page (form) length: inches between perforations. Whole inches use ESC C NUL n, others ESC C n lines. */
  pageLengthInches: number
  letterQuality?: boolean
}

/** Lines per page at 6 lpi. */
export function linesPerPage(pageLengthInches: number): number {
  return Math.max(1, Math.round(pageLengthInches * 6))
}

/**
 * Encode text pages: reset, 1/6" spacing, page length, pitch, then each page's lines followed by a
 * form feed (so every page starts at the next perforation / top-of-form).
 */
export function encodeTextPages(pages: TextLine[][], opts: EscpPageOptions): Uint8Array {
  const e = new EscpEncoder().init().lineSpacingSixth()
  const inches = opts.pageLengthInches
  if (Number.isInteger(inches)) e.pageLengthInches(inches)
  else e.pageLengthLines(linesPerPage(inches))
  e.quality(!!opts.letterQuality).pitch(opts.cpi)
  for (const page of pages) {
    for (const line of page) {
      if (line.bold) e.bold(true)
      e.text(line.text.replace(/\s+$/, ''))
      if (line.bold) e.bold(false)
      e.newline()
    }
    e.formFeed()
  }
  return e.encode()
}
