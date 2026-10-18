import { NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { systemSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get bank details from system settings
    const setting = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, 'bank_details'),
    })

    return NextResponse.json({
      value: setting?.value || null,
    })
  } catch (error) {
    logError('api/account/bank-details', error)
    return NextResponse.json({ error: 'Failed to fetch bank details' }, { status: 500 })
  }
}
