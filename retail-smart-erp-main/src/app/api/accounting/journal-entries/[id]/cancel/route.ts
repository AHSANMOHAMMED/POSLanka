import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { journalEntries } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { reverseGLEntries } from '@/lib/accounting/gl'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation'
import { cancelJournalEntrySchema } from '@/lib/validation/schemas/accounting'
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

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const tenantId = session!.user.tenantId

    const parsed = await validateBody(request, cancelJournalEntrySchema)
    if (!parsed.success) return parsed.response
    const { cancellationReason } = parsed.data

    const quotaError = await requireQuota(tenantId, 'essential')
    if (quotaError) return quotaError

    return await withTenant(tenantId, async (db) => {
      const result = await db.transaction(async (tx) => {
        const [entry] = await tx
          .select()
          .from(journalEntries)
          .where(eq(journalEntries.id, id))
          .for('update')

        if (!entry) throw new Error('NOT_FOUND')
        if (entry.status !== 'submitted') throw new Error('INVALID_STATUS')

        // Reverse GL entries
        await reverseGLEntries(tx, tenantId, 'journal_entry', id)

        // Update status to cancelled
        const [updated] = await tx.update(journalEntries)
          .set({
            status: 'cancelled',
            cancelledAt: new Date(),
            cancelledBy: session!.user.id,
            cancellationReason: cancellationReason || null,
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
      return NextResponse.json({ error: 'Only submitted entries can be cancelled' }, { status: 400 })
    }
    logError('api/accounting/journal-entries/[id]/cancel', error)
    return NextResponse.json({ error: 'Failed to cancel journal entry' }, { status: 500 })
  }
}
