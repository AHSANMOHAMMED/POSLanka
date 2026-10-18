import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { vehicleTypes, vehicleTypeDiagramViews, files } from '@/lib/db/schema'
import { eq, and, or, isNull } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateFile, storeFile, computeFileHash, deleteStoredFile } from '@/lib/files'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota, invalidateStorageCache } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET diagram for a vehicle type
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
      const vehicleType = await db.query.vehicleTypes.findFirst({
        where: and(
          eq(vehicleTypes.id, id),
          or(
            isNull(vehicleTypes.tenantId),
            eq(vehicleTypes.tenantId, session.user.tenantId)
          )
        ),
        with: {
          diagramViews: true,
        },
      })

      if (!vehicleType) {
        return NextResponse.json({ error: 'Vehicle type not found' }, { status: 404 })
      }

      const diagram = vehicleType.diagramViews?.[0] || null

      return NextResponse.json({
        vehicleTypeId: id,
        hasDiagram: !!diagram?.imageUrl,
        diagram: diagram ? {
          id: diagram.id,
          imageUrl: diagram.imageUrl,
          imageWidth: diagram.imageWidth,
          imageHeight: diagram.imageHeight,
        } : null,
      })
    })
  } catch (error) {
    logError('api/vehicle-types/[id]/diagram', error)
    return NextResponse.json({ error: 'Failed to fetch diagram' }, { status: 500 })
  }
}

// POST upload diagram image
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const permError = requirePermission(session, 'manageVehicleTypes')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'file')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const vehicleType = await db.query.vehicleTypes.findFirst({
        where: and(
          eq(vehicleTypes.id, id),
          or(
            eq(vehicleTypes.tenantId, session.user.tenantId),
            isNull(vehicleTypes.tenantId)
          )
        ),
      })

      if (!vehicleType) {
        return NextResponse.json(
          { error: 'Vehicle type not found or cannot be modified' },
          { status: 404 }
        )
      }

      if (vehicleType.isSystemDefault && (!session.user.role || !['owner', 'manager'].includes(session.user.role))) {
        return NextResponse.json(
          { error: 'Only owners and managers can modify system default vehicle types' },
          { status: 403 }
        )
      }

      const formData = await request.formData()
      const file = formData.get('file') as File | null

      if (!file) {
        return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
      }

      const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
      const validation = validateFile(file, { allowedTypes, maxSize: 5 * 1024 * 1024 })
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 })
      }

      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)
      const contentHash = computeFileHash(buffer)

      // Check dedup
      const existingFile = await db.query.files.findFirst({
        where: eq(files.contentHash, contentHash),
      })

      let fileUrl: string

      if (existingFile) {
        fileUrl = existingFile.fileUrl
      } else {
        const stored = await storeFile(buffer, file.name, {
          tenantSlug: session.user.tenantSlug,
        })
        fileUrl = stored.fileUrl
      }

      const imageWidth = formData.get('width') ? parseInt(formData.get('width') as string, 10) : null
      const imageHeight = formData.get('height') ? parseInt(formData.get('height') as string, 10) : null

      // Delete old diagram file records
      const oldFiles = await db.query.files.findMany({
        where: and(
          eq(files.attachedToType, 'vehicle-type'),
          eq(files.attachedToId, id),
          eq(files.attachedToField, 'diagram'),
        ),
      })

      for (const old of oldFiles) {
        await db.delete(files).where(eq(files.id, old.id))
        if (old.contentHash) {
          const otherRef = await db.query.files.findFirst({
            where: eq(files.contentHash, old.contentHash),
          })
          if (!otherRef) {
            await deleteStoredFile(old.fileUrl, session.user.tenantSlug)
          }
        }
      }

      // Insert new file record
      await db.insert(files).values({
        tenantId: session.user.tenantId,
        fileName: file.name,
        fileUrl,
        fileSize: file.size,
        fileType: file.type,
        contentHash,
        isPrivate: false,
        isFolder: false,
        attachedToType: 'vehicle-type',
        attachedToId: id,
        attachedToField: 'diagram',
        imageWidth,
        imageHeight,
        uploadedBy: session.user.id,
      })

      // Update/create diagram view for backward compat
      const existingView = await db.query.vehicleTypeDiagramViews.findFirst({
        where: eq(vehicleTypeDiagramViews.vehicleTypeId, id),
      })

      if (existingView) {
        await db.update(vehicleTypeDiagramViews)
          .set({ imageUrl: fileUrl, imageWidth, imageHeight })
          .where(eq(vehicleTypeDiagramViews.id, existingView.id))
      } else {
        await db.insert(vehicleTypeDiagramViews).values({
          tenantId: session.user.tenantId,
          vehicleTypeId: id,
          viewName: 'top',
          imageUrl: fileUrl,
          imageWidth,
          imageHeight,
          sortOrder: 0,
        })
      }

      logAndBroadcast(session.user.tenantId, 'vehicle-type', 'updated', id)
      invalidateStorageCache(session.user.tenantId)

      return NextResponse.json({
        success: true,
        imageUrl: fileUrl,
        imageWidth,
        imageHeight,
      })
    })
  } catch (error) {
    logError('api/vehicle-types/[id]/diagram', error)
    return NextResponse.json({ error: 'Failed to upload diagram' }, { status: 500 })
  }
}

// DELETE remove diagram image
export async function DELETE(
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
      const vehicleType = await db.query.vehicleTypes.findFirst({
        where: and(
          eq(vehicleTypes.id, id),
          or(
            eq(vehicleTypes.tenantId, session.user.tenantId),
            isNull(vehicleTypes.tenantId)
          )
        ),
      })

      if (!vehicleType) {
        return NextResponse.json(
          { error: 'Vehicle type not found or cannot be modified' },
          { status: 404 }
        )
      }

      if (vehicleType.isSystemDefault && (!session.user.role || !['owner', 'manager'].includes(session.user.role))) {
        return NextResponse.json(
          { error: 'Only owners and managers can modify system default vehicle types' },
          { status: 403 }
        )
      }

      // Delete file records
      const diagramFiles = await db.query.files.findMany({
        where: and(
          eq(files.attachedToType, 'vehicle-type'),
          eq(files.attachedToId, id),
          eq(files.attachedToField, 'diagram'),
        ),
      })

      for (const f of diagramFiles) {
        await db.delete(files).where(eq(files.id, f.id))
        if (f.contentHash) {
          const otherRef = await db.query.files.findFirst({
            where: eq(files.contentHash, f.contentHash),
          })
          if (!otherRef) {
            await deleteStoredFile(f.fileUrl, session.user.tenantSlug)
          }
        }
      }

      // Delete diagram views
      await db.delete(vehicleTypeDiagramViews)
        .where(eq(vehicleTypeDiagramViews.vehicleTypeId, id))

      logAndBroadcast(session.user.tenantId, 'vehicle-type', 'updated', id)
      invalidateStorageCache(session.user.tenantId)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/vehicle-types/[id]/diagram', error)
    return NextResponse.json({ error: 'Failed to delete diagram' }, { status: 500 })
  }
}
