/**
 * K4: kitchen orders carry no branch of their own; they belong to their restaurant order's branch.
 */
import type { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { kitchenOrders, restaurantOrders } from '@/lib/db/schema'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import type { TenantDb } from '@/lib/db/tenant-context'

type Session = Parameters<typeof assertRecordBranch>[0]

/** Refuse a kitchen order whose restaurant order belongs to another branch (403); null when allowed or not found. */
export async function assertKitchenOrderBranch(session: Session, db: Pick<TenantDb, 'select'>, kitchenOrderId: string): Promise<NextResponse | null> {
  const [ko] = await db.select({ restaurantOrderId: kitchenOrders.restaurantOrderId }).from(kitchenOrders)
    .where(eq(kitchenOrders.id, kitchenOrderId)).limit(1)
  if (!ko) return null
  return assertRecordBranch(session, db, restaurantOrders, ko.restaurantOrderId)
}
