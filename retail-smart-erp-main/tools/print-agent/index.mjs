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
 *   GET  /printers           -> { printers: [{ name, type, description }] }
 *   POST /print              -> { target?: string, data: base64 }  => { ok: true, target, bytes }
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

const VERSION = '1.0.0'
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

function resolveTarget(cfg, name) {
  const key = name || cfg.default || Object.keys(cfg.printers)[0]
  if (!key) throw new Error('No printers configured. Create printers.json next to index.mjs.')
  const p = cfg.printers[key]
  if (!p) throw new Error(`Unknown printer target "${key}"`)
  return { key, ...p }
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

function sendSystem(target, bytes) {
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

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000']

/**
 * Allowed browser origins come from printers.json `allowedOrigins` (array of
 * exact origins, e.g. "https://app.poslanka.lk"; "*" allows any origin) or the
 * PRINT_AGENT_ALLOWED_ORIGINS env var (comma separated). Default: localhost:3000.
 */
function allowedOrigins(cfg) {
  if (process.env.PRINT_AGENT_ALLOWED_ORIGINS) {
    return process.env.PRINT_AGENT_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
  }
  if (Array.isArray(cfg.allowedOrigins) && cfg.allowedOrigins.length > 0) {
    return cfg.allowedOrigins.map((s) => String(s).trim().replace(/\/+$/, '')).filter(Boolean)
  }
  return DEFAULT_ALLOWED_ORIGINS
}

function originAllowed(cfg, origin) {
  if (!origin) return true // non-browser clients (curl) send no Origin
  const list = allowedOrigins(cfg)
  return list.includes('*') || list.includes(origin.replace(/\/+$/, ''))
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
      return json(res, 200, { printers: listTargets(cfg), default: cfg.default || null })
    }
    if (req.method === 'POST' && url.pathname === '/print') {
      const body = JSON.parse((await readBody(req)) || '{}')
      if (!body.data || typeof body.data !== 'string') return json(res, 400, { error: 'Missing base64 "data"' })
      const bytes = Buffer.from(body.data, 'base64')
      if (bytes.length === 0) return json(res, 400, { error: 'Empty payload' })
      const target = resolveTarget(cfg, body.target)
      await dispatch(target, bytes)
      log(`printed ${bytes.length} bytes -> ${target.key} (${target.type})`)
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
})
