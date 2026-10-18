import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { serialNumberMovements } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams, validateParams } from '@/lib/validation/helpers'
import { serialNumberMovementsListSchema } from '@/lib/validation/schemas/items'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET - Paginated movement history for a serial number
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageInventory')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: serialNumberId } = paramsParsed.data
    const parsed = validateSearchParams(request, serialNumberMovementsListSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Get total count
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(serialNumberMovements)
        .where(eq(serialNumberMovements.serialNumberId, serialNumberId))

      const limit = Math.min(pageSize, 100)
      const offset = (page - 1) * pageSize

      // Get movements with user name and warehouse names
      // Use raw SQL for the warehouse aliases since Drizzle doesn't easily support
      // multiple joins to the same table with different aliases in select()
      const data = await db.execute(sql`
        SELECT
          m.id,
          m.from_status AS "fromStatus",
          m.to_status AS "toStatus",
          m.from_warehouse_id AS "fromWarehouseId",
          fw.name AS "fromWarehouseName",
          m.to_warehouse_id AS "toWarehouseId",
          tw.name AS "toWarehouseName",
          m.reference_type AS "referenceType",
          m.reference_id AS "referenceId",
          m.changed_by AS "changedBy",
          u.full_name AS "changedByName",
          m.notes,
          m.created_at AS "createdAt"
        FROM serial_number_movements m
        LEFT JOIN users u ON m.changed_by = u.id
        LEFT JOIN warehouses fw ON m.from_warehouse_id = fw.id
        LEFT JOIN warehouses tw ON m.to_warehouse_id = tw.id
        WHERE m.serial_number_id = ${serialNumberId}
        ORDER BY m.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `)

      return NextResponse.json({
        data: data.rows,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        },
      })
    })
  } catch (error) {
    logError('api/serial-numbers/[id]/movements', error)
    return NextResponse.json(
      { error: 'Failed to fetch serial number movements' },
      { status: 500 }
    )
  }
}
