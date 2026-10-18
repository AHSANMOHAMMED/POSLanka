import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { collections, collectionFiles } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateBody, validateSearchParams, validateParams } from '@/lib/validation/helpers'
import { addFilesToCollectionSchema, removeFileFromCollectionParamsSchema } from '@/lib/validation/schemas/files'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST add files to collection
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

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, addFilesToCollectionSchema)
    if (!parsed.success) return parsed.response
    const { fileIds } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify collection exists
      const collection = await db.query.collections.findFirst({
        where: eq(collections.id, id),
        columns: { id: true },
      })

      if (!collection) {
        return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
      }

      // Get existing entries to skip duplicates
      const existingEntries = await db.query.collectionFiles.findMany({
        where: eq(collectionFiles.collectionId, id),
        columns: { fileId: true },
      })
      const existingFileIds = new Set(existingEntries.map(e => e.fileId))

      // Filter out files that are already in the collection
      const newFileIds = fileIds.filter((fid: string) => !existingFileIds.has(fid))

      if (newFileIds.length === 0) {
        return NextResponse.json({ success: true, added: 0, message: 'All files already in collection' })
      }

      // Verify the files exist
      const existingFiles = await db.query.files.findMany({
        where: (f, { inArray }) => inArray(f.id, newFileIds),
        columns: { id: true },
      })
      const validFileIds = new Set(existingFiles.map(f => f.id))

      // Insert collection-file associations
      const valuesToInsert = newFileIds
        .filter((fid: string) => validFileIds.has(fid))
        .map((fileId: string) => ({
          collectionId: id,
          fileId,
          addedBy: session.user.id,
        }))

      if (valuesToInsert.length > 0) {
        await db.insert(collectionFiles).values(valuesToInsert)
      }

      logAndBroadcast(session.user.tenantId, 'file', 'updated', id)

      return NextResponse.json({ success: true, added: valuesToInsert.length })
    })
  } catch (error) {
    logError('api/collections/[id]/files', error)
    return NextResponse.json({ error: 'Failed to add files to collection' }, { status: 500 })
  }
}

// DELETE remove a file from collection
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
    const parsed = validateSearchParams(request, removeFileFromCollectionParamsSchema)
    if (!parsed.success) return parsed.response
    const { fileId } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify collection exists
      const collection = await db.query.collections.findFirst({
        where: eq(collections.id, id),
        columns: { id: true },
      })

      if (!collection) {
        return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
      }

      // Delete the association
      await db.delete(collectionFiles)
        .where(
          and(
            eq(collectionFiles.collectionId, id),
            eq(collectionFiles.fileId, fileId),
          )
        )

      logAndBroadcast(session.user.tenantId, 'file', 'updated', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/collections/[id]/files', error)
    return NextResponse.json({ error: 'Failed to remove file from collection' }, { status: 500 })
  }
}
