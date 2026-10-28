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
 *   POST /print-image        -> { printer, widthMm, heightMm, dpi, copies?, pages: [base64 PNG, ...] }
 *                               => { ok: true, printer, pages }
 *                               "Through the driver": one page per PNG (one physical label row each),
 *                               printed by the printer's own driver at exactly widthMm x heightMm.
 *                               Works with any installed driver (GDI-only / unknown brands too).
 *                               Windows: System.Drawing PrintDocument; macOS / Linux: CUPS lp.
 *
 * Targets are configured in printers.json next to this file (see printers.example.json):
 *   { "default": "counter1",
 *     "allowedOrigins": ["https://app.example.com", "http://localhost:3000"],
 *     "printers": {
 *       "counter1": { "type": "tcp",    "host": "192.168.1.50", "port": 9100 },
 *       "shared":   { "type": "system", "name": "EPSON_TM_T82" },
 *       "serial":   { "type": "serial", "path": "/dev/ttyUSB0" } } }
 *
 * `extraAllowedOrigins` (array) adds origins on top of the built-in hosted-app
 * list without turning off the *.skyerpos.com / *.poslanka.lk subdomain match.
 *
 *   node index.mjs --allow-origin https://shop.example.com
 *     adds the origin to extraAllowedOrigins in printers.json and exits
 *     (used by the one-command installers served at /print-agent/install.*).
 */

import http from 'node:http'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

const VERSION = '1.4.1'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOST = process.env.PRINT_AGENT_HOST || '127.0.0.1'
const PORT = Number(process.env.PRINT_AGENT_PORT || 9123)
const CONFIG_PATH = process.env.PRINT_AGENT_CONFIG || path.join(__dirname, 'printers.json')
const MAX_BODY = 8 * 1024 * 1024
/** POST /print-image: whole JSON body (base64 PNGs) cap. */
const MAX_IMAGE_BODY = 25 * 1024 * 1024
const MAX_IMAGE_PAGES = 2000

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

/**
 * PowerShell started with -EncodedCommand writes its error stream as CLIXML
 * ("#< CLIXML <Objs ...><S S="Error">...</S>"), which users saw as garbage
 * instead of the real message. Return the plain text of the error records
 * (progress records dropped); other text is returned unchanged.
 */
function decodeClixml(text) {
  const s = String(text || '')
  if (!s.includes('#< CLIXML')) return s
  const parts = []
  for (const m of s.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)) parts.push(m[1])
  const decoded = parts
    .join('')
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
  // drop PowerShell's "At line:1 char:..." position block and the CategoryInfo lines
  return decoded
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\s*(At line:|At char:|\+ |\+\s+~|CategoryInfo|FullyQualifiedErrorId)/.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: 10_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LANG: 'C', LC_ALL: 'C' }, ...opts },
      (err, stdout, stderr) => {
        if (err) {
          const msg = decodeClixml(stderr).trim()
          reject(new Error(msg || (err.killed ? `${cmd} timed out` : `${cmd} failed (exit code ${err.code ?? 'unknown'})`)))
        }
        else resolve(String(stdout))
      },
    )
  })
}

/** Run a PowerShell script without any quoting problems (-EncodedCommand = base64 UTF-16LE). */
function powershell(script, env = {}, timeout = 30_000) {
  // No progress records ("Preparing modules for first use", Add-Type ...): they only add CLIXML noise on stderr.
  const encoded = Buffer.from(`$ProgressPreference = 'SilentlyContinue'\n${script}`, 'utf16le').toString('base64')
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    env: { ...process.env, ...env },
    timeout,
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
    const port = ports.get(name) || null
    // IPP / AirPrint / cups-browsed queues (e.g. a printer shared from a Mac) convert every job as a
    // document, so raw ZPL/TSPL fails there; the page prints those through the driver as images.
    const raw = !port || !/^(implicitclass|ipps?|dnssd|ippusb|driverless):/i.test(port)
    list.push({ name, driver, port, shared: false, shareName: null, isDefault: name === def, raw })
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
    // false = IPP / AirPrint / shared queue (no raw commands); Windows queues always pass RAW through the spooler
    raw: p.raw !== false,
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

// ─── Image printing through the driver (POST /print-image) ──────────────

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** Width / height of a PNG (IHDR), or null when the bytes are not a PNG. */
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a || buf.toString('latin1', 12, 16) !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/**
 * Validate a POST /print-image body. Throws HttpError(400) with a clear message.
 * Every page must be a PNG of round(mm / 25.4 * dpi) pixels (+-2 px).
 */
function validateImageRequest(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Body must be a JSON object')
  const printer = typeof body.printer === 'string' ? body.printer.trim() : ''
  if (!printer) throw new HttpError(400, 'Missing "printer" (name of an installed printer)')
  if (printer.length > 256 || /[\x00-\x1f]/.test(printer)) throw new HttpError(400, 'Invalid printer name')
  const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN)
  const widthMm = num(body.widthMm)
  const heightMm = num(body.heightMm)
  const dpi = num(body.dpi)
  if (!Number.isFinite(widthMm) || widthMm < 5 || widthMm > 300) throw new HttpError(400, '"widthMm" must be 5..300')
  if (!Number.isFinite(heightMm) || heightMm < 5 || heightMm > 600) throw new HttpError(400, '"heightMm" must be 5..600')
  if (!Number.isFinite(dpi) || dpi < 100 || dpi > 1200) throw new HttpError(400, '"dpi" must be 100..1200')
  const copies = body.copies == null ? 1 : Math.round(num(body.copies))
  if (!Number.isFinite(copies) || copies < 1 || copies > 100) throw new HttpError(400, '"copies" must be 1..100')
  if (!Array.isArray(body.pages) || body.pages.length === 0) throw new HttpError(400, 'Missing "pages" (base64 PNG per label row)')
  if (body.pages.length > MAX_IMAGE_PAGES) throw new HttpError(400, `Too many pages (max ${MAX_IMAGE_PAGES} per request)`)
  const wantW = Math.round((widthMm / 25.4) * dpi)
  const wantH = Math.round((heightMm / 25.4) * dpi)
  let total = 0
  const pages = body.pages.map((p, i) => {
    if (typeof p !== 'string' || !p) throw new HttpError(400, `Page ${i + 1} is not a base64 string`)
    const buf = Buffer.from(p.replace(/^data:image\/png;base64,/, ''), 'base64')
    total += buf.length
    if (total > MAX_IMAGE_BODY) throw new HttpError(413, 'Images too large (max 25 MB per request)')
    const size = pngSize(buf)
    if (!size) throw new HttpError(400, `Page ${i + 1} is not a PNG image`)
    if (Math.abs(size.width - wantW) > 2 || Math.abs(size.height - wantH) > 2) {
      throw new HttpError(400, `Page ${i + 1} is ${size.width}x${size.height} px, expected ${wantW}x${wantH} px (${widthMm}x${heightMm} mm at ${dpi} dpi)`)
    }
    return buf
  })
  return { printer, widthMm, heightMm, dpi, copies, pages }
}

/** Hundredths of an inch (System.Drawing paper units). */
const hundredths = (mm) => Math.round((mm / 25.4) * 100)

/**
 * Windows PowerShell 5.1 script: print every PNG in $env:POSLANKA_DIR (sorted
 * by name) as one page of exactly widthMm x heightMm through the printer's
 * driver. Paper = a matching driver form if one exists, else a custom
 * PaperSize; no margins; StandardPrintController (no "Printing..." dialog);
 * each image drawn 1:1 over the whole page with nearest-neighbour sampling so
 * barcode bars stay crisp. Printer name / folder / copies come from env vars
 * (never interpolated into the script).
 */
function buildWindowsImagePrintScript({ widthMm, heightMm, dpi }) {
  const W = hundredths(widthMm)
  const H = hundredths(heightMm)
  const exactW = Math.round((widthMm / 25.4) * 100 * 1000) / 1000
  const exactH = Math.round((heightMm / 25.4) * 100 * 1000) / 1000
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$name = $env:POSLANKA_PRINTER
$installed = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters)
if ($installed -notcontains $name) { throw "Printer not found: '$name' is not installed on this PC. Installed: $($installed -join ', ')" }
$files = @(Get-ChildItem -LiteralPath $env:POSLANKA_DIR -Filter '*.png' | Sort-Object Name | ForEach-Object { $_.FullName })
if ($files.Count -eq 0) { throw 'No label images to print' }
$copies = [Math]::Max(1, [int]$env:POSLANKA_COPIES)
$queue = New-Object 'System.Collections.Generic.List[string]'
for ($c = 0; $c -lt $copies; $c++) { foreach ($f in $files) { $queue.Add($f) } }

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.DocumentName = 'skyERPOS labels'
$doc.PrinterSettings.PrinterName = $name
if (-not $doc.PrinterSettings.IsValid) { throw "Printer not found: '$name'" }
# Prefer the driver's own form of this size (drivers honour their forms best), else a custom size.
$paper = $null
foreach ($ps in $doc.PrinterSettings.PaperSizes) {
  if ([Math]::Abs($ps.Width - ${W}) -le 2 -and [Math]::Abs($ps.Height - ${H}) -le 2) { $paper = $ps; break }
}
if ($paper -eq $null) { $paper = New-Object System.Drawing.Printing.PaperSize('skyERPOS', ${W}, ${H}) }
$res = $null
foreach ($r in $doc.PrinterSettings.PrinterResolutions) { if ($r.X -eq ${dpi}) { $res = $r; break } }
$margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$doc.DefaultPageSettings.PaperSize = $paper
$doc.DefaultPageSettings.Margins = $margins
$doc.DefaultPageSettings.Landscape = $false
if ($res -ne $null) { $doc.DefaultPageSettings.PrinterResolution = $res }
$doc.OriginAtMargins = $false
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$state = @{ i = 0 }
$doc.add_QueryPageSettings({
  param($sender, $ev)
  $ev.PageSettings.PaperSize = $paper
  $ev.PageSettings.Margins = $margins
  $ev.PageSettings.Landscape = $false
})
$doc.add_PrintPage({
  param($sender, $ev)
  $img = [System.Drawing.Image]::FromFile($queue[$state.i])
  try {
    $g = $ev.Graphics
    $g.PageUnit = [System.Drawing.GraphicsUnit]::Display
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
    # OriginAtMargins = false puts (0,0) at the printable-area corner: move it to the paper corner.
    $g.TranslateTransform(-$ev.PageSettings.HardMarginX, -$ev.PageSettings.HardMarginY)
    $dest = New-Object System.Drawing.RectangleF(0, 0, ${exactW}, ${exactH})
    $src = New-Object System.Drawing.RectangleF(0, 0, $img.Width, $img.Height)
    $g.DrawImage($img, $dest, $src, [System.Drawing.GraphicsUnit]::Pixel)
  } finally {
    $img.Dispose()
  }
  $state.i++
  $ev.HasMorePages = ($state.i -lt $queue.Count)
})
try {
  $doc.Print()
} catch {
  $m = $_.Exception.GetBaseException().Message
  if ($m -match 'denied') { throw "Access denied printing to '$name' (check the printer's Security settings / run as the logged-in user): $m" }
  if ($m -match 'invalid|not found|settings to access printer') { throw "Printer not found or offline: '$name': $m" }
  throw "Printing to '$name' failed: $m"
} finally {
  $doc.Dispose()
}
Write-Output ('printed ' + $state.i + ' page(s)')
`
}

/** CUPS lp arguments: one job, files in order, page = exactly widthMm x heightMm. */
function buildCupsImageArgs({ printer, widthMm, heightMm, copies = 1 }, files) {
  const mm = (v) => String(Math.round(v * 100) / 100)
  return [
    '-d', printer,
    '-n', String(copies),
    '-t', 'skyERPOS labels',
    '-o', `media=Custom.${mm(widthMm)}x${mm(heightMm)}mm`,
    '-o', 'fit-to-page',
    '-o', 'page-left=0',
    '-o', 'page-right=0',
    '-o', 'page-top=0',
    '-o', 'page-bottom=0',
    ...(copies > 1 ? ['-o', 'collate=true'] : []),
    ...files,
  ]
}

function writeImagePages(pages) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poslanka-img-'))
  const files = pages.map((buf, i) => {
    const f = path.join(dir, `page-${String(i + 1).padStart(5, '0')}.png`)
    fs.writeFileSync(f, buf)
    return f
  })
  return { dir, files }
}

async function printImages(req) {
  const { dir, files } = writeImagePages(req.pages)
  try {
    if (process.platform === 'win32') {
      const timeout = Math.min(600_000, 60_000 + files.length * req.copies * 1000)
      try {
        await powershell(buildWindowsImagePrintScript(req), { POSLANKA_PRINTER: req.printer, POSLANKA_DIR: dir, POSLANKA_COPIES: String(req.copies) }, timeout)
      } catch (e) {
        throw new Error(String(e.message).replace(/^.*?(Printer not found|Access denied|Printing to)/s, '$1').split(/\r?\n\s*At line:/)[0].trim())
      }
    } else {
      await run('lp', buildCupsImageArgs(req, files), { timeout: 60_000 })
    }
  } finally {
    fs.rm(dir, { recursive: true, force: true }, () => {})
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
  const extra = [
    ...(process.env.PRINT_AGENT_APP_ORIGIN || '').split(','),
    ...(Array.isArray(cfg.extraAllowedOrigins) ? cfg.extraAllowedOrigins.map(String) : []),
  ]
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
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

function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', (c) => {
      if (tooLarge) return // discard the rest so the 413 reaches the client
      size += c.length
      if (size > max) {
        tooLarge = true
        chunks = []
        reject(new HttpError(413, `Body too large (max ${Math.round(max / 1048576)} MB)`))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

/** True when run as `node index.mjs` (not imported by the tests). */
const IS_MAIN = (() => {
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

// `node index.mjs --allow-origin <origin>`: remember an extra app origin and exit (installers).
const allowIdx = IS_MAIN ? process.argv.indexOf('--allow-origin') : -1
if (allowIdx !== -1) {
  let origin = ''
  try {
    origin = new URL(process.argv[allowIdx + 1] || '').origin
  } catch {
    /* invalid */
  }
  if (!origin || origin === 'null') {
    console.error('Usage: node index.mjs --allow-origin https://your-app.example.com')
    process.exit(2)
  }
  let cfg = {}
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.error(`Could not read ${CONFIG_PATH}: ${e.message}`)
      process.exit(1)
    }
  }
  if (!cfg.printers || typeof cfg.printers !== 'object') cfg.printers = {}
  const list = Array.isArray(cfg.extraAllowedOrigins) ? cfg.extraAllowedOrigins.map(String) : []
  if (!list.includes(origin)) list.push(origin)
  cfg.extraAllowedOrigins = list
  // An explicit allowedOrigins list replaces the defaults: make sure the origin is in it too.
  if (Array.isArray(cfg.allowedOrigins) && cfg.allowedOrigins.length > 0 && !cfg.allowedOrigins.includes(origin)) cfg.allowedOrigins.push(origin)
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n')
  console.log(`Allowed origin ${origin} (${CONFIG_PATH})`)
  process.exit(0)
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
      return json(res, 200, { ok: true, version: VERSION, platform: process.platform, capabilities: { raw: true, image: true }, targets: listTargets(cfg) })
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
    if (req.method === 'POST' && url.pathname === '/print-image') {
      let body
      try {
        body = JSON.parse((await readBody(req, MAX_IMAGE_BODY)) || '{}')
      } catch (e) {
        if (e instanceof HttpError) throw e
        throw new HttpError(400, 'Body is not valid JSON')
      }
      const job = validateImageRequest(body)
      const target = await resolveTarget(cfg, job.printer)
      if (target.type !== 'system') throw new HttpError(400, `"${job.printer}" is a ${target.type} target: image printing needs a printer installed in the OS`)
      job.printer = target.name
      await printImages(job)
      log(`printed ${job.pages.length} image page(s) x${job.copies} -> ${job.printer} (${job.widthMm}x${job.heightMm} mm, ${job.dpi} dpi)`)
      return json(res, 200, { ok: true, printer: job.printer, pages: job.pages.length, copies: job.copies })
    }
    return json(res, 404, { error: 'Not found' })
  } catch (e) {
    log('error:', e.message)
    return json(res, e instanceof HttpError ? e.status : 500, { error: e.message })
  }
})

export { VERSION, decodeClixml, validateImageRequest, buildWindowsImagePrintScript, buildCupsImageArgs, pngSize, hundredths, HttpError, server }

if (IS_MAIN) server.listen(PORT, HOST, () => {
  const cfg = loadConfig()
  log(`POSLanka print agent v${VERSION} listening on http://${HOST}:${PORT}`)
  log(`config: ${CONFIG_PATH} (${Object.keys(cfg.printers).length} target(s), default: ${cfg.default || '-'})`)
  log(`allowed origins: ${allowedOrigins(cfg).join(', ')}`)
  discoverOsPrinters()
    .then((list) => log(`installed printers: ${list.map((p) => p.name + (p.isDefault ? ' (default)' : '')).join(', ') || '-'}`))
    .catch((e) => log('printer discovery failed:', e.message))
})
