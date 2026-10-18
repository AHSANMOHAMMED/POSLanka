import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { serviceTypes } from '@/lib/db/schema'
import { sql, or, ilike } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { serviceTypesListSchema, createServiceTypeSchema } from '@/lib/validation/schemas/service-types'

// GET all service types for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, serviceTypesListSchema)
    if (!parsed.success) return parsed.response
    const { search, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      let whereClause = undefined
      if (search) {
        const escaped = escapeLikePattern(search)
        whereClause = or(
          ilike(serviceTypes.name, `%${escaped}%`),
          ilike(serviceTypes.description, `%${escaped}%`)
        )
      }

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(serviceTypes)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100) // Max 100 per page
      const offset = all ? undefined : (page - 1) * pageSize

      const result = await db.query.serviceTypes.findMany({
        where: whereClause,
        with: {
          group: true,
        },
        orderBy: (serviceTypes, { asc }) => [asc(serviceTypes.name)],
        limit,
        offset,
      })

      // Return paginated response (or just array for backward compatibility with all=true)
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
        }
      })
    })
  } catch (error) {
    logError('api/service-types', error)
    return NextResponse.json({ error: 'Failed to fetch service types' }, { status: 500 })
  }
}

// POST create new service type
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageServiceTypes')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createServiceTypeSchema)
    if (!parsed.success) return parsed.response
    const { name, description, defaultHours, defaultRate, groupId } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Check for duplicate service type name within tenant (RLS scopes the query)
      const existingServiceType = await db.query.serviceTypes.findFirst({
        where: ilike(serviceTypes.name, name.trim()),
      })
      if (existingServiceType) {
        return NextResponse.json({ error: 'A service type with this name already exists' }, { status: 400 })
      }

      const [newServiceType] = await db.insert(serviceTypes).values({
        tenantId: session!.user.tenantId,
        name,
        description: description || null,
        defaultHours: defaultHours ? String(defaultHours) : null,
        defaultRate: defaultRate ? String(defaultRate) : null,
        groupId: groupId || null,
        isActive: true,
      }).returning()

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'service', 'created', newServiceType.id)

      return NextResponse.json(newServiceType)
    })
  } catch (error) {
    logError('api/service-types', error)
    return NextResponse.json({ error: 'Failed to create service type' }, { status: 500 })
  }
}
