/**
 * Escape special characters in a string to be used safely in SQL LIKE/ILIKE patterns.
 * In PostgreSQL, `%` matches any sequence and `_` matches any single character.
 * This function escapes those characters so they are treated as literals.
 */
export function escapeLikePattern(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}
