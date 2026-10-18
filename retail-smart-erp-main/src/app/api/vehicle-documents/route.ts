import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { vehicleDocuments, vehicleInventory } from '@/lib/db/schema'
import { eq, and, desc, sql, or, ilike } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { vehicleDocumentsListSchema, createVehicleDocumentSchema } from '@/lib/validation/schemas/vehicles'

// GET all vehicle documents for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, vehicleDocumentsListSchema)
    if (!parsed.success) return parsed.response
    const { vehicleInventoryId, vehicleImportId, dealerId, documentType, status, search, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (vehicleInventoryId) {
        conditions.push(eq(vehicleDocuments.vehicleInventoryId, vehicleInventoryId))
      }
      if (vehicleImportId) {
        conditions.push(eq(vehicleDocuments.vehicleImportId, vehicleImportId))
      }
      if (dealerId) {
        conditions.push(eq(vehicleDocuments.dealerId, dealerId))
      }
      if (documentType) {
        conditions.push(eq(vehicleDocuments.documentType, documentType))
      }
      if (status) {
        conditions.push(eq(vehicleDocuments.status, status))
      }
      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(vehicleDocuments.name, `%${escaped}%`),
            ilike(vehicleDocuments.documentNo, `%${escaped}%`),
            ilike(vehicleDocuments.description, `%${escaped}%`)
          )
        )
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(vehicleDocuments)
        .where(whereClause)

      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.vehicleDocuments.findMany({
        where: whereClause,
        with: {
          vehicleInventory: true,
          vehicleImport: true,
          dealer: true,
          uploadedByUser: true,
        },
        orderBy: [desc(vehicleDocuments.createdAt)],
        limit,
        offset,
      })

      if (all) {
        return NextResponse.json(result)
      }

      return NextResponse.json({
        data: result,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        },
      })
    })
  } catch (error) {
    logError('api/vehicle-documents', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle documents' }, { status: 500 })
  }
}

// POST create a new vehicle document
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError
    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const userId = await resolveUserIdRequired(session)
    const parsed = await validateBody(request, createVehicleDocumentSchema)
    if (!parsed.success) return parsed.response
    const {
      vehicleInventoryId: vehInvId,
      vehicleImportId: vehImpId,
      dealerId,
      documentType,
      name,
      description,
      fileUrl,
      fileType,
      fileSize,
      issueDate,
      expiryDate,
      alertBeforeDays,
      documentNo,
      issuedBy,
      status,
      notes,
    } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Validate vehicleInventoryId if provided
      if (vehInvId) {
        const vehicle = await db.query.vehicleInventory.findFirst({
          where: eq(vehicleInventory.id, vehInvId),
        })
        if (!vehicle) {
          return NextResponse.json({ error: 'Vehicle inventory not found' }, { status: 404 })
        }
      }

      // Calculate isExpired
      const isExpired = expiryDate ? new Date(expiryDate) < new Date() : false

      const [document] = await db.insert(vehicleDocuments).values({
        tenantId: session.user.tenantId,
        vehicleInventoryId: vehInvId || null,
        vehicleImportId: vehImpId || null,
        dealerId: dealerId || null,
        documentType,
        name,
        description: description || null,
        fileUrl: fileUrl || null,
        fileType: fileType || null,
        fileSize: fileSize ?? null,
        issueDate: issueDate || null,
        expiryDate: expiryDate || null,
        isExpired,
        alertBeforeDays,
        documentNo: documentNo || null,
        issuedBy: issuedBy || null,
        status,
        uploadedBy: userId,
        notes: notes || null,
      }).returning()

      logAndBroadcast(session.user.tenantId, 'vehicle-document', 'created', document.id, {
        userId,
        entityName: name,
        description: `Uploaded document: ${name}`,
      })

      return NextResponse.json(document)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/vehicle-documents', error)
    return NextResponse.json({ error: 'Failed to create vehicle document' }, { status: 500 })
  }
}
