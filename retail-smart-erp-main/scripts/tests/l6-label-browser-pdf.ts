/**
 * L6: browser (Chrome print dialog) label roll output, proven with real Chrome.
 *
 * For each roll setup the exact print HTML (buildRollPrintDocument + the
 * executePrint wrapper) is printed by headless Chrome to PDF, then:
 *   - pdfinfo: page count = physical rows, every page = liner width x label height
 *   - pdftoppm at the printer DPI: every expected label cell has content, empty
 *     cells of a partial last row are blank, and the barcode in every cell
 *     decodes (zxing-cpp) to exactly the item's code, in print order.
 * Skips when google-chrome / poppler are missing; decoding needs zxing-cpp
 * (set L6_PYTHON to a python with `pip install zxing-cpp pillow`).
 *
 * Run: npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/l6-label-browser-pdf.ts
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { buildAlignmentTestDocument, buildRollPrintDocument, rollPrintHtml, type RollPrintDocument } from '../../src/lib/labels/label-print'
import { setupFromPreset, STICKER_PRESETS, type StickerSetup } from '../../src/lib/labels/sticker-stock'
import { LABEL_PRESETS } from '../../src/lib/labels/presets'
import type { LabelItemData, LabelTemplate } from '../../src/lib/labels/types'
import { ITEMS, check, decodeImages, decoderPython, expectedValue, finish, lookupFinds, standardTemplate, tmpDir, which } from './l6-shared'

const chrome = which('google-chrome') || which('google-chrome-stable') || which('chromium') || which('chromium-browser')
const havePoppler = !!which('pdfinfo') && !!which('pdftoppm')

function preset(id: string, patch: Partial<StickerSetup> = {}): StickerSetup {
  const p = STICKER_PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`no preset ${id}`)
  return setupFromPreset(p, { id, ...patch })
}

function presetTemplate(id: string): LabelTemplate {
  const p = LABEL_PRESETS.find((x) => x.id === id)!
  return { ...(p as unknown as LabelTemplate), id: p.id, widthMm: p.widthMm, heightMm: p.heightMm, elements: p.elements }
}

interface Case {
  name: string
  setup: StickerSetup
  template: LabelTemplate
  items: { item: LabelItemData; quantity: number }[]
}

const q1 = (list: LabelItemData[]) => list.map((item) => ({ item, quantity: 1 }))
const CASES: Case[] = [
  { name: '38x25 2-across, 6 items', setup: preset('38x25x2'), template: standardTemplate(38, 25, 2), items: q1(ITEMS.slice(0, 6)) },
  { name: '38x25 2-across, 7 items (odd)', setup: preset('38x25x2'), template: standardTemplate(38, 25, 2), items: q1(ITEMS) },
  { name: '38x25 2-across, quantities 3+2', setup: preset('38x25x2'), template: standardTemplate(38, 25, 2), items: [{ item: ITEMS[1], quantity: 3 }, { item: ITEMS[3], quantity: 2 }] },
  { name: '38x25 2-across preset template', setup: preset('38x25x2'), template: presetTemplate('retail-38x25-barcode-2up'), items: q1(ITEMS.slice(0, 6)) },
  { name: '38x25 1-across, 3 items', setup: preset('38x25x1'), template: standardTemplate(38, 25, 1), items: q1(ITEMS.slice(0, 3)) },
  { name: '50x25 1-across, 7 items', setup: preset('50x25x1'), template: standardTemplate(50, 25, 1), items: q1(ITEMS) },
  { name: '50x25 2-across, 5 items', setup: preset('50x25x2'), template: standardTemplate(50, 25, 2), items: q1(ITEMS.slice(0, 5)) },
  { name: '32x25 3-across, 7 items', setup: preset('32x25x3'), template: standardTemplate(32, 25, 3), items: q1(ITEMS) },
  { name: '38x25 2-across @300dpi, 6 items', setup: preset('38x25x2', { dpi: 300 }), template: standardTemplate(38, 25, 2), items: q1(ITEMS.slice(0, 6)) },
  { name: '38x25 2-across, calibration offsets', setup: preset('38x25x2', { offsetXMm: 0.6, offsetYMm: 0.4 }), template: standardTemplate(38, 25, 2), items: q1(ITEMS.slice(0, 4)) },
]

const PT = 72 / 25.4

function printPdf(dir: string, name: string, doc: Pick<RollPrintDocument, 'title' | 'styles' | 'content'>): string {
  const html = path.join(dir, `${name}.html`)
  const pdf = path.join(dir, `${name}.pdf`)
  fs.writeFileSync(html, rollPrintHtml(doc))
  const r = spawnSync(
    chrome!,
    ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer', '--hide-scrollbars', `--user-data-dir=${path.join(dir, 'profile')}`, `--print-to-pdf=${pdf}`, `file://${html}`],
    { encoding: 'utf8', timeout: 60000 }
  )
  if (!fs.existsSync(pdf)) throw new Error(`chrome produced no pdf: ${r.stderr}`)
  return pdf
}

function pdfPages(pdf: string): { pages: number; sizes: [number, number][] } {
  const info = spawnSync('pdfinfo', [pdf], { encoding: 'utf8' }).stdout
  const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? 0)
  const per = spawnSync('pdfinfo', ['-f', '1', '-l', String(pages), pdf], { encoding: 'utf8' }).stdout
  const sizes = [...per.matchAll(/Page\s+\d+\s+size:\s+([\d.]+) x ([\d.]+) pts/g)].map((m) => [Number(m[1]), Number(m[2])] as [number, number])
  return { pages, sizes }
}

function rasterize(pdf: string, dpi: number, dir: string, name: string): string[] {
  const prefix = path.join(dir, `${name}-r`)
  spawnSync('pdftoppm', ['-r', String(dpi), '-gray', '-png', pdf, prefix], { encoding: 'utf8' })
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${name}-r-`) && f.endsWith('.png'))
    .sort((a, b) => Number(/-(\d+)\.png$/.exec(a)![1]) - Number(/-(\d+)\.png$/.exec(b)![1]))
    .map((f) => path.join(dir, f))
}

async function main() {
  console.log('L6 browser label roll (headless Chrome -> PDF)')
  if (!chrome || !havePoppler) {
    console.log(`  SKIP: needs google-chrome (${chrome || 'missing'}) and poppler pdfinfo/pdftoppm (${havePoppler ? 'ok' : 'missing'})`)
    return
  }
  const py = decoderPython()
  if (!py) console.log('  NOTE: zxing-cpp not available (set L6_PYTHON) - barcode decoding skipped, layout still checked')
  const dir = tmpDir('browser')
  let decoded = 0

  for (const [ci, c] of CASES.entries()) {
    const s = c.setup
    const seq: LabelItemData[] = c.items.flatMap(({ item, quantity }) => Array.from({ length: quantity }, () => item))
    const rows = Math.ceil(seq.length / s.columns)
    const doc = await buildRollPrintDocument(c.template, c.items, s)
    check(doc.pages === rows, `${c.name}: document has ${rows} pages (got ${doc.pages})`)
    check(!/break-after/.test(doc.styles), `${c.name}: no break-after (no trailing blank page)`)
    check(!/@page[^}]*!important/.test(doc.styles), `${c.name}: @page has no !important`)
    const name = `c${ci}`
    const pdf = printPdf(dir, name, doc)
    const { pages, sizes } = pdfPages(pdf)
    const wantW = doc.pageWidthMm * PT
    const wantH = s.labelHeightMm * PT
    check(pages === rows, `${c.name}: Chrome PDF has ${rows} pages = physical rows`, `got ${pages}`)
    check(
      sizes.length === pages && sizes.every(([w, h]) => Math.abs(w - wantW) < 0.75 && Math.abs(h - wantH) < 0.75),
      `${c.name}: every page is ${doc.pageWidthMm} x ${s.labelHeightMm} mm (${wantW.toFixed(1)} x ${wantH.toFixed(1)} pt)`,
      JSON.stringify(sizes.slice(0, 3))
    )
    if (!py) continue

    const dpi = s.dpi
    const dpm = dpi / 25.4
    const files = rasterize(pdf, dpi, dir, name)
    check(files.length === rows, `${c.name}: ${rows} raster pages`)
    const labelW = Math.round(s.labelWidthMm * dpm)
    const jobs = files.map((file) => ({
      file,
      crops: Array.from({ length: s.columns }, (_, k) => [Math.round((s.marginLeftMm + s.offsetXMm + k * (s.labelWidthMm + s.columnGapMm)) * dpm), 0, labelW, Math.round(s.labelHeightMm * dpm)]),
    }))
    const res = decodeImages(py, jobs)
    const got: string[] = []
    res.forEach((row, r) =>
      row.forEach((cell, k) => {
        const idx = r * s.columns + k
        if (idx < seq.length) {
          const want = expectedValue(seq[idx])
          check(cell.dark > 0.02, `${c.name}: page ${r + 1} col ${k + 1} has a printed label`)
          const ok = cell.text === want || lookupFinds(cell.text, want)
          check(ok, `${c.name}: page ${r + 1} col ${k + 1} decodes to "${want}" (or a form the POS lookup maps to it)`, `got ${JSON.stringify(cell)}`)
          if (ok) decoded++
          got.push(`${cell.text}[${cell.format}]`)
        } else {
          check(cell.dark < 0.001, `${c.name}: page ${r + 1} col ${k + 1} is blank (partial last row)`, `dark=${cell.dark}`)
          got.push('-')
        }
      })
    )
    console.log(`  ${c.name}: ${pages} pages ${(wantW / PT).toFixed(1)}x${(wantH / PT).toFixed(1)} mm @${dpi}dpi -> ${got.join(' | ')}`)
  }

  // Alignment test: 2 pages, labels numbered in order
  const align = buildAlignmentTestDocument(preset('38x25x2'))
  const apdf = printPdf(dir, 'align', align)
  const a = pdfPages(apdf)
  check(a.pages === 2, 'alignment test: 2 pages', String(a.pages))
  check(align.content.indexOf('>1<') < align.content.indexOf('>2<') && align.content.indexOf('>3<') < align.content.indexOf('>4<'), 'alignment test numbers 1..4 in order')
  if (py) console.log(`  decoded ${decoded} browser-printed barcodes at printer DPI`)
  if (!process.env.L6_KEEP) fs.rmSync(dir, { recursive: true, force: true })
  else console.log(`  output kept in ${dir}`)
  finish()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
