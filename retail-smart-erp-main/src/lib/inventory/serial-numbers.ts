import { eq, and, inArray } from 'drizzle-orm'
import { itemSerialNumbers, serialNumberMovements } from '@/lib/db/schema'
import type { PgDatabase } from 'drizzle-orm/pg-core'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TenantDb = PgDatabase<any, any, any>

type SerialNumberStatus = 'available' | 'reserved' | 'sold' | 'returned' | 'defective' | 'scrapped' | 'lost'

interface CreateMovementParams {
  tenantId: string
  serialNumberId: string
  fromStatus: SerialNumberStatus | null
  toStatus: SerialNumberStatus
  fromWarehouseId?: string | null
  toWarehouseId?: string | null
  referenceType?: string | null
  referenceId?: string | null
  changedBy?: string | null
  notes?: string | null
}

/**
 * Create a serial number movement audit record.
 * Called by all code paths that change serial number status or warehouse.
 */
export async function createSerialMovement(db: TenantDb, params: CreateMovementParams) {
  const [movement] = await db.insert(serialNumberMovements).values({
    tenantId: params.tenantId,
    serialNumberId: params.serialNumberId,
    fromStatus: params.fromStatus,
    toStatus: params.toStatus,
    fromWarehouseId: params.fromWarehouseId || null,
    toWarehouseId: params.toWarehouseId || null,
    referenceType: params.referenceType || null,
    referenceId: params.referenceId || null,
    changedBy: params.changedBy || null,
    notes: params.notes || null,
  }).returning()
  return movement
}

/**
 * Validate that given serial number IDs are all available and belong to the expected item+warehouse.
 * Returns the serial numbers if valid, throws descriptive error if not.
 */
export async function validateSerialAvailability(
  db: TenantDb,
  serialNumberIds: string[],
  expectedItemId: string,
  expectedWarehouseId: string | null,
) {
  if (serialNumberIds.length === 0) return []

  const serials = await db.select().from(itemSerialNumbers)
    .where(inArray(itemSerialNumbers.id, serialNumberIds))

  // Check all were found
  if (serials.length !== serialNumberIds.length) {
    const foundIds = new Set(serials.map(s => s.id))
    const missing = serialNumberIds.filter(id => !foundIds.has(id))
    throw new Error(`Serial numbers not found: ${missing.join(', ')}`)
  }

  // Check all are available
  const unavailable = serials.filter(s => s.status !== 'available')
  if (unavailable.length > 0) {
    throw new Error(`Serial numbers not available: ${unavailable.map(s => s.serialNumber).join(', ')} (status: ${unavailable.map(s => s.status).join(', ')})`)
  }

  // Check all belong to expected item
  const wrongItem = serials.filter(s => s.itemId !== expectedItemId)
  if (wrongItem.length > 0) {
    throw new Error(`Serial numbers do not belong to expected item: ${wrongItem.map(s => s.serialNumber).join(', ')}`)
  }

  // Check all are in expected warehouse (if specified)
  if (expectedWarehouseId) {
    const wrongWarehouse = serials.filter(s => s.warehouseId !== expectedWarehouseId)
    if (wrongWarehouse.length > 0) {
      throw new Error(`Serial numbers not in expected warehouse: ${wrongWarehouse.map(s => s.serialNumber).join(', ')}`)
    }
  }

  return serials
}

/**
 * Bulk-allocate serial numbers: update status + create movement records.
 * Used by sales checkout, work order consumption, etc.
 */
export async function allocateSerials(
  db: TenantDb,
  params: {
    tenantId: string
    serialNumberIds: string[]
    newStatus: SerialNumberStatus
    referenceType: string
    referenceId: string
    changedBy: string | null
    notes?: string | null
  }
) {
  if (params.serialNumberIds.length === 0) return

  // Get current state of all serials
  const serials = await db.select().from(itemSerialNumbers)
    .where(inArray(itemSerialNumbers.id, params.serialNumberIds))

  // Update all serials to new status
  await db.update(itemSerialNumbers)
    .set({
      status: params.newStatus,
      updatedAt: new Date(),
    })
    .where(
      and(
        inArray(itemSerialNumbers.id, params.serialNumberIds),
      )
    )

  // Create movement records for each
  const movements = serials.map(serial => ({
    tenantId: params.tenantId,
    serialNumberId: serial.id,
    fromStatus: serial.status as SerialNumberStatus,
    toStatus: params.newStatus,
    fromWarehouseId: serial.warehouseId,
    toWarehouseId: serial.warehouseId,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    changedBy: params.changedBy,
    notes: params.notes || null,
  }))

  if (movements.length > 0) {
    await db.insert(serialNumberMovements).values(movements)
  }
}

/**
 * Transfer serial numbers between warehouses.
 * Updates warehouseId and creates movement records.
 */
export async function transferSerials(
  db: TenantDb,
  params: {
    tenantId: string
    serialNumberIds: string[]
    toWarehouseId: string
    referenceType: string
    referenceId: string
    changedBy: string | null
    notes?: string | null
  }
) {
  if (params.serialNumberIds.length === 0) return

  const serials = await db.select().from(itemSerialNumbers)
    .where(inArray(itemSerialNumbers.id, params.serialNumberIds))

  // Update warehouse
  await db.update(itemSerialNumbers)
    .set({
      warehouseId: params.toWarehouseId,
      updatedAt: new Date(),
    })
    .where(inArray(itemSerialNumbers.id, params.serialNumberIds))

  // Create movement records
  const movements = serials.map(serial => ({
    tenantId: params.tenantId,
    serialNumberId: serial.id,
    fromStatus: serial.status as SerialNumberStatus,
    toStatus: serial.status as SerialNumberStatus,
    fromWarehouseId: serial.warehouseId,
    toWarehouseId: params.toWarehouseId,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    changedBy: params.changedBy,
    notes: params.notes || null,
  }))

  if (movements.length > 0) {
    await db.insert(serialNumberMovements).values(movements)
  }
}

/**
 * Parse serial number input. Supports:
 * - One per line
 * - Comma-separated
 * - Range (SN001-SN050)
 */
export function parseSerialNumberInput(input: string): string[] {
  const lines = input.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
  const result: string[] = []

  for (const line of lines) {
    // Check if it's a range like SN001-SN050
    const rangeMatch = line.match(/^([A-Za-z]*)(\d+)\s*-\s*([A-Za-z]*)(\d+)$/)
    if (rangeMatch) {
      const prefix = rangeMatch[1] || rangeMatch[3]
      const start = parseInt(rangeMatch[2], 10)
      const end = parseInt(rangeMatch[4], 10)
      const padLength = rangeMatch[2].length

      if (!isNaN(start) && !isNaN(end) && end >= start && (end - start) <= 1000) {
        for (let i = start; i <= end; i++) {
          result.push(prefix + String(i).padStart(padLength, '0'))
        }
        continue
      }
    }
    result.push(line)
  }

  return [...new Set(result)] // Deduplicate
}

/**
 * Check if a serial number already exists for an item within tenant (via RLS context).
 */
export async function checkDuplicateSerials(
  db: TenantDb,
  itemId: string,
  serialNumbers: string[],
): Promise<string[]> {
  if (serialNumbers.length === 0) return []

  const existing = await db.select({ serialNumber: itemSerialNumbers.serialNumber })
    .from(itemSerialNumbers)
    .where(
      and(
        eq(itemSerialNumbers.itemId, itemId),
        inArray(itemSerialNumbers.serialNumber, serialNumbers),
      )
    )

  return existing.map(e => e.serialNumber)
}
