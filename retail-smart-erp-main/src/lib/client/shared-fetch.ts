/**
 * Browser-side request sharing for app-shell data (module access, feature flags, banners, badges).
 *
 * Many components mount on every page and each used to fetch the same endpoint on its own — ~75
 * requests per page load, queued behind the browser's 6-connections-per-host limit, so the page's
 * own data waited ~1 s behind them. sharedJson() gives every caller of a URL the same in-flight
 * promise and reuses a successful result for `maxAgeMs`. Failures are never cached.
 */

interface Entry {
  at: number
  pending: boolean
  promise: Promise<unknown>
}

const cache = new Map<string, Entry>()

export class SharedFetchError extends Error {
  constructor(public status: number, url: string) {
    super(`GET ${url} failed with ${status}`)
  }
}

export interface SharedJsonOptions {
  /** Reuse a successful response for this long (default 30 s). 0 = only join an in-flight request. */
  maxAgeMs?: number
  /** Ignore any cached response and fetch again (in-flight requests are still joined). */
  force?: boolean
}

export function sharedJson<T = unknown>(url: string, options: SharedJsonOptions = {}): Promise<T> {
  const { maxAgeMs = 30_000, force = false } = options
  const hit = cache.get(url)
  if (hit && (hit.pending || (!force && Date.now() - hit.at < maxAgeMs))) {
    return hit.promise as Promise<T>
  }
  const entry: Entry = { at: Date.now(), pending: true, promise: Promise.resolve() }
  entry.promise = fetch(url, { credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) throw new SharedFetchError(res.status, url)
      return res.json()
    })
    .then(
      (data) => {
        entry.pending = false
        entry.at = Date.now()
        return data
      },
      (err) => {
        if (cache.get(url) === entry) cache.delete(url)
        throw err
      },
    )
  cache.set(url, entry)
  return entry.promise as Promise<T>
}

/** Drop cached responses whose URL starts with `prefix` (call after saving the data they show). */
export function invalidateShared(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

/**
 * Resolves once the browser is idle (or after `timeoutMs`), so low-priority widgets — chat,
 * announcements, quota banners — request their data after the page's own requests went out.
 */
export function whenIdle(timeoutMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve()
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
    if (ric) ric(() => resolve(), { timeout: timeoutMs })
    else setTimeout(resolve, 200)
  })
}
