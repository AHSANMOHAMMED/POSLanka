#!/usr/bin/env node
/**
 * POSLanka print agent
 *
 * Tiny local HTTP bridge that receives raw ESC/POS bytes from the browser
 * (which cannot talk to network/shared/serial printers directly) and forwards
 * them to the configured printer (ESC/POS, TSPL, ZPL, EPL - bytes are passed
 * through untouched). No dependencies; Node 20+.
 *
 *   GET  /health             -> { ok: true, version, targets: [...] }
 *   GET  /printers           -> { printers: [{ name, kind, type, driver, port, isDefault, source, description }], default }
 *                               configured targets (source 'config') + printers installed in the OS (source 'os')
 *                               ?refresh=1 bypasses the 10 s discovery cache
 *   POST /print              -> { target?: string, data: base64 }  => { ok: true, target, bytes }
 *                               `target` = a printers.json key OR the exact name of an installed OS printer
 *
 * Targets are configured in printers.json next to this file (see printers.example.json):
 *   { "default": "counter1",
 *     "allowedOrigins": ["https://app.example.com", "http://localhost:3000"],
 *     "printers": {
 *       "counter1": { "type": "tcp",    "host": "192.168.1.50", "port": 9100 },
 *       "shared":   { "type": "system", "name": "EPSON_TM_T82" },
 *       "serial":   { "type": "serial", "path": "/dev/ttyUSB0" } } }
 */

import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

const VERSION = '1.2.0'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOST = process.env.PRINT_AGENT_HOST || '127.0.0.1'
const PORT = Number(process.env.PRINT_AGENT_PORT || 9123)
const CONFIG_PATH = process.env.PRINT_AGENT_CONFIG || path.join(__dirname, 'printers.json')
const MAX_BODY = 8 * 1024 * 1024

function log(...args) {
  console.log(new Date().toISOString(), ...args)
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const cfg = JSON.parse(raw)
    if (!cfg.printers || typeof cfg.printers !== 'object') cfg.printers = {}
    return cfg
  } catch (e) {
    if (e.code !== 'ENOENT') log('Could not read config:', e.message)
    return { printers: {} }
  }
}

function listTargets(cfg) {
  return Object.entries(cfg.printers).map(([name, p]) => ({
    name,
    type: p.type,
    kind: p.type,
    driver: null,
    port: p.type === 'tcp' ? `${p.host}:${p.port || 9100}` : p.type === 'serial' ? p.path : p.type === 'system' ? p.name : null,
    source: 'config',
    description:
      p.type === 'tcp'
        ? `${p.host}:${p.port || 9100}`
        : p.type === 'system'
          ? `system printer "${p.name}"`
          : p.type === 'serial'
            ? p.path
            : '',
    isDefault: cfg.default === name,
  }))
}

async function resolveTarget(cfg, name) {
  if (name && cfg.printers[name]) return { key: name, source: 'config', ...cfg.printers[name] }
  if (name) {
    // Not in printers.json: accept the exact name of a printer installed in the OS.
    let os = []
    try {
      os = await discoverOsPrinters()
    } catch {
      /* discovery failed - try the name anyway */
    }
    const hit = os.find((p) => p.name === name)
    if (hit || os.length === 0) return { key: name, source: 'os', type: 'system', name }
    throw new Error(`Unknown printer "${name}". It is not in printers.json and not installed on this PC.`)
  }
  const key = cfg.default || Object.keys(cfg.printers)[0]
  if (key && cfg.printers[key]) return { key, source: 'config', ...cfg.printers[key] }
  // Nothing configured: fall back to the OS default printer.
  const os = await discoverOsPrinters().catch(() => [])
  const def = os.find((p) => p.isDefault) || os[0]
  if (!def) throw new Error('No printer selected and none configured/installed. Pick a printer in the POS printer settings.')
  return { key: def.name, source: 'os', type: 'system', name: def.name }
}

// ─── OS printer discovery ─────────────────────────────────────────────────

const DISCOVERY_TTL_MS = 10_000
let discoveryCache = { at: 0, list: null, pending: null }

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: 10_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LANG: 'C', LC_ALL: 'C' }, ...opts },
      (err, stdout, stderr) => {
        if (err) reject(new Error(String(stderr || err.message).trim()))
        else resolve(String(stdout))
      },
    )
  })
}

/** Run a PowerShell script without any quoting problems (-EncodedCommand = base64 UTF-16LE). */
function powershell(script, env = {}) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    env: { ...process.env, ...env },
    timeout: 30_000,
  })
}

const PS_LIST_PRINTERS = `
$ErrorActionPreference = 'Stop'
$def = $null
try { $def = (Get-CimInstance -ClassName Win32_Printer -Filter 'Default=TRUE' -ErrorAction SilentlyContinue | Select-Object -First 1).Name } catch {}
@(Get-Printer | Select-Object Name, DriverName, PortName, Shared, ShareName, @{ n = 'IsDefault'; e = { $_.Name -eq $def } }) | ConvertTo-Json -Compress
`

async function discoverWindows() {
  try {
    const out = (await powershell(PS_LIST_PRINTERS)).trim()
    if (!out) return []
    const parsed = JSON.parse(out)
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    return rows
      .filter((r) => r && r.Name)
      .map((r) => ({
        name: String(r.Name),
        driver: r.DriverName || null,
        port: r.PortName || null,
        shared: !!r.Shared,
        shareName: r.ShareName || null,
        isDefault: !!r.IsDefault,
      }))
  } catch (e) {
    log('Get-Printer failed, trying wmic:', e.message)
  }
  // Fallback (older Windows without the PrintManagement module).
  const out = await run('wmic', ['printer', 'get', 'Name,DriverName,PortName,Default,Shared,ShareName', '/format:csv'])
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const header = lines[0].split(',')
  const col = (row, key) => row[header.indexOf(key)]
  return lines.slice(1).map((line) => {
    const row = line.split(',')
    return {
      name: col(row, 'Name'),
      driver: col(row, 'DriverName') || null,
      port: col(row, 'PortName') || null,
      shared: /true/i.test(col(row, 'Shared') || ''),
      shareName: col(row, 'ShareName') || null,
      isDefault: /true/i.test(col(row, 'Default') || ''),
    }
  }).filter((p) => p.name)
}

async function discoverCups() {
  let names = []
  try {
    names = (await run('lpstat', ['-e'])).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  } catch {
    // Old CUPS without -e: parse "printer NAME is idle..."
    const out = await run('lpstat', ['-p'])
    names = out.split(/\r?\n/).map((l) => /^printer\s+(\S+)/.exec(l)?.[1]).filter(Boolean)
  }
  let def = null
  try {
    def = /system default destination:\s*(\S+)/.exec(await run('lpstat', ['-d']))?.[1] || null
  } catch {
    /* no default */
  }
  const ports = new Map()
  try {
    for (const l of (await run('lpstat', ['-v'])).split(/\r?\n/)) {
      const m = /^device for\s+(.+?):\s*(.+)$/.exec(l.trim())
      if (m) ports.set(m[1], m[2])
    }
  } catch {
    /* ignore */
  }
  const list = []
  for (const name of names.slice(0, 50)) {
    let driver = null
    try {
      driver = /printer-make-and-model='?([^']+?)'?(?:\s+\S+=|$)/.exec(await run('lpoptions', ['-p', name]))?.[1] || null
    } catch {
      /* ignore */
    }
    list.push({ name, driver, port: ports.get(name) || null, shared: false, shareName: null, isDefault: name === def })
  }
  return list
}

/** Printers installed in the OS (cached ~10 s). */
async function discoverOsPrinters(force = false) {
  const now = Date.now()
  if (!force && discoveryCache.list && now - discoveryCache.at < DISCOVERY_TTL_MS) return discoveryCache.list
  if (discoveryCache.pending) return discoveryCache.pending
  discoveryCache.pending = (process.platform === 'win32' ? discoverWindows() : discoverCups())
    .then((list) => {
      discoveryCache = { at: Date.now(), list, pending: null }
      return list
    })
    .catch((e) => {
      discoveryCache.pending = null
      throw e
    })
  return discoveryCache.pending
}

/** Configured targets first, then installed OS printers (kind 'system'). */
async function listAllPrinters(cfg, force = false) {
  const configured = listTargets(cfg)
  let installed = []
  let discoveryError = null
  try {
    installed = await discoverOsPrinters(force)
  } catch (e) {
    discoveryError = e.message
  }
  const os = installed.map((p) => ({
    name: p.name,
    type: 'system',
    kind: 'system',
    driver: p.driver,
    port: p.port,
    shared: p.shared,
    shareName: p.shareName,
    isDefault: p.isDefault,
    systemDefault: p.isDefault,
    source: 'os',
    description: [p.driver, p.port].filter(Boolean).join(' · '),
  }))
  return { printers: [...configured, ...os], discoveryError }
}

// ─── Senders ──────────────────────────────────────────────────────────────

function sendTcp(target, bytes) {
  return new Promise((resolve, reject) => {
    const port = Number(target.port || 9100)
    const sock = net.connect({ host: target.host, port })
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error(`Timed out connecting to ${target.host}:${port}`))
    }, Number(target.timeoutMs || 5000))
    sock.on('connect', () => {
      sock.end(bytes, () => {
        clearTimeout(timer)
        resolve()
      })
    })
    sock.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`TCP ${target.host}:${port}: ${e.message}`))
    })
  })
}

/**
 * Windows: hand RAW bytes to a named printer through the spooler
 * (OpenPrinter / StartDocPrinter("RAW") / WritePrinter). Works with any
 * installed driver (Generic / Text Only, vendor thermal drivers, label
 * drivers) because the driver's renderer is bypassed; no sharing needed.
 */
const PS_RAW_PRINT = `
$ErrorActionPreference = 'Stop'
$src = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
public static class PosLankaRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr h, byte[] buf, int count, out int written);
  public static void Send(string printer, string file, string docName) {
    byte[] bytes = File.ReadAllBytes(file);
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero))
      throw new Exception("OpenPrinter failed for '" + printer + "' (Win32 error " + Marshal.GetLastWin32Error() + ")");
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = docName;
      di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) {
        // v4 (XPS-based) drivers refuse RAW; XPS_PASS sends the bytes straight through them
        int rawErr = Marshal.GetLastWin32Error();
        di.pDataType = "XPS_PASS";
        if (StartDocPrinter(h, 1, di) == 0)
          throw new Exception("StartDocPrinter failed (Win32 error " + rawErr + " / " + Marshal.GetLastWin32Error() + ")");
      }
      try {
        if (!StartPagePrinter(h)) throw new Exception("StartPagePrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ")");
        int written;
        bool ok = WritePrinter(h, bytes, bytes.Length, out written);
        int err = Marshal.GetLastWin32Error();
        EndPagePrinter(h);
        if (!ok || written != bytes.Length)
          throw new Exception("WritePrinter failed (Win32 error " + err + "), wrote " + written + " of " + bytes.Length + " bytes");
      } finally {
        EndDocPrinter(h);
      }
    } finally {
      ClosePrinter(h);
    }
  }
}
'@
# Compile once and reuse the DLL: compiling on every print costs seconds per receipt
$dll = Join-Path $env:TEMP 'PosLankaRawPrinter-v2.dll'
try {
  if (-not (Test-Path $dll)) { Add-Type -TypeDefinition $src -OutputAssembly $dll -OutputType Library }
  Add-Type -Path $dll
} catch {
  # another print is writing the DLL right now (or TEMP is read-only): compile in memory
  Add-Type -TypeDefinition $src
}
[PosLankaRawPrinter]::Send($env:POSLANKA_PRINTER, $env:POSLANKA_FILE, $env:POSLANKA_DOCNAME)
`

async function sendWindowsRaw(printerName, bytes) {
  const tmp = path.join(os.tmpdir(), `poslanka-print-${process.pid}-${Date.now()}.bin`)
  fs.writeFileSync(tmp, bytes)
  try {
    await powershell(PS_RAW_PRINT, { POSLANKA_PRINTER: printerName, POSLANKA_FILE: tmp, POSLANKA_DOCNAME: 'POSLanka' })
  } catch (e) {
    throw new Error(`Windows spooler print to "${printerName}" failed: ${e.message}`)
  } finally {
    fs.unlink(tmp, () => {})
  }
}

function sendSystem(target, bytes) {
  // OS printers picked in the POS (and configured targets with "raw": true) go
  // straight to the spooler on Windows. Configured shared targets keep `print /D`.
  if (process.platform === 'win32' && (target.source === 'os' || target.raw)) return sendWindowsRaw(target.name, bytes)
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `poslanka-print-${process.pid}-${Date.now()}.bin`)
    fs.writeFileSync(tmp, bytes)
    const cleanup = () => fs.unlink(tmp, () => {})
    let cmd
    let args
    if (process.platform === 'win32') {
      // Raw copy to a shared printer. Share the printer first (Printer properties > Sharing).
      cmd = 'cmd.exe'
      args = ['/c', 'print', `/D:\\\\localhost\\${target.name}`, tmp]
    } else {
      cmd = 'lp'
      args = ['-d', target.name, '-o', 'raw', tmp]
    }
    execFile(cmd, args, { timeout: 15000 }, (err, stdout, stderr) => {
      cleanup()
      if (err) reject(new Error(`System print failed: ${stderr || err.message}`))
      else resolve()
    })
  })
}

function sendSerial(target, bytes) {
  return new Promise((resolve, reject) => {
    // Set the baud rate once with `stty -F /dev/ttyUSB0 9600` (Linux) or via the
    // COM port properties on Windows (path like \\\\.\\COM3).
    const stream = fs.createWriteStream(target.path, { flags: 'w' })
    stream.on('error', (e) => reject(new Error(`Serial ${target.path}: ${e.message}`)))
    stream.end(bytes, () => resolve())
  })
}

async function dispatch(target, bytes) {
  switch (target.type) {
    case 'tcp':
      return sendTcp(target, bytes)
    case 'system':
      return sendSystem(target, bytes)
    case 'serial':
      return sendSerial(target, bytes)
    default:
      throw new Error(`Unsupported printer type "${target.type}"`)
  }
}

// ─── HTTP ─────────────────────────────────────────────────────────────────

/**
 * Built-in origins of the hosted POSLanka app + local dev. Extend with
 * PRINT_AGENT_APP_ORIGIN (comma separated) or `allowedOrigins` in printers.json.
 */
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://app.skyerpos.com',
  'https://skyerpos.com',
  'https://www.skyerpos.com',
  'http://168.144.216.104',
  'https://168.144.216.104',
  'https://168-144-216-104.sslip.io',
  'https://app.poslanka.lk',
  'https://www.poslanka.lk',
  'https://www.retailsmarterp.com',
]

/**
 * Allowed browser origins come from printers.json `allowedOrigins` (array of
 * exact origins, e.g. "https://app.poslanka.lk"; "*" allows any origin) or the
 * PRINT_AGENT_ALLOWED_ORIGINS env var (comma separated, replaces everything).
 * Default: DEFAULT_ALLOWED_ORIGINS. PRINT_AGENT_APP_ORIGIN adds to either list.
 */
function allowedOrigins(cfg) {
  if (process.env.PRINT_AGENT_ALLOWED_ORIGINS) {
    return process.env.PRINT_AGENT_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  }
  const extra = (process.env.PRINT_AGENT_APP_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
  if (Array.isArray(cfg.allowedOrigins) && cfg.allowedOrigins.length > 0) {
    return [...cfg.allowedOrigins.map((s) => String(s).trim().replace(/\/+$/, '')).filter(Boolean), ...extra]
  }
  return [...DEFAULT_ALLOWED_ORIGINS, ...extra]
}

/** Vendor subdomains of the hosted app (https://<slug>.poslanka.lk etc.) when no explicit list is configured. */
const DEFAULT_ALLOWED_SUFFIXES = ['.poslanka.lk', '.skyerpos.com', '.retailsmarterp.com']

function originAllowed(cfg, origin) {
  if (!origin) return true // non-browser clients (curl) send no Origin
  const list = allowedOrigins(cfg)
  const o = origin.replace(/\/+$/, '')
  if (list.includes('*') || list.includes(o)) return true
  const explicit = !!process.env.PRINT_AGENT_ALLOWED_ORIGINS || (Array.isArray(cfg.allowedOrigins) && cfg.allowedOrigins.length > 0)
  if (explicit) return false
  try {
    const u = new URL(o)
    return u.protocol === 'https:' && DEFAULT_ALLOWED_SUFFIXES.some((sfx) => u.hostname.endsWith(sfx))
  } catch {
    return false
  }
}

function cors(req, res, cfg) {
  const origin = req.headers.origin
  if (origin && originAllowed(cfg, origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '86400')
  // Chrome Private Network Access preflight (public/https page -> loopback).
  if (req.headers['access-control-request-private-network'] === 'true' || origin) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('Body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  const cfg = loadConfig()
  cors(req, res, cfg)
  if (!originAllowed(cfg, req.headers.origin)) {
    log(`rejected request from origin ${req.headers.origin} (add it to allowedOrigins in printers.json)`)
    return json(res, 403, { error: `Origin ${req.headers.origin} is not allowed` })
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true, version: VERSION, platform: process.platform, targets: listTargets(cfg) })
    }
    if (req.method === 'GET' && url.pathname === '/printers') {
      const { printers, discoveryError } = await listAllPrinters(cfg, url.searchParams.has('refresh'))
      const def = cfg.default || printers.find((p) => p.source === 'os' && p.isDefault)?.name || null
      return json(res, 200, { printers, default: def, platform: process.platform, discoveryError })
    }
    if (req.method === 'POST' && url.pathname === '/print') {
      const body = JSON.parse((await readBody(req)) || '{}')
      if (!body.data || typeof body.data !== 'string') return json(res, 400, { error: 'Missing base64 "data"' })
      const bytes = Buffer.from(body.data, 'base64')
      if (bytes.length === 0) return json(res, 400, { error: 'Empty payload' })
      const target = await resolveTarget(cfg, typeof body.target === 'string' ? body.target : '')
      await dispatch(target, bytes)
      log(`printed ${bytes.length} bytes -> ${target.key} (${target.type}, ${target.source})`)
      return json(res, 200, { ok: true, target: target.key, bytes: bytes.length })
    }
    return json(res, 404, { error: 'Not found' })
  } catch (e) {
    log('error:', e.message)
    return json(res, 500, { error: e.message })
  }
})

server.listen(PORT, HOST, () => {
  const cfg = loadConfig()
  log(`POSLanka print agent v${VERSION} listening on http://${HOST}:${PORT}`)
  log(`config: ${CONFIG_PATH} (${Object.keys(cfg.printers).length} target(s), default: ${cfg.default || '-'})`)
  log(`allowed origins: ${allowedOrigins(cfg).join(', ')}`)
  discoverOsPrinters()
    .then((list) => log(`installed printers: ${list.map((p) => p.name + (p.isDefault ? ' (default)' : '')).join(', ') || '-'}`))
    .catch((e) => log('printer discovery failed:', e.message))
})
