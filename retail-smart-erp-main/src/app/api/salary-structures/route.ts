import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { salaryStructures, salaryStructureComponents } from '@/lib/db/schema'
import { ilike, sql, eq, and } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { salaryStructuresListSchema, createSalaryStructureSchema } from '@/lib/validation/schemas/hr'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSalaryComponents')
    if (permError) return permError

    const parsed = validateSearchParams(request, salaryStructuresListSchema)
    if (!parsed.success) return parsed.response
    const { all, page, pageSize, search, active } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const conditions = []
      if (search) conditions.push(ilike(salaryStructures.name, `%${escapeLikePattern(search)}%`))
      if (active) conditions.push(eq(salaryStructures.isActive, true))
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      if (all) {
        const result = await db.query.salaryStructures.findMany({
          where: whereClause,
          with: { components: { with: { component: true } } },
          orderBy: (s, { asc }) => [asc(s.name)],
          limit: 1000,
        })
        return NextResponse.json(result)
      }

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(salaryStructures)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      const result = await db.query.salaryStructures.findMany({
        where: whereClause,
        with: { components: { with: { component: true } } },
        orderBy: (s, { asc }) => [asc(s.name)],
        limit: pageSize,
        offset,
      })

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/salary-structures', error)
    return NextResponse.json({ error: 'Failed to fetch salary structures' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSalaryComponents')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createSalaryStructureSchema)
    if (!parsed.success) return parsed.response
    const { name, description, components: componentEntries } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Create structure
      const [structure] = await db
        .insert(salaryStructures)
        .values({
          tenantId: session.user.tenantId,
          name,
          description: description || null,
        })
        .returning()

      // Create component associations
      if (componentEntries && componentEntries.length > 0) {
        await db.insert(salaryStructureComponents).values(
          componentEntries.map((c, idx) => ({
            tenantId: session.user.tenantId,
            structureId: structure.id,
            componentId: c.componentId,
            overrideFormula: c.overrideFormula || null,
            overrideAmount: c.overrideAmount != null ? String(c.overrideAmount) : null,
            sortOrder: c.sortOrder ?? idx,
            isActive: true,
          }))
        )
      }

      // Fetch with components
      const result = await db.query.salaryStructures.findFirst({
        where: eq(salaryStructures.id, structure.id),
        with: { components: { with: { component: true } } },
      })

      logAndBroadcast(session.user.tenantId, 'salary-structure', 'created', structure.id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/salary-structures', error)
    return NextResponse.json({ error: 'Failed to create salary structure' }, { status: 500 })
  }
}
