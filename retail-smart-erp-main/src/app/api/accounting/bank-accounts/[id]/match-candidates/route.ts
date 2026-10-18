import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { bankAccounts, bankTransactions, glEntries, paymentEntries, journalEntries } from '@/lib/db/schema'
import { eq, and, sql, notInArray, gte, lte, or, ilike } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams, validateSearchParams } from '@/lib/validation/helpers'
import { matchCandidatesQuerySchema } from '@/lib/validation/schemas/accounting'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    const parsed = validateSearchParams(request, matchCandidatesQuerySchema)
    if (!parsed.success) return parsed.response
    const { search, fromDate, toDate, page, pageSize } = parsed.data

    const tenantId = session.user.tenantId

    return await withTenant(tenantId, async (db) => {
      // Get bank account and its linked COA account
      const account = await db.query.bankAccounts.findFirst({
        where: eq(bankAccounts.id, id),
      })

      if (!account) {
        return NextResponse.json({ error: 'Bank account not found' }, { status: 404 })
      }

      if (!account.accountId) {
        return NextResponse.json({
          data: [],
          pagination: { page, pageSize, total: 0, totalPages: 0 },
          message: 'Bank account has no linked Chart of Accounts entry',
        })
      }

      // Get voucher IDs already matched on this bank account's transactions
      const matchedVouchers = await db
        .select({
          voucherId: bankTransactions.matchedVoucherId,
        })
        .from(bankTransactions)
        .where(
          and(
            eq(bankTransactions.bankAccountId, id),
            sql`${bankTransactions.matchedVoucherId} IS NOT NULL`
          )
        )

      const matchedVoucherIds = matchedVouchers
        .map((m) => m.voucherId)
        .filter((v): v is string => v !== null)

      // Build conditions for GL entries on the linked COA account
      const conditions = [
        eq(glEntries.accountId, account.accountId),
      ]

      // Exclude already-matched vouchers
      if (matchedVoucherIds.length > 0) {
        conditions.push(notInArray(glEntries.voucherId, matchedVoucherIds))
      }

      // Date filters
      if (fromDate) {
        conditions.push(gte(glEntries.postingDate, fromDate))
      }
      if (toDate) {
        conditions.push(lte(glEntries.postingDate, toDate))
      }

      // Search filter - search in voucher number or remarks
      if (search) {
        conditions.push(
          or(
            ilike(glEntries.voucherNumber, `%${search}%`),
            ilike(glEntries.remarks, `%${search}%`)
          )!
        )
      }

      // Group GL entries by (voucherType, voucherId) to get net amounts per voucher
      const whereClause = and(...conditions)

      // Count total distinct vouchers
      const [countResult] = await db
        .select({
          total: sql<number>`count(distinct (${glEntries.voucherType} || ':' || ${glEntries.voucherId}))::int`,
        })
        .from(glEntries)
        .where(whereClause)

      const total = countResult?.total || 0
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // Get grouped candidates
      const candidates = await db
        .select({
          voucherType: glEntries.voucherType,
          voucherId: glEntries.voucherId,
          voucherNumber: sql<string>`max(${glEntries.voucherNumber})`,
          postingDate: sql<string>`max(${glEntries.postingDate})`,
          totalDebit: sql<string>`coalesce(sum(${glEntries.debit}), 0)`,
          totalCredit: sql<string>`coalesce(sum(${glEntries.credit}), 0)`,
          remarks: sql<string>`max(${glEntries.remarks})`,
        })
        .from(glEntries)
        .where(whereClause)
        .groupBy(glEntries.voucherType, glEntries.voucherId)
        .orderBy(sql`max(${glEntries.postingDate}) desc`)
        .limit(pageSize)
        .offset(offset)

      // Enrich with party names from payment entries or journal entries
      const enriched = await Promise.all(
        candidates.map(async (c) => {
          const debit = Number(c.totalDebit)
          const credit = Number(c.totalCredit)
          const amount = Math.abs(debit - credit)
          const direction = debit > credit ? 'debit' : 'credit'

          let partyName: string | null = null
          let referenceNo: string | null = null

          if (c.voucherType === 'payment_entry') {
            const pe = await db.query.paymentEntries.findFirst({
              where: eq(paymentEntries.id, c.voucherId),
              columns: {
                partyName: true,
                referenceNo: true,
                remarks: true,
                status: true,
              },
            })
            if (pe) {
              // Skip draft/cancelled vouchers
              if (pe.status === 'draft' || pe.status === 'cancelled') return null
              partyName = pe.partyName || null
              referenceNo = pe.referenceNo || null
              if (!c.remarks && pe.remarks) c.remarks = pe.remarks
            }
          } else if (c.voucherType === 'journal_entry') {
            const je = await db.query.journalEntries.findFirst({
              where: eq(journalEntries.id, c.voucherId),
              columns: {
                remarks: true,
                status: true,
              },
            })
            if (je) {
              if (je.status === 'draft' || je.status === 'cancelled') return null
              if (!c.remarks && je.remarks) c.remarks = je.remarks
            }
          }

          return {
            voucherType: c.voucherType,
            voucherId: c.voucherId,
            voucherNumber: c.voucherNumber || '',
            postingDate: c.postingDate,
            amount,
            direction,
            remarks: c.remarks || '',
            partyName,
            referenceNo,
          }
        })
      )

      const data = enriched.filter((c): c is NonNullable<typeof c> => c !== null)

      return NextResponse.json({
        data,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/accounting/bank-accounts/[id]/match-candidates', error)
    return NextResponse.json({ error: 'Failed to fetch match candidates' }, { status: 500 })
  }
}
