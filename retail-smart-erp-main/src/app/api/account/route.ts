import { NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { and, eq, ne } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { updateAccountSchema } from '@/lib/validation/schemas/account'

// GET /api/account - Get account profile
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

    // Don't return password hash
    const { passwordHash: _passwordHash, ...safeAccount } = account

    return NextResponse.json(safeAccount)
  } catch (error) {
    logError('api/account', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/account - Update account profile
export async function PUT(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, updateAccountSchema)
    if (!parsed.success) return parsed.response
    const { fullName, phone } = parsed.data

    // Check phone uniqueness if changing
    if (phone) {
      const existingWithPhone = await db.query.accounts.findFirst({
        where: and(
          eq(accounts.phone, phone),
          ne(accounts.id, session.user.accountId),
        ),
      })
      if (existingWithPhone) {
        return NextResponse.json(
          { error: 'This mobile number is already registered to another account' },
          { status: 400 }
        )
      }
    }

    const [updated] = await db.update(accounts)
      .set({
        fullName: fullName.trim(),
        phone: phone || undefined,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, session.user.accountId))
      .returning()

    if (!updated) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const { passwordHash: _passwordHash, ...safeAccount } = updated

    return NextResponse.json(safeAccount)
  } catch (error) {
    logError('api/account', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
