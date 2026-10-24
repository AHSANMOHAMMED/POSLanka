import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission, requireModule } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { customers, workOrders, layaways, appointments } from '@/lib/db/schema'
import { eq, and, ne, inArray, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateCustomerSchema } from '@/lib/validation/schemas/customers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { moveToRecycleBin } from '@/lib/recycle-bin'

// GET single customer
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Module Access: refused when the owner switched this module off for the caller's role
    const moduleError = requireModule(session, 'selling')
    if (moduleError) return moduleError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const customer = await db.query.customers.findFirst({
        where: eq(customers.id, id),
      })

      if (!customer) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      }

      return NextResponse.json(customer)
    })
  } catch (error) {
    logError('api/customers/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch customer' }, { status: 500 })
  }
}

// PUT update customer
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageCustomers')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateCustomerSchema)
    if (!parsed.success) return parsed.response
    const {
      name, firstName, lastName, companyName, email, phone, mobilePhone, alternatePhone,
      addressLine1, addressLine2, city, state, postalCode, country,
      useSameBillingAddress, billingAddressLine1, billingAddressLine2, billingCity, billingState, billingPostalCode, billingCountry,
      taxId, taxExempt, businessType, creditLimit, paymentTerms, defaultPaymentMethod,
      customerType, referralSource, marketingOptIn, birthday, notes, specialInstructions, driverLicenseNumber,
      paymentTermsTemplateId, expectedUpdatedAt
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Use transaction with FOR UPDATE to prevent race conditions
      const result = await db.transaction(async (tx) => {
        // Lock and get current customer (RLS scopes the query)
        const [currentCustomer] = await tx
          .select()
          .from(customers)
          .where(eq(customers.id, id))
          .for('update')

        if (!currentCustomer) {
          throw new Error('NOT_FOUND')
        }

        // Optimistic locking - check if record was modified since client fetched it
        if (expectedUpdatedAt) {
          const clientUpdatedAt = new Date(expectedUpdatedAt).getTime()
          const serverUpdatedAt = currentCustomer.updatedAt ? new Date(currentCustomer.updatedAt).getTime() : 0
          if (serverUpdatedAt > clientUpdatedAt) {
            throw new Error('CONFLICT')
          }
        }

        // Check for duplicate phone number (excluding current customer) - RLS scopes
        if (phone) {
          const normalizedPhone = phone.replace(/\s+/g, '').trim()
          const existingPhone = await tx.query.customers.findFirst({
            where: and(
              eq(customers.phone, normalizedPhone),
              ne(customers.id, id)
            ),
          })
          if (existingPhone) {
            throw new Error('DUPLICATE_PHONE')
          }
        }

        const [updated] = await tx.update(customers)
          .set({
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
            useSameBillingAddress: useSameBillingAddress ?? true,
            billingAddressLine1: billingAddressLine1 || null,
            billingAddressLine2: billingAddressLine2 || null,
            billingCity: billingCity || null,
            billingState: billingState || null,
            billingPostalCode: billingPostalCode || null,
            billingCountry: billingCountry || null,
            taxId: taxId || null,
            taxExempt: taxExempt || false,
            businessType: businessType || 'individual',
            creditLimit: creditLimit ? String(creditLimit) : null,
            paymentTerms: paymentTerms || null,
            defaultPaymentMethod: defaultPaymentMethod || null,
            customerType: customerType || 'retail',
            referralSource: referralSource || null,
            marketingOptIn: marketingOptIn || false,
            birthday: birthday || null,
            notes: notes || null,
            specialInstructions: specialInstructions || null,
            driverLicenseNumber: driverLicenseNumber || null,
            paymentTermsTemplateId: paymentTermsTemplateId || null,
            updatedAt: new Date(),
          })
          .where(eq(customers.id, id))
          .returning()

        return updated
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'customer', 'updated', id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/customers/[id]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }
    if (message === 'CONFLICT') {
      return NextResponse.json({
        error: 'This customer was modified by another user. Please refresh and try again.',
        code: 'CONFLICT'
      }, { status: 409 })
    }
    if (message === 'DUPLICATE_PHONE') {
      return NextResponse.json({ error: 'A customer with this phone number already exists' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 })
  }
}

// DELETE customer
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageCustomers')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const tenantId = session!.user.tenantId

    // Execute with RLS tenant context
    return await withTenant(tenantId, async (db) => {
      // Check for dependencies before deletion (RLS scopes all queries)
      const dependencies: string[] = []

      // Store credit is money the shop owes the customer (Customer Advance in the GL): deleting
      // the customer would orphan that liability.
      const existingCustomer = await db.query.customers.findFirst({
        where: eq(customers.id, id),
        columns: { id: true, balance: true },
      })
      if (!existingCustomer) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      }
      const creditBalance = parseFloat(existingCustomer.balance || '0') || 0
      if (Math.abs(creditBalance) >= 0.01) {
        dependencies.push(`a store credit balance of ${creditBalance.toFixed(2)}`)
      }

      // Check for active work orders (draft status)
      const [activeWorkOrders] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(workOrders)
        .where(and(
          eq(workOrders.customerId, id),
          eq(workOrders.status, 'draft')
        ))
      if (activeWorkOrders?.count > 0) {
        dependencies.push(`${activeWorkOrders.count} active work order(s)`)
      }


      // Check for active layaways
      const [activeLayaways] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(layaways)
        .where(and(
          eq(layaways.customerId, id),
          inArray(layaways.status, ['active', 'fully_paid'])
        ))
      if (activeLayaways?.count > 0) {
        dependencies.push(`${activeLayaways.count} active layaway(s)`)
      }

      // Check for upcoming appointments
      const [upcomingAppointments] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(appointments)
        .where(and(
          eq(appointments.customerId, id),
          inArray(appointments.status, ['scheduled', 'confirmed'])
        ))
      if (upcomingAppointments?.count > 0) {
        dependencies.push(`${upcomingAppointments.count} upcoming appointment(s)`)
      }


      // If there are dependencies, prevent deletion
      if (dependencies.length > 0) {
        return NextResponse.json({
          error: `Cannot move the customer to the recycle bin. Customer has: ${dependencies.join(', ')}. Please reassign or remove these records first.`,
          dependencies
        }, { status: 400 })
      }

      // History (sales, vehicles, quotations, credit, loyalty...) keeps pointing at the customer:
      // the vendor's delete only archives it (hidden from lists, pickers and the POS) and puts it in
      // the recycle bin, where only a super admin can restore or purge it.
      const binned = await moveToRecycleBin(db, {
        tenantId, entityType: 'customer', entityId: id, userId: session!.user.id, userName: session!.user.name,
      })
      if (!binned) {
        return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(tenantId, 'customer', 'deleted', id)

      return NextResponse.json({ success: true, archived: true, recycleBinId: binned.binId })
    })
  } catch (error) {
    logError('api/customers/[id]', error)
    return NextResponse.json({ error: 'Failed to delete customer' }, { status: 500 })
  }
}
