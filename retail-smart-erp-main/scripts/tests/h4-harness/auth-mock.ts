/**
 * Test-only replacement for `@/lib/auth` (mapped via scripts/tests/h4-harness/tsconfig.json).
 * Like the w8 harness, plus the H4 API-key principal hook of the real authWithCompany():
 * inside a /api/v1 request (runWithApiPrincipal) the API key's principal wins.
 */
import type { CompanySession } from '../../../src/lib/auth/index'
import { getApiKeyPrincipal } from '../../../src/lib/auth/api-key-context'

export type { CompanySession }
export { resolveUserId, resolveUserIdRequired } from '../../../src/lib/auth/resolve-user'

let current: CompanySession | null = null

export function setTestSession(session: CompanySession | null): void {
  current = session
}

export async function authWithCompany(): Promise<CompanySession | null> {
  const principal = getApiKeyPrincipal()
  if (principal) return principal.session
  return current
}

export async function auth(): Promise<CompanySession | null> {
  return current
}
