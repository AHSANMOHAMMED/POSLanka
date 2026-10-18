import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { itemSerialNumbers } from '@/lib/db/schema'
import { inArray } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

// GET /api/serial-numbers/by-ids?ids=uuid1,uuid2,...
// Returns [{id, serialNumber}] for display on receipts
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const idsParam = request.nextUrl.searchParams.get('ids')
    if (!idsParam) {
      return NextResponse.json([])
    }

    const ids = idsParam.split(',').filter(Boolean).slice(0, 100) // Cap at 100
    if (ids.length === 0) {
      return NextResponse.json([])
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const serials = await db.select({
        id: itemSerialNumbers.id,
        serialNumber: itemSerialNumbers.serialNumber,
      })
        .from(itemSerialNumbers)
        .where(inArray(itemSerialNumbers.id, ids))

      return NextResponse.json(serials)
    })
  } catch (error) {
    logError('api/serial-numbers/by-ids', error)
    return NextResponse.json({ error: 'Failed to fetch serial numbers' }, { status: 500 })
  }
}
