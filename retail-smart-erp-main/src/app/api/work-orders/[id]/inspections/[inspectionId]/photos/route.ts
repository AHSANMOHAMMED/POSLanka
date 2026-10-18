import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { vehicleInspections, inspectionPhotos, workOrders, files } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateFile, storeFile, computeFileHash, deleteStoredFile } from '@/lib/files'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota, invalidateStorageCache } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateParams } from '@/lib/validation/helpers'
import { z } from 'zod'

const MAX_PHOTOS_PER_INSPECTION = 20
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

// GET photos for an inspection
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; inspectionId: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), inspectionId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id: workOrderId, inspectionId } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const workOrder = await db.query.workOrders.findFirst({
        where: eq(workOrders.id, workOrderId),
      })

      if (!workOrder) {
        return NextResponse.json({ error: 'Work order not found' }, { status: 404 })
      }

      const inspection = await db.query.vehicleInspections.findFirst({
        where: and(
          eq(vehicleInspections.id, inspectionId),
          eq(vehicleInspections.workOrderId, workOrderId)
        ),
      })

      if (!inspection) {
        return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
      }

      const photos = await db.query.inspectionPhotos.findMany({
        where: eq(inspectionPhotos.inspectionId, inspectionId),
        with: {
          damageMark: true,
          response: true,
        },
        orderBy: (photos, { asc }) => [asc(photos.createdAt)],
      })

      return NextResponse.json(photos)
    })
  } catch (error) {
    logError('api/work-orders/[id]/inspections/[inspectionId]/photos', error)
    return NextResponse.json({ error: 'Failed to fetch photos' }, { status: 500 })
  }
}

// POST upload photo
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; inspectionId: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageWorkOrders')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'file')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), inspectionId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id: workOrderId, inspectionId } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const workOrder = await db.query.workOrders.findFirst({
        where: eq(workOrders.id, workOrderId),
      })

      if (!workOrder) {
        return NextResponse.json({ error: 'Work order not found' }, { status: 404 })
      }

      const inspection = await db.query.vehicleInspections.findFirst({
        where: and(
          eq(vehicleInspections.id, inspectionId),
          eq(vehicleInspections.workOrderId, workOrderId)
        ),
      })

      if (!inspection) {
        return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
      }

      if (inspection.status === 'completed') {
        return NextResponse.json({ error: 'Cannot modify completed inspection' }, { status: 400 })
      }

      // Check photo count limit
      const existingPhotos = await db.query.inspectionPhotos.findMany({
        where: eq(inspectionPhotos.inspectionId, inspectionId),
      })

      if (existingPhotos.length >= MAX_PHOTOS_PER_INSPECTION) {
        return NextResponse.json(
          { error: `Maximum ${MAX_PHOTOS_PER_INSPECTION} photos allowed per inspection` },
          { status: 400 }
        )
      }

      const formData = await request.formData()
      const file = formData.get('file') as File | null
      const damageMarkId = formData.get('damageMarkId') as string | null
      const responseId = formData.get('responseId') as string | null
      const caption = formData.get('caption') as string | null

      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 })
      }

      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
      const validation = validateFile(file, { allowedTypes, maxSize: MAX_FILE_SIZE })
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

      // Insert into unified files table
      const [newFile] = await db.insert(files).values({
        tenantId: session.user.tenantId,
        fileName: file.name,
        fileUrl,
        fileSize: file.size,
        fileType: file.type,
        contentHash,
        isPrivate: false,
        isFolder: false,
        attachedToType: 'inspection',
        attachedToId: inspectionId,
        uploadedBy: session.user.id,
      }).returning()

      // Insert into inspectionPhotos junction table (preserves FK linkage)
      const [newPhoto] = await db.insert(inspectionPhotos).values({
        tenantId: session.user.tenantId,
        inspectionId,
        damageMarkId: damageMarkId || null,
        responseId: responseId || null,
        photoUrl: fileUrl,
        caption: caption || null,
        fileId: newFile.id,
      }).returning()

      logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId)
      invalidateStorageCache(session.user.tenantId)

      return NextResponse.json(newPhoto)
    })
  } catch (error) {
    logError('api/work-orders/[id]/inspections/[inspectionId]/photos', error)
    return NextResponse.json({ error: 'Failed to upload photo' }, { status: 500 })
  }
}

// DELETE remove photo
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; inspectionId: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), inspectionId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id: workOrderId, inspectionId } = paramsParsed.data
    const { searchParams } = new URL(request.url)
    const photoId = searchParams.get('photoId')

    if (!photoId) {
      return NextResponse.json({ error: 'Photo ID is required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const workOrder = await db.query.workOrders.findFirst({
        where: eq(workOrders.id, workOrderId),
      })

      if (!workOrder) {
        return NextResponse.json({ error: 'Work order not found' }, { status: 404 })
      }

      const inspection = await db.query.vehicleInspections.findFirst({
        where: and(
          eq(vehicleInspections.id, inspectionId),
          eq(vehicleInspections.workOrderId, workOrderId)
        ),
      })

      if (!inspection) {
        return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
      }

      if (inspection.status === 'completed') {
        return NextResponse.json({ error: 'Cannot modify completed inspection' }, { status: 400 })
      }

      const photo = await db.query.inspectionPhotos.findFirst({
        where: and(
          eq(inspectionPhotos.id, photoId),
          eq(inspectionPhotos.inspectionId, inspectionId)
        ),
      })

      if (!photo) {
        return NextResponse.json({ error: 'Photo not found' }, { status: 404 })
      }

      // Delete from inspectionPhotos junction table
      await db.delete(inspectionPhotos).where(eq(inspectionPhotos.id, photoId))

      // Delete from files table if linked
      if (photo.fileId) {
        const fileRecord = await db.query.files.findFirst({
          where: eq(files.id, photo.fileId),
        })

        if (fileRecord) {
          await db.delete(files).where(eq(files.id, photo.fileId))

          // Only delete physical file if no other records reference the same hash
          if (fileRecord.contentHash) {
            const otherRef = await db.query.files.findFirst({
              where: eq(files.contentHash, fileRecord.contentHash),
            })

            if (!otherRef) {
              await deleteStoredFile(fileRecord.fileUrl, session.user.tenantSlug)
            }
          }
        }
      } else if (photo.photoUrl) {
        // Legacy photo without file record - try to delete from R2
        try {
          const { deleteStoredFile } = await import('@/lib/files')
          await deleteStoredFile(photo.photoUrl, session.user.tenantSlug)
        } catch {
          // File may not exist
        }
      }

      logAndBroadcast(session.user.tenantId, 'work-order', 'updated', workOrderId)
      invalidateStorageCache(session.user.tenantId)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/work-orders/[id]/inspections/[inspectionId]/photos', error)
    return NextResponse.json({ error: 'Failed to delete photo' }, { status: 500 })
  }
}
