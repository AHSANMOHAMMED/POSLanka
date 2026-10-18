import { NextRequest, NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import crypto from 'crypto'
import { logError } from '@/lib/ai/error-logger'
import { uploadToR2, deleteFromR2, keyFromUrl } from '@/lib/files'

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
const MAX_SIZE = 2 * 1024 * 1024 // 2MB

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('avatar') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Allowed: PNG, JPEG, WebP' }, { status: 400 })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum 2MB' }, { status: 400 })
    }

    const accountId = session.user.accountId
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12)
    const ext = file.name.split('.').pop() || 'png'

    // Delete old avatar from R2 if exists
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
      columns: { avatarUrl: true }
    })

    if (account?.avatarUrl) {
      const oldKey = keyFromUrl(account.avatarUrl)
      if (oldKey) {
        try { await deleteFromR2(oldKey) } catch { /* ignore */ }
      }
    }

    const r2Key = `avatars/${hash}.${ext}`
    const avatarUrl = await uploadToR2(r2Key, buffer, file.type)

    await db.update(accounts)
      .set({ avatarUrl, updatedAt: new Date() })
      .where(eq(accounts.id, accountId))

    return NextResponse.json({ avatarUrl })
  } catch (error) {
    logError('api/account/avatar', error)
    return NextResponse.json({ error: 'Failed to upload avatar' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = session.user.accountId

    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, accountId),
      columns: { avatarUrl: true }
    })

    if (account?.avatarUrl) {
      const key = keyFromUrl(account.avatarUrl)
      if (key) {
        try { await deleteFromR2(key) } catch { /* ignore */ }
      }
    }

    await db.update(accounts)
      .set({ avatarUrl: null, updatedAt: new Date() })
      .where(eq(accounts.id, accountId))

    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/account/avatar', error)
    return NextResponse.json({ error: 'Failed to remove avatar' }, { status: 500 })
  }
}
