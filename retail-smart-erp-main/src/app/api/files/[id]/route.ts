import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { files } from '@/lib/db/schema'
import { eq, and, ne } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { deleteStoredFile, storeFile, generateThumbnail } from '@/lib/files'
import { getFromR2, keyFromUrl } from '@/lib/files'
import { logFileAudit, getRequestMeta } from '@/lib/files'
import { logError } from '@/lib/ai/error-logger'
import { invalidateStorageCache } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateFileSchema } from '@/lib/validation/schemas/files'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single file metadata
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
      const file = await db.query.files.findFirst({
        where: eq(files.id, id),
        with: {
          uploadedByUser: { columns: { fullName: true } },
          parentFolder: { columns: { id: true, fileName: true } },
        },
      })

      if (!file) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      return NextResponse.json(file)
    })
  } catch (error) {
    logError('api/files/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch file' }, { status: 500 })
  }
}

// PUT update file metadata (rename, move, update description/category, toggle private)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageFiles')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateFileSchema)
    if (!parsed.success) return parsed.response
    const { fileName, folderId, description, category, isPrivate } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.files.findFirst({
        where: eq(files.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() }

      if (fileName !== undefined) updateData.fileName = fileName
      if (folderId !== undefined) updateData.folderId = folderId || null
      if (description !== undefined) updateData.description = description || null
      if (category !== undefined) updateData.category = category || null

      // Handle private/public toggle - re-upload to new R2 path
      if (isPrivate !== undefined && isPrivate !== existing.isPrivate && !existing.isFolder) {
        try {
          const oldKey = keyFromUrl(existing.fileUrl)
          if (!oldKey) {
            return NextResponse.json({ error: 'Cannot resolve file location' }, { status: 500 })
          }

          const r2File = await getFromR2(oldKey)
          if (!r2File) {
            return NextResponse.json({ error: 'File not found on storage' }, { status: 500 })
          }

          const stored = await storeFile(r2File.buffer, existing.fileName, {
            tenantSlug: session.user.tenantSlug,
            isPrivate,
          })

          // Only delete old file if no other records reference the same URL
          const otherRef = await db.query.files.findFirst({
            where: and(
              eq(files.fileUrl, existing.fileUrl),
              ne(files.id, id)
            ),
          })

          if (!otherRef) {
            await deleteStoredFile(existing.fileUrl, session.user.tenantSlug, existing.thumbnailUrl)
          }

          updateData.fileUrl = stored.fileUrl
          updateData.isPrivate = isPrivate

          // Regenerate thumbnail for the new privacy setting
          if (existing.fileType?.startsWith('image/') && existing.fileType !== 'image/svg+xml') {
            const r2KeyBase = isPrivate
              ? `private/${session.user.tenantSlug}/${existing.contentHash?.substring(0, 2) || 'xx'}/${existing.contentHash?.substring(0, 12) || 'file'}-${Date.now()}`
              : `${session.user.tenantSlug}/${existing.contentHash?.substring(0, 2) || 'xx'}/${existing.contentHash?.substring(0, 12) || 'file'}-${Date.now()}`
            const thumb = await generateThumbnail(r2File.buffer, existing.fileType, r2KeyBase, isPrivate, session.user.tenantSlug)
            if (thumb) {
              updateData.thumbnailUrl = thumb.thumbnailUrl
              updateData.imageWidth = thumb.imageWidth
              updateData.imageHeight = thumb.imageHeight
            } else {
              updateData.thumbnailUrl = null
            }
          }
        } catch (err) {
          logError('api/files/[id]', err)
          return NextResponse.json({ error: 'Failed to move file' }, { status: 500 })
        }
      }

      const [updated] = await db.update(files)
        .set(updateData)
        .where(eq(files.id, id))
        .returning()

      logAndBroadcast(session.user.tenantId, 'file', 'updated', id)

      // Audit logging (fire and forget)
      const { ip, userAgent } = getRequestMeta(request)
      if (fileName !== undefined && fileName !== existing.fileName) {
        logFileAudit({
          tenantId: session.user.tenantId,
          fileId: id,
          userId: session.user.id,
          action: 'renamed',
          fileName: fileName,
          ipAddress: ip,
          userAgent,
          details: { oldName: existing.fileName, newName: fileName },
        })
      }
      if (folderId !== undefined && folderId !== existing.folderId) {
        logFileAudit({
          tenantId: session.user.tenantId,
          fileId: id,
          userId: session.user.id,
          action: 'moved',
          fileName: existing.fileName,
          ipAddress: ip,
          userAgent,
          details: { oldFolderId: existing.folderId, newFolderId: folderId || null },
        })
      }

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/files/[id]', error)
    return NextResponse.json({ error: 'Failed to update file' }, { status: 500 })
  }
}

// DELETE file
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'deleteFiles')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const file = await db.query.files.findFirst({
        where: eq(files.id, id),
      })

      if (!file) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      // Delete DB record
      await db.delete(files).where(eq(files.id, id))

      // Only delete physical file if no other records reference the same contentHash
      if (!file.isFolder && file.contentHash) {
        const otherReference = await db.query.files.findFirst({
          where: eq(files.contentHash, file.contentHash),
        })

        if (!otherReference) {
          await deleteStoredFile(file.fileUrl, session.user.tenantSlug, file.thumbnailUrl)
        }
      }

      logAndBroadcast(session.user.tenantId, 'file', 'deleted', id)
      invalidateStorageCache(session.user.tenantId)

      // Audit log (fire and forget)
      const { ip, userAgent } = getRequestMeta(request)
      logFileAudit({
        tenantId: session.user.tenantId,
        fileId: null, // File record already deleted
        userId: session.user.id,
        action: 'deleted',
        fileName: file.fileName,
        ipAddress: ip,
        userAgent,
      })

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/files/[id]', error)
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 })
  }
}
