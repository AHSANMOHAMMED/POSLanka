import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { asc, gte, and, ilike, or, sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { validateBody } from '@/lib/validation/helpers'
import { customers } from '@/lib/db/schema'
import { withApiKey } from '@/lib/auth/api-keys'
import { escapeLikePattern } from '@/lib/utils/sql'
import { serializeCustomer, v1Error, v1Page, v1PageSchema, v1Query } from '@/lib/api-v1'
import { POST as createCustomerPOST } from '@/app/api/customers/route'

const listSchema = v1PageSchema.extend({
  search: z.string().trim().max(100).optional(),
  updatedSince: z.coerce.date().optional(),
})

/** Fields an integration may set. Credit limit / tax exemption stay with staff in the app. */
const createSchema = z.object({
  name: z.string().trim().min(1).max(255),
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  companyName: z.string().trim().max(255).optional(),
  email: z.string().trim().max(255).optional(),
  phone: z.string().trim().max(50).optional(),
  mobilePhone: z.string().trim().max(50).optional(),
  addressLine1: z.string().max(255).optional(),
  addressLine2: z.string().max(255).optional(),
  city: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
  taxId: z.string().max(50).optional(),
  notes: z.string().max(2000).optional(),
}).strict()

// GET /api/v1/customers (scope customers:read)
export async function GET(request: NextRequest) {
  return withApiKey(request, 'customers:read', async ({ session }) => {
    const q = v1Query(request, listSchema)
    if (!q.ok) return q.response
    const { page, pageSize, search, updatedSince } = q.data
    return withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (search) {
        const p = `%${escapeLikePattern(search)}%`
        conditions.push(or(ilike(customers.name, p), ilike(customers.phone, p), ilike(customers.mobilePhone, p), ilike(customers.email, p)))
      }
      if (updatedSince) conditions.push(gte(customers.updatedAt, updatedSince))
      const where = conditions.length ? and(...conditions) : undefined
      const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(customers).where(where)
      const rows = await db.select().from(customers).where(where)
        .orderBy(asc(customers.name), asc(customers.id))
        .limit(pageSize).offset((page - 1) * pageSize)
      return v1Page(rows.map(serializeCustomer), page, pageSize, Number(count))
    })
  })
}

// POST /api/v1/customers (scope customers:write) — runs the app's own create-customer logic
export async function POST(request: NextRequest) {
  return withApiKey(request, 'customers:write', async () => {
    const parsed = await validateBody(request, createSchema)
    if (!parsed.success) {
      const err = await parsed.response.json().catch(() => ({}))
      return v1Error(400, err.error === 'Invalid JSON in request body' ? err.error : 'Invalid customer', 'VALIDATION_ERROR', err.details)
    }
    const inner = new NextRequest(new URL('/api/customers', request.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
    })
    const res = await createCustomerPOST(inner)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return v1Error(res.status, body.error || 'Failed to create customer', res.status === 400 ? 'VALIDATION_ERROR' : 'ERROR', body.details)
    return NextResponse.json({ data: serializeCustomer(body) }, { status: 201 })
  })
}
