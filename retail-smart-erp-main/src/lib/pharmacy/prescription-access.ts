/**
 * Load one prescription for the caller: 404 when missing, 403 when its bill belongs to a branch the
 * caller may not work with (K4). Prescriptions without a bill follow the caller's scope like
 * company-wide records (restricted staff are refused).
 */
import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { prescriptions, sales } from '@/lib/db/schema'
import type { TenantDb } from '@/lib/db'
import { getBranchScope, branchDeniedResponse } from '@/lib/auth/branch-access'

interface SessionLike { user: { id: string; tenantId: string; role: string; isOwner?: boolean } }

export async function loadPrescriptionFor(session: SessionLike, db: TenantDb, id: string): Promise<
  { error: NextResponse } | { prescription: { id: string; saleId: string | null; warehouseId: string | null; customerId: string | null } }
> {
  const [row] = await db.select({ id: prescriptions.id, saleId: prescriptions.saleId, customerId: prescriptions.customerId, warehouseId: sales.warehouseId })
    .from(prescriptions)
    .leftJoin(sales, eq(sales.id, prescriptions.saleId))
    .where(and(eq(prescriptions.tenantId, session.user.tenantId), eq(prescriptions.id, id)))
    .limit(1)
  if (!row) return { error: NextResponse.json({ error: 'Prescription not found' }, { status: 404 }) }
  const scope = await getBranchScope(session, db)
  if (scope && (!row.warehouseId || !scope.includes(row.warehouseId))) return { error: await branchDeniedResponse(scope, db) }
  return { prescription: row }
}
