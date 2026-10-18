import { db, withTenant } from '@/lib/db'
import { activityLogs } from '@/lib/db/schema'
import type { TenantDb } from '@/lib/db/tenant-context'

// X4: Activity logging utility
export type ActivityAction = 'create' | 'update' | 'delete' | 'status_change' |
  'submit' | 'approve' | 'reject' | 'cancel' | 'convert' |
  'login' | 'logout' | 'print' | 'export' | 'import'

interface LogActivityParams {
  tenantId: string
  userId?: string
  action: ActivityAction
  entityType: string
  entityId?: string
  entityName?: string
  description?: string
  metadata?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    await withTenant(params.tenantId, async (db) => {
      await db.insert(activityLogs).values({
        tenantId: params.tenantId,
        userId: params.userId || null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId || null,
        entityName: params.entityName || null,
        description: params.description || null,
        metadata: params.metadata || null,
        ipAddress: params.ipAddress || null,
        userAgent: params.userAgent || null,
      })
    })
  } catch (error) {
    // Don't throw - activity logging should not break the main flow
    console.error('Failed to log activity:', error)
  }
}

// Helper to generate activity descriptions
export function generateActivityDescription(
  action: ActivityAction,
  entityType: string,
  entityName?: string
): string {
  const entityDisplay = entityName ? `"${entityName}"` : entityType

  switch (action) {
    case 'create':
      return `Created ${entityType} ${entityDisplay}`
    case 'update':
      return `Updated ${entityType} ${entityDisplay}`
    case 'delete':
      return `Deleted ${entityType} ${entityDisplay}`
    case 'status_change':
      return `Changed status of ${entityType} ${entityDisplay}`
    case 'submit':
      return `Submitted ${entityType} ${entityDisplay}`
    case 'approve':
      return `Approved ${entityType} ${entityDisplay}`
    case 'reject':
      return `Rejected ${entityType} ${entityDisplay}`
    case 'cancel':
      return `Cancelled ${entityType} ${entityDisplay}`
    case 'convert':
      return `Converted ${entityType} ${entityDisplay}`
    case 'login':
      return 'Logged in'
    case 'logout':
      return 'Logged out'
    case 'print':
      return `Printed ${entityType} ${entityDisplay}`
    case 'export':
      return `Exported ${entityType} ${entityDisplay}`
    case 'import':
      return `Imported ${entityType} ${entityDisplay}`
    default:
      return `${action} ${entityType} ${entityDisplay}`
  }
}

// ==================== STATUS CHANGE HELPER (STW-6) ====================

/**
 * Log a status change with full audit trail
 * Use this for tracking status transitions on documents like stock transfers, work orders, etc.
 *
 * @param txDb - Transaction or tenant-scoped database instance
 * @param tenantId - The tenant ID
 * @param userId - The user making the change
 * @param entityType - Type of entity (e.g., 'stock_transfer', 'work_order')
 * @param entityId - The entity's ID
 * @param fromStatus - Previous status
 * @param toStatus - New status
 * @param notes - Optional notes or reason for the change
 */
export async function logStatusChange(
  txDb: typeof db | TenantDb,
  tenantId: string,
  userId: string | null,
  entityType: string,
  entityId: string,
  fromStatus: string,
  toStatus: string,
  notes?: string
): Promise<void> {
  try {
    await txDb.insert(activityLogs).values({
      tenantId,
      userId: userId || null,
      action: 'status_change',
      entityType,
      entityId,
      description: `Status changed from "${fromStatus}" to "${toStatus}"${notes ? `: ${notes}` : ''}`,
      metadata: {
        fromStatus,
        toStatus,
        notes: notes || null,
        timestamp: new Date().toISOString(),
      },
    })
  } catch (error) {
    // Don't throw - activity logging should not break the main flow
    console.error('Failed to log status change:', error)
  }
}
