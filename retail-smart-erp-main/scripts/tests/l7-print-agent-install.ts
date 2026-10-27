/**
 * L7: one-command print agent installers (GET /print-agent/*). Pure, no DB.
 *
 *  - install.sh / install.ps1 / uninstall.ps1 embed the host they were fetched from
 *    (x-forwarded-host / host), never a spoofed one (falls back to NEXTAUTH_URL)
 *  - index.mjs served byte-for-byte from tools/print-agent/index.mjs
 *  - bash -n on the rendered install.sh; node --check on the agent; --allow-origin works
 *  - the UI commands point at the same routes
 *
 * Run: npx tsx scripts/tests/l7-print-agent-install.ts
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { GET } from '../../src/app/print-agent/[file]/route'
import { printAgentInstallCommands, detectAgentOs } from '../../src/lib/print/print-agent-commands'
import { ORIGIN_PLACEHOLDER } from '../../src/lib/print/print-agent-install'

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` -- ${detail}` : ''}`)
  if (!ok) failed++
}

const root = path.resolve(__dirname, '../..')
process.chdir(root)
process.env.NEXTAUTH_URL = 'https://app.skyerpos.com'

async function fetchFile(file: string, headers: Record<string, string>, url = `http://internal:3000/print-agent/${file}`) {
  const res = await GET(new Request(url, { headers }), { params: Promise.resolve({ file }) })
  return { status: res.status, type: res.headers.get('content-type') || '', cache: res.headers.get('cache-control') || '', body: await res.text() }
}

async function main() {
  const shop = { host: 'internal:3000', 'x-forwarded-host': 'shop.skyerpos.com', 'x-forwarded-proto': 'https' }

  const sh = await fetchFile('install.sh', shop)
  check('install.sh 200 text/plain', sh.status === 200 && sh.type.startsWith('text/plain'), `${sh.status} ${sh.type}`)
  check('install.sh cacheable', /public/.test(sh.cache), sh.cache)
  check('install.sh has the request host', sh.body.includes('ORIGIN="${SKYERPOS_ORIGIN:-https://shop.skyerpos.com}"'))
  check('install.sh placeholder replaced', !sh.body.includes(ORIGIN_PLACEHOLDER))
  const bashN = spawnSync('bash', ['-n'], { input: sh.body, encoding: 'utf8' })
  check('bash -n install.sh', bashN.status === 0, bashN.stderr)
  const sc = spawnSync('shellcheck', ['-s', 'bash', '-S', 'warning', '-'], { input: sh.body, encoding: 'utf8' })
  if (!sc.error) check('shellcheck install.sh (warnings)', sc.status === 0, sc.stdout)

  const ps = await fetchFile('install.ps1', shop)
  check('install.ps1 200', ps.status === 200 && ps.type.startsWith('text/plain'))
  check('install.ps1 has the request host', ps.body.includes("$Origin = 'https://shop.skyerpos.com'"))
  check('install.ps1 CRLF line endings', ps.body.includes('\r\n') && !/[^\r]\n/.test(ps.body))
  check('install.ps1 installs (not uninstall)', ps.body.includes('$SkyerposUninstall = $false'))
  check('install.ps1 autostart + health', ps.body.includes("GetFolderPath('Startup')") && ps.body.includes('127.0.0.1:9123/health'))
  const un = await fetchFile('uninstall.ps1', shop)
  check('uninstall.ps1 sets uninstall', un.status === 200 && un.body.includes('$SkyerposUninstall = $true'))
  const pwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$e=$null; [void][System.Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(), [ref]$null, [ref]$e); if ($e.Count) { $e | % { $_.Message }; exit 1 }'], { input: ps.body, encoding: 'utf8' })
  if (!pwsh.error) check('pwsh parses install.ps1', pwsh.status === 0, pwsh.stdout + pwsh.stderr)

  // Spoofed host -> configured app origin; local dev keeps http.
  const evil = await fetchFile('install.sh', { host: 'evil.example.com' }, 'http://evil.example.com/print-agent/install.sh')
  check('spoofed host not embedded', !evil.body.includes('evil.example.com') && evil.body.includes('https://app.skyerpos.com'))
  const local = await fetchFile('install.sh', { host: 'localhost:3000' }, 'http://localhost:3000/print-agent/install.sh')
  check('localhost keeps http', local.body.includes('http://localhost:3000}'))
  const sslip = await fetchFile('install.ps1', { host: '168-144-216-104.sslip.io', 'x-forwarded-proto': 'http' })
  check('real domain forced to https', sslip.body.includes("'https://168-144-216-104.sslip.io'"))

  const agent = await fetchFile('index.mjs', shop)
  const src = fs.readFileSync(path.join(root, 'tools/print-agent/index.mjs'), 'utf8')
  check('index.mjs served = tools/print-agent/index.mjs', agent.status === 200 && agent.body === src)
  const nf = await fetchFile('printers.json', shop)
  check('unknown file 404', nf.status === 404)
  const proto = await fetchFile('__proto__', shop)
  check('__proto__ 404', proto.status === 404)

  // Agent: syntax + --allow-origin keeps the defaults (extraAllowedOrigins, idempotent).
  check('node --check index.mjs', spawnSync(process.execPath, ['--check', 'tools/print-agent/index.mjs']).status === 0)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'l7-agent-'))
  const cfgPath = path.join(tmp, 'printers.json')
  fs.writeFileSync(cfgPath, JSON.stringify({ default: 'x', printers: { x: { type: 'tcp', host: '10.0.0.5' } } }))
  for (let i = 0; i < 2; i++) {
    spawnSync(process.execPath, ['tools/print-agent/index.mjs', '--allow-origin', 'https://shop.example.com/'], { env: { ...process.env, PRINT_AGENT_CONFIG: cfgPath } })
  }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  check('--allow-origin adds once, keeps printers', JSON.stringify(cfg.extraAllowedOrigins) === '["https://shop.example.com"]' && cfg.printers.x?.host === '10.0.0.5' && !cfg.allowedOrigins, JSON.stringify(cfg))
  const bad = spawnSync(process.execPath, ['tools/print-agent/index.mjs', '--allow-origin', 'nope'], { env: { ...process.env, PRINT_AGENT_CONFIG: cfgPath } })
  check('--allow-origin rejects junk', bad.status === 2)
  fs.rmSync(tmp, { recursive: true, force: true })

  // UI commands
  const cmds = printAgentInstallCommands('https://shop.skyerpos.com/')
  check('windows one-liner', cmds.windows.install === 'irm https://shop.skyerpos.com/print-agent/install.ps1 | iex')
  check('unix one-liner', cmds.unix.install === 'curl -fsSL https://shop.skyerpos.com/print-agent/install.sh | bash')
  const nav = (platform: string, userAgent: string) => ({ platform, userAgent }) as Navigator
  check('detect windows', detectAgentOs(nav('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')) === 'windows')
  check('detect mac', detectAgentOs(nav('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')) === 'mac')
  check('detect linux', detectAgentOs(nav('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)')) === 'linux')
  check('detect android', detectAgentOs(nav('Linux armv8l', 'Mozilla/5.0 (Linux; Android 14)')) === 'android')
  check('detect chromeos', detectAgentOs(nav('Linux x86_64', 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)')) === 'chromeos')

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall l7 print-agent install checks passed')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
