import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { users, items, sales } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

export async function GET() {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const slug = session.user.tenantSlug

  return withTenant(session.user.tenantId, async (db) => {
    const [userCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.tenantId, session.user.tenantId))

    const [itemCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(items)
      .where(eq(items.tenantId, session.user.tenantId))

    const [saleCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sales)
      .where(eq(sales.tenantId, session.user.tenantId))

    const steps = [
      { key: 'company', label: 'Create company', done: true },
      { key: 'plan', label: 'Choose plan', done: true },
      {
        key: 'staff',
        label: 'Invite cashiers',
        done: (userCount?.count || 0) > 1,
        href: `/c/${slug}/settings/users`,
      },
      {
        key: 'item',
        label: 'Add first item',
        done: (itemCount?.count || 0) > 0,
        href: `/c/${slug}/items`,
      },
      {
        key: 'pos',
        label: 'Open POS and make a sale',
        done: (saleCount?.count || 0) > 0,
        href: `/c/${slug}/pos`,
      },
    ]

    return NextResponse.json({ steps })
  })
}
