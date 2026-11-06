/**
 * Message safe to return to the client from a 500 handler. Raw driver errors ("Failed query: …",
 * constraint names, SQL) are logged server-side but never sent; only messages matching `allow`
 * (the route's own, user-facing errors) pass through.
 */
export function clientErrorMessage(error: unknown, fallback: string, allow?: RegExp): string {
  if (allow && error instanceof Error && allow.test(error.message)) return error.message
  return fallback
}
