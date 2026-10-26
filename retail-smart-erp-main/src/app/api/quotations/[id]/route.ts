import { NextRequest, NextResponse } from 'next/server'
import { eq, and } from 'drizzle-orm'
import { withAuthTenant } from '@/lib/db/with-auth-tenant'
import { quotations, tenants } from '@/lib/db/schema'
import { requireTenantFeature } from '@/lib/features/check'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'Quotation not found' }, { status: 404 })
  }

  const result = await withAuthTenant(async (session, db) => {
    const feature = await requireTenantFeature(session.user.tenantId, 'quotation')
    if (!feature.ok) {
      return { error: 'Quotation module disabled', status: 403 as const }
    }

    const quotation = await db.query.quotations.findFirst({
      where: and(eq(quotations.id, id), eq(quotations.tenantId, session.user.tenantId)),
      with: { items: true },
    })

    if (!quotation) {
      return { error: 'Quotation not found', status: 404 as const }
    }

    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, session.user.tenantId),
      columns: {
        name: true,
        legalName: true,
        businessId: true,
        email: true,
        phone: true,
        address: true,
        logoUrl: true,
        brn: true,
        taxId: true,
        currency: true,
      },
    })

    return { quotation, tenant }
  })

  if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}

