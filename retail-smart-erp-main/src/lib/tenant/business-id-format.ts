/**
 * Business ID parsing/formatting with no server dependencies (safe in client components).
 * Server-side lookup lives in ./business-id.ts.
 */
export const BUSINESS_ID_RE = /^PL\d{6}$/

/** "pl-482 913" → "PL482913"; returns null when it isn't shaped like a Business ID. */
export function normalizeBusinessId(input: string | null | undefined): string | null {
  if (!input) return null
  const compact = input.trim().toUpperCase().replace(/[\s-]/g, '')
  return BUSINESS_ID_RE.test(compact) ? compact : null
}

/** Display form with a separator for readability: PL482913 → PL-482913 */
export function formatBusinessId(id: string | null | undefined): string {
  if (!id) return ''
  return BUSINESS_ID_RE.test(id) ? `${id.slice(0, 2)}-${id.slice(2)}` : id
}

