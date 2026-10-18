import { NextRequest, NextResponse } from 'next/server'
import { accountAuth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { tenants, pendingCompanies } from '@/lib/db/schema'
import { eq, and, gt, sql } from 'drizzle-orm'
import { RESERVED_SLUGS } from '@/lib/utils/reserved-slugs'

export async function GET(request: NextRequest) {
  const session = await accountAuth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const slug = request.nextUrl.searchParams.get('slug')?.toLowerCase().trim()
  if (!slug) {
    return NextResponse.json({ error: 'Slug is required' }, { status: 400 })
  }

  // Format check
  const slugRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/
  if (!slugRegex.test(slug) && slug.length > 1) {
    return NextResponse.json({ available: false, reason: 'Must start and end with a letter or number' })
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ available: false, reason: 'Only lowercase letters, numbers, and hyphens allowed' })
  }

  // Length check
  if (slug.length < 3) {
    return NextResponse.json({ available: false, reason: 'Must be at least 3 characters' })
  }
  if (slug.length > 25) {
    return NextResponse.json({ available: false, reason: 'Must be 25 characters or less' })
  }

  // Reserved check
  if (RESERVED_SLUGS.has(slug)) {
    return NextResponse.json({ available: false, reason: 'This code is reserved' })
  }

  // Database uniqueness check
  const existingTenant = await db.query.tenants.findFirst({
    where: eq(tenants.slug, slug),
    columns: { id: true },
  })
  if (existingTenant) {
    return NextResponse.json({ available: false, reason: 'Already taken' })
  }

  // Check pending companies
  const existingPending = await db.query.pendingCompanies.findFirst({
    where: and(
      eq(pendingCompanies.slug, slug),
      gt(pendingCompanies.expiresAt, new Date()),
      sql`${pendingCompanies.status} NOT IN ('approved', 'rejected', 'expired')`
    ),
    columns: { id: true },
  })
  if (existingPending) {
    return NextResponse.json({ available: false, reason: 'Reserved by a pending company' })
  }

  return NextResponse.json({ available: true })
}
