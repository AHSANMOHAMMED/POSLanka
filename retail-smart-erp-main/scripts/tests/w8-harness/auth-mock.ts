/**
 * Test-only replacement for `@/lib/auth` (mapped via scripts/tests/w8-harness/tsconfig.json).
 * Lets integration tests call Next.js route handlers directly with a fixed session.
 */
import type { CompanySession } from '../../../src/lib/auth/index'

export type { CompanySession }
export { resolveUserId, resolveUserIdRequired } from '../../../src/lib/auth/resolve-user'

let current: CompanySession | null = null

export function setTestSession(session: CompanySession | null): void {
  current = session
}

export async function authWithCompany(): Promise<CompanySession | null> {
  // Same as the real authWithCompany(): a request principal installed by runWithApiPrincipal()
  // (/api/v1 and internal system runs such as recurring invoices) wins over the cookie session.
  // Read the cookie session BEFORE any await: tests set it right before each concurrent call.
  const session = current
  const { getApiKeyPrincipal } = await import('../../../src/lib/auth/api-key-context')
  const principal = getApiKeyPrincipal()
  if (principal) return principal.session
  return session
}

export async function auth(): Promise<CompanySession | null> {
  return current
}
