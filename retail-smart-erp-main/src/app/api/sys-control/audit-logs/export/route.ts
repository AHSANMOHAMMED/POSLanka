import { NextRequest, NextResponse } from 'next/server'
import { adminAuthError, validateAdminSession, logAdminAction, withRateLimit, STRICT_LIMIT } from '@/lib/admin'
import { validateSearchParams } from '@/lib/validation/helpers'
import { logError } from '@/lib/ai/error-logger'
import { formatBusinessId } from '@/lib/tenant/business-id'
import { auditBaseQuery, auditCount, auditFilterSchema, auditOrder, auditWhere, csvCell } from '@/lib/admin/audit-query'

const MAX_ROWS = 20_000

// GET /api/sys-control/audit-logs/export?<same filters as the list> — CSV of the filtered audit trail (audited)
export async function GET(request: NextRequest) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/audit-logs/export', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const session = await validateAdminSession('read')
    if (!session) return adminAuthError()

    const parsed = validateSearchParams(request, auditFilterSchema)
    if (!parsed.success) return parsed.response
    const where = await auditWhere(parsed.data)
    const [rows, total] = await Promise.all([
      auditBaseQuery().where(where).orderBy(...auditOrder).limit(MAX_ROWS),
      auditCount(where),
    ])

    const header = ['Time (UTC)', 'Admin', 'Admin email', 'Action', 'Resource', 'Resource ID', 'Vendor', 'Business ID', 'IP address', 'Details']
    const lines = [header.map(csvCell).join(',')]
    for (const r of rows) {
      lines.push([
        r.createdAt, r.adminName ?? r.accountName, r.adminEmail ?? r.accountEmail, r.action, r.resource, r.resourceId,
        r.vendorName, r.vendorBusinessId ? formatBusinessId(r.vendorBusinessId) : '', r.ipAddress, r.details ?? {},
      ].map(csvCell).join(','))
    }

    await logAdminAction({
      accountId: session.superAdminId,
      action: 'view',
      resource: 'audit_export',
      details: { filters: parsed.data, rows: rows.length, total, truncated: total > rows.length },
    })

    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse('﻿' + lines.join('\r\n') + '\r\n', {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="poslanka-audit-log-${stamp}.csv"`,
        'Cache-Control': 'no-store',
        'X-Total-Count': String(total),
      },
    })
  } catch (error) {
    logError('api/sys-control/audit-logs/export', error)
    return NextResponse.json({ error: 'Failed to export audit logs' }, { status: 500 })
  }
}
