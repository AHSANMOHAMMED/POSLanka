/**
 * Server side of the one-command print agent installers (GET /print-agent/*).
 * Scripts live next to the agent in tools/print-agent (single source); the
 * app origin is templated in so the script downloads the agent from, and
 * allows, the host it was fetched from.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const ORIGIN_PLACEHOLDER = '__SKYERPOS_ORIGIN__'

export type PrintAgentFile =
  | 'install.ps1'
  | 'uninstall.ps1'
  | 'install.sh'
  | 'index.mjs'
  | 'skyERPOS-Printer-Setup.cmd'
  | 'skyERPOS-Printer-Uninstall.cmd'

export const PRINT_AGENT_FILES: Record<PrintAgentFile, { source: string; templated: boolean; download?: boolean }> = {
  'install.ps1': { source: 'install.ps1', templated: true },
  'uninstall.ps1': { source: 'install.ps1', templated: true },
  'install.sh': { source: 'install.sh', templated: true },
  'index.mjs': { source: 'index.mjs', templated: false },
  // Double-click setup for Windows (curl.exe + tar.exe only, no PowerShell): downloaded, not piped
  'skyERPOS-Printer-Setup.cmd': { source: 'setup-windows.cmd', templated: true, download: true },
  'skyERPOS-Printer-Uninstall.cmd': { source: 'setup-windows.cmd', templated: true, download: true },
}

export function printAgentDir(cwd = process.cwd()): string {
  return path.join(cwd, 'tools', 'print-agent')
}

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/

function envOrigin(): string | null {
  for (const v of [process.env.NEXTAUTH_URL, process.env.NEXT_PUBLIC_APP_URL]) {
    if (!v) continue
    try {
      const u = new URL(v)
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin
    } catch {
      /* ignore */
    }
  }
  const app = process.env.NEXT_PUBLIC_APP_DOMAIN
  return app && HOST_RE.test(app.toLowerCase()) ? `https://${app.toLowerCase()}` : null
}

/** Hosts we serve (mirrors isAllowedHost in src/proxy.ts) - a spoofed Host header must not end up in a script. */
export function isServedHost(host: string): boolean {
  const h = host.split(':')[0].toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1') return true
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true
  const suffixes = ['skyerpos.com', 'poslanka.lk', 'retailsmarterp.com', 'sslip.io', 'nip.io', 'ondigitalocean.app', 'up.railway.app']
  const base = (process.env.NEXT_PUBLIC_BASE_DOMAIN || '').split(':')[0].toLowerCase()
  if (base && base !== 'localhost') suffixes.push(base)
  if (suffixes.some((s) => h === s || h.endsWith(`.${s}`))) return true
  const extra = (process.env.ALLOWED_HOSTS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
  if (extra.includes(h)) return true
  const env = envOrigin()
  return !!env && new URL(env).hostname === h
}

/** Public origin the request came in on (proxy headers first), else NEXTAUTH_URL / NEXT_PUBLIC_APP_URL. */
export function resolveInstallOrigin(request: Request): string {
  const url = new URL(request.url)
  const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host).split(',')[0].trim().toLowerCase()
  const protoHeader = (request.headers.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase()
  const proto = protoHeader === 'http' || protoHeader === 'https' ? protoHeader : url.protocol.replace(':', '')
  if (host && HOST_RE.test(host) && isServedHost(host)) {
    const h = host.split(':')[0]
    // Plain http only for local / raw-IP access; real domains are always https.
    const local = h === 'localhost' || h === '127.0.0.1' || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)
    return `${local ? proto : 'https'}://${host}`
  }
  return envOrigin() || `${url.protocol}//${url.host}`
}

/** Fill in the origin (+ uninstall flag). Throws if the origin is not a plain http(s) origin. */
export function renderPrintAgentScript(file: PrintAgentFile, template: string, origin: string): string {
  const o = origin.replace(/\/+$/, '')
  if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(o)) throw new Error(`Invalid origin ${origin}`)
  if (!PRINT_AGENT_FILES[file].templated) return template
  let out = template.split(ORIGIN_PLACEHOLDER).join(o)
  if (file === 'uninstall.ps1') out = out.replace('$SkyerposUninstall = $false', '$SkyerposUninstall = $true')
  if (file === 'skyERPOS-Printer-Uninstall.cmd') out = out.replace('if /i "%~1"=="/uninstall" goto :uninstall', 'goto :uninstall')
  if (file.endsWith('.ps1') || file.endsWith('.cmd')) out = out.replace(/\r?\n/g, '\r\n')
  return out
}

export async function loadPrintAgentFile(file: PrintAgentFile, origin: string, cwd?: string): Promise<string> {
  const raw = await readFile(path.join(printAgentDir(cwd), PRINT_AGENT_FILES[file].source), 'utf8')
  return renderPrintAgentScript(file, raw, origin)
}
