import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { files } from '@/lib/db/schema'
import { eq, inArray, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { deleteStoredFile } from '@/lib/files'
import { logFileAudit, getRequestMeta } from '@/lib/files'
import { logError } from '@/lib/ai/error-logger'
import { invalidateStorageCache } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { bulkFileOperationSchema } from '@/lib/validation/schemas/files'

// POST bulk operations on files
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, bulkFileOperationSchema)
    if (!parsed.success) return parsed.response
    const { action, fileIds, targetFolderId, tags } = parsed.data

    // Permission check based on action type
    if (action === 'delete') {
      const permError = requirePermission(session, 'deleteFiles')
      if (permError) return permError
    } else if (action === 'move') {
      const permError = requirePermission(session, 'manageFiles')
      if (permError) return permError
    } else if (['star', 'unstar', 'addTags', 'removeTags'].includes(action)) {
      const permError = requirePermission(session, 'uploadFiles')
      if (permError) return permError
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const { ip, userAgent } = getRequestMeta(request)

    return await withTenant(session.user.tenantId, async (db) => {
      let affected = 0

      switch (action) {
        case 'delete': {
          // Get files to delete
          const filesToDelete = await db.query.files.findMany({
            where: inArray(files.id, fileIds),
          })

          if (filesToDelete.length === 0) {
            return NextResponse.json({ success: true, affected: 0 })
          }

          // Delete DB records
          await db.delete(files).where(inArray(files.id, fileIds))

          // Clean up R2 storage for files with unique hashes
          for (const file of filesToDelete) {
            if (!file.isFolder && file.contentHash) {
              const otherRef = await db.query.files.findFirst({
                where: eq(files.contentHash, file.contentHash),
              })
              if (!otherRef) {
                await deleteStoredFile(file.fileUrl, session.user.tenantSlug, file.thumbnailUrl).catch(() => {})
              }
            }

            // Log each deletion
            logFileAudit({
              tenantId: session.user.tenantId,
              fileId: null,
              userId: session.user.id,
              action: 'deleted',
              fileName: file.fileName,
              ipAddress: ip,
              userAgent,
              details: { bulkOperation: true },
            })
          }

          affected = filesToDelete.length
          invalidateStorageCache(session.user.tenantId)
          break
        }

        case 'move': {
          if (targetFolderId === undefined) {
            return NextResponse.json({ error: 'targetFolderId is required for move action' }, { status: 400 })
          }

          // Validate target folder exists (or null for root)
          if (targetFolderId) {
            const folder = await db.query.files.findFirst({
              where: eq(files.id, targetFolderId),
              columns: { id: true, isFolder: true },
            })
            if (!folder || !folder.isFolder) {
              return NextResponse.json({ error: 'Target folder not found' }, { status: 404 })
            }
          }

          const result = await db.update(files)
            .set({
              folderId: targetFolderId || null,
              updatedAt: new Date(),
            })
            .where(inArray(files.id, fileIds))
            .returning({ id: files.id })

          affected = result.length
          break
        }

        case 'star': {
          const result = await db.update(files)
            .set({
              isStarred: true,
              updatedAt: new Date(),
            })
            .where(inArray(files.id, fileIds))
            .returning({ id: files.id })

          affected = result.length
          break
        }

        case 'unstar': {
          const result = await db.update(files)
            .set({
              isStarred: false,
              updatedAt: new Date(),
            })
            .where(inArray(files.id, fileIds))
            .returning({ id: files.id })

          affected = result.length
          break
        }

        case 'addTags': {
          if (!tags || !Array.isArray(tags) || tags.length === 0) {
            return NextResponse.json({ error: 'tags array is required for addTags action' }, { status: 400 })
          }

          // Use PostgreSQL array_cat to merge tags, then remove duplicates with array_agg(distinct)
          const result = await db.update(files)
            .set({
              tags: sql`(
                SELECT array_agg(DISTINCT elem)
                FROM unnest(coalesce(${files.tags}, ARRAY[]::text[]) || ARRAY[${sql.join(tags.map(t => sql`${t}`), sql`, `)}]::text[]) AS elem
              )`,
              updatedAt: new Date(),
            })
            .where(inArray(files.id, fileIds))
            .returning({ id: files.id })

          affected = result.length
          break
        }

        case 'removeTags': {
          if (!tags || !Array.isArray(tags) || tags.length === 0) {
            return NextResponse.json({ error: 'tags array is required for removeTags action' }, { status: 400 })
          }

          // Remove specified tags from the array
          const result = await db.update(files)
            .set({
              tags: sql`(
                SELECT coalesce(array_agg(elem), ARRAY[]::text[])
                FROM unnest(coalesce(${files.tags}, ARRAY[]::text[])) AS elem
                WHERE elem != ALL(ARRAY[${sql.join(tags.map(t => sql`${t}`), sql`, `)}]::text[])
              )`,
              updatedAt: new Date(),
            })
            .where(inArray(files.id, fileIds))
            .returning({ id: files.id })

          affected = result.length
          break
        }
      }

      // Broadcast changes for each affected file
      for (const fileId of fileIds) {
        logAndBroadcast(session.user.tenantId, 'file', action === 'delete' ? 'deleted' : 'updated', fileId)
      }

      return NextResponse.json({ success: true, affected })
    })
  } catch (error) {
    logError('api/files/bulk', error)
    return NextResponse.json({ error: 'Failed to perform bulk operation' }, { status: 500 })
  }
}
