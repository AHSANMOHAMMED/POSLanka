import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { glEntries, chartOfAccounts, costCenters } from '@/lib/db/schema'
import { eq, and, sql, desc, gte, lte, or, ilike } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logError } from '@/lib/ai/error-logger'
import { validateSearchParams } from '@/lib/validation/helpers'
import { glEntriesListSchema } from '@/lib/validation/schemas/accounting'

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const parsed = validateSearchParams(request, glEntriesListSchema)
    if (!parsed.success) return parsed.response
    const { search, accountId, fromDate, toDate, partyType, partyId, voucherType, voucherId, costCenterId, page, pageSize } = parsed.data

    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      // Build filter conditions
      const conditions: ReturnType<typeof eq>[] = []

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(glEntries.remarks, `%${escaped}%`),
            ilike(glEntries.voucherNumber, `%${escaped}%`),
            ilike(chartOfAccounts.name, `%${escaped}%`),
            ilike(chartOfAccounts.accountNumber, `%${escaped}%`),
          )!
        )
      }
      if (accountId) {
        conditions.push(eq(glEntries.accountId, accountId))
      }
      if (fromDate) {
        conditions.push(gte(glEntries.postingDate, fromDate))
      }
      if (toDate) {
        conditions.push(lte(glEntries.postingDate, toDate))
      }
      if (partyType) {
        conditions.push(eq(glEntries.partyType, partyType as 'customer' | 'supplier'))
      }
      if (partyId) {
        conditions.push(eq(glEntries.partyId, partyId))
      }
      if (voucherType) {
        conditions.push(eq(glEntries.voucherType, voucherType))
      }
      if (voucherId) {
        conditions.push(eq(glEntries.voucherId, voucherId))
      }
      if (costCenterId) {
        conditions.push(eq(glEntries.costCenterId, costCenterId))
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Get total count (join chartOfAccounts when search is active for name/number filtering)
      const countQuery = db
        .select({ count: sql<number>`count(*)::int` })
        .from(glEntries)
      if (search) {
        countQuery.leftJoin(chartOfAccounts, eq(glEntries.accountId, chartOfAccounts.id))
      }
      const [{ count }] = await countQuery.where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // Fetch entries with joined account info
      const entries = await db
        .select({
          id: glEntries.id,
          tenantId: glEntries.tenantId,
          postingDate: glEntries.postingDate,
          accountId: glEntries.accountId,
          debit: glEntries.debit,
          credit: glEntries.credit,
          partyType: glEntries.partyType,
          partyId: glEntries.partyId,
          costCenterId: glEntries.costCenterId,
          voucherType: glEntries.voucherType,
          voucherId: glEntries.voucherId,
          voucherNumber: glEntries.voucherNumber,
          remarks: glEntries.remarks,
          isOpening: glEntries.isOpening,
          fiscalYearId: glEntries.fiscalYearId,
          createdAt: glEntries.createdAt,
          accountName: chartOfAccounts.name,
          accountNumber: chartOfAccounts.accountNumber,
          costCenterName: costCenters.name,
        })
        .from(glEntries)
        .leftJoin(chartOfAccounts, eq(glEntries.accountId, chartOfAccounts.id))
        .leftJoin(costCenters, eq(glEntries.costCenterId, costCenters.id))
        .where(whereClause)
        .orderBy(desc(glEntries.postingDate), desc(glEntries.createdAt))
        .limit(Math.min(pageSize, 100))
        .offset(offset)

      return NextResponse.json({
        data: entries,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/accounting/gl-entries', error)
    return NextResponse.json({ error: 'Failed to fetch GL entries' }, { status: 500 })
  }
}
