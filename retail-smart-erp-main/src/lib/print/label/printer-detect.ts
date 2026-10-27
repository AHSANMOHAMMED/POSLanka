/**
 * Recognise label printers among the printers installed on a PC (print agent
 * GET /printers: name + driver) and guess their command language and DPI.
 * Pure; the guess is only a default - the user can always override language
 * and DPI and confirm with a test / alignment print.
 */
import type { RawLabelLanguage } from './common'

/** Brand / model / driver words of thermal label printers. */
export const LABEL_PRINTER_PATTERN =
  /zebra|zdesigner|\bzd\s?-?\d{3}|\bgk4|\bgx4|\bgc4|\bzt\s?-?\d{3}|\blp\s?-?28\d\d|\btlp|tsc|\bttp\b|\bttp-|\bte\s?-?[23]\d\d|\bda\s?-?2\d\d|xprinter|\bxp-|\bxp\s?\d{3}|godex|argox|honeywell|datamax|intermec|\bdbl\b|dbl-|label|barcode|bixolon|citizen|\bsato\b|rongta|hprt|gainscha|gprinter|\bsnbc|\bdeli\b|idprt|\btsp\b/i

export interface LabelPrinterGuess {
  language: Exclude<RawLabelLanguage, 'escpos-raster'>
  dpi: 203 | 300
  /** Brand family used for setup tips. */
  brand: 'zebra' | 'tsc' | 'xprinter' | 'godex' | 'honeywell' | 'argox' | 'bixolon' | 'citizen' | 'sato' | 'generic'
  /** True when the language is certain (e.g. ZDesigner driver); false = check with a test print. */
  confident: boolean
  /** Short hint shown next to the guess. */
  note?: string
}

export function isLikelyLabelPrinter(name: string, driver?: string | null): boolean {
  return LABEL_PRINTER_PATTERN.test(`${name} ${driver || ''}`)
}

/** DPI from the model / driver name ("300dpi", "-300", TSC TTP-345 / TE310 ...). */
export function guessDpi(text: string): 203 | 300 {
  const t = text.toLowerCase()
  if (/300\s*dpi|[-_ ]300\b|\b300\b|12\s*dots|ttp-?\d45|\bte\s?-?3\d0|\bda\s?-?3\d0|zd\d{3}-?300|\b[zg]t\d{3}-?300/.test(t)) return 300
  return 203
}

export function guessLabelPrinter(name: string, driver?: string | null): LabelPrinterGuess {
  const t = `${name} ${driver || ''}`.toLowerCase()
  const dpi = guessDpi(t)
  // EPL-only Zebra desktop models (LP/TLP 2844, 2824): ZPL is not understood.
  if (/\bt?lp\s?-?28[24]4\b|eltron/.test(t) && !/zpl/.test(t)) return { language: 'epl', dpi, brand: 'zebra', confident: true }
  if (/zebra|zdesigner|\bzd\s?-?\d{3}|\bg[kxc]4\d\d|\bzt\s?-?\d{3}/.test(t)) {
    const epl = /\bepl\b/.test(t) && !/zpl/.test(t)
    return { language: epl ? 'epl' : 'zpl', dpi, brand: 'zebra', confident: true }
  }
  if (/godex/.test(t)) {
    return {
      language: 'zpl',
      dpi,
      brand: 'godex',
      confident: /zpl/.test(t),
      note: 'GoDEX prints ZPL through its built-in emulation. If the test label prints as text, choose TSPL/EPL or enable ZPL emulation in GoDEX GoLabel / printer menu.',
    }
  }
  if (/honeywell|datamax|intermec/.test(t)) {
    return { language: 'zpl', dpi, brand: 'honeywell', confident: /zpl|zsim/.test(t), note: 'Honeywell / Datamax / Intermec: set the printer to ZPL (ZSim) emulation, or pick EPL if your model only has EPL.' }
  }
  if (/argox/.test(t)) {
    return { language: 'zpl', dpi, brand: 'argox', confident: /zpl|pplz/.test(t), note: 'Argox: use the PPLZ (ZPL) emulation; older PPLA/PPLB-only models need EPL or the browser path.' }
  }
  if (/bixolon/.test(t)) return { language: 'zpl', dpi, brand: 'bixolon', confident: /zpl/.test(t), note: 'Bixolon label printers accept ZPL via emulation (SLCS is not supported).' }
  if (/citizen/.test(t)) return { language: 'zpl', dpi, brand: 'citizen', confident: /zpl/.test(t), note: 'Citizen CL-S / CL-E auto-detect ZPL (Cross-Emulation).' }
  if (/\bsato\b/.test(t)) return { language: 'zpl', dpi, brand: 'sato', confident: /zpl/.test(t), note: 'SATO: enable ZPL emulation on the printer (SBPL is not supported).' }
  if (/\bzpl\b/.test(t)) return { language: 'zpl', dpi, brand: 'generic', confident: true }
  if (/\bepl\b/.test(t)) return { language: 'epl', dpi, brand: 'generic', confident: true }
  if (/tsc|\bttp\b|\bttp-|\bte\s?-?[23]\d\d|\bda\s?-?[23]\d\d/.test(t)) return { language: 'tspl', dpi, brand: 'tsc', confident: true }
  if (/xprinter|\bxp-|\bxp\s?\d{3}/.test(t)) return { language: 'tspl', dpi, brand: 'xprinter', confident: true }
  // Gprinter, Gainscha, HPRT, Rongta, DBL, SNBC, Deli, iDPRT and unbranded "Label / Barcode printer" drivers speak TSPL.
  return { language: 'tspl', dpi, brand: 'generic', confident: /gprinter|gainscha|hprt|rongta|dbl|snbc|deli|idprt|tspl/.test(t) }
}

/** Printers sorted label printers first (then the OS default, then by name). */
export function sortPrintersForLabels<T extends { name: string; driver?: string | null; isDefault?: boolean }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const la = isLikelyLabelPrinter(a.name, a.driver) ? 0 : 1
    const lb = isLikelyLabelPrinter(b.name, b.driver) ? 0 : 1
    if (la !== lb) return la - lb
    if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/** Driver / printer names whose drivers are known to pass raw ZPL / TSPL / EPL through. */
export const RAW_CAPABLE_PATTERN =
  /zebra|zdesigner|eltron|\btlp\s?-?28|\blp\s?-?28\d\d|tsc|\bttp\b|\bttp-|\bte\s?-?2\d\d|xprinter|\bxp-|\bxp\s?\d{3}|gprinter|gainscha|hprt|rongta|\bdeli\b|\bsnbc|godex|\bzpl\b|\btspl\b|\bepl2?\b/i

/**
 * Default print mode for a printer installed in the OS (print agent list):
 * its raw language for known raw-capable families (Zebra -> ZPL, TSC /
 * Xprinter / Gprinter / HPRT / Rongta / Deli / SNBC -> TSPL, GoDEX -> ZPL
 * emulation), else 'driver' (an exact-size image printed through the
 * installed driver, works with any driver). The user can always switch.
 */
export function defaultAgentLabelLanguage(name: string, driver?: string | null): LabelPrinterGuess['language'] | 'driver' {
  if (!RAW_CAPABLE_PATTERN.test(`${name} ${driver || ''}`)) return 'driver'
  return guessLabelPrinter(name, driver).language
}
