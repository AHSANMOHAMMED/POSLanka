#!/usr/bin/env node
/**
 * W10 tenant isolation guard.
 *
 * Static checks — every public table that has a tenant_id column must have:
 *   - row level security enabled,
 *   - at least one policy that applies to the app role (PUBLIC or the role itself),
 *   - every such policy referencing app.tenant_id (in USING or WITH CHECK),
 *   - tenant_id NOT NULL — unless the table is in one of the documented categories below.
 *
 * Behavioural probe — inside a rolled-back transaction the script switches to the app role
 * with a random, non-existent app.tenant_id and verifies that no tenant rows (and, outside
 * GLOBAL_TENANT_TABLES, no rows at all) are visible. Skipped with a warning when the
 * connecting user cannot SET ROLE to the app role.
 *
 * Usage: DATABASE_URL=... [DATABASE_APP_ROLE=app_user] node scripts/check-tenant-isolation.mjs
 *        npm run db:check-isolation
 * Exit code: 0 = OK, 1 = violations found, 2 = could not run.
 * Emergency escape hatch (avoid): TENANT_ISOLATION_ALLOW="table_a,table_b" skips tables entirely.
 */
import 'dotenv/config'
import pg from 'pg'
import { pgConnectionConfig } from './pg-connection.mjs'


/**
 * "global+tenant" tables: tenant_id IS NULL marks a system default shared by all companies.
 * Required: a SELECT-capable app policy exposing `tenant_id IS NULL`, and NO write-capable
 * (ALL/INSERT/UPDATE/DELETE) app policy that mentions `tenant_id IS NULL` (global rows are
 * read-only for tenant code; they are written by seeding / super admin via the plain db).
 */
const GLOBAL_TENANT_TABLES = new Set([
  'vehicle_types',
  'vehicle_type_diagram_views',
  'inspection_templates',
  'inspection_categories',
  'inspection_checklist_items',
])

/**
 * Account-level tables: tenant_id IS NULL marks a row that belongs to an account, a super
 * admin or the platform (system error logs, account-scope sessions, account/super-admin push
 * devices). Those rows must be invisible to tenant code: no app policy may mention
 * `tenant_id IS NULL`.
 */
const ACCOUNT_LEVEL_NULLABLE_TABLES = new Set([
  'account_sessions',
  'user_devices',
  'ai_error_logs',
])

const rawUrl = process.env.DATABASE_URL
if (!rawUrl) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}
const url = rawUrl.replace('-pooler.', '.')

const appRole = process.env.DATABASE_APP_ROLE || 'app_user'
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(appRole)) {
  console.error(`Invalid DATABASE_APP_ROLE "${appRole}"`)
  process.exit(2)
}
const allow = new Set((process.env.TENANT_ISOLATION_ALLOW || '').split(',').map((s) => s.trim()).filter(Boolean))

const NULL_TENANT_RE = /\btenant_id IS NULL\b/i
const TENANT_SETTING_RE = /app\.tenant_id/

const client = new pg.Client(pgConnectionConfig(url))

try {
  await client.connect()
  const { rows } = await client.query(
    `
    SELECT c.relname AS table_name,
           c.relrowsecurity AS rls_enabled,
           a.attnotnull AS tenant_not_null,
           COALESCE((
             SELECT json_agg(json_build_object(
                      'name', p.polname,
                      'cmd', p.polcmd,
                      'qual', pg_get_expr(p.polqual, p.polrelid),
                      'check', pg_get_expr(p.polwithcheck, p.polrelid)))
             FROM pg_policy p
             WHERE p.polrelid = c.oid
               AND (p.polroles = '{0}'::oid[]
                    OR EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname = $1 AND r.oid = ANY (p.polroles)))
           ), '[]'::json) AS app_policies
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
    `,
    [appRole],
  )

  const offenders = new Map()
  const flag = (table, problem) => {
    if (!offenders.has(table)) offenders.set(table, [])
    offenders.get(table).push(problem)
  }

  for (const r of rows) {
    const t = r.table_name
    if (allow.has(t)) continue
    const policies = r.app_policies
    const isGlobal = GLOBAL_TENANT_TABLES.has(t)
    const isAccountLevel = ACCOUNT_LEVEL_NULLABLE_TABLES.has(t)

    if (!r.rls_enabled) flag(t, 'RLS disabled')
    if (policies.length === 0) flag(t, `no policy for ${appRole}`)
    if (!r.tenant_not_null && !isGlobal && !isAccountLevel) flag(t, 'tenant_id nullable')

    // Policies that exclude the app role (current_user <> 'app_user') never apply to vendor
    // requests; they give the login role (platform code) access on managed databases where
    // BYPASSRLS is unavailable (migration 0147). Every RLS table needs one.
    const excludesApp = (p) => new RegExp(`current_user\\s*<>\\s*'${appRole}'(::\\w+)?`, 'i').test(`${p.qual || ''}`)
    if (r.rls_enabled && !policies.some(excludesApp)) flag(t, 'no platform_login_access policy (platform code sees no rows without BYPASSRLS)')

    for (const p of policies) {
      const fullText = `${p.qual || ''} ${p.check || ''}`
      // current_setting(...)::uuid must be guarded: pooled connections return '' after a
      // tenant transaction, and ''::uuid raises on managed databases (migration 0148)
      if (/current_setting\('app\.tenant_id'/i.test(fullText.replace(/NULLIF\(current_setting\('app\.tenant_id'[^)]*\)[^)]*\)/gi, ''))) {
        flag(t, `policy ${p.name} casts app.tenant_id without NULLIF (fails on reused connections)`)
      }
      if (excludesApp(p)) continue
      const text = `${p.qual || ''} ${p.check || ''}`
      const exposesGlobal = NULL_TENANT_RE.test(text)
      if (exposesGlobal) {
        if (!isGlobal) flag(t, `policy ${p.name} exposes tenant_id IS NULL rows`)
        else if (p.cmd !== 'r') flag(t, `policy ${p.name} lets tenants write global (tenant_id IS NULL) rows`)
      }
      // A read-only global-rows policy (`tenant_id IS NULL`) needs no tenant reference.
      const globalReadOnly = isGlobal && p.cmd === 'r' && exposesGlobal
      if (!globalReadOnly && !TENANT_SETTING_RE.test(text)) flag(t, `policy ${p.name} does not reference app.tenant_id`)
    }
    if (isGlobal && !policies.some((p) => (p.cmd === 'r' || p.cmd === '*') && NULL_TENANT_RE.test(p.qual || ''))) {
      flag(t, 'global+tenant table has no read policy for global (tenant_id IS NULL) rows')
    }
  }

  // ---- behavioural probe as the app role ----
  let probed = 0
  const canSwitch = await client.query('SELECT pg_has_role(current_user, $1, \'MEMBER\') AS ok', [appRole])
    .then((r) => r.rows[0]?.ok === true)
    .catch(() => false)
  if (!canSwitch) {
    console.warn(`WARN: the connecting user cannot SET ROLE ${appRole}; behavioural probe skipped.`)
  } else {
    await client.query('BEGIN')
    try {
      await client.query(`SELECT set_config('app.tenant_id', gen_random_uuid()::text, true)`)
      await client.query(`SET LOCAL ROLE ${appRole}`)
      for (const r of rows) {
        const t = r.table_name
        if (allow.has(t)) continue
        await client.query('SAVEPOINT probe')
        try {
          const where = GLOBAL_TENANT_TABLES.has(t) ? 'WHERE tenant_id IS NOT NULL' : ''
          const res = await client.query(`SELECT EXISTS (SELECT 1 FROM "${t}" ${where}) AS leak`)
          if (res.rows[0].leak) flag(t, `${appRole} with a foreign app.tenant_id can see rows`)
          probed++
          await client.query('RELEASE SAVEPOINT probe')
        } catch (err) {
          await client.query('ROLLBACK TO SAVEPOINT probe')
          if (err && err.code === '42501') continue // no SELECT privilege: nothing visible
          flag(t, `probe failed: ${err instanceof Error ? err.message : err}`)
        }
      }
    } finally {
      await client.query('ROLLBACK')
    }
  }

  console.log(`Checked ${rows.length} tenant tables (app role: ${appRole}; probed ${probed}).`)
  console.log(`  global+tenant: ${[...GLOBAL_TENANT_TABLES].join(', ')}`)
  console.log(`  account-level nullable: ${[...ACCOUNT_LEVEL_NULLABLE_TABLES].join(', ')}`)
  if (allow.size) console.log(`  skipped via TENANT_ISOLATION_ALLOW: ${[...allow].join(', ')}`)
  if (offenders.size === 0) {
    console.log('OK: every tenant table has RLS, tenant-scoped app policies and NOT NULL tenant_id (or a documented global/account-level exception).')
    process.exit(0)
  }
  console.error(`FAIL: ${offenders.size} table(s) violate tenant isolation:`)
  for (const [t, problems] of offenders) console.error(`  - ${t}: ${problems.join(', ')}`)
  process.exit(1)
} catch (err) {
  console.error('check-tenant-isolation failed:', err instanceof Error ? err.message : err)
  process.exit(2)
} finally {
  await client.end().catch(() => {})
}
