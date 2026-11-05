/**
 * Plain business-type labels for server code and API responses (no icon imports).
 * The web UI has the richer list in src/lib/constants/business-types.ts.
 */
import { MALL, SEGMENT_TYPES, type SegmentType } from './scope'

export const BUSINESS_TYPE_LABELS: Record<string, string> = {
  retail: 'Retail Store',
  restaurant: 'Restaurant',
  supermarket: 'Supermarket',
  pharmacy: 'Pharmacy',
  electronics: 'Electronics & Appliances',
  hardware: 'Hardware & Building Supplies',
  print_studio: 'Printing & Photo Studio',
  office: 'Office & Services',
  textile: 'Textile & Clothing',
  auto_service: 'Auto Service',
  dealership: 'Vehicle Dealership',
  [MALL]: 'Mall / Multi-shop',
}

export function businessTypeLabel(type: string | null | undefined): string {
  return (type && BUSINESS_TYPE_LABELS[type]) || type || ''
}

/** Every type a mall can run, with its label (super admin forms, mobile admin). */
export function segmentTypeOptions(): Array<{ value: SegmentType; label: string }> {
  return SEGMENT_TYPES.map((value) => ({ value, label: BUSINESS_TYPE_LABELS[value] || value }))
}
