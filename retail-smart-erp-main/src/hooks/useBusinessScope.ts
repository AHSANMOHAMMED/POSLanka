'use client'

import { useContext, useMemo } from 'react'
import { SessionContext } from 'next-auth/react'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import {
  businessTypesOf,
  hasBusinessType,
  isMall as scopeIsMall,
  primaryBusinessType,
  type BusinessScope,
} from '@/lib/business-types/scope'

export interface BusinessScopeInfo {
  /** The vendor's own type ('mall' for a multi-shop vendor) */
  businessType: string
  /** 'mall' only: the business types it runs; null otherwise */
  businessSegments: string[] | null
  /** The business types the vendor runs (just [businessType] for every non-mall vendor) */
  types: string[]
  isMall: boolean
  /** Does the vendor run this type (or any of these)? */
  has: (type: string | readonly string[]) => boolean
  /** The one type for terminology / landing page / default till mode */
  primary: string
  /** Pass to helpers that accept a BusinessScope (getModuleSidebar, getTerms …) */
  scope: { businessType: string; businessSegments: string[] | null }
}

/**
 * Which business types the signed-in vendor runs. The session copy wins when it belongs to the
 * same tenant: it re-reads business_type / business_segments every ~20 s, so a super admin
 * changing the type (e.g. supermarket → mall) reaches open tabs without a reload. The company
 * context (rendered by the /c/[slug] layout) is the fallback.
 */
export function useBusinessScope(): BusinessScopeInfo {
  const company = useCompanyOptional()
  // Read the context directly (not useSession) so the hook also works outside a SessionProvider
  const session = useContext(SessionContext)?.data
  const user = session?.user
  const fromSession = !!user?.businessType && (!company || user.tenantId === company.tenantId)
  const businessType = (fromSession ? user?.businessType : company?.businessType) || user?.businessType || ''
  const rawSegments = fromSession ? user?.businessSegments : company?.businessSegments
  const segKey = Array.isArray(rawSegments) ? rawSegments.join(',') : ''

  return useMemo(() => {
    const businessSegments = businessType === 'mall' && segKey ? segKey.split(',') : null
    const scope = { businessType, businessSegments }
    const types = businessTypesOf(businessType, businessSegments)
    return {
      businessType,
      businessSegments,
      types,
      isMall: scopeIsMall(scope),
      has: (type: string | readonly string[]) => hasBusinessType(types, type),
      primary: primaryBusinessType(types),
      scope,
    }
  }, [businessType, segKey])
}

export type { BusinessScope }

/** Business types that keep service jobs (repairs, tailoring, service tickets), in preference order */
const SERVICE_JOB_TYPES = ['electronics', 'textile', 'office', 'retail', 'hardware']

/**
 * The type whose words / job kind the service-jobs pages use: the vendor's own type, or for a
 * mall its first segment that keeps service jobs (electronics repairs before tailoring …).
 */
export function serviceJobBusinessType(info: Pick<BusinessScopeInfo, 'businessType' | 'types' | 'primary'>): string {
  if (info.types.length <= 1) return info.businessType
  return SERVICE_JOB_TYPES.find((t) => info.types.includes(t)) ?? info.primary
}

/** Service-job business types a mall runs (to offer a job kind choice) */
export function serviceJobTypesOf(info: Pick<BusinessScopeInfo, 'types'>): string[] {
  return SERVICE_JOB_TYPES.filter((t) => info.types.includes(t))
}
