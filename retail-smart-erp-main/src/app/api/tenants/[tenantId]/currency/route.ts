import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { withoutTenant } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { z } from 'zod'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, z.object({ tenantId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { tenantId } = paramsParsed.data

    // Verify the requesting user belongs to the queried tenant (IDOR protection)
    if (session.user.tenantId && session.user.tenantId !== tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await withoutTenant(async (db) => {
      return db.query.tenants.findFirst({
        where: eq(tenants.id, tenantId),
        columns: { currency: true },
      })
    })

    if (!result) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }

    return NextResponse.json({ currency: result.currency })
  } catch (error) {
    logError('api/tenants/[tenantId]/currency', error)
    return NextResponse.json({ error: 'Failed to fetch tenant currency' }, { status: 500 })
  }
}
