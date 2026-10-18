import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { files, fileVersions } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateFile, storeFile, computeFileHash } from '@/lib/files'
import { logFileAudit, getRequestMeta } from '@/lib/files'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota, invalidateStorageCache } from '@/lib/db/storage-quota'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET list all versions of a file
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
      // Verify the file exists
      const file = await db.query.files.findFirst({
        where: eq(files.id, id),
        columns: { id: true, fileName: true, versionNumber: true },
      })

      if (!file) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      // Get all versions ordered by version number descending
      const versions = await db.query.fileVersions.findMany({
        where: eq(fileVersions.fileId, id),
        with: {
          uploadedByUser: { columns: { id: true, fullName: true } },
        },
        orderBy: [desc(fileVersions.versionNumber)],
      })

      return NextResponse.json({
        file: {
          id: file.id,
          fileName: file.fileName,
          currentVersion: file.versionNumber,
        },
        versions,
      })
    })
  } catch (error) {
    logError('api/files/[id]/versions', error)
    return NextResponse.json({ error: 'Failed to list file versions' }, { status: 500 })
  }
}

// POST create a new version (upload a new file as the next version)
export async function POST(
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

    const quotaError = await requireQuota(session.user.tenantId, 'file')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const changeDescription = formData.get('changeDescription') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const validation = validateFile(file)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const contentHash = computeFileHash(buffer)

    return await withTenant(session.user.tenantId, async (db) => {
      // Get the original file
      const originalFile = await db.query.files.findFirst({
        where: eq(files.id, id),
      })

      if (!originalFile) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
      }

      if (originalFile.isFolder) {
        return NextResponse.json({ error: 'Cannot version a folder' }, { status: 400 })
      }

      // Store the current version in the fileVersions table
      await db.insert(fileVersions).values({
        tenantId: session.user.tenantId,
        fileId: id,
        versionNumber: originalFile.versionNumber || 1,
        fileUrl: originalFile.fileUrl,
        fileSize: originalFile.fileSize,
        contentHash: originalFile.contentHash,
        changeDescription: changeDescription || null,
        uploadedBy: session.user.id,
      })

      // Upload the new file to R2
      const stored = await storeFile(buffer, file.name, {
        tenantSlug: session.user.tenantSlug,
        isPrivate: originalFile.isPrivate,
      })

      // Update the files record with new version info
      const newVersionNumber = (originalFile.versionNumber || 1) + 1
      const [updated] = await db.update(files)
        .set({
          fileUrl: stored.fileUrl,
          fileSize: stored.fileSize,
          contentHash,
          fileType: file.type,
          versionNumber: newVersionNumber,
          updatedAt: new Date(),
        })
        .where(eq(files.id, id))
        .returning()

      // Log audit event
      const { ip, userAgent } = getRequestMeta(request)
      await logFileAudit({
        tenantId: session.user.tenantId,
        fileId: id,
        userId: session.user.id,
        action: 'version_created',
        fileName: originalFile.fileName,
        ipAddress: ip,
        userAgent,
        details: { versionNumber: newVersionNumber, changeDescription },
      })

      logAndBroadcast(session.user.tenantId, 'file', 'updated', id)
      invalidateStorageCache(session.user.tenantId)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/files/[id]/versions', error)
    return NextResponse.json({ error: 'Failed to create file version' }, { status: 500 })
  }
}
