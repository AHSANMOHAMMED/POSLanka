import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import {
  fiscalYears,
  glEntries,
  journalEntries,
  budgets,
  periodClosingVouchers,
  accountingSettings,
} from '@/lib/db/schema'
import { eq, and, sql, lte, gte, ne } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateFiscalYearSchema } from '@/lib/validation/schemas/accounting'
import { idParamSchema } from '@/lib/validation/schemas/common'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      const fy = await db.query.fiscalYears.findFirst({
        where: eq(fiscalYears.id, id),
      })
      if (!fy) {
        return NextResponse.json({ error: 'Fiscal year not found' }, { status: 404 })
      }
      return NextResponse.json(fy)
    })
  } catch (error) {
    logError('api/accounting/fiscal-years/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch fiscal year' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateFiscalYearSchema)
    if (!parsed.success) return parsed.response
    const { name, startDate, endDate, isClosed } = parsed.data
    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const existing = await db.query.fiscalYears.findFirst({
        where: eq(fiscalYears.id, id),
      })
      if (!existing) {
        return NextResponse.json({ error: 'Fiscal year not found' }, { status: 404 })
      }

      const updateData: Record<string, unknown> = {}

      // Handle close/reopen
      if (isClosed !== undefined && isClosed !== existing.isClosed) {
        updateData.isClosed = isClosed
        if (isClosed) {
          updateData.closedAt = new Date()
          updateData.closedBy = session!.user.id
        } else {
          updateData.closedAt = null
          updateData.closedBy = null
        }
      }

      // Handle name edit
      if (name !== undefined) {
        updateData.name = name.trim()
      }

      // Handle date edits with overlap validation
      if (startDate !== undefined || endDate !== undefined) {
        const newStart = startDate || existing.startDate
        const newEnd = endDate || existing.endDate

        if (new Date(newStart) >= new Date(newEnd)) {
          return NextResponse.json({ error: 'Start date must be before end date' }, { status: 400 })
        }

        // Check for overlapping fiscal years (excluding self)
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(fiscalYears)
          .where(
            and(
              ne(fiscalYears.id, id),
              lte(fiscalYears.startDate, newEnd),
              gte(fiscalYears.endDate, newStart)
            )
          )

        if (Number(count) > 0) {
          return NextResponse.json({ error: 'Dates overlap with another fiscal year' }, { status: 409 })
        }

        if (startDate !== undefined) updateData.startDate = startDate
        if (endDate !== undefined) updateData.endDate = endDate
      }

      if (Object.keys(updateData).length === 0) {
        return NextResponse.json(existing)
      }

      const [updated] = await db.update(fiscalYears)
        .set(updateData)
        .where(eq(fiscalYears.id, id))
        .returning()

      logAndBroadcast(tenantId, 'fiscal-year', 'updated', id)
      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/accounting/fiscal-years/[id]', error)
    return NextResponse.json({ error: 'Failed to update fiscal year' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      // Check dependencies before deletion
      const dependencies: string[] = []

      const [glCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(glEntries)
        .where(eq(glEntries.fiscalYearId, id))
      if (Number(glCount.count) > 0) dependencies.push(`${glCount.count} GL entries`)

      const [jeCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(journalEntries)
        .where(eq(journalEntries.fiscalYearId, id))
      if (Number(jeCount.count) > 0) dependencies.push(`${jeCount.count} journal entries`)

      const [budgetCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(budgets)
        .where(eq(budgets.fiscalYearId, id))
      if (Number(budgetCount.count) > 0) dependencies.push(`${budgetCount.count} budgets`)

      const [pcvCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(periodClosingVouchers)
        .where(eq(periodClosingVouchers.fiscalYearId, id))
      if (Number(pcvCount.count) > 0) dependencies.push(`${pcvCount.count} period closing vouchers`)

      // Check if used as current fiscal year in settings
      const settingsRef = await db.query.accountingSettings.findFirst({
        where: eq(accountingSettings.currentFiscalYearId, id),
      })
      if (settingsRef) dependencies.push('current fiscal year in settings')

      if (dependencies.length > 0) {
        return NextResponse.json({
          error: `Cannot delete. This fiscal year has: ${dependencies.join(', ')}.`,
          dependencies,
        }, { status: 400 })
      }

      const [deleted] = await db.delete(fiscalYears).where(eq(fiscalYears.id, id)).returning()
      if (!deleted) {
        return NextResponse.json({ error: 'Fiscal year not found' }, { status: 404 })
      }

      logAndBroadcast(tenantId, 'fiscal-year', 'deleted', id)
      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/accounting/fiscal-years/[id]', error)
    return NextResponse.json({ error: 'Failed to delete fiscal year' }, { status: 500 })
  }
}
