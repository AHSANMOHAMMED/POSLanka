import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { laborGuides, serviceTypes, vehicleMakes, vehicleModels } from '@/lib/db/schema'
import { eq, and, sql, or, ilike } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { laborGuidesListSchema, createLaborGuideSchema } from '@/lib/validation/schemas/service-types'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, laborGuidesListSchema)
    if (!parsed.success) return parsed.response
    const { serviceTypeId, makeId, search, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions: ReturnType<typeof eq>[] = []
      if (serviceTypeId) conditions.push(eq(laborGuides.serviceTypeId, serviceTypeId))
      if (makeId) conditions.push(eq(laborGuides.makeId, makeId))

      // For search, we need to join with related tables to search by name
      // Use the query builder with relations for cleaner code
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      if (all) {
        const result = await db.query.laborGuides.findMany({
          where: whereClause,
          with: { serviceType: true, make: true, model: true },
          limit: 1000,
        })
        return NextResponse.json(result)
      }

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(laborGuides)
        .where(whereClause)
      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // If search is provided, we do a join-based query
      if (search) {
        const escaped = escapeLikePattern(search)
        // Use a raw join approach to search across related tables
        const rows = await db
          .select({
            id: laborGuides.id,
            tenantId: laborGuides.tenantId,
            serviceTypeId: laborGuides.serviceTypeId,
            makeId: laborGuides.makeId,
            modelId: laborGuides.modelId,
            yearFrom: laborGuides.yearFrom,
            yearTo: laborGuides.yearTo,
            hours: laborGuides.hours,
            serviceTypeName: serviceTypes.name,
            makeName: vehicleMakes.name,
            modelName: vehicleModels.name,
          })
          .from(laborGuides)
          .leftJoin(serviceTypes, eq(laborGuides.serviceTypeId, serviceTypes.id))
          .leftJoin(vehicleMakes, eq(laborGuides.makeId, vehicleMakes.id))
          .leftJoin(vehicleModels, eq(laborGuides.modelId, vehicleModels.id))
          .where(
            and(
              ...(conditions.length > 0 ? conditions : []),
              or(
                ilike(serviceTypes.name, `%${escaped}%`),
                ilike(vehicleMakes.name, `%${escaped}%`),
                ilike(vehicleModels.name, `%${escaped}%`)
              )
            )
          )
          .limit(Math.min(pageSize, 100))
          .offset(offset)

        // Get filtered count
        const [{ filteredCount }] = await db
          .select({ filteredCount: sql<number>`count(*)::int` })
          .from(laborGuides)
          .leftJoin(serviceTypes, eq(laborGuides.serviceTypeId, serviceTypes.id))
          .leftJoin(vehicleMakes, eq(laborGuides.makeId, vehicleMakes.id))
          .leftJoin(vehicleModels, eq(laborGuides.modelId, vehicleModels.id))
          .where(
            and(
              ...(conditions.length > 0 ? conditions : []),
              or(
                ilike(serviceTypes.name, `%${escaped}%`),
                ilike(vehicleMakes.name, `%${escaped}%`),
                ilike(vehicleModels.name, `%${escaped}%`)
              )
            )
          )

        // Transform results to match the relation-based shape
        const data = rows.map(row => ({
          id: row.id,
          tenantId: row.tenantId,
          serviceTypeId: row.serviceTypeId,
          makeId: row.makeId,
          modelId: row.modelId,
          yearFrom: row.yearFrom,
          yearTo: row.yearTo,
          hours: row.hours,
          serviceType: row.serviceTypeName ? { id: row.serviceTypeId, name: row.serviceTypeName } : null,
          make: row.makeId && row.makeName ? { id: row.makeId, name: row.makeName } : null,
          model: row.modelId && row.modelName ? { id: row.modelId, name: row.modelName } : null,
        }))

        const searchTotal = Number(filteredCount)
        return NextResponse.json({
          data,
          pagination: {
            page,
            pageSize,
            total: searchTotal,
            totalPages: Math.ceil(searchTotal / pageSize),
          },
        })
      }

      const result = await db.query.laborGuides.findMany({
        where: whereClause,
        with: { serviceType: true, make: true, model: true },
        limit: Math.min(pageSize, 100),
        offset,
      })

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/labor-guides', error)
    return NextResponse.json({ error: 'Failed to fetch labor guides' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageServiceTypes')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createLaborGuideSchema)
    if (!parsed.success) return parsed.response
    const { serviceTypeId, makeId, modelId, yearFrom, yearTo, hours } = parsed.data

    return await withTenant(session!.user.tenantId, async (db) => {
      const [newGuide] = await db.insert(laborGuides).values({
        tenantId: session!.user.tenantId,
        serviceTypeId,
        makeId: makeId || null,
        modelId: modelId || null,
        yearFrom: yearFrom ?? null,
        yearTo: yearTo ?? null,
        hours: String(hours),
      }).returning()

      // Fetch the full guide with relations
      const fullGuide = await db.query.laborGuides.findFirst({
        where: eq(laborGuides.id, newGuide.id),
        with: { serviceType: true, make: true, model: true },
      })

      logAndBroadcast(session!.user.tenantId, 'labor-guide', 'created', newGuide.id)
      return NextResponse.json(fullGuide)
    })
  } catch (error) {
    logError('api/labor-guides', error)
    return NextResponse.json({ error: 'Failed to create labor guide' }, { status: 500 })
  }
}
