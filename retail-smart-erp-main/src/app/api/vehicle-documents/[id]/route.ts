import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany, resolveUserIdRequired } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { vehicleDocuments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateVehicleDocumentSchema } from '@/lib/validation/schemas/vehicles'
import { deleteFromR2, keyFromUrl } from '@/lib/files'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single vehicle document
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const document = await db.query.vehicleDocuments.findFirst({
        where: eq(vehicleDocuments.id, id),
        with: {
          vehicleInventory: true,
          vehicleImport: true,
          dealer: true,
          uploadedByUser: true,
        },
      })

      if (!document) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      }

      return NextResponse.json(document)
    })
  } catch (error) {
    logError('api/vehicle-documents/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch vehicle document' }, { status: 500 })
  }
}

// PUT update vehicle document
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError

    const userId = await resolveUserIdRequired(session)
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateVehicleDocumentSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.vehicleDocuments.findFirst({
        where: eq(vehicleDocuments.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: Record<string, any> = {
        updatedAt: new Date(),
      }

      if (body.documentType !== undefined) updateData.documentType = body.documentType
      if (body.name !== undefined) updateData.name = body.name
      if (body.description !== undefined) updateData.description = body.description
      if (body.fileUrl !== undefined) updateData.fileUrl = body.fileUrl
      if (body.fileType !== undefined) updateData.fileType = body.fileType
      if (body.fileSize !== undefined) updateData.fileSize = body.fileSize ?? null
      if (body.issueDate !== undefined) updateData.issueDate = body.issueDate
      if (body.expiryDate !== undefined) {
        updateData.expiryDate = body.expiryDate
        updateData.isExpired = body.expiryDate ? new Date(body.expiryDate) < new Date() : false
      }
      if (body.alertBeforeDays !== undefined) updateData.alertBeforeDays = body.alertBeforeDays ?? 30
      if (body.documentNo !== undefined) updateData.documentNo = body.documentNo
      if (body.issuedBy !== undefined) updateData.issuedBy = body.issuedBy
      if (body.status !== undefined) updateData.status = body.status
      if (body.notes !== undefined) updateData.notes = body.notes

      const [updated] = await db.update(vehicleDocuments)
        .set(updateData)
        .where(eq(vehicleDocuments.id, id))
        .returning()

      logAndBroadcast(session.user.tenantId, 'vehicle-document', 'updated', updated.id, {
        userId,
        entityName: updated.name,
        description: `Updated document: ${updated.name}`,
      })

      return NextResponse.json(updated)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/vehicle-documents/[id]', error)
    return NextResponse.json({ error: 'Failed to update vehicle document' }, { status: 500 })
  }
}

// DELETE vehicle document
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageVehicles')
    if (permError) return permError

    const userId = await resolveUserIdRequired(session)
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.vehicleDocuments.findFirst({
        where: eq(vehicleDocuments.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      }

      await db.delete(vehicleDocuments)
        .where(eq(vehicleDocuments.id, id))

      // Clean up file from R2
      if (existing.fileUrl) {
        const key = keyFromUrl(existing.fileUrl)
        if (key) {
          try { await deleteFromR2(key) } catch { /* ignore */ }
        }
      }

      logAndBroadcast(session.user.tenantId, 'vehicle-document', 'deleted', id, {
        userId,
        entityName: existing.name,
        description: `Deleted document: ${existing.name}`,
      })

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') {
      return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
    }
    logError('api/vehicle-documents/[id]', error)
    return NextResponse.json({ error: 'Failed to delete vehicle document' }, { status: 500 })
  }
}
