/**
 * Shared fixtures for the L6 label tests (l6-label-roll.ts, l6-label-browser-pdf.ts).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { LabelItemData, LabelTemplate, LabelElement } from '../../src/lib/labels/types'
import { gtinCheckDigit } from '../../src/lib/print/label/barcode-fit'
import { analyseScan } from '../../src/lib/inventory/barcode-parse'

let pass = 0
let fail = 0
export function check(cond: boolean, msg: string, extra?: string) {
  if (cond) pass++
  else {
    fail++
    console.error(`  FAIL: ${msg}${extra ? `\n    ${extra}` : ''}`)
  }
}
export function finish() {
  console.log(`  ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
  console.log('PASS')
}

const ean = (body12: string) => body12 + gtinCheckDigit(body12)

export function mkItem(id: string, name: string, barcode: string | null, sku: string | null): LabelItemData {
  return {
    id,
    name,
    sku,
    barcode,
    sellingPrice: '1250',
    costPrice: '900',
    brand: null,
    oemPartNumber: null,
    pluCode: null,
    category: null,
    unit: 'pcs',
    weight: null,
    dimensions: null,
    imageUrl: null,
  }
}

/** Mixed real-world codes: generated in-store EAN-13, retail EAN-13, UPC-A, alphanumeric SKUs, numeric Code 128. */
export const ITEMS: LabelItemData[] = [
  mkItem('i1', 'Instore EAN', ean('200000000001'), 'ITM-0001'),
  mkItem('i2', 'Alnum SKU', null, 'ABC-12345'),
  mkItem('i3', 'Short SKU', null, 'SKU0001'),
  mkItem('i4', 'Retail EAN', '4791234567891', null),
  mkItem('i5', 'Numeric 8', '12345678', null),
  mkItem('i6', 'UPC item', '012345678905', null),
  mkItem('i7', 'Numeric 10', '1234567890', 'X'),
]

/** What a scanner must return for each item (= what /api/items/barcode-lookup matches). */
export const expectedValue = (it: LabelItemData) => (it.barcode || it.sku || it.pluCode || '').trim()

/**
 * True when the POS scan lookup (/api/items/barcode-lookup uses analyseScan's
 * candidates against items.barcode / items.sku) finds an item whose code is
 * `stored` from the scanner output `decoded` (e.g. UPC-A read as 0 + 12 digits).
 */
export function lookupFinds(decoded: string | null, stored: string): boolean {
  if (!decoded) return false
  return analyseScan(decoded).candidates.some((c) => (c.field === 'barcode' || c.field === 'sku') && c.lookup.toLowerCase() === stored.toLowerCase())
}

/** Same layout the barcode print page builds for "Standard" (name, barcode, SKU + price). */
export function standardTemplate(widthMm: number, heightMm: number, columns = 1): LabelTemplate {
  const narrow = widthMm <= 40
  const nameH = narrow ? 3.5 : 4.2
  const currentY = 1 + nameH + 0.8
  const footerH = narrow ? 5 : 6
  const footerY = Math.max(currentY + 6, heightMm - footerH - 1)
  const bcH = Math.min(22, Math.max(6, footerY - 0.5 - currentY))
  const skuW = Math.min(22, Math.floor(widthMm * 0.42))
  const els: LabelElement[] = [
    { id: 'name', type: 'text', dataField: 'item.name', x: 1, y: 1, width: widthMm - 2, height: nameH, fontSize: narrow ? 6.5 : 8, fontWeight: 'bold', textAlign: 'center', maxLines: 1, rotation: 0, zIndex: 1 },
    { id: 'bc', type: 'barcode', dataField: 'item.barcode', format: 'code128', barWidth: 2, showText: true, x: 2, y: currentY, width: widthMm - 4, height: bcH, rotation: 0, zIndex: 1 },
    { id: 'sku', type: 'text', dataField: 'item.sku', prefix: 'SKU: ', x: 1.5, y: footerY + 1, width: skuW, height: 3.5, fontSize: 5.5, fontWeight: 'normal', textAlign: 'left', maxLines: 1, rotation: 0, zIndex: 2 },
    { id: 'price', type: 'text', dataField: 'item.sellingPrice', isCurrency: true, x: skuW + 2, y: footerY, width: widthMm - skuW - 3.5, height: footerH, fontSize: narrow ? 8.5 : 11, fontWeight: 'bold', textAlign: 'right', maxLines: 1, rotation: 0, zIndex: 2 },
  ]
  return {
    id: `std-${widthMm}x${heightMm}`,
    tenantId: 't',
    name: `Standard ${widthMm}x${heightMm}`,
    description: null,
    widthMm,
    heightMm,
    columns,
    labelShape: 'rectangle',
    elements: els,
    isDefault: false,
    isActive: true,
    createdBy: null,
    createdAt: '',
    updatedAt: '',
  }
}

export function tmpDir(name: string) {
  const d = path.join(os.tmpdir(), `l6-${name}-${process.pid}`)
  fs.mkdirSync(d, { recursive: true })
  return d
}

export function which(cmd: string): string | null {
  const r = spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

/** Python with zxing-cpp + pillow (L6_PYTHON env, else python3), or null. */
export function decoderPython(): string | null {
  for (const py of [process.env.L6_PYTHON, 'python3'].filter(Boolean) as string[]) {
    const r = spawnSync(py, ['-c', 'import zxingcpp, PIL'], { encoding: 'utf8' })
    if (r.status === 0) return py
  }
  return null
}

export interface DecodeResult {
  text: string | null
  format: string | null
  dark: number
}

export function decodeImages(py: string, jobs: { file: string; crops: number[][] }[]): DecodeResult[][] {
  const r = spawnSync(py, [path.join(__dirname, 'l6-decode.py')], { input: JSON.stringify(jobs), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`decoder failed: ${r.stderr || r.stdout}`)
  return JSON.parse(r.stdout)
}

/** Write an 8-bit grayscale PGM (0 = black). */
export function writePgm(file: string, w: number, h: number, black: Uint8Array) {
  const head = Buffer.from(`P5\n${w} ${h}\n255\n`, 'ascii')
  const px = Buffer.alloc(w * h)
  for (let i = 0; i < w * h; i++) px[i] = black[i] ? 0 : 255
  fs.writeFileSync(file, Buffer.concat([head, px]))
}
