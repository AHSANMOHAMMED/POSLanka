import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant, withTenantTransaction } from '@/lib/db'
import { taxTemplates, taxTemplateItems } from '@/lib/db/schema'
import { eq, and, ilike, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateSearchParams } from '@/lib/validation'
import { taxTemplatesListSchema, createTaxTemplateSchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'viewAccounting')
    if (permError) return permError

    const parsed = validateSearchParams(request, taxTemplatesListSchema)
    if (!parsed.success) return parsed.response
    const { search, page, pageSize, all } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // All mode: return flat list with items (for dropdowns)
      if (all) {
        const templates = await db.query.taxTemplates.findMany({
          with: {
            items: {
              with: {
                account: true,
              },
            },
          },
          orderBy: (tt, { asc }) => [asc(tt.name)],
          limit: 1000,
        })

        return NextResponse.json(templates)
      }

      // Build search conditions
      const conditions: ReturnType<typeof eq>[] = []
      if (search) {
        conditions.push(ilike(taxTemplates.name, `%${escapeLikePattern(search)}%`))
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(taxTemplates)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      const templates = await db.query.taxTemplates.findMany({
        where: whereClause,
        with: {
          items: {
            with: {
              account: true,
            },
          },
        },
        orderBy: (tt, { desc }) => [desc(tt.createdAt)],
        limit: Math.min(pageSize, 100),
        offset,
      })

      return NextResponse.json({
        data: templates,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/accounting/tax-templates', error)
    return NextResponse.json({ error: 'Failed to fetch tax templates' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createTaxTemplateSchema)
    if (!parsed.success) return parsed.response
    const { name, isActive, items } = parsed.data

    const tenantId = session!.user.tenantId

    return await withTenantTransaction(tenantId, async (tx) => {
      // Create tax template
      const [newTemplate] = await tx.insert(taxTemplates).values({
        tenantId,
        name,
        isActive,
      }).returning()

      // Create tax template items if provided
      if (items && items.length > 0) {
        for (const item of items) {
          await tx.insert(taxTemplateItems).values({
            tenantId,
            taxTemplateId: newTemplate.id,
            taxName: item.taxName,
            rate: String(item.rate),
            accountId: item.accountId || null,
            includedInPrice: item.includedInPrice,
          })
        }
      }

      logAndBroadcast(tenantId, 'tax-template', 'created', newTemplate.id)
      return NextResponse.json(newTemplate)
    })
  } catch (error) {
    logError('api/accounting/tax-templates', error)
    return NextResponse.json({ error: 'Failed to create tax template' }, { status: 500 })
  }
}
