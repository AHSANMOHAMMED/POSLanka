import { NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { accounts, creditTransactions } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

// GET /api/account/wallet - Get wallet balance and transactions
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, session.user.accountId),
    })

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // Fetch recent transactions - handle case where table might not exist
    let transactions: Array<{
      id: string
      type: string
      amount: number
      description: string
      createdAt: string
      balanceAfter: number
    }> = []

    try {
      const txData = await db.query.creditTransactions.findMany({
        where: eq(creditTransactions.accountId, session.user.accountId),
        orderBy: [desc(creditTransactions.createdAt)],
        limit: 50,
      })

      transactions = txData.map(tx => ({
        id: tx.id,
        type: tx.type,
        amount: Number(tx.amount),
        description: tx.description,
        createdAt: tx.createdAt.toISOString(),
        balanceAfter: Number(tx.balanceAfter),
      }))
    } catch (txError) {
      // If creditTransactions table doesn't exist, return empty transactions
      console.warn('Failed to fetch credit transactions:', txError)
    }

    return NextResponse.json({
      balance: Number(account.walletBalance) || 0,
      currency: account.currency || 'LKR',
      transactions,
    })
  } catch (error) {
    logError('api/account/wallet', error)
    return NextResponse.json({ error: 'Failed to fetch wallet' }, { status: 500 })
  }
}
