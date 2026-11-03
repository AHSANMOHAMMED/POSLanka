import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { formatBusinessId } from '@/lib/tenant/business-id'
import { resolveLockMessage } from '@/lib/tenant/lock-message'

export interface CompanyInfo {
  name: string
  slug: string
  logoUrl: string | null
  businessType: string
  /** Display form, e.g. PL-985633 */
  businessId: string
  status: string
  lockTitle?: string | null
  lockDescription?: string | null
}

/**
 * Public branding for a company's sign-in pages.
 * Inactive companies still return branding + lock copy so staff see a clear screen (not a blank 404).
 */
export const getCompanyForSignIn = cache(async (slug: string): Promise<CompanyInfo | null> => {
  try {
    const t = await db.query.tenants.findFirst({
      where: eq(tenants.slug, slug),
      columns: {
        name: true,
        slug: true,
        logoUrl: true,
        businessType: true,
        businessId: true,
        status: true,
        lockedReason: true,
        settings: true,
      },
    })
    if (!t) return null
    const lock = t.status !== 'active'
      ? resolveLockMessage({ status: t.status, lockedReason: t.lockedReason, settings: t.settings })
      : null
    return {
      name: t.name,
      slug: t.slug,
      logoUrl: t.logoUrl || null,
      businessType: t.businessType,
      businessId: formatBusinessId(t.businessId),
      status: t.status,
      lockTitle: lock?.title ?? null,
      lockDescription: lock?.description ?? null,
    }
  } catch {
    return null
  }
})
