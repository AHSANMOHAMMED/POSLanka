import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { journalEntries, journalEntryItems, accountingSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { createGLEntries, type GLEntryInput } from '@/lib/accounting/gl'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageAccounting')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'essential')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const tenantId = session!.user.tenantId

    return await withTenant(tenantId, async (db) => {
      const result = await db.transaction(async (tx) => {
        // Lock journal entry row to prevent double submit
        const [lockedEntry] = await tx.select().from(journalEntries).where(eq(journalEntries.id, id)).for('update')
        // Get items separately
        const entryItems = await tx.select().from(journalEntryItems).where(eq(journalEntryItems.journalEntryId, id))
        const entry = lockedEntry ? { ...lockedEntry, items: entryItems } : null

        if (!entry || !lockedEntry) throw new Error('NOT_FOUND')
        if (entry.status !== 'draft') throw new Error('INVALID_STATUS')
        if (!entry.items || entry.items.length < 2) throw new Error('INSUFFICIENT_ITEMS')

        // Get fiscal year from settings
        const [settings] = await tx.select()
          .from(accountingSettings)
          .where(eq(accountingSettings.tenantId, tenantId))
          .limit(1)

        // Create GL entries
        const glEntryInputs: GLEntryInput[] = entry.items.map(item => ({
          accountId: item.accountId,
          debit: Number(item.debit || 0),
          credit: Number(item.credit || 0),
          partyType: item.partyType,
          partyId: item.partyId,
          costCenterId: item.costCenterId,
          remarks: item.remarks || entry.remarks || null,
        }))

        await createGLEntries(tx, {
          tenantId,
          postingDate: entry.postingDate,
          voucherType: 'journal_entry',
          voucherId: entry.id,
          voucherNumber: entry.entryNumber,
          fiscalYearId: settings?.currentFiscalYearId || null,
          entries: glEntryInputs,
        })

        // Update status to submitted
        const [updated] = await tx.update(journalEntries)
          .set({
            status: 'submitted',
            submittedAt: new Date(),
            submittedBy: session!.user.id,
            updatedAt: new Date(),
          })
          .where(eq(journalEntries.id, id))
          .returning()

        return updated
      })

      logAndBroadcast(tenantId, 'journal-entry', 'updated', id)
      logAndBroadcast(tenantId, 'gl-entry', 'created', id)

      return NextResponse.json(result)
    })
  } catch (error) {
    const err = error as Error
    if (err.message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 })
    }
    if (err.message === 'INVALID_STATUS') {
      return NextResponse.json({ error: 'Only draft entries can be submitted' }, { status: 400 })
    }
    if (err.message === 'INSUFFICIENT_ITEMS') {
      return NextResponse.json({ error: 'Journal entry must have at least 2 items' }, { status: 400 })
    }
    logError('api/accounting/journal-entries/[id]/submit', error)
    return NextResponse.json({ error: 'Failed to submit journal entry' }, { status: 500 })
  }
}
