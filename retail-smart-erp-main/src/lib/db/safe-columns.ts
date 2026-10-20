/**
 * Column selections that must be used whenever a users row is embedded in an API response.
 * `users` carries password_hash and pin_hash; returning `user: true` would send them to the
 * browser / phone. Use `user: SAFE_USER` (exclusion mode keeps every other column).
 */
export const SAFE_USER = { columns: { passwordHash: false, pinHash: false } } as const
