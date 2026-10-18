import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { collections, collectionFiles } from '@/lib/db/schema'
import { eq, sql, desc } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams, validateBody, validateParams } from '@/lib/validation/helpers'
import { collectionDetailSchema, updateCollectionSchema } from '@/lib/validation/schemas/files'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET collection with files
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
    const parsed = validateSearchParams(request, collectionDetailSchema)
    if (!parsed.success) return parsed.response
    const { page, pageSize } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Get the collection
      const collection = await db.query.collections.findFirst({
        where: eq(collections.id, id),
        with: {
          createdByUser: { columns: { id: true, fullName: true } },
        },
      })

      if (!collection) {
        return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
      }

      // Count total files in collection
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(collectionFiles)
        .where(eq(collectionFiles.collectionId, id))

      // Get files in collection via join
      const collectionFileRecords = await db.query.collectionFiles.findMany({
        where: eq(collectionFiles.collectionId, id),
        with: {
          file: {
            with: {
              uploadedByUser: { columns: { fullName: true } },
            },
          },
          addedByUser: { columns: { id: true, fullName: true } },
        },
        orderBy: [desc(collectionFiles.addedAt)],
        limit: Math.min(pageSize, 100),
        offset: (page - 1) * pageSize,
      })

      const fileData = collectionFileRecords.map(cf => ({
        ...cf.file,
        addedAt: cf.addedAt,
        addedBy: cf.addedByUser,
        collectionFileId: cf.id,
      }))

      return NextResponse.json({
        collection,
        files: {
          data: fileData,
          pagination: {
            page,
            pageSize,
            total: totalCount,
            totalPages: Math.ceil(totalCount / pageSize),
          },
        },
      })
    })
  } catch (error) {
    logError('api/collections/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch collection' }, { status: 500 })
  }
}

// PUT update collection
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
    const parsed = await validateBody(request, updateCollectionSchema)
    if (!parsed.success) return parsed.response
    const { name, description, color, icon } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.collections.findFirst({
        where: eq(collections.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (name !== undefined) updateData.name = name.trim()
      if (description !== undefined) updateData.description = description || null
      if (color !== undefined) updateData.color = color || null
      if (icon !== undefined) updateData.icon = icon || null

      const [updated] = await db.update(collections)
        .set(updateData)
        .where(eq(collections.id, id))
        .returning()

      logAndBroadcast(session.user.tenantId, 'collection', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/collections/[id]', error)
    return NextResponse.json({ error: 'Failed to update collection' }, { status: 500 })
  }
}

// DELETE collection
export async function DELETE(
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

    return await withTenant(session.user.tenantId, async (db) => {
      const existing = await db.query.collections.findFirst({
        where: eq(collections.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
      }

      // Delete collection (cascade deletes collection_files entries)
      await db.delete(collections).where(eq(collections.id, id))

      logAndBroadcast(session.user.tenantId, 'collection', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/collections/[id]', error)
    return NextResponse.json({ error: 'Failed to delete collection' }, { status: 500 })
  }
}
