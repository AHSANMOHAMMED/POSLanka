/**
 * Migrate existing attachment data to the unified files table.
 *
 * Idempotent: safe to re-run. Skips rows that already exist based on
 * contentHash + attachedToType + attachedToId.
 *
 * Usage: npx tsx scripts/migrate-files-to-unified.ts
 */

import { Client } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/retail_smart_pos'

async function main() {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  console.log('Connected to database')

  let totalMigrated = 0
  let totalSkipped = 0

  // ==================== 1. Migrate insurance_estimate_attachments → files ====================
  console.log('\n--- Migrating insurance estimate attachments ---')

  const attachmentsResult = await client.query(`
    SELECT a.*, t.slug as tenant_slug
    FROM insurance_estimate_attachments a
    JOIN tenants t ON a.tenant_id = t.id
    ORDER BY a.created_at ASC
  `)

  for (const att of attachmentsResult.rows) {
    // Check if already migrated
    const existing = await client.query(`
      SELECT id FROM files
      WHERE tenant_id = $1
        AND attached_to_type = 'estimate'
        AND attached_to_id = $2
        AND content_hash = $3
    `, [att.tenant_id, att.estimate_id, att.file_hash])

    if (existing.rows.length > 0) {
      totalSkipped++
      continue
    }

    await client.query(`
      INSERT INTO files (
        tenant_id, file_name, file_url, file_size, file_type, content_hash,
        is_private, is_folder, attached_to_type, attached_to_id,
        category, description, uploaded_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, false, false, 'estimate', $7, $8, $9, $10, $11, $11)
    `, [
      att.tenant_id,
      att.file_name,
      att.file_path,
      att.file_size,
      att.file_type,
      att.file_hash,
      att.estimate_id,
      att.category,
      att.description,
      att.uploaded_by,
      att.created_at,
    ])

    totalMigrated++
  }

  console.log(`  Attachments: ${totalMigrated} migrated, ${totalSkipped} skipped`)

  // ==================== 2. Migrate inspection_photos → files ====================
  console.log('\n--- Migrating inspection photos ---')
  let photosMigrated = 0
  let photosSkipped = 0

  const photosResult = await client.query(`
    SELECT p.*, vi.work_order_id, wo.tenant_id, t.slug as tenant_slug
    FROM inspection_photos p
    JOIN vehicle_inspections vi ON p.inspection_id = vi.id
    JOIN work_orders wo ON vi.work_order_id = wo.id
    JOIN tenants t ON wo.tenant_id = t.id
    ORDER BY p.created_at ASC
  `)

  for (const photo of photosResult.rows) {
    // Check if already linked via file_id
    if (photo.file_id) {
      photosSkipped++
      continue
    }

    // Check if already migrated by URL match
    const existing = await client.query(`
      SELECT id FROM files
      WHERE tenant_id = $1
        AND attached_to_type = 'inspection'
        AND attached_to_id = $2
        AND file_url = $3
    `, [photo.tenant_id, photo.inspection_id, photo.photo_url])

    if (existing.rows.length > 0) {
      // Link the existing file record
      await client.query(`
        UPDATE inspection_photos SET file_id = $1 WHERE id = $2
      `, [existing.rows[0].id, photo.id])
      photosSkipped++
      continue
    }

    // Guess file type from URL
    const ext = photo.photo_url.split('.').pop()?.toLowerCase() || 'jpg'
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
    }
    const fileType = mimeMap[ext] || 'image/jpeg'

    // Insert into files
    const insertResult = await client.query(`
      INSERT INTO files (
        tenant_id, file_name, file_url, file_type,
        is_private, is_folder, attached_to_type, attached_to_id,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, false, false, 'inspection', $5, $6, $6)
      RETURNING id
    `, [
      photo.tenant_id,
      photo.photo_url.split('/').pop() || 'photo.jpg',
      photo.photo_url,
      fileType,
      photo.inspection_id,
      photo.created_at,
    ])

    // Link back to inspection_photos
    await client.query(`
      UPDATE inspection_photos SET file_id = $1 WHERE id = $2
    `, [insertResult.rows[0].id, photo.id])

    photosMigrated++
  }

  console.log(`  Photos: ${photosMigrated} migrated, ${photosSkipped} skipped`)

  // ==================== 3. Migrate vehicle_type_diagram_views → files ====================
  console.log('\n--- Migrating vehicle type diagrams ---')
  let diagramsMigrated = 0
  let diagramsSkipped = 0

  const diagramsResult = await client.query(`
    SELECT dv.*, vt.tenant_id, COALESCE(t.slug, 'system') as tenant_slug
    FROM vehicle_type_diagram_views dv
    JOIN vehicle_types vt ON dv.vehicle_type_id = vt.id
    LEFT JOIN tenants t ON vt.tenant_id = t.id
    WHERE dv.image_url IS NOT NULL AND dv.image_url != ''
    ORDER BY dv.id ASC
  `)

  for (const diagram of diagramsResult.rows) {
    if (!diagram.tenant_id) {
      diagramsSkipped++ // Skip system defaults without tenant
      continue
    }

    // Check if already migrated
    const existing = await client.query(`
      SELECT id FROM files
      WHERE tenant_id = $1
        AND attached_to_type = 'vehicle-type'
        AND attached_to_id = $2
        AND attached_to_field = 'diagram'
    `, [diagram.tenant_id, diagram.vehicle_type_id])

    if (existing.rows.length > 0) {
      diagramsSkipped++
      continue
    }

    const ext = diagram.image_url.split('.').pop()?.toLowerCase() || 'png'
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
    }
    const fileType = mimeMap[ext] || 'image/png'

    await client.query(`
      INSERT INTO files (
        tenant_id, file_name, file_url, file_type,
        is_private, is_folder, attached_to_type, attached_to_id, attached_to_field,
        image_width, image_height, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, false, false, 'vehicle-type', $5, 'diagram', $6, $7, now(), now())
    `, [
      diagram.tenant_id,
      diagram.image_url.split('/').pop() || 'diagram.png',
      diagram.image_url,
      fileType,
      diagram.vehicle_type_id,
      diagram.image_width,
      diagram.image_height,
    ])

    diagramsMigrated++
  }

  console.log(`  Diagrams: ${diagramsMigrated} migrated, ${diagramsSkipped} skipped`)

  // ==================== Summary ====================
  console.log('\n=== Migration Summary ===')
  console.log(`Total migrated: ${totalMigrated + photosMigrated + diagramsMigrated}`)
  console.log(`Total skipped:  ${totalSkipped + photosSkipped + diagramsSkipped}`)

  await client.end()
  console.log('\nDone.')
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
