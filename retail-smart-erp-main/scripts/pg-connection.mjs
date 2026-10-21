/**
 * PostgreSQL connection options shared by the app and the CLI scripts (keep in sync with
 * src/lib/db/pg-connection.ts).
 *
 *   DATABASE_SSL      disable | no-verify | verify   (optional)
 *   DATABASE_CA_CERT  PEM of the server CA (DigitalOcean: "Download CA certificate").
 *                     Newlines may be written as \n. When set, the certificate is verified.
 *
 * Managed databases (DigitalOcean, Railway, Neon, Supabase, RDS…) are detected from the host or
 * from `sslmode=` in the URL. `sslmode` is removed from the URL because node-postgres lets the
 * URL override the explicit `ssl` option.
 */
const MANAGED_HOST = /ondigitalocean\.com|railway|render\.com|neon\.tech|supabase|amazonaws\.com/i

export function pgConnectionConfig(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is required')
  const mode = (process.env.DATABASE_SSL || '').toLowerCase()
  const ca = (process.env.DATABASE_CA_CERT || '').replace(/\\n/g, '\n').trim()
  let parsed
  try { parsed = new URL(url) } catch { return { connectionString: url } }
  const sslmode = (parsed.searchParams.get('sslmode') || '').toLowerCase()
  if (mode === 'disable' || sslmode === 'disable') {
    parsed.searchParams.delete('sslmode')
    return { connectionString: parsed.toString(), ssl: false }
  }
  const wantsSsl = mode === 'no-verify' || mode === 'verify' || !!ca
    || ['require', 'verify-ca', 'verify-full', 'prefer'].includes(sslmode) || MANAGED_HOST.test(parsed.hostname)
  if (!wantsSsl) return { connectionString: url }
  for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslaccept']) parsed.searchParams.delete(k)
  const ssl = ca
    ? { ca, rejectUnauthorized: true }
    : { rejectUnauthorized: mode === 'verify' || sslmode === 'verify-full' || sslmode === 'verify-ca' }
  return { connectionString: parsed.toString(), ssl }
}
