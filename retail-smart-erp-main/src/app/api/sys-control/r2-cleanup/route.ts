import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tenants, files } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import { withRateLimit, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { listByPrefix, deleteManyFromR2, keyFromUrl } from '@/lib/files/r2'
import { validateBody } from '@/lib/validation/helpers'
import { sysR2CleanupSchema } from '@/lib/validation/schemas/sys-control'

// GET - Analyze orphaned R2 files (dry run)
export async function GET() {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/r2-cleanup')
    if (rateLimited) return rateLimited

    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get all tenant slugs
    const allTenants = await db.select({ id: tenants.id, slug: tenants.slug }).from(tenants)
    const _tenantSlugs = new Set(allTenants.map(t => t.slug))

    // Get all file URLs from the database
    const allFiles = await db.select({ fileUrl: files.fileUrl }).from(files)
    const dbKeys = new Set<string>()
    for (const f of allFiles) {
      if (f.fileUrl) {
        const key = keyFromUrl(f.fileUrl)
        if (key) dbKeys.add(key)
      }
    }

    // Also check tenant logos and user avatars
    const [{ count: _totalR2 }] = await db.execute(sql`
      SELECT COUNT(*) as count FROM (
        SELECT logo_url as url FROM tenants WHERE logo_url IS NOT NULL
        UNION ALL
        SELECT avatar_url as url FROM accounts WHERE avatar_url IS NOT NULL
      ) t
    `) as any // eslint-disable-line @typescript-eslint/no-explicit-any

    // List all R2 objects
    const allR2Keys = await listByPrefix('')
    const orphanedKeys: string[] = []
    const activeKeys: string[] = []

    for (const key of allR2Keys) {
      if (dbKeys.has(key)) {
        activeKeys.push(key)
      } else {
        // Check if it belongs to a known tenant (might be a logo/avatar)
        orphanedKeys.push(key)
      }
    }

    // Group orphans by tenant prefix
    const orphansByPrefix: Record<string, number> = {}
    for (const key of orphanedKeys) {
      const prefix = key.split('/')[0] || 'unknown'
      orphansByPrefix[prefix] = (orphansByPrefix[prefix] || 0) + 1
    }

    return NextResponse.json({
      summary: {
        totalR2Objects: allR2Keys.length,
        activeDbReferences: activeKeys.length,
        orphanedObjects: orphanedKeys.length,
        knownTenants: allTenants.length,
        dbFileRecords: allFiles.length,
      },
      orphansByPrefix,
      orphanedKeys: orphanedKeys.slice(0, 100), // Return first 100 for preview
    })
  } catch (error) {
    logError('api/sys-control/r2-cleanup GET', error)
    return NextResponse.json({ error: 'Failed to analyze R2 storage' }, { status: 500 })
  }
}

// POST - Delete orphaned R2 files
export async function POST(request: NextRequest) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/r2-cleanup')
    if (rateLimited) return rateLimited

    const session = await validateAdminSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, sysR2CleanupSchema)
    if (!parsed.success) return parsed.response
    const { prefix } = parsed.data

    // Get all file URLs from DB to know which keys are still referenced
    const allFiles = await db.select({ fileUrl: files.fileUrl }).from(files)
    const dbKeys = new Set<string>()
    for (const f of allFiles) {
      if (f.fileUrl) {
        const key = keyFromUrl(f.fileUrl)
        if (key) dbKeys.add(key)
      }
    }

    // Also add tenant logo and account avatar URLs
    const logoRows = await db.execute(sql`
      SELECT logo_url as url FROM tenants WHERE logo_url IS NOT NULL
      UNION ALL
      SELECT avatar_url as url FROM accounts WHERE avatar_url IS NOT NULL
    `) as any // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const row of logoRows.rows || logoRows) {
      if (row.url) {
        const key = keyFromUrl(row.url)
        if (key) dbKeys.add(key)
      }
    }

    // List R2 objects (optionally filtered by prefix)
    const r2Keys = await listByPrefix(prefix || '')

    // Find orphans (in R2 but not in DB)
    const orphanedKeys = r2Keys.filter(key => !dbKeys.has(key))

    if (orphanedKeys.length === 0) {
      return NextResponse.json({ message: 'No orphaned files found', deleted: 0 })
    }

    // Delete orphans
    const deleted = await deleteManyFromR2(orphanedKeys)

    console.log(`[R2 Cleanup] Deleted ${deleted}/${orphanedKeys.length} orphaned files${prefix ? ` (prefix: ${prefix})` : ''}`)

    return NextResponse.json({
      message: `Deleted ${deleted} orphaned files from R2`,
      deleted,
      total: orphanedKeys.length,
      prefix: prefix || '(all)',
    })
  } catch (error) {
    logError('api/sys-control/r2-cleanup POST', error)
    return NextResponse.json({ error: 'Failed to clean up R2 storage' }, { status: 500 })
  }
}
