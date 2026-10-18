import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { files, collectionFiles } from '@/lib/db/schema'
import { eq, and, sql, ilike, isNull, like, inArray } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateFile, storeFile, computeFileHash, generateThumbnail } from '@/lib/files'
import { logFileAudit, getRequestMeta } from '@/lib/files'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota, invalidateStorageCache } from '@/lib/db/storage-quota'
import { validateSearchParams } from '@/lib/validation/helpers'
import { filesListSchema } from '@/lib/validation/schemas/files'

// GET list files with filters
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, filesListSchema)
    if (!parsed.success) return parsed.response
    const { folderId, attachedToType, attachedToId, search, type, starred, collectionId, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []

      // Collection filter: get file IDs in collection first
      if (collectionId) {
        const collectionFileRows = await db.query.collectionFiles.findMany({
          where: eq(collectionFiles.collectionId, collectionId),
          columns: { fileId: true },
        })
        const fileIdsInCollection = collectionFileRows.map(cf => cf.fileId)
        if (fileIdsInCollection.length === 0) {
          // No files in this collection
          return NextResponse.json(all ? [] : {
            data: [],
            pagination: { page, pageSize, total: 0, totalPages: 0 },
          })
        }
        conditions.push(inArray(files.id, fileIdsInCollection))
      } else if (attachedToType && attachedToId) {
        conditions.push(eq(files.attachedToType, attachedToType))
        conditions.push(eq(files.attachedToId, attachedToId))
      } else if (folderId) {
        conditions.push(eq(files.folderId, folderId))
      } else if (!search && !type && !starred) {
        // Root level: no folder, no attachment
        conditions.push(isNull(files.folderId))
        conditions.push(isNull(files.attachedToType))
      }

      if (search) {
        conditions.push(ilike(files.fileName, `%${escapeLikePattern(search)}%`))
      }

      // Starred filter
      if (starred) {
        conditions.push(eq(files.isStarred, true))
        conditions.push(eq(files.isFolder, false))
      }

      // File type filter
      if (type === 'image') {
        conditions.push(like(files.fileType, 'image/%'))
        conditions.push(eq(files.isFolder, false))
      } else if (type === 'document') {
        conditions.push(inArray(files.fileType, [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/csv',
          'text/plain',
        ]))
        conditions.push(eq(files.isFolder, false))
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(files)
        .where(whereClause)

      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.files.findMany({
        where: whereClause,
        with: {
          uploadedByUser: { columns: { fullName: true } },
        },
        orderBy: (f, { desc, asc }) => [desc(f.isFolder), asc(f.fileName)],
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
    logError('api/files', error)
    return NextResponse.json({ error: 'Failed to list files' }, { status: 500 })
  }
}

// POST upload file (multipart FormData)
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'uploadFiles')
    if (permError) return permError

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const isPrivate = formData.get('isPrivate') === 'true'
    const folderId = formData.get('folderId') as string | null
    const attachedToType = formData.get('attachedToType') as string | null
    const attachedToId = formData.get('attachedToId') as string | null
    const attachedToField = formData.get('attachedToField') as string | null
    const category = formData.get('category') as string | null
    const description = formData.get('description') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const validation = validateFile(file)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // Check quota with file size to prevent single large file from exceeding limit
    const quotaError = await requireQuota(session!.user.tenantId, 'file', file.size)
    if (quotaError) return quotaError

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const contentHash = computeFileHash(buffer)

    return await withTenant(session.user.tenantId, async (db) => {
      // Check dedup within tenant
      const existing = await db.query.files.findFirst({
        where: and(
          eq(files.contentHash, contentHash),
          eq(files.isFolder, false),
        ),
      })

      let fileUrl: string
      let fileSize: number
      let thumbnailUrl: string | null = null
      let imageWidth: number | null = null
      let imageHeight: number | null = null

      if (existing) {
        // Reuse existing file on disk
        fileUrl = existing.fileUrl
        fileSize = buffer.length
        // Reuse existing thumbnail if available
        thumbnailUrl = existing.thumbnailUrl
        imageWidth = existing.imageWidth
        imageHeight = existing.imageHeight
      } else {
        // Store new file
        const stored = await storeFile(buffer, file.name, {
          tenantSlug: session.user.tenantSlug,
          isPrivate,
        })
        fileUrl = stored.fileUrl
        fileSize = stored.fileSize

        // Generate thumbnail for images (fire-and-forget style but await for DB insert)
        const r2KeyBase = isPrivate
          ? `private/${session.user.tenantSlug}/${contentHash.substring(0, 2)}/${contentHash.substring(0, 12)}-${Date.now()}`
          : `${session.user.tenantSlug}/${contentHash.substring(0, 2)}/${contentHash.substring(0, 12)}-${Date.now()}`
        const thumb = await generateThumbnail(
          buffer,
          file.type,
          r2KeyBase,
          isPrivate,
          session.user.tenantSlug
        )
        if (thumb) {
          thumbnailUrl = thumb.thumbnailUrl
          imageWidth = thumb.imageWidth
          imageHeight = thumb.imageHeight
        }
      }

      const [newFile] = await db.insert(files).values({
        tenantId: session.user.tenantId,
        fileName: file.name,
        fileUrl,
        fileSize,
        fileType: file.type,
        contentHash,
        isPrivate,
        isFolder: false,
        folderId: folderId || null,
        attachedToType: attachedToType || null,
        attachedToId: attachedToId || null,
        attachedToField: attachedToField || null,
        category: category || null,
        description: description || null,
        uploadedBy: session.user.id,
        thumbnailUrl,
        imageWidth,
        imageHeight,
      }).returning()

      logAndBroadcast(session.user.tenantId, 'file', 'created', newFile.id)
      invalidateStorageCache(session.user.tenantId)

      // Audit log (fire and forget)
      const { ip, userAgent } = getRequestMeta(request)
      logFileAudit({
        tenantId: session.user.tenantId,
        fileId: newFile.id,
        userId: session.user.id,
        action: 'uploaded',
        fileName: file.name,
        ipAddress: ip,
        userAgent,
      })

      return NextResponse.json(newFile)
    })
  } catch (error) {
    logError('api/files', error)
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
  }
}
