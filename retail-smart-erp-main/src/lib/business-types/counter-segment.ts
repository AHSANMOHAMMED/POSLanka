/**
 * POS profile (counter) business segment: a mall counter can work as one of the mall's shop types
 * (food-court counter → 'restaurant' till). Only malls may set one; it must be one of their segments.
 */
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { isMall, scopeTypes } from './scope'

/** Null when the value is acceptable for this tenant, otherwise the error message. */
export async function counterSegmentError(tenantId: string, segment: string | null | undefined): Promise<string | null> {
  if (segment == null || segment === '') return null
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { businessType: true, businessSegments: true },
  })
  if (!tenant || !isMall(tenant.businessType)) return 'Only a mall / multi-shop business can set a counter shop type'
  if (!scopeTypes(tenant).includes(segment)) return 'This shop type is not one the business runs'
  return null
}

/** Did the raw JSON body explicitly clear the field (null or '')? validateBody drops those keys. */
export function clearsField(raw: unknown, key: string): boolean {
  if (!raw || typeof raw !== 'object' || !(key in raw)) return false
  const v = (raw as Record<string, unknown>)[key]
  return v === null || v === ''
}
