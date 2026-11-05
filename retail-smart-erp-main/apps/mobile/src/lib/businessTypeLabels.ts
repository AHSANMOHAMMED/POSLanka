// Display names of the business types (vendor app + mobile super admin). Same words as the web
// super admin; 'mall' runs several of the others (src/lib/businessScope.ts).
import { MALL, cleanSegments } from './businessScope'

const LABELS: Record<string, string> = {
  retail: 'Retail',
  restaurant: 'Restaurant',
  supermarket: 'Supermarket',
  auto_service: 'Auto service',
  dealership: 'Dealership',
  pharmacy: 'Pharmacy',
  electronics: 'Electronics & appliances',
  hardware: 'Hardware',
  print_studio: 'Printing & photo studio',
  office: 'Office & services',
  textile: 'Textile & clothing',
  mall: 'Mall / Multi-shop',
}

export const MALL_DESCRIPTION = 'Supermarket, textile, electronics, stationery, pharmacy, food court… in one business'

export function businessTypeLabel(t: string | null | undefined): string {
  if (!t) return 'Unknown'
  return LABELS[t] || t.replace(/_/g, ' ')
}

/** Valid segments of a mall (empty for any other type). */
export function mallSegments(businessType: string | null | undefined, segments: readonly unknown[] | null | undefined): string[] {
  return businessType === MALL ? cleanSegments(segments) : []
}

/** Short label of a POS counter's segment ('' when none) — e.g. "Restaurant counter". */
export function counterSegmentLabel(segment: string | null | undefined): string {
  return segment ? `${businessTypeLabel(segment)} counter` : ''
}
