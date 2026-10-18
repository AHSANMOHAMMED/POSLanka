import { NextRequest } from 'next/server'
import { withTenant } from '@/lib/db'
import { fileAuditLogs } from '@/lib/db/schema'

interface AuditLogParams {
  tenantId: string
  fileId?: string | null
  userId: string
  action: string
  fileName?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  details?: Record<string, unknown> | null
}

export async function logFileAudit(params: AuditLogParams): Promise<void> {
  try {
    await withTenant(params.tenantId, async (db) => {
      await db.insert(fileAuditLogs).values({
        tenantId: params.tenantId,
        fileId: params.fileId || null,
        userId: params.userId,
        action: params.action,
        fileName: params.fileName || null,
        ipAddress: params.ipAddress || null,
        userAgent: params.userAgent || null,
        details: params.details || null,
      })
    })
  } catch (error) {
    console.error('[FileAudit] Failed to log:', error)
  }
}

// Extract IP and user agent from request
export function getRequestMeta(request: NextRequest): { ip: string; userAgent: string } {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
  const userAgent = request.headers.get('user-agent') || 'unknown'
  return { ip, userAgent }
}
