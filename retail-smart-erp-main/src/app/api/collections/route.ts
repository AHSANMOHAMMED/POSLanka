import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { collections } from '@/lib/db/schema'
import { ilike, sql, desc } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { requirePermission } from '@/lib/auth/roles'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { collectionsListSchema, createCollectionSchema } from '@/lib/validation/schemas/files'

// GET list collections
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, collectionsListSchema)
    if (!parsed.success) return parsed.response
    const { search } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []

      if (search) {
        conditions.push(ilike(collections.name, `%${escapeLikePattern(search)}%`))
      }

      const whereClause = conditions.length > 0 ? conditions[0] : undefined

      // Get collections with file count via subquery
      const result = await db
        .select({
          id: collections.id,
          tenantId: collections.tenantId,
          name: collections.name,
          description: collections.description,
          color: collections.color,
          icon: collections.icon,
          isSmartCollection: collections.isSmartCollection,
          filterRules: collections.filterRules,
          createdBy: collections.createdBy,
          createdAt: collections.createdAt,
          updatedAt: collections.updatedAt,
          fileCount: sql<number>`(SELECT count(*)::int FROM collection_files WHERE collection_id = ${collections.id})`,
        })
        .from(collections)
        .where(whereClause)
        .orderBy(desc(collections.updatedAt))

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/collections', error)
    return NextResponse.json({ error: 'Failed to list collections' }, { status: 500 })
  }
}

// POST create collection
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

    const parsed = await validateBody(request, createCollectionSchema)
    if (!parsed.success) return parsed.response
    const { name, description, color, icon } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const [newCollection] = await db.insert(collections).values({
        tenantId: session.user.tenantId,
        name: name.trim(),
        description: description || null,
        color: color || null,
        icon: icon || null,
        createdBy: session.user.id,
      }).returning()

      logAndBroadcast(session.user.tenantId, 'collection', 'created', newCollection.id)

      return NextResponse.json(newCollection)
    })
  } catch (error) {
    logError('api/collections', error)
    return NextResponse.json({ error: 'Failed to create collection' }, { status: 500 })
  }
}
