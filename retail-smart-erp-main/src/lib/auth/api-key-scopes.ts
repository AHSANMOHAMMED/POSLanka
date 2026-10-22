// H4: API key scopes (client-safe; the settings page imports this, lib/auth/api-keys re-exports it).
export const API_SCOPES = [
  'items:read',
  'stock:read',
  'customers:read',
  'customers:write',
  'sales:read',
  'sales:write',
] as const
export type ApiScope = (typeof API_SCOPES)[number]

export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  'items:read': 'Read items & prices',
  'stock:read': 'Read stock levels',
  'customers:read': 'Read customers',
  'customers:write': 'Create customers',
  'sales:read': 'Read sales',
  'sales:write': 'Create sales',
}
