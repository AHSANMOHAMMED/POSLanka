/**
 * Pre-print barcode check (L6): runs before anything is sent to a printer or
 * the print dialog, so an unscannable or unfindable barcode is reported
 * instead of silently printed.
 */
import type { BarcodeElement, LabelItemData } from '@/lib/labels/types'
import type { LabelTemplateLike } from './common'
import { barcodeSourceValue } from './common'
import { chooseSymbology, minModuleDots, planLinear, SYMBOLOGY_NAMES, TWO_D_FORMATS } from './barcode-fit'

export interface LabelPreflightIssue {
  itemId: string | null
  itemName: string
  value: string
  severity: 'error' | 'warning'
  message: string
}

export interface LabelPreflightResult {
  issues: LabelPreflightIssue[]
  errors: number
  warnings: number
  /** item id -> "EAN-13 4791234567891" (what each label encodes). */
  encodes: Record<string, string>
}

export function preflightLabels(
  template: LabelTemplateLike,
  items: { item: LabelItemData | null; quantity?: number }[],
  o: { dpi: 203 | 300; labelWidthMm?: number; tenantName?: string }
): LabelPreflightResult {
  const issues: LabelPreflightIssue[] = []
  const encodes: Record<string, string> = {}
  const dpi = o.dpi
  const dpm = dpi / 25.4
  const labelWmm = o.labelWidthMm ?? Number(template.widthMm)
  const barcodes = (template.elements || []).filter((e): e is BarcodeElement => e.type === 'barcode')
  const seen = new Set<string>()
  const shortBars = new Set<string>()
  for (const { item } of items) {
    const key = item?.id ?? '-'
    if (seen.has(key)) continue
    seen.add(key)
    const name = item?.name || 'Sample'
    for (const el of barcodes) {
      const value = barcodeSourceValue(el, item, o)
      const choice = chooseSymbology(el.format, value)
      if ('error' in choice) {
        issues.push({ itemId: item?.id ?? null, itemName: name, value, severity: 'error', message: `No barcode printed: ${choice.error}. Give the item a barcode or SKU first.` })
        continue
      }
      if (item?.id) encodes[item.id] = `${SYMBOLOGY_NAMES[choice.format] || choice.format} ${choice.value}`
      if (choice.note) issues.push({ itemId: item?.id ?? null, itemName: name, value, severity: 'warning', message: choice.note })
      if (TWO_D_FORMATS.includes(choice.format)) continue
      const plan = planLinear(choice.format, choice.data, dpi, Math.round(el.x * dpm), Math.max(1, Math.round(el.width * dpm)), Math.round(labelWmm * dpm))
      if (!plan.fits) {
        const needMm = Math.ceil(((plan.symbolDots + 2 * plan.quietDots) / dpm) * 10) / 10
        issues.push({
          itemId: item?.id ?? null,
          itemName: name,
          value,
          severity: 'error',
          message: `"${choice.value}" is too long for a ${labelWmm} mm label: it needs ${needMm} mm at the thinnest scannable bars (${minModuleDots(dpi)} dots). Use a shorter code (e.g. the item's EAN-13 barcode) or a wider label.`,
        })
      }
      const barMm = el.height - (el.showText ? 2.5 : 0)
      if (barMm < 6 && !shortBars.has(el.id)) {
        shortBars.add(el.id)
        issues.push({ itemId: item?.id ?? null, itemName: name, value, severity: 'warning', message: `Barcode bars are only ${barMm.toFixed(1)} mm tall; 8 mm or more scans best (make the barcode taller in the template).` })
      }
    }
  }
  return { issues, errors: issues.filter((i) => i.severity === 'error').length, warnings: issues.filter((i) => i.severity === 'warning').length, encodes }
}
