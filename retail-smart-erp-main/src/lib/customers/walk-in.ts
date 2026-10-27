/**
 * Walk-in customers booked by name + phone (print studio jobs): find the customer by phone, or
 * create one, so the job (and its invoice / advances) lands on a customer account.
 *
 * Phones are compared in the Sri Lankan local form (0XXXXXXXXX): "+94 77 123 4567", "94771234567",
 * "0771234567" and "771234567" are the same number. Duplicate rules follow POST /api/customers:
 * a phone that belongs to a customer in the recycle bin (is_active = false) is never re-created
 * (nothing is linked; the job keeps the typed name / phone).
 */
import { sql } from 'drizzle-orm'
import { customers } from '@/lib/db/schema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** Sri Lankan local form of a phone number (digits only), or null when there are too few digits. */
export function normalizeSlPhone(phone: string | null | undefined): string | null {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return null
  let local = digits
  if (local.startsWith('0094')) local = local.slice(2)
  if (local.startsWith('94') && local.length === 11) local = `0${local.slice(2)}`
  else if (local.length === 9 && !local.startsWith('0')) local = `0${local}`
  return local.length >= 7 ? local : null
}

/** SQL twin of normalizeSlPhone for a column */
function normalizedColumn(col: unknown) {
  return sql`(CASE
    WHEN regexp_replace(COALESCE(${col}, ''), '\\D', '', 'g') ~ '^(00)?94[0-9]{9}$'
      THEN '0' || right(regexp_replace(${col}, '\\D', '', 'g'), 9)
    WHEN regexp_replace(COALESCE(${col}, ''), '\\D', '', 'g') ~ '^[1-9][0-9]{8}$'
      THEN '0' || regexp_replace(${col}, '\\D', '', 'g')
    ELSE regexp_replace(COALESCE(${col}, ''), '\\D', '', 'g')
  END)`
}

export interface WalkInCustomerResult {
  customerId: string | null
  /** 'found' = existing customer, 'created' = new customer, 'skipped' = no usable phone / recycle bin */
  outcome: 'found' | 'created' | 'skipped'
  name?: string
}

export async function findOrCreateWalkInCustomer(db: Db, tenantId: string, input: { name: string; phone: string | null | undefined }): Promise<WalkInCustomerResult> {
  const local = normalizeSlPhone(input.phone)
  const name = input.name.trim()
  if (!local || !name) return { customerId: null, outcome: 'skipped' }

  const matches: Array<{ id: string; name: string; isActive: boolean }> = await db
    .select({ id: customers.id, name: customers.name, isActive: customers.isActive })
    .from(customers)
    .where(sql`${customers.tenantId} = ${tenantId} AND (${normalizedColumn(customers.phone)} = ${local} OR ${normalizedColumn(customers.mobilePhone)} = ${local})`)
    .orderBy(sql`${customers.isActive} DESC`, customers.createdAt)
    .limit(5)
  const active = matches.find((m) => m.isActive)
  if (active) return { customerId: active.id, outcome: 'found', name: active.name }
  if (matches.length > 0) return { customerId: null, outcome: 'skipped' }

  const [created] = await db.insert(customers).values({
    tenantId,
    name: name.slice(0, 255),
    phone: local,
    mobilePhone: local,
    notes: 'Created from a walk-in booking',
  }).returning({ id: customers.id, name: customers.name })
  return { customerId: created.id, outcome: 'created', name: created.name }
}
