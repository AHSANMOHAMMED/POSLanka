import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { files } from '@/lib/db/schema'
import { eq, and, isNull } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation/helpers'
import { createFolderSchema } from '@/lib/validation/schemas/files'

// POST create folder
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageFiles')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createFolderSchema)
    if (!parsed.success) return parsed.response
    const { name, folderId } = parsed.data

    const folderName = name

    return await withTenant(session.user.tenantId, async (db) => {
      // Check for duplicate name in same parent
      const parentCondition = folderId
        ? eq(files.folderId, folderId)
        : isNull(files.folderId)

      const duplicate = await db.query.files.findFirst({
        where: and(
          eq(files.fileName, folderName),
          eq(files.isFolder, true),
          parentCondition,
          isNull(files.attachedToType),
        ),
      })

      if (duplicate) {
        return NextResponse.json({ error: 'A folder with this name already exists' }, { status: 409 })
      }

      // Verify parent folder exists if specified
      if (folderId) {
        const parentFolder = await db.query.files.findFirst({
          where: and(
            eq(files.id, folderId),
            eq(files.isFolder, true),
          ),
        })

        if (!parentFolder) {
          return NextResponse.json({ error: 'Parent folder not found' }, { status: 404 })
        }
      }

      const [folder] = await db.insert(files).values({
        tenantId: session.user.tenantId,
        fileName: folderName,
        fileUrl: '', // Folders don't have URLs
        isFolder: true,
        isPrivate: false,
        folderId: folderId || null,
        uploadedBy: session.user.id,
      }).returning()

      logAndBroadcast(session.user.tenantId, 'file', 'created', folder.id)

      return NextResponse.json(folder)
    })
  } catch (error) {
    logError('api/files/folder', error)
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 })
  }
}
