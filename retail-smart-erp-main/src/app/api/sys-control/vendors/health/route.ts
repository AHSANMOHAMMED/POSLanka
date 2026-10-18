import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tenants, users, sales, tenantUsage } from '@/lib/db/schema'
import { desc, eq, sql } from 'drizzle-orm'
import { validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'

/** Platform analytics: vendor health snapshot for Super Admin */
export async function GET() {
  try {
    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const all = await db.query.tenants.findMany({
      columns: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
      },
      orderBy: [desc(tenants.createdAt)],
      limit: 100,
    })

    const health = await Promise.all(
      all.map(async (t) => {
        const [cashierCount] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(eq(users.tenantId, t.id))

        const lastSale = await db.query.sales.findFirst({
          where: eq(sales.tenantId, t.id),
          orderBy: [desc(sales.createdAt)],
          columns: { createdAt: true, total: true },
        })

        const usage = await db.query.tenantUsage.findFirst({
          where: eq(tenantUsage.tenantId, t.id),
          columns: { storageBytes: true, fileStorageBytes: true },
        })

        return {
          tenantId: t.id,
          name: t.name,
          slug: t.slug,
          status: t.status,
          userCount: cashierCount?.count ?? 0,
          lastSaleAt: lastSale?.createdAt ?? null,
          lastSaleTotal: lastSale?.total ?? null,
          storageBytes: usage ? Number(usage.storageBytes) : 0,
          fileStorageBytes: usage ? Number(usage.fileStorageBytes) : 0,
        }
      })
    )

    return NextResponse.json({ vendors: health })
  } catch (error) {
    logError('api/sys-control/vendors/health', error)
    return NextResponse.json({ error: 'Failed to load vendor health' }, { status: 500 })
  }
}
