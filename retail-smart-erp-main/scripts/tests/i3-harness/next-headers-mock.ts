/**
 * Test-only replacement for `next/headers` (mapped via scripts/tests/i3-harness/tsconfig.json)
 * so super-admin route handlers can be called directly: the admin session cookie and request
 * headers (IP for rate limits / audit rows) are set by the test.
 */
const cookieJar = new Map<string, string>()
const headerMap = new Map<string, string>()

export function setTestCookie(name: string, value: string | null): void {
  if (value === null) cookieJar.delete(name)
  else cookieJar.set(name, value)
}

export function setTestHeader(name: string, value: string | null): void {
  if (value === null) headerMap.delete(name.toLowerCase())
  else headerMap.set(name.toLowerCase(), value)
}

export async function cookies() {
  return {
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => { cookieJar.set(name, value) },
    delete: (name: string) => { cookieJar.delete(name) },
    has: (name: string) => cookieJar.has(name),
    getAll: () => [...cookieJar.entries()].map(([name, value]) => ({ name, value })),
  }
}

export async function headers() {
  return {
    get: (name: string) => headerMap.get(name.toLowerCase()) ?? null,
    has: (name: string) => headerMap.has(name.toLowerCase()),
    forEach: (cb: (value: string, key: string) => void) => headerMap.forEach(cb),
  }
}

export async function draftMode() {
  return { isEnabled: false, enable() {}, disable() {} }
}
