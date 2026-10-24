import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenantTransaction } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { requireQuota } from '@/lib/db/storage-quota'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { requireAccountingConfig } from '@/lib/accounting/validate-config'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { completeStockTake, StockTakeCompletionError } from '@/lib/inventory/complete-stock-take'
import { toApiError } from '@/lib/db/errors'
import { logError } from '@/lib/ai/error-logger'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { stockTakes } from '@/lib/db/schema'

// POST - Complete stock take: apply (counted - system qty at count) per line through the stock ledger
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
  if (!paramsParsed.success) return paramsParsed.response
  const { id } = paramsParsed.data

  try {
    const result = await withAuthTenantTransaction(async (session, tx) => {
      const permError = requirePermission(session, 'manageInventory')
      if (permError) return { error: permError }

      // K4: only counts of the user's own branches
      const branchDenied = await assertRecordBranch(session, tx, stockTakes, id)
      if (branchDenied) return { error: branchDenied }

      const quotaError = await requireQuota(session.user.tenantId, 'standard')
      if (quotaError) return { error: quotaError }

      // Pre-validate accounting config before processing adjustments
      const acctError = await requireAccountingConfig(tx, session.user.tenantId, 'stock_adjustment')
      if (acctError) return { error: acctError }

      // Throws (→ rollback) on any failing line: all-or-nothing
      const completed = await completeStockTake(tx, {
        tenantId: session.user.tenantId,
        stockTakeId: id,
        userId: session.user.id,
      })

      const opts = { userId: session.user.id }
      logAndBroadcast(session.user.tenantId, 'stock-take', 'updated', id, opts)
      logAndBroadcast(session.user.tenantId, 'warehouse-stock', 'updated', completed.warehouseId, opts)
      logAndBroadcast(session.user.tenantId, 'stock-movement', 'created', 'bulk', opts)

      return {
        data: {
          success: true,
          message: `Stock take completed. ${completed.adjustmentCount} adjustment(s) applied.`,
          adjustmentCount: completed.adjustmentCount,
          applied: completed.applied,
        },
      }
    })

    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  } catch (error) {
    if (error instanceof StockTakeCompletionError) {
      return NextResponse.json({ error: error.message, lines: error.lines }, { status: error.status })
    }
    const mapped = toApiError(error)
    if (mapped) return mapped
    logError('api/stock-takes/[id]/complete', error)
    return NextResponse.json({ error: 'Failed to complete stock take' }, { status: 500 })
  }
}
