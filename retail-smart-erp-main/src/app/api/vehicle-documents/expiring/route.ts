import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { vehicleDocuments } from '@/lib/db/schema'
import { and, or, lte, gte, sql, isNotNull } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { vehicleDocumentsExpiringSchema } from '@/lib/validation/schemas/vehicles'

// GET documents expiring within N days (or already expired)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError

    const parsed = validateSearchParams(request, vehicleDocumentsExpiringSchema)
    if (!parsed.success) return parsed.response
    const { days } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const now = new Date()
      const futureDate = new Date()
      futureDate.setDate(futureDate.getDate() + days)

      const nowStr = now.toISOString().split('T')[0]
      const futureStr = futureDate.toISOString().split('T')[0]

      // Get documents that:
      // 1. Have an expiry date AND expiry date is within the range (now to now+days)
      // 2. OR are already expired (expiryDate < now OR isExpired = true)
      const result = await db.query.vehicleDocuments.findMany({
        where: and(
          isNotNull(vehicleDocuments.expiryDate),
          or(
            // Expiring within N days (between now and future)
            and(
              gte(vehicleDocuments.expiryDate, nowStr),
              lte(vehicleDocuments.expiryDate, futureStr)
            ),
            // Already expired
            lte(vehicleDocuments.expiryDate, nowStr)
          )
        ),
        with: {
          vehicleInventory: true,
          vehicleImport: true,
          dealer: true,
          uploadedByUser: true,
        },
        orderBy: [sql`${vehicleDocuments.expiryDate} ASC`],
      })

      return NextResponse.json({
        data: result,
        meta: {
          days,
          total: result.length,
          expired: result.filter(d => d.expiryDate && new Date(d.expiryDate) < now).length,
          expiringSoon: result.filter(d => d.expiryDate && new Date(d.expiryDate) >= now).length,
        },
      })
    })
  } catch (error) {
    logError('api/vehicle-documents/expiring', error)
    return NextResponse.json({ error: 'Failed to fetch expiring documents' }, { status: 500 })
  }
}
