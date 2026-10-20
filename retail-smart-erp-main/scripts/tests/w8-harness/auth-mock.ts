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
  return current
}

export async function auth(): Promise<CompanySession | null> {
  return current
}
