import { eq } from 'drizzle-orm'
import { suppliers, supplierBalanceAudit } from '@/lib/db/schema'
import type { DbTx } from '@/lib/inventory/db-types'

const round2 = (n: number) => Math.round(n * 100) / 100

export interface SupplierBalanceChange {
  tenantId: string
  supplierId: string
  /** Signed change: positive = we owe the supplier more, negative = less. */
  delta: number
  type: string
  referenceType: string
  referenceId: string
  notes: string
  userId: string | null
}

/**
 * Apply a signed change to suppliers.balance (row locked FOR UPDATE) and write the matching
 * supplier_balance_audit row, so the supplier statement always explains the balance.
 * A zero change is a no-op.
 */
export async function adjustSupplierBalance(tx: DbTx, change: SupplierBalanceChange): Promise<void> {
  const delta = round2(change.delta)
  if (delta === 0) return
  const [current] = await tx
    .select({ balance: suppliers.balance })
    .from(suppliers)
    .where(eq(suppliers.id, change.supplierId))
    .for('update')
  if (!current) return
  const previousBalance = round2(parseFloat(current.balance || '0'))
  const newBalance = round2(previousBalance + delta)
  await tx.update(suppliers)
    .set({ balance: newBalance.toString() })
    .where(eq(suppliers.id, change.supplierId))
  await tx.insert(supplierBalanceAudit).values({
    tenantId: change.tenantId,
    supplierId: change.supplierId,
    type: change.type,
    amount: delta.toString(),
    previousBalance: previousBalance.toString(),
    newBalance: newBalance.toString(),
    referenceType: change.referenceType,
    referenceId: change.referenceId,
    notes: change.notes,
    createdBy: change.userId,
  })
}
