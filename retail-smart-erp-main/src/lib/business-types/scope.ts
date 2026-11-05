/**
 * Business scope: which business types a vendor actually runs.
 *
 * Every vendor has one `business_type`. A 'mall' (department store / multi-shop) also lists the
 * types it runs in `tenants.business_segments` — e.g. grocery + textile + electronics + food court —
 * and gets the menus, features, roles and reports of all of them. For every other vendor the scope
 * is just its own type, so code written as `hasBusinessType(scope, 'restaurant')` behaves exactly
 * like the old `businessType === 'restaurant'`.
 *
 * A "scope" is accepted in any of the shapes callers already have:
 *  - a plain business type string ('restaurant'; 'mall' alone = the default mall segments)
 *  - an array of types (already resolved, e.g. session.user.businessTypes)
 *  - { businessType, businessSegments } (a tenants row / session user)
 */

export const MALL = 'mall'

/** Business types a mall can run (every type except 'mall' itself), in menu order. */
export const SEGMENT_TYPES = [
  'supermarket',
  'retail',
  'textile',
  'electronics',
  'hardware',
  'pharmacy',
  'restaurant',
  'print_studio',
  'office',
  'auto_service',
  'dealership',
] as const
export type SegmentType = (typeof SEGMENT_TYPES)[number]

/** A mall saved without segments (or a bare 'mall' string) runs these. */
export const DEFAULT_MALL_SEGMENTS: readonly SegmentType[] = ['supermarket', 'retail']

/**
 * When a mall needs ONE type (terminology, default till mode, landing page), the first of these
 * that it runs wins: general store types before specialised ones.
 */
const PRIMARY_ORDER: readonly string[] = [
  'supermarket', 'retail', 'textile', 'electronics', 'hardware', 'pharmacy',
  'restaurant', 'print_studio', 'office', 'auto_service', 'dealership',
]

export type BusinessScope =
  | string
  | readonly string[]
  | { businessType?: string | null; businessSegments?: readonly string[] | null }
  | null
  | undefined

const SEGMENT_SET = new Set<string>(SEGMENT_TYPES)

/** Valid, de-duplicated segments in SEGMENT_TYPES order. */
export function cleanSegments(segments: readonly unknown[] | null | undefined): SegmentType[] {
  if (!Array.isArray(segments)) return []
  const want = new Set(segments.filter((s): s is string => typeof s === 'string' && SEGMENT_SET.has(s)))
  return SEGMENT_TYPES.filter((t) => want.has(t))
}

/** The business types a vendor runs: its segments for a mall, otherwise just its own type. */
export function businessTypesOf(businessType: string | null | undefined, segments?: readonly unknown[] | null): string[] {
  if (!businessType) return []
  if (businessType !== MALL) return [businessType]
  const s = cleanSegments(segments)
  return s.length ? s : [...DEFAULT_MALL_SEGMENTS]
}

/** Normalises any scope shape to the list of business types. */
export function scopeTypes(scope: BusinessScope): string[] {
  if (!scope) return []
  if (typeof scope === 'string') return businessTypesOf(scope)
  if (Array.isArray(scope)) {
    const list = scope as readonly string[]
    // An array that still contains 'mall' (e.g. [businessType, ...segments]) resolves the same way
    return list.includes(MALL) ? businessTypesOf(MALL, list.filter((t) => t !== MALL)) : [...list]
  }
  const s = scope as { businessType?: string | null; businessSegments?: readonly string[] | null }
  return businessTypesOf(s.businessType, s.businessSegments)
}

export function isMall(scope: BusinessScope): boolean {
  if (!scope) return false
  if (typeof scope === 'string') return scope === MALL
  if (Array.isArray(scope)) return (scope as readonly string[]).includes(MALL)
  return (scope as { businessType?: string | null }).businessType === MALL
}

/** Does the vendor run this business type (or any of these)? */
export function hasBusinessType(scope: BusinessScope, type: string | readonly string[]): boolean {
  const types = scopeTypes(scope)
  return typeof type === 'string' ? types.includes(type) : type.some((t) => types.includes(t))
}

/** The one type to use where a single answer is needed (terminology, landing page, till mode). */
export function primaryBusinessType(scope: BusinessScope): string {
  const types = scopeTypes(scope)
  if (types.length <= 1) return types[0] ?? ''
  return PRIMARY_ORDER.find((t) => types.includes(t)) ?? types[0]
}

/**
 * The type a till works as. A mall counter may be set to one of the mall's segments (food-court
 * counter → 'restaurant'); anything else falls back to the vendor's primary type.
 */
export function tillBusinessType(scope: BusinessScope, counterSegment?: string | null): string {
  const types = scopeTypes(scope)
  if (counterSegment && types.includes(counterSegment)) return counterSegment
  return primaryBusinessType(scope)
}
