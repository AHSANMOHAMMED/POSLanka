import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tenants, users, sales, tenantUsage } from '@/lib/db/schema'
import { desc, eq, sql } from 'drizzle-orm'
import { adminAuthError, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { foldTenantUsage } from '@/lib/db/storage-quota'

/** Platform analytics: vendor health snapshot for Super Admin */
export async function GET() {
  try {
    const session = await validateAdminSession('read')
    if (!session) {
      return adminAuthError()
    }

    // One fold of pending usage deltas for every vendor, then ONE query for the 100 newest
    // vendors (was 4 queries per vendor fired concurrently: 400 queries against a 15-connection pool).
    await foldTenantUsage()
    const rows = await db
      .select({
        tenantId: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        status: tenants.status,
        userCount: sql<number>`(SELECT count(*)::int FROM ${users} u WHERE u.tenant_id = ${tenants.id})`,
        // correlated LIMIT 1 lookups use idx_sales_tenant_created (migration 0168)
        lastSaleAt: sql<Date | string | null>`(SELECT s.created_at FROM ${sales} s WHERE s.tenant_id = ${tenants.id} ORDER BY s.created_at DESC LIMIT 1)`,
        lastSaleTotal: sql<string | null>`(SELECT s.total FROM ${sales} s WHERE s.tenant_id = ${tenants.id} ORDER BY s.created_at DESC LIMIT 1)`,
        storageBytes: tenantUsage.storageBytes,
        fileStorageBytes: tenantUsage.fileStorageBytes,
      })
      .from(tenants)
      .leftJoin(tenantUsage, eq(tenantUsage.tenantId, tenants.id))
      .orderBy(desc(tenants.createdAt))
      .limit(100)

    const health = rows.map((r) => ({
      tenantId: r.tenantId,
      name: r.name,
      slug: r.slug,
      status: r.status,
      userCount: Number(r.userCount ?? 0),
      lastSaleAt: r.lastSaleAt ? new Date(r.lastSaleAt) : null,
      lastSaleTotal: r.lastSaleTotal ?? null,
      storageBytes: r.storageBytes != null ? Number(r.storageBytes) : 0,
      fileStorageBytes: r.fileStorageBytes != null ? Number(r.fileStorageBytes) : 0,
    }))

    return NextResponse.json({ vendors: health })
  } catch (error) {
    logError('api/sys-control/vendors/health', error)
    return NextResponse.json({ error: 'Failed to load vendor health' }, { status: 500 })
  }
}
