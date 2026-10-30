import { NextRequest, NextResponse } from 'next/server'
import { adminAuthError, validateAdminSession, logAdminAction, withRateLimit, STRICT_LIMIT } from '@/lib/admin'
import { validateSearchParams } from '@/lib/validation'
import { logError } from '@/lib/ai/error-logger'
import { queryVendors, vendorFilterSchema } from '@/lib/admin/vendor-query'
import { formatBusinessId } from '@/lib/tenant/business-id'
import { csvRow, CSV_BOM } from '@/lib/admin/csv'

const MAX_ROWS = 10_000

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
    const lines = [csvRow(header)]
    for (const r of rows) {
      lines.push(csvRow([
        formatBusinessId(r.businessId), r.name, r.legalName, r.slug, r.businessType, r.status, r.tierDisplayName,
        r.subscriptionStatus, r.currentPeriodEnd, r.trialEndsAt, r.owner?.name, r.owner?.email, r.email, r.phone,
        r.activeUserCount, r.userCount, r.lastActivityAt, r.createdAt,
      ]))
    }

    await logAdminAction({
      accountId: session.superAdminId,
      action: 'view',
      resource: 'vendor_export',
      details: { filters: parsed.data, rows: rows.length, total, truncated: total > rows.length },
    })

    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse(CSV_BOM + lines.join('\r\n') + '\r\n', {
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
