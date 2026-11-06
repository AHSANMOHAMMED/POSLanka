/**
 * Client-side shapes + small helpers for the super-admin "Business types" console
 * (/sys-control/business-types). The API lives in src/lib/admin/business-type-features.ts.
 */
import { createElement } from 'react'
import { Store, type LucideIcon, type LucideProps } from 'lucide-react'
import { BUSINESS_TYPE_LABELS } from '@/lib/business-types/labels'
import { getBusinessTypeIcon } from '@/lib/constants/business-types'

/** Every business type, in the server's order (same keys as the API). */
export const CONSOLE_BUSINESS_TYPES: Array<{ type: string; label: string }> = Object.entries(BUSINESS_TYPE_LABELS).map(([type, label]) => ({ type, label }))

export function businessTypeIcon(type: string): LucideIcon {
  return getBusinessTypeIcon(type) ?? Store
}

/** The type's icon as an element (a plain lookup, so no component is created during render). */
export function BusinessTypeIcon({ type, ...props }: LucideProps & { type: string }) {
  return createElement(businessTypeIcon(type), props)
}

export function businessTypeHref(type?: string): string {
  return type ? `/sys-control/business-types/${encodeURIComponent(type)}` : '/sys-control/business-types'
}

/** Share as a whole percentage (0 when the total is 0). */
export function pctOf(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 100) : 0
}

// ------------------------------------------------------------------ GET /api/sys-control/business-types

export interface BusinessTypeSummary {
  type: string
  label: string
  tenantCount: number
  statusCounts: Record<string, number>
  activeTenants30d: number
  netSales30d: number
  receipts30d: number
  enabledCounts: Record<string, number>
  preset: Record<string, boolean>
  presetOverridden: string[]
}

export interface BusinessTypeOverview {
  types: BusinessTypeSummary[]
  totals: { tenants: number; activeTenants30d: number; netSales30d: number }
  features: Array<{ key: string; label: string; group: string; businessTypes: string[] | null }>
  groups: string[]
  usageDays: number
}

// ------------------------------------------------------------------ GET /api/sys-control/business-types/[type]

export interface TypeFeature {
  key: string
  label: string
  description: string
  group: string
  offEffect: string | null
  applies: boolean
  usageTracked: boolean
  enabledCount: number
  usedCount: number | null
  activity: number | null
}

export interface TypeTenant {
  id: string
  name: string
  slug: string
  businessId: string | null
  businessSegments: string[] | null
  status: string
  plan: string | null
  createdAt: string
  netSales30d: number
  receipts30d: number
  lastSaleAt: string | null
  featureFlags: Record<string, boolean>
  enabledCount: number
  usedFeatures: string[]
  unusedEnabled: string[]
}

export interface BusinessTypeDetail {
  type: string
  label: string
  usageDays: number
  tenantCount: number
  activeTenants30d: number
  netSales30d: number
  preset: Record<string, boolean>
  codePreset: Record<string, boolean>
  presetOverridden: string[]
  groups: string[]
  features: TypeFeature[]
  tenants: TypeTenant[]
}

// ------------------------------------------------------------------ PUT / DELETE .../[type]/features

export interface ApplyFeaturesBody {
  changes: Record<string, boolean>
  applyToExisting: boolean
  applyToNew: boolean
  tenantIds?: string[]
}

export interface ApplyFeaturesResult {
  changes: Record<string, boolean>
  updatedTenants: number
  updatedTenantIds: string[]
  preset: Record<string, boolean>
  presetOverridden: string[]
}
