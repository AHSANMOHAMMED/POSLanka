/**
 * H4: request-scoped principal for API-key requests (/api/v1).
 *
 * A v1 handler authenticates the API key, then runs an existing route handler (e.g. POST /api/sales)
 * inside runWithApiPrincipal(). authWithCompany() returns this principal when one is set for the
 * current async context, so the existing route logic runs unchanged with the key's permissions.
 * Nothing sets a principal outside /api/v1, so cookie/mobile session behaviour is untouched.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { CompanySession } from './index'

export interface ApiKeyPrincipal {
  session: CompanySession
  apiKeyId: string
  apiKeyName: string
  scopes: string[]
}

const store = new AsyncLocalStorage<ApiKeyPrincipal>()

export function runWithApiPrincipal<T>(principal: ApiKeyPrincipal, fn: () => Promise<T>): Promise<T> {
  return store.run(principal, fn)
}

/** The API-key principal of the current request, if the request came through /api/v1. */
export function getApiKeyPrincipal(): ApiKeyPrincipal | undefined {
  return store.getStore()
}
