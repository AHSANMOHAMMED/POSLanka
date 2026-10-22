/**
 * Vendor web-address (slug) rules for the super-admin create wizard — the same checks
 * self-registration applies (reserved words, existing tenants, pending sign-ups).
 */
import { and, eq, gt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pendingCompanies, tenants } from '@/lib/db/schema'
import { RESERVED_SLUGS } from '@/lib/utils/reserved-slugs'

export { RESERVED_SLUGS }

/** 3–50 chars, lowercase letters/digits, single hyphens, no leading/trailing hyphen. */
export const SLUG_RE = /^(?=.{3,50}$)[a-z0-9]+(?:-[a-z0-9]+)*$/

export type SlugCheck = { available: true } | { available: false; reason: string }

export async function checkSlugAvailability(slug: string): Promise<SlugCheck> {
  if (!SLUG_RE.test(slug)) return { available: false, reason: 'Use 3–50 lowercase letters, numbers and single hyphens.' }
  if (RESERVED_SLUGS.has(slug)) return { available: false, reason: 'This address is reserved.' }
  const [tenant, pending] = await Promise.all([
    db.query.tenants.findFirst({ where: eq(tenants.slug, slug), columns: { id: true } }),
    db.query.pendingCompanies.findFirst({
      where: and(
        eq(pendingCompanies.slug, slug),
        gt(pendingCompanies.expiresAt, new Date()),
        sql`${pendingCompanies.status} NOT IN ('approved', 'rejected', 'expired')`
      ),
      columns: { id: true },
    }),
  ])
  if (tenant) return { available: false, reason: 'Another business already uses this address.' }
  if (pending) return { available: false, reason: 'A sign-up awaiting payment has reserved this address.' }
  return { available: true }
}
