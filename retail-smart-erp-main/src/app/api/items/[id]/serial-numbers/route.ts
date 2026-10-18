import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { itemSerialNumbers, serialNumberMovements, warehouses } from '@/lib/db/schema'
import { eq, and, sql, ilike, desc } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import {
  parseSerialNumberInput,
  checkDuplicateSerials,
} from '@/lib/inventory/serial-numbers'
import { validateSearchParams, validateBody, validateParams } from '@/lib/validation/helpers'
import { itemSerialNumbersListSchema, createItemSerialNumbersSchema } from '@/lib/validation/schemas/items'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET - List serial numbers for an item (paginated)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: itemId } = paramsParsed.data
    const parsed = validateSearchParams(request, itemSerialNumbersListSchema)
    if (!parsed.success) return parsed.response
    const { search, status, warehouseId, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions (tenantId filter handled by RLS)
      const conditions = [eq(itemSerialNumbers.itemId, itemId)]

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(ilike(itemSerialNumbers.serialNumber, `%${escaped}%`))
      }
      if (status) {
        conditions.push(
          eq(
            itemSerialNumbers.status,
            status as 'available' | 'reserved' | 'sold' | 'returned' | 'defective' | 'scrapped' | 'lost'
          )
        )
      }
      if (warehouseId) {
        conditions.push(eq(itemSerialNumbers.warehouseId, warehouseId))
      }

      const whereClause = and(...conditions)

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(itemSerialNumbers)
        .where(whereClause)

      const limit = all ? 10000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      // Query serial numbers with warehouse join
      const query = db
        .select({
          id: itemSerialNumbers.id,
          serialNumber: itemSerialNumbers.serialNumber,
          status: itemSerialNumbers.status,
          warehouseId: itemSerialNumbers.warehouseId,
          warehouseName: warehouses.name,
          warrantyStartDate: itemSerialNumbers.warrantyStartDate,
          warrantyEndDate: itemSerialNumbers.warrantyEndDate,
          warrantyNotes: itemSerialNumbers.warrantyNotes,
          notes: itemSerialNumbers.notes,
          createdAt: itemSerialNumbers.createdAt,
          updatedAt: itemSerialNumbers.updatedAt,
        })
        .from(itemSerialNumbers)
        .leftJoin(warehouses, eq(itemSerialNumbers.warehouseId, warehouses.id))
        .where(whereClause)
        .orderBy(desc(itemSerialNumbers.createdAt))
        .limit(limit)

      const data = offset !== undefined
        ? await query.offset(offset)
        : await query

      // Return flat array for dropdowns (all=true)
      if (all) {
        return NextResponse.json(data)
      }

      return NextResponse.json({
        data,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        },
      })
    })
  } catch (error) {
    logError('api/items/[id]/serial-numbers', error)
    return NextResponse.json(
      { error: 'Failed to fetch serial numbers' },
      { status: 500 }
    )
  }
}

// POST - Bulk create serial numbers for an item
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: itemId } = paramsParsed.data

    const parsed = await validateBody(request, createItemSerialNumbersSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    // Parse the serial number input (supports one-per-line, comma-separated, ranges)
    const parsedSerials = parseSerialNumberInput(body.serialNumbers)
    if (parsedSerials.length === 0) {
      return NextResponse.json(
        { error: 'No valid serial numbers found in input' },
        { status: 400 }
      )
    }

    if (parsedSerials.length > 1000) {
      return NextResponse.json(
        { error: 'Cannot create more than 1000 serial numbers at once' },
        { status: 400 }
      )
    }

    const tenantId = session!.user.tenantId
    const userId = session!.user.id

    return await withTenantTransaction(tenantId, async (tx) => {
      // Check for duplicate serial numbers within this item
      const duplicates = await checkDuplicateSerials(tx, itemId, parsedSerials)
      if (duplicates.length > 0) {
        return NextResponse.json(
          {
            error: `Duplicate serial numbers already exist for this item: ${duplicates.join(', ')}`,
            duplicates,
          },
          { status: 400 }
        )
      }

      // Bulk insert serial number records
      const serialValues = parsedSerials.map((sn) => ({
        tenantId,
        itemId,
        serialNumber: sn,
        status: 'available' as const,
        warehouseId: body.warehouseId || null,
        warrantyStartDate: body.warrantyStartDate || null,
        warrantyEndDate: body.warrantyEndDate || null,
        warrantyNotes: body.warrantyNotes || null,
        notes: body.notes || null,
        createdBy: userId,
      }))

      const created = await tx
        .insert(itemSerialNumbers)
        .values(serialValues)
        .returning()

      // Create initial movement records for each serial number
      const movementValues = created.map((sn) => ({
        tenantId,
        serialNumberId: sn.id,
        fromStatus: null,
        toStatus: 'available' as const,
        fromWarehouseId: null,
        toWarehouseId: body.warehouseId || null,
        referenceType: 'manual_entry',
        referenceId: null,
        changedBy: userId,
        notes: body.notes || null,
      }))

      // Bulk insert movement records for efficiency
      if (movementValues.length > 0) {
        await tx.insert(serialNumberMovements).values(movementValues)
      }

      // Broadcast change
      logAndBroadcast(tenantId, 'serial-number', 'created', itemId)

      return NextResponse.json(
        {
          message: `${created.length} serial number(s) created successfully`,
          count: created.length,
          data: created,
        },
        { status: 201 }
      )
    })
  } catch (error) {
    logError('api/items/[id]/serial-numbers', error)
    return NextResponse.json(
      { error: 'Failed to create serial numbers' },
      { status: 500 }
    )
  }
}
