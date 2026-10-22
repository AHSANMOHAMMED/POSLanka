/**
 * `next dev` compiles a route the first time it is requested, so the first click on a module
 * waited 1.5–4 s. After the dev server is up, request the login page, every top-level module page
 * (/c/[slug]/<module>) and the app-shell APIs every page calls, one at a time, so the first clicks
 * find them compiled. Turbopack's filesystem cache keeps the results across restarts.
 *
 * Deliberately NOT everything: compiling all ~940 routes grew the dev server past 9 GB and the
 * OS killed it. Detail pages and other APIs still compile on first use. Stops early if the server
 * passes WARMUP_MAX_RSS_MB (default 3500). Dev only; disable with DEV_WARMUP=off.
 */
import { readdirSync, existsSync } from 'fs'
import { request } from 'http'
import { join } from 'path'

const PRIORITY = ['dashboard', 'pos', 'items', 'sales', 'sales-orders', 'quotations', 'customers', 'stock', 'purchases', 'accounting', 'reports', 'settings']

// Fetched by the layout / sidebar / navbar on every page
const SHELL_APIS = [
  '/api/module-access', '/api/features', '/api/tenant', '/api/my-companies', '/api/notifications',
  '/api/ai/alerts', '/api/ai/status', '/api/chat/unread', '/api/chat/conversations', '/api/company/subscription',
  '/api/company/storage-quota', '/api/system/announcement', '/api/workspace/dashboard', '/api/items',
  '/api/customers', '/api/warehouses', '/api/sales', '/api/categories', '/api/pos-opening-entries',
]

function modulePages(appDir: string): string[] {
  const companyDir = join(appDir, 'c', '[slug]')
  if (!existsSync(companyDir)) return []
  const modules = readdirSync(companyDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('[') && !e.name.startsWith('(') && !e.name.startsWith('_'))
    .filter((e) => existsSync(join(companyDir, e.name, 'page.tsx')))
    .map((e) => e.name)
  const rank = (m: string) => (PRIORITY.includes(m) ? PRIORITY.indexOf(m) : PRIORITY.length)
  modules.sort((a, b) => rank(a) - rank(b))
  // login first: it is the first page anyone opens
  return ['/c/warmup/login', ...modules.filter((m) => m !== 'login').map((m) => `/c/warmup/${m}`)]
}

function hit(port: number, url: string): Promise<void> {
  // No cookies: protected routes redirect/401 after compiling, which is all we need. Host must be
  // localhost — the proxy sends any other host (127.0.0.1) to the base domain unrouted.
  return new Promise<void>((resolve) => {
    const req = request({ host: '127.0.0.1', port, path: url, headers: { host: `localhost:${port}`, 'x-dev-warmup': '1' } }, (res) => {
      res.resume()
      res.on('end', resolve)
    })
    req.on('error', () => resolve()) // server busy/restarting: skip this one
    req.setTimeout(120_000, () => { req.destroy(); resolve() })
    req.end()
  })
}

export function startDevWarmup(port: number): void {
  if (process.env.DEV_WARMUP === 'off') return
  const appDir = join(process.cwd(), 'src', 'app')
  if (!existsSync(appDir)) return

  const queue = [...modulePages(appDir), ...SHELL_APIS]
  const maxRssMb = Number(process.env.WARMUP_MAX_RSS_MB) || 3500
  const started = Date.now()
  console.log(`[warmup] Pre-compiling ${queue.length} module pages and shell APIs in the background (DEV_WARMUP=off to disable)`)

  // Let the first real request (the browser opening the app) go first
  setTimeout(async () => {
    let done = 0
    for (const url of queue) {
      const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024)
      if (rssMb > maxRssMb) {
        console.log(`[warmup] stopped at ${done}/${queue.length}: dev server uses ${rssMb} MB (WARMUP_MAX_RSS_MB=${maxRssMb})`)
        return
      }
      await hit(port, url)
      done++
    }
    console.log(`[warmup] done: ${done} routes in ${Math.round((Date.now() - started) / 1000)}s`)
  }, 1500)
}
