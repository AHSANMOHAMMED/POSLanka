// Pure: HTTP outcomes worth retrying later (never mark work as "rejected" for these).
// 0 = never reached the server (offline / timeout), 408 timeout, 429 rate limit, 5xx server error.
export function isTransientStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500
}
