import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { withoutTenant } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { z } from 'zod'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  try {
    const session = await auth()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, z.object({ accountId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { accountId } = paramsParsed.data

    // Verify the accountId belongs to the current user
    if (session.user.accountId && session.user.accountId !== accountId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await withoutTenant(async (db) => {
      return db.query.accounts.findFirst({
        where: eq(accounts.id, accountId),
        columns: { currency: true },
      })
    })

    if (!result) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    return NextResponse.json({ currency: result.currency })
  } catch (error) {
    logError('api/accounts/[accountId]/currency', error)
    return NextResponse.json({ error: 'Failed to fetch account currency' }, { status: 500 })
  }
}
