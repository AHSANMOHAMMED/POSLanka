import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { salaryComponents } from '@/lib/db/schema'
import { eq, and, ne, ilike } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateFormula } from '@/lib/payroll/formula-engine'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateSalaryComponentSchema } from '@/lib/validation/schemas/hr'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single salary component
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageSalaryComponents')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      const component = await db.query.salaryComponents.findFirst({
        where: eq(salaryComponents.id, id),
        with: {
          expenseAccount: true,
          payableAccount: true,
        },
      })

      if (!component) {
        return NextResponse.json({ error: 'Salary component not found' }, { status: 404 })
      }

      return NextResponse.json(component)
    })
  } catch (error) {
    logError('api/salary-components/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch salary component' }, { status: 500 })
  }
}

// PUT update salary component
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageSalaryComponents')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateSalaryComponentSchema)
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
      isActive,
      expectedUpdatedAt,
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
      // Use transaction with FOR UPDATE to prevent race conditions
      const result = await db.transaction(async (tx) => {
        // Lock and get current component (RLS scopes the query)
        const [current] = await tx
          .select()
          .from(salaryComponents)
          .where(eq(salaryComponents.id, id))
          .for('update')

        if (!current) {
          throw new Error('NOT_FOUND')
        }

        // Optimistic locking - check if record was modified since client fetched it
        if (expectedUpdatedAt) {
          const clientUpdatedAt = new Date(expectedUpdatedAt).getTime()
          const serverUpdatedAt = current.updatedAt ? new Date(current.updatedAt).getTime() : 0
          if (serverUpdatedAt > clientUpdatedAt) {
            throw new Error('CONFLICT')
          }
        }

        // Check for duplicate abbreviation (excluding current component) - RLS scopes
        const existingAbbrev = await tx.query.salaryComponents.findFirst({
          where: and(
            ilike(salaryComponents.abbreviation, abbreviation.trim()),
            ne(salaryComponents.id, id)
          ),
        })
        if (existingAbbrev) {
          throw new Error('DUPLICATE_ABBREVIATION')
        }

        const [updated] = await tx.update(salaryComponents)
          .set({
            name: name.trim(),
            abbreviation: abbreviation.trim().toUpperCase(),
            componentType,
            formulaExpression: formulaExpression || null,
            defaultAmount: defaultAmount != null ? String(defaultAmount) : null,
            isStatutory: isStatutory ?? false,
            isFlexibleBenefit: isFlexibleBenefit ?? false,
            dependsOnPaymentDays: dependsOnPaymentDays ?? true,
            doNotIncludeInTotal: doNotIncludeInTotal ?? false,
            isPayableByEmployer: isPayableByEmployer ?? false,
            expenseAccountId: expenseAccountId || null,
            payableAccountId: payableAccountId || null,
            description: description || null,
            sortOrder: sortOrder != null ? sortOrder : 0,
            isActive: isActive !== undefined ? isActive : true,
            updatedAt: new Date(),
          })
          .where(eq(salaryComponents.id, id))
          .returning()

        return updated
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'salary-component', 'updated', id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/salary-components/[id]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Salary component not found' }, { status: 404 })
    }
    if (message === 'CONFLICT') {
      return NextResponse.json({
        error: 'This salary component was modified by another user. Please refresh and try again.',
        code: 'CONFLICT',
      }, { status: 409 })
    }
    if (message === 'DUPLICATE_ABBREVIATION') {
      return NextResponse.json({ error: 'A salary component with this abbreviation already exists' }, { status: 400 })
    }

    return NextResponse.json({ error: 'Failed to update salary component' }, { status: 500 })
  }
}

// DELETE (soft-delete) salary component - sets isActive to false
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageSalaryComponents')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Verify the component exists (RLS scopes the query)
      const existing = await db.query.salaryComponents.findFirst({
        where: eq(salaryComponents.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Salary component not found' }, { status: 404 })
      }

      if (!existing.isActive) {
        return NextResponse.json({ error: 'Salary component is already deactivated' }, { status: 400 })
      }

      const [deactivated] = await db.update(salaryComponents)
        .set({
          isActive: false,
          updatedAt: new Date(),
        })
        .where(eq(salaryComponents.id, id))
        .returning()

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'salary-component', 'deleted', id)

      return NextResponse.json(deactivated)
    })
  } catch (error) {
    logError('api/salary-components/[id]', error)
    return NextResponse.json({ error: 'Failed to deactivate salary component' }, { status: 500 })
  }
}
