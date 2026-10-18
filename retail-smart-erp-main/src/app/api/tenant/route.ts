import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation'
import { updateTenantSchema } from '@/lib/validation/schemas/users'

// GET tenant settings (tax rate, currency, etc.)
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, session.user.tenantId),
        columns: {
          id: true,
          name: true,
          businessType: true,
          currency: true,
          country: true,
          taxRate: true,
          taxInclusive: true,
          timezone: true,
          aiEnabled: true,
          aiConsentAcceptedAt: true,
          phone: true,
          address: true,
          email: true,
        },
      })

      if (!tenant) {
        return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
      }

      return NextResponse.json(tenant)
    })
  } catch (error) {
    logError('api/tenant', error)
    return NextResponse.json({ error: 'Failed to fetch tenant settings' }, { status: 500 })
  }
}

// PUT update tenant settings (business type for testing)
export async function PUT(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const parsed = await validateBody(request, updateTenantSchema)
    if (!parsed.success) return parsed.response
    const { businessType, timezone, aiEnabled, taxRate, taxInclusive } = parsed.data

    // Build update data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: Record<string, any> = { updatedAt: new Date() }

    if (businessType !== undefined) {
      updateData.businessType = businessType
    }

    if (timezone !== undefined) {
      // Validate timezone using Intl API
      try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone })
      } catch {
        return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 })
      }
      updateData.timezone = timezone
    }

    if (taxRate !== undefined) {
      updateData.taxRate = String(taxRate)
    }

    if (taxInclusive !== undefined) {
      updateData.taxInclusive = taxInclusive
    }

    if (aiEnabled !== undefined) {
      updateData.aiEnabled = !!aiEnabled
      // Record consent timestamp when enabling AI for the first time
      if (aiEnabled) {
        const tenant = await withTenant(session.user.tenantId, async (db) => {
          return db.query.tenants.findFirst({
            where: eq(tenants.id, session.user.tenantId),
            columns: { aiConsentAcceptedAt: true },
          })
        })
        if (!tenant?.aiConsentAcceptedAt) {
          updateData.aiConsentAcceptedAt = new Date()
        }
      }
    }

    if (Object.keys(updateData).length <= 1) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Note: tenants table doesn't have RLS, but we use withTenant for consistency
    // and to ensure proper connection handling
    return await withTenant(session.user.tenantId, async (db) => {
      await db.update(tenants)
        .set(updateData)
        .where(eq(tenants.id, session.user.tenantId))

      // Broadcast tenant settings update
      logAndBroadcast(session.user.tenantId, 'tenant', 'updated', session.user.tenantId)

      return NextResponse.json({ success: true, ...updateData })
    })
  } catch (error) {
    logError('api/tenant', error)
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 })
  }
}
