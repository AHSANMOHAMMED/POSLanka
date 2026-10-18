import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission, Permission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { files } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { broadcastChange } from '@/lib/websocket/broadcast'
import type { EntityType } from '@/lib/websocket/events'
import { validateFile, storeFile, computeFileHash, deleteStoredFile } from '@/lib/files'
import { invalidateStorageCache, requireQuota } from '@/lib/db/storage-quota'

interface AttachmentHandlerOptions {
  entityType: string // The attachedToType value in files table
  broadcastEntityType: EntityType
  permission: Permission
  // Validator to confirm the parent entity exists
  validateEntity: (db: Parameters<Parameters<typeof withTenant>[1]>[0], entityId: string) => Promise<boolean>
}

export function createAttachmentHandler(options: AttachmentHandlerOptions) {
  async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    try {
      const session = await authWithCompany()
      if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

      const permError = requirePermission(session, options.permission)
      if (permError) return permError

      const { id } = await params

      return await withTenant(session.user.tenantId, async (db) => {
        const exists = await options.validateEntity(db, id)
        if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        const fileRecords = await db.query.files.findMany({
          where: and(
            eq(files.attachedToType, options.entityType),
            eq(files.attachedToId, id),
          ),
          with: {
            uploadedByUser: { columns: { fullName: true } },
          },
          orderBy: (f, { desc }) => [desc(f.createdAt)],
        })

        return NextResponse.json(fileRecords.map(f => ({
          id: f.id,
          fileName: f.fileName,
          fileType: f.fileType,
          fileSize: f.fileSize,
          filePath: f.fileUrl,
          category: f.category,
          description: f.description,
          createdAt: f.createdAt,
          uploadedByUser: f.uploadedByUser,
        })))
      })
    } catch (error) {
      console.error(`Error fetching ${options.entityType} attachments:`, error)
      return NextResponse.json({ error: 'Failed to fetch attachments' }, { status: 500 })
    }
  }

  async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    try {
      const session = await authWithCompany()
      if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

      const permError = requirePermission(session, options.permission)
      if (permError) return permError

      const quotaError = await requireQuota(session.user.tenantId, 'file')
      if (quotaError) return quotaError

      const { id } = await params

      return await withTenant(session.user.tenantId, async (db) => {
        const exists = await options.validateEntity(db, id)
        if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        const formData = await request.formData()
        const file = formData.get('file') as File | null
        if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf',
          'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/csv']
        const validation = validateFile(file, { allowedTypes, maxSize: 10 * 1024 * 1024 })
        if (!validation.valid) return NextResponse.json({ error: validation.error }, { status: 400 })

        const bytes = await file.arrayBuffer()
        const buffer = Buffer.from(bytes)
        const contentHash = computeFileHash(buffer)

        // Check for duplicate
        const duplicate = await db.query.files.findFirst({
          where: and(
            eq(files.attachedToType, options.entityType),
            eq(files.attachedToId, id),
            eq(files.contentHash, contentHash),
          ),
        })

        if (duplicate) {
          return NextResponse.json({ error: 'This file has already been uploaded' }, { status: 409 })
        }

        // Check for existing file with same hash for reuse
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

        const [newFile] = await db.insert(files).values({
          tenantId: session.user.tenantId,
          fileName: file.name,
          fileUrl,
          fileSize: file.size,
          fileType: file.type,
          contentHash,
          isPrivate: false,
          isFolder: false,
          attachedToType: options.entityType,
          attachedToId: id,
          uploadedBy: session.user.id,
        }).returning()

        broadcastChange(session.user.tenantId, options.broadcastEntityType, 'updated', id)
        invalidateStorageCache(session.user.tenantId)

        return NextResponse.json({
          id: newFile.id,
          fileName: newFile.fileName,
          fileType: newFile.fileType,
          fileSize: newFile.fileSize,
          filePath: newFile.fileUrl,
          createdAt: newFile.createdAt,
        })
      })
    } catch (error) {
      console.error(`Error uploading ${options.entityType} attachment:`, error)
      return NextResponse.json({ error: 'Failed to upload attachment' }, { status: 500 })
    }
  }

  async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) {
    try {
      const session = await authWithCompany()
      if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

      const permError = requirePermission(session, options.permission)
      if (permError) return permError

      const { id: entityId } = await params
      const { searchParams } = new URL(request.url)
      const attachmentId = searchParams.get('attachmentId')

      if (!attachmentId) return NextResponse.json({ error: 'Attachment ID required' }, { status: 400 })

      return await withTenant(session.user.tenantId, async (db) => {
        const attachment = await db.query.files.findFirst({
          where: and(
            eq(files.id, attachmentId),
            eq(files.attachedToType, options.entityType),
            eq(files.attachedToId, entityId),
          ),
        })

        if (!attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })

        await db.delete(files).where(eq(files.id, attachmentId))

        if (attachment.contentHash) {
          const otherReference = await db.query.files.findFirst({
            where: eq(files.contentHash, attachment.contentHash),
          })
          if (!otherReference) {
            await deleteStoredFile(attachment.fileUrl, session.user.tenantSlug)
          }
        }

        broadcastChange(session.user.tenantId, options.broadcastEntityType, 'updated', entityId)
        invalidateStorageCache(session.user.tenantId)

        return NextResponse.json({ success: true })
      })
    } catch (error) {
      console.error(`Error deleting ${options.entityType} attachment:`, error)
      return NextResponse.json({ error: 'Failed to delete attachment' }, { status: 500 })
    }
  }

  return { GET, POST, DELETE }
}
