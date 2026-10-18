import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { files } from '@/lib/db/schema'
import { eq, sql, ilike, like, inArray, and, or, desc } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { fileSearchSchema } from '@/lib/validation/schemas/files'

// GET full-text search across files
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageFiles')
    if (permError) return permError

    const parsed = validateSearchParams(request, fileSearchSchema)
    if (!parsed.success) return parsed.response
    const { q, tags, type, starred, page, pageSize } = parsed.data

    if (!q && !tags && !type && !starred) {
      return NextResponse.json({ error: 'At least one search parameter is required (q, tags, type, starred)' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []

      // Exclude folders from search results
      conditions.push(eq(files.isFolder, false))

      // Text search: filename (ilike) OR full-text search on searchContent
      if (q) {
        const nameMatch = ilike(files.fileName, `%${escapeLikePattern(q)}%`)
        const fullTextMatch = sql`to_tsvector('english', coalesce(${files.searchContent}, '')) @@ plainto_tsquery('english', ${q})`
        conditions.push(or(nameMatch, fullTextMatch)!)
      }

      // Tag filtering using PostgreSQL array overlap operator
      if (tags) {
        const tagValues = tags.split(',').map(t => t.trim()).filter(Boolean)
        if (tagValues.length > 0) {
          conditions.push(sql`${files.tags} && ARRAY[${sql.join(tagValues.map(t => sql`${t}`), sql`, `)}]::text[]`)
        }
      }

      // File type filter
      if (type === 'image') {
        conditions.push(like(files.fileType, 'image/%'))
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
      } else if (type === 'video') {
        conditions.push(like(files.fileType, 'video/%'))
      }

      // Starred filter
      if (starred === 'true') {
        conditions.push(eq(files.isStarred, true))
      } else if (starred === 'false') {
        conditions.push(eq(files.isStarred, false))
      }

      const whereClause = and(...conditions)

      // Count total matches
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(files)
        .where(whereClause)

      // Build the query with optional relevance ranking
      if (q) {
        // Include a relevance score for full-text matches
        const result = await db
          .select({
            file: files,
            rank: sql<number>`ts_rank(to_tsvector('english', coalesce(${files.searchContent}, '')), plainto_tsquery('english', ${q}))`.as('rank'),
          })
          .from(files)
          .where(whereClause)
          .orderBy(desc(sql`rank`), desc(files.updatedAt))
          .limit(Math.min(pageSize, 100))
          .offset((page - 1) * pageSize)

        const data = result.map(r => ({
          ...r.file,
          relevanceScore: r.rank,
        }))

        return NextResponse.json({
          data,
          pagination: {
            page,
            pageSize,
            total: totalCount,
            totalPages: Math.ceil(totalCount / pageSize),
          },
        })
      }

      // Without text search, just order by updatedAt
      const result = await db.query.files.findMany({
        where: whereClause,
        with: {
          uploadedByUser: { columns: { fullName: true } },
        },
        orderBy: [desc(files.updatedAt)],
        limit: Math.min(pageSize, 100),
        offset: (page - 1) * pageSize,
      })

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
    logError('api/files/search', error)
    return NextResponse.json({ error: 'Failed to search files' }, { status: 500 })
  }
}
