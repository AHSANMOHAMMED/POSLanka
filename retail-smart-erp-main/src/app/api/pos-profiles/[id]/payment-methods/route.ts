import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { posProfiles, posProfilePaymentMethods } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation'
import { posProfilePaymentMethodsSchema } from '@/lib/validation/schemas/pos'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET payment methods for a POS profile
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify profile exists
      const profile = await db.query.posProfiles.findFirst({
        where: eq(posProfiles.id, id),
      })

      if (!profile) {
        return NextResponse.json({ error: 'POS profile not found' }, { status: 404 })
      }

      const paymentMethods = await db.query.posProfilePaymentMethods.findMany({
        where: eq(posProfilePaymentMethods.posProfileId, id),
        orderBy: (pm, { asc }) => [asc(pm.sortOrder)],
      })

      return NextResponse.json(paymentMethods)
    })
  } catch (error) {
    logError('api/pos-profiles/[id]/payment-methods', error)
    return NextResponse.json({ error: 'Failed to fetch payment methods' }, { status: 500 })
  }
}

// POST/PUT - Replace all payment methods for a POS profile
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, posProfilePaymentMethodsSchema)
    if (!parsed.success) return parsed.response
    const { paymentMethods } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify profile exists
      const profile = await db.query.posProfiles.findFirst({
        where: eq(posProfiles.id, id),
      })

      if (!profile) {
        return NextResponse.json({ error: 'POS profile not found' }, { status: 404 })
      }

      // withTenant already wraps in a transaction — no nested db.transaction() which resets SET LOCAL RLS context.
      await db.delete(posProfilePaymentMethods)
        .where(eq(posProfilePaymentMethods.posProfileId, id))

      if (paymentMethods.length > 0) {
        const pmValues = paymentMethods.map((pm, index) => ({
          tenantId: session.user.tenantId,
          posProfileId: id,
          paymentMethod: typeof pm === 'string' ? pm : pm.paymentMethod,
          isDefault: typeof pm === 'string' ? index === 0 : (pm.isDefault || index === 0),
          allowInReturns: typeof pm === 'string' ? true : (pm.allowInReturns !== false),
          sortOrder: index,
        }))
        await db.insert(posProfilePaymentMethods).values(pmValues)
      }

      // Fetch updated
      const updated = await db.query.posProfilePaymentMethods.findMany({
        where: eq(posProfilePaymentMethods.posProfileId, id),
        orderBy: (pm, { asc }) => [asc(pm.sortOrder)],
      })

      logAndBroadcast(session.user.tenantId, 'pos-profile', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/pos-profiles/[id]/payment-methods', error)
    return NextResponse.json({ error: 'Failed to update payment methods' }, { status: 500 })
  }
}
