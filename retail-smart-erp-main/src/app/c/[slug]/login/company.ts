import { cache } from 'react'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { formatBusinessId } from '@/lib/tenant/business-id'

export interface CompanyInfo {
  name: string
  slug: string
  logoUrl: string | null
  businessType: string
  /** Display form, e.g. PL-985633 */
  businessId: string
}

/**
 * Public branding for a company's sign-in pages (active companies only).
 * Tenants are a global table (no RLS), same as /api/c/[slug]/public-info.
 */
export const getCompanyForSignIn = cache(async (slug: string): Promise<CompanyInfo | null> => {
  try {
    const t = await db.query.tenants.findFirst({
      where: and(eq(tenants.slug, slug), eq(tenants.status, 'active')),
      columns: { name: true, slug: true, logoUrl: true, businessType: true, businessId: true },
    })
    if (!t) return null
    return { name: t.name, slug: t.slug, logoUrl: t.logoUrl || null, businessType: t.businessType, businessId: formatBusinessId(t.businessId) }
  } catch {
    return null
  }
})
