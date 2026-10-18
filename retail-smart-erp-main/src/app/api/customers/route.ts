import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { customers } from '@/lib/db/schema'
import { eq, or, ilike, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { requirePermission } from '@/lib/auth/roles'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { customersListSchema, createCustomerSchema } from '@/lib/validation/schemas/customers'

// GET all customers for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, customersListSchema)
    if (!parsed.success) return parsed.response
    const { search, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      let whereClause = undefined
      if (search) {
        const escaped = escapeLikePattern(search)
        whereClause = or(
          ilike(customers.name, `%${escaped}%`),
          ilike(customers.phone, `%${escaped}%`),
          ilike(customers.email, `%${escaped}%`)
        )
      }

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(customers)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100) // Max 100 per page
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.customers.findMany({
        where: whereClause,
        orderBy: (customers, { asc }) => [asc(customers.name)],
        limit,
        offset,
      })

      // Return paginated response (or just array for backward compatibility with all=true)
      if (all) {
        return NextResponse.json(result)
      }

      return NextResponse.json({
        data: result,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        }
      })
    })
  } catch (error) {
    logError('api/customers', error)
    return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 })
  }
}

// POST create new customer
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check permission
    const permError = requirePermission(session, 'manageCustomers')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createCustomerSchema)
    if (!parsed.success) return parsed.response
    const {
      name, firstName, lastName, companyName, email, phone, mobilePhone, alternatePhone,
      addressLine1, addressLine2, city, state, postalCode, country,
      useSameBillingAddress, billingAddressLine1, billingAddressLine2, billingCity, billingState, billingPostalCode, billingCountry,
      taxId, taxExempt, businessType, creditLimit, paymentTerms, defaultPaymentMethod,
      customerType, referralSource, marketingOptIn, birthday, notes, specialInstructions, driverLicenseNumber,
      paymentTermsTemplateId
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Check for duplicate phone number within tenant (RLS scopes the query)
      if (phone) {
        const normalizedPhone = phone.replace(/\s+/g, '').trim()
        const existingPhone = await db.query.customers.findFirst({
          where: eq(customers.phone, normalizedPhone),
        })
        if (existingPhone) {
          return NextResponse.json({ error: 'A customer with this phone number already exists' }, { status: 400 })
        }
      }

      const [newCustomer] = await db.insert(customers).values({
        tenantId: session.user.tenantId,
        name,
        firstName: firstName || null,
        lastName: lastName || null,
        companyName: companyName || null,
        email: email || null,
        phone: phone ? phone.replace(/\s+/g, '').trim() : null,
        mobilePhone: mobilePhone ? mobilePhone.replace(/\s+/g, '').trim() : null,
        alternatePhone: alternatePhone ? alternatePhone.replace(/\s+/g, '').trim() : null,
        addressLine1: addressLine1 || null,
        addressLine2: addressLine2 || null,
        city: city || null,
        state: state || null,
        postalCode: postalCode || null,
        country: country || null,
        useSameBillingAddress,
        billingAddressLine1: billingAddressLine1 || null,
        billingAddressLine2: billingAddressLine2 || null,
        billingCity: billingCity || null,
        billingState: billingState || null,
        billingPostalCode: billingPostalCode || null,
        billingCountry: billingCountry || null,
        taxId: taxId || null,
        taxExempt,
        businessType,
        creditLimit: creditLimit != null ? String(creditLimit) : null,
        paymentTerms: paymentTerms || null,
        defaultPaymentMethod: defaultPaymentMethod || null,
        customerType,
        referralSource: referralSource || null,
        marketingOptIn,
        birthday: birthday || null,
        notes: notes || null,
        specialInstructions: specialInstructions || null,
        driverLicenseNumber: driverLicenseNumber || null,
        paymentTermsTemplateId: paymentTermsTemplateId || null,
      }).returning()

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'customer', 'created', newCustomer.id)

      return NextResponse.json(newCustomer)
    })
  } catch (error) {
    logError('api/customers', error)
    return NextResponse.json({ error: 'Failed to create customer' }, { status: 500 })
  }
}
