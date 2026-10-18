import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { files } from '@/lib/db/schema'
import { inArray, eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logFileAudit, getRequestMeta } from '@/lib/files'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { bulkCopySchema } from '@/lib/validation/schemas/files'

// POST: Copy files to a target folder (duplicate DB records, reuse R2 objects via contentHash)
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageFiles')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, bulkCopySchema)
    if (!parsed.success) return parsed.response
    const { fileIds, targetFolderId } = parsed.data

    const { ip, userAgent } = getRequestMeta(request)

    return await withTenant(session.user.tenantId, async (db) => {
      // Validate target folder if provided
      if (targetFolderId) {
        const folder = await db.query.files.findFirst({
          where: and(eq(files.id, targetFolderId), eq(files.isFolder, true)),
          columns: { id: true },
        })
        if (!folder) {
          return NextResponse.json({ error: 'Target folder not found' }, { status: 404 })
        }
      }

      // Get source files (skip folders - only copy files)
      const sourceFiles = await db.query.files.findMany({
        where: and(inArray(files.id, fileIds), eq(files.isFolder, false)),
      })

      if (sourceFiles.length === 0) {
        return NextResponse.json({ success: true, affected: 0 })
      }

      // Check for name conflicts in target folder to append " (copy)"
      const existingNames = new Set<string>()
      const existingInTarget = await db.query.files.findMany({
        where: targetFolderId
          ? eq(files.folderId, targetFolderId)
          : eq(files.folderId, '00000000-0000-0000-0000-000000000000'), // won't match - use isNull below
        columns: { fileName: true },
      })

      // If targeting root, fetch root files
      if (!targetFolderId) {
        const rootFiles = await db.query.files.findMany({
          where: and(
            eq(files.isFolder, false),
            // RLS handles tenant filtering
          ),
          columns: { fileName: true, folderId: true },
        })
        for (const f of rootFiles) {
          if (!f.folderId) existingNames.add(f.fileName)
        }
      } else {
        for (const f of existingInTarget) {
          existingNames.add(f.fileName)
        }
      }

      // Create copies
      const newFiles = []
      for (const src of sourceFiles) {
        let newName = src.fileName
        // If same folder or name exists, add " (copy)" suffix
        if (existingNames.has(newName)) {
          const ext = newName.lastIndexOf('.')
          if (ext > 0) {
            const base = newName.substring(0, ext)
            const extension = newName.substring(ext)
            newName = `${base} (copy)${extension}`
          } else {
            newName = `${newName} (copy)`
          }
          // Handle multiple copies
          let counter = 2
          while (existingNames.has(newName)) {
            if (ext > 0) {
              const base = src.fileName.substring(0, ext)
              const extension = src.fileName.substring(ext)
              newName = `${base} (copy ${counter})${extension}`
            } else {
              newName = `${src.fileName} (copy ${counter})`
            }
            counter++
          }
        }
        existingNames.add(newName)

        const [copied] = await db.insert(files).values({
          tenantId: session.user.tenantId,
          fileName: newName,
          fileUrl: src.fileUrl, // Reuse same R2 object
          fileSize: src.fileSize,
          fileType: src.fileType,
          contentHash: src.contentHash, // Same hash = dedup on delete
          isPrivate: src.isPrivate,
          isFolder: false,
          folderId: targetFolderId || null,
          category: src.category,
          description: src.description,
          tags: src.tags,
          uploadedBy: session.user.id,
        }).returning()

        newFiles.push(copied)

        logFileAudit({
          tenantId: session.user.tenantId,
          fileId: copied.id,
          userId: session.user.id,
          action: 'copied',
          fileName: newName,
          ipAddress: ip,
          userAgent,
          details: { sourceFileId: src.id, bulkOperation: true },
        })
      }

      // Broadcast for each new file
      for (const f of newFiles) {
        logAndBroadcast(session.user.tenantId, 'file', 'created', f.id)
      }

      return NextResponse.json({ success: true, affected: newFiles.length })
    })
  } catch (error) {
    logError('api/files/bulk-copy', error)
    return NextResponse.json({ error: 'Failed to copy files' }, { status: 500 })
  }
}
