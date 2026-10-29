import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { warehouses } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { bulkStockAdjustmentSchema } from '@/lib/validation/schemas/stock'
import { applyBulkAdjustment, BulkLineError } from '@/lib/inventory/bulk-adjust'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { stockErrorResponse } from '@/lib/purchasing/stock-cost'
import { logError } from '@/lib/ai/error-logger'
import { assertBranchAccess } from '@/lib/auth/branch-access'

// POST - Apply bulk stock adjustments (each line: set stock to newQuantity)
// H3: all-or-nothing — see applyBulkAdjustment (src/lib/inventory/bulk-adjust.ts).
export async function POST(request: NextRequest) {
  const parsed = await validateBody(request, bulkStockAdjustmentSchema)
  if (!parsed.success) return parsed.response
  const body = parsed.data

  try {
    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'manageInventory')
      if (permError) return { error: permError }

      const quotaError = await requireQuota(session.user.tenantId, 'standard')
      if (quotaError) return { error: quotaError }

      const tenantId = session.user.tenantId
      const userId = session.user.id

      const [warehouse] = await tx.select({ id: warehouses.id }).from(warehouses)
        .where(eq(warehouses.id, body.warehouseId)).limit(1)
      if (!warehouse) return { error: NextResponse.json({ error: 'Warehouse not found' }, { status: 404 }) }
      // K4: a branch-restricted stock keeper adjusts their own branches only
      const branchDenied = await assertBranchAccess(session, body.warehouseId, tx)
      if (branchDenied) return { error: branchDenied }

      // Configuration problems fail before anything is written
      const acctError = await requireAccountingConfig(tx, tenantId, 'stock_adjustment')
      if (acctError) return { error: acctError }

      const { adjusted, warnings, results, changedStockIds } = await applyBulkAdjustment(tx, {
        tenantId,
        warehouseId: body.warehouseId,
        userId,
        reasonCode: body.reasonCode,
        defaultNote: 'Bulk adjustment',
        referenceType: 'bulk_adjustment',
        adjustments: body.adjustments,
      })

      for (const id of changedStockIds) logAndBroadcast(tenantId, 'warehouse-stock', 'updated', id, { userId })
      logAndBroadcast(tenantId, 'stock-movement', 'created', 'bulk', { userId })

      return { data: { adjusted, total: body.adjustments.length, errors: [] as string[], warnings, results } }
    })

    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  } catch (error) {
    if (error instanceof BulkLineError) {
      return NextResponse.json({
        error: `No adjustments applied: item ${error.itemId}: ${error.reason}`,
        code: 'BULK_ADJUSTMENT_FAILED',
        errors: [`Item ${error.itemId}: ${error.reason}`],
      }, { status: error.status })
    }
    const stockErr = stockErrorResponse(error, 'No adjustments applied')
    if (stockErr) return stockErr
    logError('api/stock-adjustments/bulk', error)
    return NextResponse.json({ error: 'Failed to apply stock adjustments' }, { status: 500 })
  }
}
