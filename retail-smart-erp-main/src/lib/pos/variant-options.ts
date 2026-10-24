/**
 * Variant picker logic (sizes / colours …) for the POS: builds the attribute rows, per-option stock,
 * keeps the selection on an in-stock combination, and matches what the cashier types ("m", "xl",
 * "xxl", "2xl", "32", or a digit = the nth option). Pure — self-tested in scripts/pos-keyboard-selftest.ts.
 */

export interface VariantLike {
  id: string
  name: string
  variantAttributes?: Record<string, string> | null | unknown
  trackStock?: boolean | null
  availableStock?: string | number | null
}

export interface VariantRow {
  key: string
  /** Label to show ("Size"); the synthetic row is called "Variant" */
  label: string
  options: string[]
}

export type VariantSelection = Record<string, string>

/** Used when variants carry no attributes: one row with the variant names */
export const SYNTHETIC_KEY = '__variant'

function attrsOf(v: VariantLike): Record<string, string> {
  const a = v.variantAttributes
  return a && typeof a === 'object' ? (a as Record<string, string>) : {}
}

export function variantAttrs(v: VariantLike, rows: VariantRow[]): Record<string, string> {
  if (rows.length === 1 && rows[0].key === SYNTHETIC_KEY) return { [SYNTHETIC_KEY]: v.name }
  return attrsOf(v)
}

/** Sellable units of a variant (Infinity when stock is not tracked) */
export function variantStock(v: VariantLike): number {
  if (!v.trackStock) return Infinity
  const n = typeof v.availableStock === 'number' ? v.availableStock : parseFloat(String(v.availableStock ?? '0'))
  return Number.isFinite(n) ? n : 0
}

export function buildVariantRows(
  variants: VariantLike[],
  attributeKeys?: string[] | null,
  attributeValues?: Record<string, string[]> | null,
): VariantRow[] {
  const keys: string[] = []
  for (const k of attributeKeys || []) if (!keys.includes(k)) keys.push(k)
  for (const v of variants) for (const k of Object.keys(attrsOf(v))) if (!keys.includes(k)) keys.push(k)

  const rows: VariantRow[] = []
  for (const key of keys) {
    const present: string[] = []
    for (const v of variants) {
      const val = attrsOf(v)[key]
      if (val !== undefined && val !== null && val !== '' && !present.includes(val)) present.push(val)
    }
    if (present.length === 0) continue
    const ordered = (attributeValues?.[key] || []).filter((o) => present.includes(o))
    for (const p of present) if (!ordered.includes(p)) ordered.push(p)
    rows.push({ key, label: key, options: ordered })
  }
  if (rows.length === 0 && variants.length > 0) {
    rows.push({ key: SYNTHETIC_KEY, label: 'Variant', options: variants.map((v) => v.name) })
  }
  return rows
}

function matchesSelection(attrs: Record<string, string>, sel: VariantSelection, skipKey?: string): boolean {
  return Object.entries(sel).every(([k, val]) => k === skipKey || !val || attrs[k] === val)
}

/** The variant for a full selection (null when the combination does not exist) */
export function findVariant<V extends VariantLike>(variants: V[], rows: VariantRow[], sel: VariantSelection): V | null {
  if (rows.some((r) => !sel[r.key])) return null
  return variants.find((v) => {
    const a = variantAttrs(v, rows)
    return rows.every((r) => a[r.key] === sel[r.key])
  }) || null
}

/**
 * Stock of one option given the other selected attributes. `exists` = the combination exists at all;
 * `sellable` = the option can be sold in SOME combination (used to disable an option completely).
 */
export function optionStock(
  variants: VariantLike[], rows: VariantRow[], sel: VariantSelection, key: string, value: string,
): { stock: number; exists: boolean; sellable: boolean } {
  let stock = 0
  let exists = false
  let sellable = false
  for (const v of variants) {
    const a = variantAttrs(v, rows)
    if (a[key] !== value) continue
    const s = variantStock(v)
    if (s > 0) sellable = true
    if (matchesSelection(a, sel, key)) {
      exists = true
      stock += s
    }
  }
  return { stock, exists, sellable }
}

/**
 * Pick `value` for `key`. When the resulting combination does not exist or is out of stock, the other
 * attributes move to the in-stock variant that keeps the most of the current choices.
 */
export function selectOption(
  variants: VariantLike[], rows: VariantRow[], sel: VariantSelection, key: string, value: string,
): VariantSelection {
  const next: VariantSelection = { ...sel, [key]: value }
  const exact = findVariant(variants, rows, next)
  if (exact && variantStock(exact) > 0) return next
  let best: { attrs: Record<string, string>; score: number } | null = null
  for (const v of variants) {
    const a = variantAttrs(v, rows)
    if (a[key] !== value || variantStock(v) <= 0) continue
    const score = rows.reduce((n, r) => n + (r.key !== key && a[r.key] === sel[r.key] ? 1 : 0), 0)
    if (!best || score > best.score) best = { attrs: a, score }
  }
  if (!best) return next
  const out: VariantSelection = {}
  for (const r of rows) out[r.key] = best.attrs[r.key]
  return out
}

/** Initial selection: the first in-stock variant (else the first one) */
export function initialSelection(variants: VariantLike[], rows: VariantRow[]): VariantSelection {
  const v = variants.find((x) => variantStock(x) > 0) || variants[0]
  if (!v) return {}
  const a = variantAttrs(v, rows)
  const out: VariantSelection = {}
  for (const r of rows) if (a[r.key]) out[r.key] = a[r.key]
  return out
}

/** "2XL" → "xxl", " X L " → "xl", "Black" → "black" */
export function normalizeOptionText(s: string): string {
  let t = s.toLowerCase().replace(/\s+/g, '')
  const m = /^([2-5])x([sl])$/.exec(t)
  if (m) t = 'x'.repeat(parseInt(m[1], 10)) + m[2]
  return t
}

/** How long a pause starts a new typed word (ms) */
export const TYPE_RESET_MS = 900

/**
 * Match typed text against a row's options.
 * - exact label first ("l" → L, not "Lime"), then the first enabled label starting with the text
 *   ("x" → XS/XL…, "xx" → XXL), labels that are numbers (shoe/waist sizes) match as text;
 * - otherwise a pure number picks the nth option (1-based);
 * - when nothing matches the whole buffer, it restarts with the last character.
 * Returns the matched option index (or null) and the buffer to keep.
 */
export function matchTypedOption(
  options: string[], disabled: boolean[], buffer: string, ch: string,
): { index: number | null; buffer: string } {
  const tryMatch = (buf: string): number | null => {
    const q = normalizeOptionText(buf)
    const qRaw = buf.toLowerCase().replace(/\s+/g, '')
    if (!q) return null
    const norm = options.map(normalizeOptionText)
    const raw = options.map((o) => o.toLowerCase().replace(/\s+/g, ''))
    const ok = (i: number) => !disabled[i]
    const exact = (k: number) => norm[k] === q || raw[k] === qRaw
    const prefix = (k: number) => norm[k].startsWith(q) || raw[k].startsWith(qRaw)
    let i = options.findIndex((_o, k) => ok(k) && exact(k))
    if (i >= 0) return i
    i = options.findIndex((_o, k) => ok(k) && prefix(k))
    if (i >= 0) return i
    // an option exists but is disabled → stop here (do not fall back to "nth")
    if (options.some((_o, k) => exact(k) || prefix(k))) return -1
    if (/^\d+$/.test(q)) {
      const n = parseInt(q, 10) - 1
      if (n >= 0 && n < options.length && ok(n)) return n
    }
    return null
  }
  const full = buffer + ch
  const a = tryMatch(full)
  if (a !== null) return { index: a >= 0 ? a : null, buffer: full }
  const b = tryMatch(ch)
  if (b !== null) return { index: b >= 0 ? b : null, buffer: ch }
  return { index: null, buffer: '' }
}

/** Next enabled option index moving left/right (wraps) */
export function stepOption(disabled: boolean[], index: number, delta: 1 | -1): number {
  const n = disabled.length
  if (n === 0) return -1
  let i = index
  for (let step = 0; step < n; step++) {
    i = (i + delta + n) % n
    if (!disabled[i]) return i
  }
  return index
}
