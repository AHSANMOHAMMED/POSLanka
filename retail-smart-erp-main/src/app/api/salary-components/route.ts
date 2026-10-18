import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { salaryComponents } from '@/lib/db/schema'
import { and, eq, ilike, or, sql } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateFormula } from '@/lib/payroll/formula-engine'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { salaryComponentsListSchema, createSalaryComponentSchema } from '@/lib/validation/schemas/hr'

// GET all salary components for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageSalaryComponents')
    if (permError) return permError

    const parsed = validateSearchParams(request, salaryComponentsListSchema)
    if (!parsed.success) return parsed.response
    const { all, page, pageSize, search, type, active } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Build where conditions (tenantId filter handled by RLS)
      const conditions = []

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(salaryComponents.name, `%${escaped}%`),
            ilike(salaryComponents.abbreviation, `%${escaped}%`)
          )
        )
      }

      if (type) {
        conditions.push(eq(salaryComponents.componentType, type))
      }

      if (active) {
        conditions.push(eq(salaryComponents.isActive, true))
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Return all components (for dropdowns)
      if (all) {
        const result = await db
          .select()
          .from(salaryComponents)
          .where(whereClause)
          .orderBy(salaryComponents.sortOrder, salaryComponents.name)
          .limit(1000)

        return NextResponse.json(result)
      }

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(salaryComponents)
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // Get paginated results
      const result = await db
        .select()
        .from(salaryComponents)
        .where(whereClause)
        .orderBy(salaryComponents.sortOrder, salaryComponents.name)
        .limit(pageSize)
        .offset(offset)

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/salary-components', error)
    return NextResponse.json({ error: 'Failed to fetch salary components' }, { status: 500 })
  }
}

// POST create new salary component
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageSalaryComponents')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createSalaryComponentSchema)
    if (!parsed.success) return parsed.response
    const {
      name,
      abbreviation,
      componentType,
      formulaExpression,
      defaultAmount,
      isStatutory,
      isFlexibleBenefit,
      dependsOnPaymentDays,
      doNotIncludeInTotal,
      isPayableByEmployer,
      expenseAccountId,
      payableAccountId,
      description,
      sortOrder,
    } = parsed.data

    // Validate formula if provided
    if (formulaExpression) {
      const formulaError = validateFormula(formulaExpression)
      if (formulaError) {
        return NextResponse.json({ error: `Invalid formula: ${formulaError}` }, { status: 400 })
      }
    }

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Check for duplicate abbreviation within tenant (case-insensitive) - RLS scopes
      const existing = await db.query.salaryComponents.findFirst({
        where: ilike(salaryComponents.abbreviation, abbreviation.trim()),
      })

      if (existing) {
        return NextResponse.json({
          error: 'A salary component with this abbreviation already exists',
        }, { status: 400 })
      }

      const [newComponent] = await db.insert(salaryComponents).values({
        tenantId: session!.user.tenantId,
        name,
        abbreviation: abbreviation.toUpperCase(),
        componentType,
        formulaExpression: formulaExpression || null,
        defaultAmount: defaultAmount != null ? String(defaultAmount) : null,
        isStatutory,
        isFlexibleBenefit,
        dependsOnPaymentDays,
        doNotIncludeInTotal,
        isPayableByEmployer,
        expenseAccountId: expenseAccountId || null,
        payableAccountId: payableAccountId || null,
        description: description || null,
        sortOrder,
        isActive: true,
      }).returning()

      // Broadcast the change
      logAndBroadcast(session!.user.tenantId, 'salary-component', 'created', newComponent.id)

      return NextResponse.json(newComponent)
    })
  } catch (error) {
    logError('api/salary-components', error)
    return NextResponse.json({ error: 'Failed to create salary component' }, { status: 500 })
  }
}
