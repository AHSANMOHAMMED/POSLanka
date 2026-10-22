import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

const publicInfoCache = new Map<string, { data: { name: string; businessType: string; logoUrl: string | null }; expires: number }>()

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
    const now = Date.now()
    const cached = publicInfoCache.get(slug)
    if (cached && cached.expires > now) {
      return NextResponse.json(cached.data, {
        headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' }
      })
    }

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

    const payload = {
      name: tenant.name,
      businessType: tenant.businessType,
      logoUrl: tenant.logoUrl || null,
    }

    publicInfoCache.set(slug, { data: payload, expires: now + 60_000 })

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' }
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch company info' }, { status: 500 })
  }
}
