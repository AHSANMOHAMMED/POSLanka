/**
 * L8: "Through the driver" label printing. Pure, no DB, no printing.
 *
 * Browser side (src/lib/print/label/driver-image.ts):
 *  - one 1-bit PNG per physical label row, in order, exactly
 *    round(liner mm / 25.4 * dpi) x round(label height mm / 25.4 * dpi) px
 *  - strictly black / white (bit depth 1 grayscale), resolution in pHYs
 *  - every barcode decodes to the item's code, column by column, in print
 *    order (zxing-cpp via L6_PYTHON / python3; skipped when missing)
 *  - stored-deflate fallback when CompressionStream is missing
 *  - default mode per installed driver name (raw families vs 'driver')
 * Agent (tools/print-agent/index.mjs, imported without listening):
 *  - POST /print-image validation, PowerShell script text (not executed),
 *    CUPS lp arguments, HTTP 400/403/404 paths + /health capabilities
 *
 * Run: npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/l8-driver-image.ts
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import type { AddressInfo } from 'node:net'
import { buildDriverImageJob, encodePng1Bit, renderDriverRows } from '../../src/lib/print/label/driver-image'
import { mmToDots, type LabelPrintItem } from '../../src/lib/print/label'
import { defaultAgentLabelLanguage } from '../../src/lib/print/label/printer-detect'
import { setupFromPreset, stickerLayout, STICKER_PRESETS, type StickerSetup } from '../../src/lib/labels/sticker-stock'
import { LABEL_LANGUAGES, sanitizeLabelConfig } from '../../src/lib/print/printer-profiles'
import type { LabelItemData, LabelTemplate } from '../../src/lib/labels/types'
import { ITEMS, check, decodeImages, decoderPython, expectedValue, finish, lookupFinds, standardTemplate, tmpDir } from './l6-shared'

function preset(id: string, patch: Partial<StickerSetup> = {}): StickerSetup {
  return setupFromPreset(STICKER_PRESETS.find((x) => x.id === id)!, { id, ...patch })
}
const q1 = (list: LabelItemData[]): LabelPrintItem[] => list.map((item) => ({ item, quantity: 1 }))

function job(template: LabelTemplate, items: LabelPrintItem[], s: StickerSetup, copies = 1) {
  return buildDriverImageJob(template, items, { dpi: s.dpi, copies, widthMm: s.labelWidthMm, heightMm: s.labelHeightMm, layout: stickerLayout(s) })
}

interface Png {
  width: number
  height: number
  bitDepth: number
  colorType: number
  ppm: number
  /** 1 = black */
  px: Uint8Array
}

function readPng(buf: Uint8Array): Png {
  const b = Buffer.from(buf)
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let off = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let ppm = 0
  const idat: Buffer[] = []
  while (off < b.length) {
    const len = b.readUInt32BE(off)
    const type = b.toString('latin1', off + 4, off + 8)
    const data = b.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'pHYs') ppm = data.readUInt32BE(0)
    else if (type === 'IDAT') idat.push(data)
    off += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const bpr = Math.ceil((width * bitDepth) / 8)
  const px = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    if (raw[y * (bpr + 1)] !== 0) throw new Error('unexpected PNG filter')
    for (let x = 0; x < width; x++) px[y * width + x] = raw[y * (bpr + 1) + 1 + (x >> 3)] & (0x80 >> (x & 7)) ? 0 : 1
  }
  return { width, height, bitDepth, colorType, ppm, px }
}

async function browserSide(py: string | null) {
  const dir = tmpDir('driver')
  const jobs: { file: string; crops: number[][]; expect: (LabelItemData | null)[]; label: string }[] = []

  const cases: { name: string; s: StickerSetup; t: LabelTemplate; items: LabelPrintItem[]; copies?: number }[] = [
    { name: '38x25 2-across, 6 items @203', s: preset('38x25x2'), t: standardTemplate(38, 25, 2), items: q1(ITEMS.slice(0, 6)) },
    { name: '38x25 2-across, 7 items @300', s: preset('38x25x2', { dpi: 300 }), t: standardTemplate(38, 25, 2), items: q1(ITEMS) },
    { name: '50x25 1-across, 3 items x2 copies', s: preset('50x25x1'), t: standardTemplate(50, 25, 1), items: q1(ITEMS.slice(0, 3)), copies: 2 },
    { name: '38x25 2-across, offsets +1/-0.5 mm', s: preset('38x25x2', { offsetXMm: 1, offsetYMm: -0.5 }), t: standardTemplate(38, 25, 2), items: [{ item: ITEMS[3], quantity: 3 }] },
  ]
  for (const c of cases) {
    const s = c.s
    const dpi = s.dpi
    const flat = c.items.flatMap(({ item, quantity }) => Array.from({ length: quantity * (c.copies ?? 1) }, () => item))
    const rows = Math.ceil(flat.length / s.columns)
    const liner = s.marginLeftMm * 2 + s.columns * s.labelWidthMm + (s.columns - 1) * s.columnGapMm
    const wantW = Math.round((liner / 25.4) * dpi)
    const wantH = Math.round((s.labelHeightMm / 25.4) * dpi)
    const res = await job(c.t, c.items, s, c.copies)
    check(!res.warnings.some((w) => /too long|no barcode|cannot/.test(w)), `${c.name}: no barcode warnings`, res.warnings.join(' | '))
    check(res.pages.length === rows, `${c.name}: ${rows} PNG pages (one per physical row)`, `got ${res.pages.length}`)
    check(res.widthMm === Math.round(liner * 100) / 100 && res.heightMm === s.labelHeightMm && res.dpi === dpi, `${c.name}: page ${liner} x ${s.labelHeightMm} mm @ ${dpi}`, `${res.widthMm} x ${res.heightMm} @ ${res.dpi}`)
    const colX = (k: number) => mmToDots(s.marginLeftMm + s.offsetXMm + k * (s.labelWidthMm + s.columnGapMm), dpi)
    const labelW = mmToDots(s.labelWidthMm, dpi)
    res.pages.forEach((png, r) => {
      const p = readPng(png)
      check(p.width === wantW && p.height === wantH, `${c.name}: row ${r + 1} is ${wantW} x ${wantH} px`, `got ${p.width} x ${p.height}`)
      check(p.bitDepth === 1 && p.colorType === 0, `${c.name}: row ${r + 1} is 1-bit black/white`)
      check(Math.abs(p.ppm - dpi / 0.0254) < 1, `${c.name}: row ${r + 1} pHYs = ${dpi} dpi`)
      for (let k = 0; k < s.columns; k++) {
        const want = flat[r * s.columns + k] ?? null
        // blank cells stay white
        if (!want) {
          let dark = 0
          for (let y = 0; y < p.height; y++) for (let x = Math.max(0, colX(k)); x < Math.min(p.width, colX(k) + labelW); x++) dark += p.px[y * p.width + x]
          check(dark === 0, `${c.name}: row ${r + 1} col ${k + 1} blank`)
        }
      }
      if (py) {
        const file = path.join(dir, `${c.name.replace(/\W+/g, '_')}-${r}.png`)
        fs.writeFileSync(file, png)
        jobs.push({
          file,
          label: `${c.name} row ${r + 1}`,
          crops: Array.from({ length: s.columns }, (_, k) => [Math.max(0, colX(k)), 0, labelW, wantH]),
          expect: Array.from({ length: s.columns }, (_, k) => flat[r * s.columns + k] ?? null),
        })
      }
    })
  }

  // The owner's case, spelled out: 6 items on 38 x 25 mm 2-across at 203 dpi = 3 PNGs of 639 x 200 px.
  const six = await job(standardTemplate(38, 25, 2), q1(ITEMS.slice(0, 6)), preset('38x25x2'))
  const sizes = six.pages.map((png) => readPng(png)).map((p) => `${p.width}x${p.height}`)
  check(sizes.join(',') === '639x200,639x200,639x200', '6 items, 38x25 2-across @203: 3 PNGs of 639 x 200 px', sizes.join(','))

  // Bars: integer-dot modules >= 2 dots @203 (scan a row through the first barcode).
  const r0 = readPng(six.pages[0])
  const y = mmToDots(10, 203)
  const runs: number[] = []
  let run = 0
  let prev = 0
  for (let x = 0; x < mmToDots(39, 203); x++) {
    const v = r0.px[y * r0.width + x]
    if (v === prev) run++
    else {
      if (prev === 1) runs.push(run)
      run = 1
      prev = v
    }
  }
  const mod = Math.min(...runs)
  check(runs.length > 10 && mod >= 2 && runs.every((w) => w % mod === 0), `bars are whole multiples of a ${mod}-dot module (>= 2 dots @203)`, runs.join(','))

  // Identical rows encoded once; 1-across copies keep the order.
  const rr = await renderDriverRows(standardTemplate(38, 25, 2), [{ item: ITEMS[0], quantity: 4 }], { dpi: 203, widthMm: 38, heightMm: 25, layout: stickerLayout(preset('38x25x2')) })
  check(rr.rows.length === 2 && rr.rows[0] === rr.rows[1], 'qty 4 on 2-across: 2 rows sharing one bitmap')

  // Alignment-test shape: columns x 2 labels -> 2 rows.
  const at = await renderDriverRows({ widthMm: 32, heightMm: 25, elements: [] }, Array.from({ length: 6 }, () => ({ item: null, quantity: 1 })), { dpi: 203, widthMm: 32, heightMm: 25, layout: stickerLayout(preset('32x25x3')) })
  check(at.rows.length === 2 && at.widthDots === mmToDots(102, 203), 'alignment test on 32x25 3-across: 2 rows of 102 mm')

  // Stored-deflate fallback (no CompressionStream).
  const saved = (globalThis as { CompressionStream?: unknown }).CompressionStream
  ;(globalThis as { CompressionStream?: unknown }).CompressionStream = undefined
  try {
    const raster = { width: 13, height: 3, data: new Uint8Array([0xff, 0xf8, 0x00, 0x00, 0xaa, 0xa8]) }
    const p = readPng(await encodePng1Bit(raster, 13, 300))
    check(p.width === 13 && p.height === 3 && p.px.slice(0, 13).every((v) => v === 1) && p.px.slice(13, 26).every((v) => v === 0) && p.px[26] === 1 && p.px[27] === 0, 'PNG without CompressionStream (stored deflate) decodes exactly')
  } finally {
    ;(globalThis as { CompressionStream?: unknown }).CompressionStream = saved
  }

  if (py && jobs.length) {
    let decoded = 0
    const res = decodeImages(py, jobs.map(({ file, crops }) => ({ file, crops })))
    res.forEach((row, j) =>
      row.forEach((cell, k) => {
        const want = jobs[j].expect[k]
        if (!want) return
        const value = expectedValue(want)
        const ok = cell.text === value || lookupFinds(cell.text, value)
        check(ok, `${jobs[j].label} col ${k + 1}: decodes to ${value}`, JSON.stringify(cell))
        if (ok) decoded++
      })
    )
    console.log(`  decoded ${decoded} barcodes from ${jobs.length} driver PNG rows (203 + 300 dpi)`)
  } else console.log('  NOTE: zxing-cpp not available (set L6_PYTHON) - PNG decode skipped')
  if (!process.env.L6_KEEP) fs.rmSync(dir, { recursive: true, force: true })
  else console.log(`  output kept in ${dir}`)
}

function detection() {
  check(LABEL_LANGUAGES.includes('driver') && sanitizeLabelConfig({ language: 'driver' }).language === 'driver', "profiles accept language 'driver'")
  const d = defaultAgentLabelLanguage
  check(d('ZDesigner ZD230-203dpi ZPL', 'ZDesigner ZD230-203dpi ZPL') === 'zpl', 'ZDesigner -> ZPL')
  check(d('TSC TTP-244 Pro', 'TSC TTP-244 Pro') === 'tspl' && d('Xprinter XP-365B') === 'tspl' && d('XP-360B', 'XP-360B') === 'tspl', 'TSC / Xprinter -> TSPL')
  check(d('Gprinter GP-1324D') === 'tspl' && d('HPRT HT300') === 'tspl' && d('Rongta RP410') === 'tspl' && d('Deli DL-888T') === 'tspl' && d('SNBC BTP-L42') === 'tspl', 'Gprinter / HPRT / Rongta / Deli / SNBC -> TSPL')
  check(d('Godex G500') === 'zpl', 'GoDEX -> ZPL emulation')
  check(d('DBL Label Printer', 'Label Printer') === 'driver' && d('4BARCODE 4B-2054L', 'Barcode Printer') === 'driver' && d('POS-58 Label', 'Generic GDI') === 'driver', 'unknown / GDI label drivers -> through the driver')
}

async function agentSide() {
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'l8-agent-'))
  process.env.PRINT_AGENT_CONFIG = path.join(cfgDir, 'printers.json')
  fs.writeFileSync(process.env.PRINT_AGENT_CONFIG, JSON.stringify({ printers: { net: { type: 'tcp', host: '127.0.0.1', port: 1 } } }))
  const agentPath = path.resolve(__dirname, '../../tools/print-agent/index.mjs')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agent: any = await import(agentPath)
  check(agent.VERSION === '1.4.0', `agent version 1.4.0 (${agent.VERSION})`)
  check(agent.server.listening === false, 'importing the agent does not start the server')

  const png = await encodePng1Bit({ width: 639, height: 200, data: new Uint8Array(80 * 200) }, 639, 203)
  const good = { printer: 'ZDesigner ZD230', widthMm: 80, heightMm: 25, dpi: 203, pages: [Buffer.from(png).toString('base64')] }
  const v = agent.validateImageRequest(good)
  check(v.printer === 'ZDesigner ZD230' && v.copies === 1 && v.pages.length === 1 && v.widthMm === 80, 'valid /print-image request accepted')
  const bad = (patch: Record<string, unknown>, re: RegExp, name: string) => {
    try {
      agent.validateImageRequest({ ...good, ...patch })
      check(false, `rejects ${name}`)
    } catch (e) {
      const err = e as { status?: number; message: string }
      check((err.status === 400 || err.status === 413) && re.test(err.message), `rejects ${name}: ${err.message}`)
    }
  }
  bad({ printer: '' }, /printer/, 'missing printer')
  bad({ printer: 'a\nb' }, /Invalid printer/, 'control chars in printer name')
  bad({ widthMm: 2 }, /widthMm/, 'width < 5 mm')
  bad({ heightMm: 'x' }, /heightMm/, 'non-numeric height')
  bad({ dpi: 50 }, /dpi/, 'dpi 50')
  bad({ copies: 0 }, /copies/, 'copies 0')
  bad({ pages: [] }, /pages/, 'no pages')
  bad({ pages: ['aGVsbG8='] }, /not a PNG/, 'non-PNG page')
  bad({ heightMm: 30 }, /expected 639x240 px/, 'PNG size not matching the label size')
  bad({ pages: Array.from({ length: 2001 }, () => good.pages[0]) }, /Too many pages/, '2001 pages')

  const ps: string = agent.buildWindowsImagePrintScript({ widthMm: 80, heightMm: 25, dpi: 203 })
  check(ps.includes("New-Object System.Drawing.Printing.PaperSize('skyERPOS', 315, 98)"), 'PowerShell: PaperSize skyERPOS 315 x 98 hundredths (80 x 25 mm)')
  check(ps.includes('System.Drawing.Printing.StandardPrintController'), 'PowerShell: StandardPrintController (no dialog)')
  check(ps.includes('InterpolationMode]::NearestNeighbor') && ps.includes('PixelOffsetMode]::Half'), 'PowerShell: NearestNeighbor + PixelOffsetMode Half')
  check(ps.includes('Margins(0, 0, 0, 0)') && ps.includes('$doc.OriginAtMargins = $false') && ps.includes('Landscape = $false'), 'PowerShell: zero margins, OriginAtMargins false, portrait')
  check(ps.includes('RectangleF(0, 0, 314.961, 98.425)') && ps.includes('GraphicsUnit]::Display'), 'PowerShell: image drawn over the whole page in hundredths of an inch')
  check(ps.includes("$ErrorActionPreference = 'Stop'") && ps.includes('Add-Type -AssemblyName System.Drawing') && ps.includes('InstalledPrinters'), 'PowerShell: Stop on errors, System.Drawing, installed-printer check')
  check(ps.includes('$ev.HasMorePages') && ps.includes('Access denied') && ps.includes('Printer not found'), 'PowerShell: one page per PNG, clear errors')
  check(!ps.includes('ZDesigner') && ps.includes('$env:POSLANKA_PRINTER'), 'PowerShell: printer name passed via env, never interpolated')
  check(/\$ErrorActionPreference/.test(ps) && !/\$\{(?!W|H)/.test(ps.replace(/\$\{[^}]*\}/g, '')), 'PowerShell: no leftover template placeholders')
  const ps300 = agent.buildWindowsImagePrintScript({ widthMm: 102, heightMm: 25, dpi: 300 })
  check(ps300.includes("PaperSize('skyERPOS', 402, 98)") && ps300.includes('$r.X -eq 300'), 'PowerShell 102 x 25 mm @300: 402 x 98 hundredths, 300 dpi resolution')

  const args: string[] = agent.buildCupsImageArgs({ printer: 'Zebra_ZD230', widthMm: 80, heightMm: 25, copies: 1 }, ['/t/page-00001.png', '/t/page-00002.png'])
  check(
    args.join(' ') === '-d Zebra_ZD230 -n 1 -t skyERPOS labels -o media=Custom.80x25mm -o fit-to-page -o page-left=0 -o page-right=0 -o page-top=0 -o page-bottom=0 /t/page-00001.png /t/page-00002.png',
    'CUPS: lp -d <printer> media=Custom.80x25mm fit-to-page zero page margins, files in order',
    args.join(' ')
  )
  const args2: string[] = agent.buildCupsImageArgs({ printer: 'P', widthMm: 38.5, heightMm: 25, copies: 3 }, ['a.png'])
  check(args2.includes('media=Custom.38.5x25mm') && args2.includes('collate=true') && args2[args2.indexOf('-n') + 1] === '3', 'CUPS: fractional mm, copies collated')

  // HTTP (only requests that never reach a printer)
  await new Promise<void>((r) => agent.server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(agent.server.address() as AddressInfo).port}`
  try {
    const health = await (await fetch(`${base}/health`)).json()
    check(health.version === '1.4.0' && health.capabilities?.raw === true && health.capabilities?.image === true, '/health reports capabilities {raw, image}')
    const post = (body: unknown, headers: Record<string, string> = {}) => fetch(`${base}/print-image`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
    let r = await post({ ...good, dpi: 5 })
    check(r.status === 400 && /dpi/.test((await r.json()).error), 'POST /print-image bad dpi -> 400')
    r = await post('{not json')
    check(r.status === 400, 'POST /print-image invalid JSON -> 400')
    r = await post({ ...good, printer: 'net' })
    check(r.status === 400 && /image printing needs a printer installed/.test((await r.json()).error), 'POST /print-image to a TCP target -> 400 (needs an OS printer)')
    r = await post(good, { Origin: 'https://evil.example.com' })
    check(r.status === 403, 'POST /print-image from a foreign origin -> 403 (same rules as /print)')
    r = await fetch(`${base}/print-image`, { method: 'OPTIONS', headers: { Origin: 'https://app.skyerpos.com', 'Access-Control-Request-Method': 'POST' } })
    check(r.status === 204 && r.headers.get('access-control-allow-origin') === 'https://app.skyerpos.com', 'CORS preflight for /print-image from the app origin')
    r = await post('x'.repeat(26 * 1024 * 1024))
    check(r.status === 413, 'POST /print-image over 25 MB -> 413')
  } finally {
    await new Promise<void>((r) => agent.server.close(() => r()))
    fs.rmSync(cfgDir, { recursive: true, force: true })
  }
}

async function main() {
  console.log('L8 label printing through the driver (images)')
  const py = decoderPython()
  detection()
  await browserSide(py)
  await agentSide()
  finish()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
