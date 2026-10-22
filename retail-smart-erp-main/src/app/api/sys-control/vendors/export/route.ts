import { NextRequest, NextResponse } from 'next/server'
import { adminAuthError, validateAdminSession, logAdminAction, withRateLimit, STRICT_LIMIT } from '@/lib/admin'
import { validateSearchParams } from '@/lib/validation'
import { logError } from '@/lib/ai/error-logger'
import { queryVendors, vendorFilterSchema } from '@/lib/admin/vendor-query'
import { formatBusinessId } from '@/lib/tenant/business-id'

const MAX_ROWS = 10_000

/** RFC 4180 cell; also neutralises spreadsheet formulas (=, +, -, @ at the start). */
function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s = v instanceof Date ? v.toISOString() : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// GET /api/sys-control/vendors/export?q=&status=&businessType=&tierId= — CSV of the filtered directory (audited)
export async function GET(request: NextRequest) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/vendors/export', STRICT_LIMIT)
    if (rateLimited) return rateLimited

    const session = await validateAdminSession('read')
    if (!session) return adminAuthError()

    const parsed = validateSearchParams(request, vendorFilterSchema)
    if (!parsed.success) return parsed.response

    const { rows, total } = await queryVendors(parsed.data, MAX_ROWS, 0)

    const header = [
      'Business ID', 'Business name', 'Legal name', 'Web address', 'Business type', 'Status', 'Plan',
      'Subscription status', 'Period ends', 'Trial ends', 'Owner name', 'Owner email', 'Business email', 'Phone',
      'Active users', 'Total users', 'Last activity', 'Created',
    ]
    const lines = [header.map(cell).join(',')]
    for (const r of rows) {
      lines.push([
        formatBusinessId(r.businessId), r.name, r.legalName, r.slug, r.businessType, r.status, r.tierDisplayName,
        r.subscriptionStatus, r.currentPeriodEnd, r.trialEndsAt, r.owner?.name, r.owner?.email, r.email, r.phone,
        r.activeUserCount, r.userCount, r.lastActivityAt, r.createdAt,
      ].map(cell).join(','))
    }

    await logAdminAction({
      accountId: session.superAdminId,
      action: 'view',
      resource: 'vendor_export',
      details: { filters: parsed.data, rows: rows.length, total, truncated: total > rows.length },
    })

    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse('﻿' + lines.join('\r\n') + '\r\n', {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="poslanka-vendors-${stamp}.csv"`,
        'Cache-Control': 'no-store',
        'X-Total-Count': String(total),
      },
    })
  } catch (error) {
    logError('api/sys-control/vendors/export', error)
    return NextResponse.json({ error: 'Failed to export vendors' }, { status: 500 })
  }
}
