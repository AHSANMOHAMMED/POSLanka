import { db } from '@/lib/db'
import { adminAuditLogs } from '@/lib/db/schema'
import { headers } from 'next/headers'

type AuditAction = 'login' | 'logout' | 'view' | 'create' | 'update' | 'delete' | 'approve' | 'reject' | 'extend'

interface AuditLogParams {
  accountId: string
  action: AuditAction
  resource: string
  resourceId?: string
  details?: Record<string, unknown>
}

/**
 * Log an admin action to the audit log
 */
export async function logAdminAction({
  accountId,
  action,
  resource,
  resourceId,
  details = {},
}: AuditLogParams): Promise<void> {
  try {
    const headersList = await headers()
    const forwardedFor = headersList.get('x-forwarded-for')
    const realIp = headersList.get('x-real-ip')
    const ipAddress = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown'
    const userAgent = headersList.get('user-agent') || undefined

    await db.insert(adminAuditLogs).values({
      accountId,
      action,
      resource,
      resourceId: resourceId || null,
      details,
      ipAddress,
      userAgent,
    })
  } catch (error) {
    // Don't throw - audit logging should not break the main operation
    console.error('Failed to log admin action:', error)
  }
}

/**
 * Helper functions for common audit actions
 */
export const adminAudit = {
  login: (accountId: string) =>
    logAdminAction({ accountId, action: 'login', resource: 'session' }),

  logout: (accountId: string) =>
    logAdminAction({ accountId, action: 'logout', resource: 'session' }),

  view: (accountId: string, resource: string, resourceId?: string) =>
    logAdminAction({ accountId, action: 'view', resource, resourceId }),

  create: (accountId: string, resource: string, resourceId: string, details?: Record<string, unknown>) =>
    logAdminAction({ accountId, action: 'create', resource, resourceId, details }),

  update: (accountId: string, resource: string, resourceId: string, details?: Record<string, unknown>) =>
    logAdminAction({ accountId, action: 'update', resource, resourceId, details }),

  delete: (accountId: string, resource: string, resourceId: string, details?: Record<string, unknown>) =>
    logAdminAction({ accountId, action: 'delete', resource, resourceId, details }),

  approve: (accountId: string, resource: string, resourceId: string, details?: Record<string, unknown>) =>
    logAdminAction({ accountId, action: 'approve', resource, resourceId, details }),

  reject: (accountId: string, resource: string, resourceId: string, details?: Record<string, unknown>) =>
    logAdminAction({ accountId, action: 'reject', resource, resourceId, details }),

  extend: (accountId: string, resource: string, resourceId: string, details?: Record<string, unknown>) =>
    logAdminAction({ accountId, action: 'extend', resource, resourceId, details }),
}
