/**
 * Orphaned upload detection for /sys-control/settings → Storage maintenance.
 *
 * An object is "referenced" when its key (or its public URL / /uploads/ path) appears in any
 * file-like column of the database: text/varchar/jsonb columns whose name mentions url, image,
 * logo, photo, avatar, attachment, file, path, document or receipt. Everything else in the
 * bucket is an orphan. Deletion refuses to run when no references are found at all (a broken
 * scan must never empty the bucket).
 */
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { deleteManyFromR2, keyFromUrl, listByPrefix } from '@/lib/files/r2'

const NAME_PATTERN = '(url|image|logo|photo|avatar|attachment|file|path|document|receipt|signature|key)'
const URLISH = /(https?:\/\/[^\s"'<>,]+|\/uploads\/[^\s"'<>,]+|\/storage\/private\/[^\s"'<>,]+)/g

function rows<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows) ?? (Array.isArray(res) ? (res as T[]) : [])
}

function addRefs(value: string, into: Set<string>) {
  const matches = value.match(URLISH)
  if (matches) {
    for (const m of matches) {
      const k = keyFromUrl(m.replace(/[)\].;]+$/, ''))
      if (k) into.add(k)
    }
  }
  // bare object keys stored as-is (tenant/ab/hash.png)
  const bare = value.trim()
  if (!/\s/.test(bare) && bare.includes('/') && !bare.startsWith('http') && bare.length < 512) {
    into.add(bare.replace(/^\/+/, ''))
  }
}

/** Every object key the database still points at. */
export async function collectReferencedKeys(): Promise<Set<string>> {
  const cols = rows<{ table_name: string; column_name: string; data_type: string }>(await db.execute(sql`
    SELECT c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      AND c.data_type IN ('text', 'character varying', 'jsonb', 'json', 'ARRAY')
      AND c.column_name ~* ${NAME_PATTERN}
      AND c.column_name !~* '(hash|token|secret|idempotency|api_key|group_key|dedupe)'
  `))
  const refs = new Set<string>()
  for (const c of cols) {
    const t = `"${c.table_name.replace(/"/g, '""')}"`
    const col = `"${c.column_name.replace(/"/g, '""')}"`
    const res = await db.execute(sql.raw(`SELECT DISTINCT ${col}::text AS v FROM public.${t} WHERE ${col} IS NOT NULL LIMIT 200000`))
    for (const r of rows<{ v: string | null }>(res)) if (r.v) addRefs(r.v, refs)
  }
  return refs
}

export interface OrphanScan {
  totalObjects: number
  referencedObjects: number
  orphanedObjects: number
  referencesFound: number
  orphansByPrefix: Record<string, number>
  sample: string[]
}

export async function scanOrphans(prefix = ''): Promise<{ scan: OrphanScan; orphans: string[] }> {
  const [keys, refs] = await Promise.all([listByPrefix(prefix), collectReferencedKeys()])
  const orphans = keys.filter((k) => !refs.has(k))
  const byPrefix: Record<string, number> = {}
  for (const k of orphans) {
    const p = k.split('/')[0] || '(root)'
    byPrefix[p] = (byPrefix[p] ?? 0) + 1
  }
  return {
    orphans,
    scan: {
      totalObjects: keys.length,
      referencedObjects: keys.length - orphans.length,
      orphanedObjects: orphans.length,
      referencesFound: refs.size,
      orphansByPrefix: byPrefix,
      sample: orphans.slice(0, 50),
    },
  }
}

export async function deleteOrphans(prefix = ''): Promise<{ deleted: number; scanned: number }> {
  const { scan, orphans } = await scanOrphans(prefix)
  if (scan.referencesFound === 0 && scan.totalObjects > 0) {
    throw new Error('No file references were found in the database, so nothing was deleted.')
  }
  if (orphans.length === 0) return { deleted: 0, scanned: scan.totalObjects }
  const deleted = await deleteManyFromR2(orphans)
  return { deleted, scanned: scan.totalObjects }
}
