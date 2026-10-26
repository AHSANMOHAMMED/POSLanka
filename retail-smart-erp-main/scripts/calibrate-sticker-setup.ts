/**
 * Calibrate the tenant sticker setup: make the single 38 x 25 roll (1 across)
 * the tenant default and persist it in the `label_settings` settings row
 * (same row the PUT /api/label-settings/sticker-setups endpoint writes).
 *
 * - Keeps every other saved setup (twin / triple, calibration offsets) but
 *   selects only the single roll as default.
 * - Creates the single setup from the built-in preset when the tenant has none.
 * - Run: npx tsx scripts/calibrate-sticker-setup.ts [--tenant <slug|uuid>] [--dry-run]
 */
import dotenv from 'dotenv'
import pg from 'pg'
import { pgConnectionConfig } from '../src/lib/db/pg-connection'
import {
  sanitizeStickerSetups,
  setupFromPreset,
  stickerRollWidthMm,
  STICKER_PRESETS,
  type StickerSetup,
} from '../src/lib/labels/sticker-stock'

dotenv.config({ path: '.env.local' })
dotenv.config()

const { Pool } = pg

const LABEL_SETTINGS_KEY = 'label_settings'

// Raw pool (owner) on purpose: wholesale settings maintenance, RLS tenant-scoping
// is not useful when we iterate all tenants.
const pool = new Pool(pgConnectionConfig(process.env.DATABASE_URL))

function parseStored(value: string | null | undefined): Record<string, unknown> {
  try {
    const v = value ? JSON.parse(value) : {}
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const idx = args.indexOf('--tenant')
  const tenantArg = idx >= 0 ? args[idx + 1] : undefined

  const tenantsResult = tenantArg
    ? await pool.query(`SELECT id, slug, name FROM tenants WHERE slug = $1 OR id::text = $1`, [tenantArg])
    : await pool.query(`SELECT id, slug, name FROM tenants ORDER BY created_at ASC`)
  const tenants = tenantsResult.rows as Array<{ id: string; slug: string; name: string }>
  if (tenants.length === 0) {
    console.error('No matching tenant found')
    process.exit(1)
  }

  for (const tenant of tenants) {
    const rowRes = await pool.query(
      `SELECT id, value FROM settings WHERE tenant_id = $1 AND key = $2`,
      [tenant.id, LABEL_SETTINGS_KEY]
    )
    const row = rowRes.rows[0] as { id: string; value: string | null } | undefined
    const stored = parseStored(row?.value)
    const storedCodeWord = typeof stored.codeWord === 'string' ? stored.codeWord : ''
    let list = sanitizeStickerSetups(stored.stickerSetups)

    // Add the single 38x25 preset when the tenant has no single-across 38x25 yet
    const hasSingle = list.some(
      (s) => s.id === '38x25x1' || (s.labelWidthMm === 38 && s.labelHeightMm === 25 && s.columns === 1)
    )
    if (!hasSingle) {
      const preset = STICKER_PRESETS.find((p) => p.id === '38x25x1')!
      list = [...list, setupFromPreset(preset, { id: '38x25x1' })]
    }

    // Select the single roll as the one and only default
    const next: StickerSetup[] = list.map((s) => ({ ...s, isDefault: s.id === '38x25x1' || (s.labelWidthMm === 38 && s.labelHeightMm === 25 && s.columns === 1) }))

    const before = sanitizeStickerSetups(stored.stickerSetups)
    const defaultBefore = before.find((s) => s.isDefault)
    const defaultAfter = next.find((s) => s.isDefault)
    console.log(`Tenant ${tenant.slug} (${tenant.name})`)
    console.log(`  setups: ${before.length} → ${next.length}`)
    console.log(`  default: ${defaultBefore ? `${defaultBefore.name} (${defaultBefore.columns} across)` : '(none)'} → ${defaultAfter ? `${defaultAfter.name} (${defaultAfter.columns} across, roll ${stickerRollWidthMm(defaultAfter)} mm)` : '(none)'}`)
    for (const s of next) {
      console.log(`   - ${s.columns} across, ${s.labelWidthMm}x${s.labelHeightMm}, roll ${stickerRollWidthMm(s)} mm${s.isDefault ? ' ★ default' : ''}${s.locked ? ' 🔒' : ''}`)
    }

    if (dryRun) continue
    const value = JSON.stringify({ ...stored, codeWord: storedCodeWord, stickerSetups: next })
    if (row) {
      await pool.query(`UPDATE settings SET value = $2, updated_at = now() WHERE id = $1`, [row.id, value])
    } else {
      await pool.query(
        `INSERT INTO settings (tenant_id, key, value, type) VALUES ($1, $2, $3, 'json')`,
        [tenant.id, LABEL_SETTINGS_KEY, value]
      )
    }
    console.log('  persisted ✔')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => pool.end())
