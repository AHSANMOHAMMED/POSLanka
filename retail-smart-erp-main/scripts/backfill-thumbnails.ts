/**
 * Backfill thumbnails for existing image files that don't have thumbnailUrl set.
 *
 * Usage:
 *   npx tsx scripts/backfill-thumbnails.ts
 *
 * Options:
 *   --dry-run   Show what would be processed without making changes
 *   --limit=N   Process at most N files (default: all)
 */

import { db } from '../src/lib/db'
import { files, tenants } from '../src/lib/db/schema'
import { eq, and, isNull, like, sql } from 'drizzle-orm'
import { getFromR2, keyFromUrl, uploadToR2 } from '../src/lib/files/r2'
import sharp from 'sharp'

const THUMB_MAX_WIDTH = 400
const THUMB_MAX_HEIGHT = 400
const THUMB_QUALITY = 80

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitArg = args.find(a => a.startsWith('--limit='))
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined

async function main() {
  console.log(`Backfilling thumbnails${dryRun ? ' (DRY RUN)' : ''}...`)

  // Get all tenants for slug lookup
  const allTenants = await db.query.tenants.findMany({
    columns: { id: true, slug: true },
  })
  const tenantMap = new Map(allTenants.map(t => [t.id, t.slug]))

  // Find image files without thumbnails
  const conditions = [
    isNull(files.thumbnailUrl),
    eq(files.isFolder, false),
    like(files.fileType, 'image/%'),
    sql`${files.fileType} != 'image/svg+xml'`,
  ]

  const query = db
    .select({
      id: files.id,
      fileName: files.fileName,
      fileUrl: files.fileUrl,
      fileType: files.fileType,
      isPrivate: files.isPrivate,
      tenantId: files.tenantId,
      contentHash: files.contentHash,
    })
    .from(files)
    .where(and(...conditions))
    .orderBy(files.createdAt)

  const pending = limit ? await query.limit(limit) : await query

  console.log(`Found ${pending.length} image files without thumbnails`)

  let processed = 0
  let failed = 0

  for (const file of pending) {
    const tenantSlug = tenantMap.get(file.tenantId)
    if (!tenantSlug) {
      console.log(`  SKIP ${file.fileName} — tenant ${file.tenantId} not found`)
      failed++
      continue
    }

    const key = keyFromUrl(file.fileUrl)
    if (!key) {
      console.log(`  SKIP ${file.fileName} — can't resolve R2 key from ${file.fileUrl}`)
      failed++
      continue
    }

    if (dryRun) {
      console.log(`  WOULD process: ${file.fileName} (${tenantSlug})`)
      processed++
      continue
    }

    try {
      const r2File = await getFromR2(key)
      if (!r2File) {
        console.log(`  SKIP ${file.fileName} — not found in R2`)
        failed++
        continue
      }

      const image = sharp(r2File.buffer)
      const metadata = await image.metadata()

      if (!metadata.width || !metadata.height) {
        console.log(`  SKIP ${file.fileName} — can't read image dimensions`)
        failed++
        continue
      }

      // Generate thumbnail
      const thumbBuffer = await image
        .resize(THUMB_MAX_WIDTH, THUMB_MAX_HEIGHT, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: THUMB_QUALITY, progressive: true })
        .toBuffer()

      // Build thumbnail key
      const baseName = key.replace(/\.[^.]+$/, '')
      const isPrivate = file.isPrivate
      const thumbKey = isPrivate
        ? `private/thumbnails/${tenantSlug}/${baseName.split('/').slice(2).join('/')}_thumb.jpg`
        : `thumbnails/${tenantSlug}/${baseName.split('/').slice(1).join('/')}_thumb.jpg`

      const thumbnailCdnUrl = await uploadToR2(thumbKey, thumbBuffer, 'image/jpeg')

      const thumbnailUrl = isPrivate
        ? `/storage/${thumbKey}`
        : thumbnailCdnUrl

      // Update DB
      await db
        .update(files)
        .set({
          thumbnailUrl,
          imageWidth: metadata.width,
          imageHeight: metadata.height,
        })
        .where(eq(files.id, file.id))

      processed++
      const reduction = Math.round((1 - thumbBuffer.length / r2File.buffer.length) * 100)
      console.log(`  OK ${file.fileName} — ${(r2File.buffer.length / 1024).toFixed(0)}KB → ${(thumbBuffer.length / 1024).toFixed(0)}KB (${reduction}% smaller)`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  FAIL ${file.fileName} — ${msg}`)
      failed++
    }
  }

  console.log(`\nDone: ${processed} processed, ${failed} failed`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
