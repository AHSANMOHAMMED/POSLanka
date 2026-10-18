import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { systemSettings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'

// GET /api/system/announcement - Get current system announcement (public)
export async function GET() {
  try {
    const setting = await db.query.systemSettings.findFirst({
      where: eq(systemSettings.key, 'system_announcement'),
    })

    if (!setting || !setting.value) {
      return NextResponse.json({ enabled: false })
    }

    const announcement = setting.value as {
      enabled: boolean
      message: string
      type: 'info' | 'warning' | 'error'
    }

    if (!announcement.enabled || !announcement.message) {
      return NextResponse.json({ enabled: false })
    }

    return NextResponse.json(announcement)
  } catch (error) {
    logError('api/system/announcement', error)
    return NextResponse.json({ enabled: false })
  }
}
