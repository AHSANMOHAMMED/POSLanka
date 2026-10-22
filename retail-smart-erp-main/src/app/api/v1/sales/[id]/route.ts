import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/db'
import { withApiKey } from '@/lib/auth/api-keys'
import { isUuid } from '@/lib/offline/sync-policy'
import { loadSalesV1, v1Error } from '@/lib/api-v1'

// GET /api/v1/sales/{id} — sale with lines and payments (scope sales:read)
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withApiKey(request, 'sales:read', async ({ session }) => {
    const { id } = await params
    if (!isUuid(id)) return v1Error(400, 'Invalid sale id', 'VALIDATION_ERROR')
    const [sale] = await withTenant(session.user.tenantId, (db) => loadSalesV1(db, [id]))
    if (!sale) return v1Error(404, 'Sale not found', 'NOT_FOUND')
    return NextResponse.json({ data: sale })
  })
}
