/**
 * Reserved slugs that cannot be used as tenant/company business codes.
 * Shared between check-slug, pending-companies, and companies routes.
 */
export const RESERVED_SLUGS = new Set([
  'www', 'app', 'api', 'admin', 'test', 'staging', 'dev',
  'mail', 'email', 'blog', 'support', 'help', 'status',
  'dashboard', 'account', 'login', 'register', 'billing',
  'pos', 'system', 'auth', 'oauth', 'webhook', 'webhooks',
  'cdn', 'assets', 'static', 'img', 'images', 'docs',
])
