import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

/**
 * Public endpoint for basic company info (used by company login page).
 * No auth required. Only returns non-sensitive info.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const tenant = await db.query.tenants.findFirst({
      where: and(
        eq(tenants.slug, slug),
        eq(tenants.status, 'active')
      ),
      columns: {
        name: true,
        businessType: true,
        logoUrl: true,
      },
    })

    if (!tenant) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    return NextResponse.json({
      name: tenant.name,
      businessType: tenant.businessType,
      logoUrl: tenant.logoUrl || null,
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch company info' }, { status: 500 })
  }
}
