import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { costCenters } from '@/lib/db/schema'
import { eq, and, ilike, sql, asc } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { costCentersListSchema, createCostCenterSchema } from '@/lib/validation/schemas/accounting'

interface CostCenterTreeNode {
  id: string
  name: string
  parentId: string | null
  isGroup: boolean
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  children: CostCenterTreeNode[]
}

function buildTree(items: typeof costCenters.$inferSelect[]): CostCenterTreeNode[] {
  const map = new Map<string, CostCenterTreeNode>()
  const roots: CostCenterTreeNode[] = []

  // Create nodes
  for (const item of items) {
    map.set(item.id, {
      id: item.id,
      name: item.name,
      parentId: item.parentId,
      isGroup: item.isGroup,
      isActive: item.isActive,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      children: [],
    })
  }

  // Build hierarchy
  for (const item of items) {
    const node = map.get(item.id)!
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const parsed = validateSearchParams(request, costCentersListSchema)
    if (!parsed.success) return parsed.response
    const { search, page, pageSize, all, tree } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Tree mode: return all cost centers in hierarchical structure
      if (tree) {
        const items = await db
          .select()
          .from(costCenters)
          .orderBy(asc(costCenters.name))

        const treeData = buildTree(items)
        return NextResponse.json(treeData)
      }

      // All mode: return flat list (for dropdowns)
      if (all) {
        const items = await db
          .select()
          .from(costCenters)
          .orderBy(asc(costCenters.name))
          .limit(1000)

        return NextResponse.json(items)
      }

      // Build search conditions
      const conditions: ReturnType<typeof eq>[] = []
      if (search) {
        conditions.push(ilike(costCenters.name, `%${escapeLikePattern(search)}%`))
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(costCenters)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      const items = await db
        .select()
        .from(costCenters)
        .where(whereClause)
        .orderBy(asc(costCenters.name))
        .limit(Math.min(pageSize, 100))
        .offset(offset)

      return NextResponse.json({
        data: items,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/accounting/cost-centers', error)
    return NextResponse.json({ error: 'Failed to fetch cost centers' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createCostCenterSchema)
    if (!parsed.success) return parsed.response
    const { name, parentId, isGroup } = parsed.data

    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      // If parentId is specified, verify the parent exists and is a group
      if (parentId) {
        const parent = await db
          .select({ id: costCenters.id, isGroup: costCenters.isGroup })
          .from(costCenters)
          .where(eq(costCenters.id, parentId))
          .limit(1)

        if (parent.length === 0) {
          return NextResponse.json(
            { error: 'Parent cost center not found' },
            { status: 404 }
          )
        }

        if (!parent[0].isGroup) {
          return NextResponse.json(
            { error: 'Parent cost center must be a group' },
            { status: 400 }
          )
        }
      }

      const [newCostCenter] = await db.insert(costCenters).values({
        tenantId,
        name,
        parentId: parentId || null,
        isGroup: isGroup ?? false,
      }).returning()

      logAndBroadcast(tenantId, 'cost-center', 'created', newCostCenter.id)
      return NextResponse.json(newCostCenter)
    })
  } catch (error) {
    logError('api/accounting/cost-centers', error)
    return NextResponse.json({ error: 'Failed to create cost center' }, { status: 500 })
  }
}
