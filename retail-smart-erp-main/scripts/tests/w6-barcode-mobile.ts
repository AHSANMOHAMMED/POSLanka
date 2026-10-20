/**
 * W6: the mobile app's offline barcode engine (apps/mobile/src/lib/barcodeParse.ts) must resolve
 * scans exactly like the server (src/lib/inventory/barcode-parse.ts).
 *
 *   npx tsx scripts/tests/w6-barcode-mobile.ts
 */
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as mobile from '../../apps/mobile/src/lib/barcodeParse'
import * as server from '../../src/lib/inventory/barcode-parse'

const ROOT = join(__dirname, '..', '..')
let passed = 0
function t(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`PASS  ${name}`)
  } catch (e) {
    console.log(`FAIL  ${name}  — ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  }
}

const { analyseScan, expandUpcE, gtinCheckDigit, isValidGtin, parseGs1, parseScaleBarcode, normalizeScaleConfig } = mobile

t('source is a verbatim copy of the server engine', () => {
  const srv = readFileSync(join(ROOT, 'src/lib/inventory/barcode-parse.ts'), 'utf8')
  const mob = readFileSync(join(ROOT, 'apps/mobile/src/lib/barcodeParse.ts'), 'utf8')
  assert.ok(mob.endsWith(srv), 'apps/mobile/src/lib/barcodeParse.ts differs from src/lib/inventory/barcode-parse.ts')
})

t('EAN-13 check digit + validation', () => {
  assert.strictEqual(gtinCheckDigit('400638133393'), 1)
  assert.ok(isValidGtin('4006381333931'))
  assert.ok(!isValidGtin('4006381333932'))
  const a = analyseScan('4006381333931')
  assert.strictEqual(a.symbology, 'ean13')
  assert.deepStrictEqual(a.candidates.slice(0, 2).map((c) => [c.field, c.lookup]), [['barcode', '4006381333931'], ['plu', '4006381333931']])
  assert.strictEqual(a.gtinValid, true)
})

t('UPC-A / EAN-13 leading zero variants', () => {
  const a = analyseScan('012000003455')
  assert.strictEqual(a.symbology, 'upca')
  assert.ok(a.candidates.some((c) => c.field === 'barcode' && c.lookup === '0012000003455'))
  const e = analyseScan('0012000003455')
  assert.ok(e.candidates.some((c) => c.field === 'barcode' && c.lookup === '012000003455'))
})

t('UPC-E expands to UPC-A (8, 7 and 6 digits)', () => {
  assert.strictEqual(expandUpcE('01234565'), '012345000065')
  assert.strictEqual(expandUpcE('1234565'), '012345000065')
  assert.strictEqual(expandUpcE('123456'), '012345000065')
  const a = analyseScan('123456')
  assert.strictEqual(a.symbology, 'upce')
  assert.ok(a.candidates.some((c) => c.lookup === '012345000065'))
  assert.strictEqual(analyseScan('01234565').symbology, 'ean8')
})

t('weighing-scale label (weight)', () => {
  const cfg = normalizeScaleConfig({ enabled: true })
  const body = '2' + '0' + '04011' + '01234'
  const code = body + gtinCheckDigit(body)
  const sc = parseScaleBarcode(code, cfg)
  assert.ok(sc && sc.plu === '4011' && Math.abs(sc.value - 1.234) < 1e-9 && sc.valueType === 'weight')
  const a = analyseScan(code, cfg)
  assert.strictEqual(a.symbology, 'scale')
  assert.deepStrictEqual(a.candidates.map((c) => [c.field, c.lookup]), [['barcode', code], ['plu', '4011'], ['plu', '04011']])
  // disabled → plain EAN-13
  assert.strictEqual(analyseScan(code, normalizeScaleConfig({ enabled: false })).symbology, 'ean13')
})

t('weighing-scale label (price, 2 decimals, custom prefix)', () => {
  const cfg = normalizeScaleConfig({ enabled: true, prefixes: ['21'], valueType: 'price', valueDecimals: 2 })
  const body = '21' + '00777' + '01250'
  const code = body + gtinCheckDigit(body)
  const sc = parseScaleBarcode(code, cfg)
  assert.ok(sc && sc.plu === '777' && sc.value === 12.5 && sc.valueType === 'price')
  assert.strictEqual(parseScaleBarcode('20' + code.slice(2), cfg), null)
})

t('GS1-128 with FNC1 separators', () => {
  const gs1 = parseGs1(']C10109501101530003\u001d17260131\u001d10AB12\u001d3103001250')
  assert.ok(gs1 && gs1.gtin === '09501101530003' && gs1.expiryDate === '2026-01-31' && gs1.batchNo === 'AB12' && gs1.netWeightKg === 1.25)
  const a = analyseScan(']C10109501101530003\u001d17260131\u001d10AB12\u001d3103001250')
  assert.strictEqual(a.symbology, 'gs1')
  assert.ok(a.candidates.some((c) => c.lookup === '9501101530003'))
})

t('GS1 bracketed human-readable form', () => {
  const gs1 = parseGs1('(01)09501101530003(10)LOT7')
  assert.ok(gs1 && gs1.batchNo === 'LOT7' && gs1.gtin === '09501101530003')
})

t('free-text SKU / QR', () => {
  const a = analyseScan('rice-001')
  assert.strictEqual(a.symbology, 'sku')
  assert.ok(a.candidates.some((c) => c.field === 'sku' && c.lookup === 'RICE-001'))
  assert.strictEqual(analyseScan('https://example.com/x').symbology, 'qr')
})

t('parity with the server engine on 2,000 generated inputs', () => {
  const cfgs = [undefined, { enabled: true }, { enabled: true, prefixes: ['21', '22'], valueType: 'price' as const, valueDecimals: 2 }]
  let seed = 42
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  for (let i = 0; i < 2000; i++) {
    const len = 4 + Math.floor(rnd() * 12)
    let s = ''
    for (let k = 0; k < len; k++) s += String(Math.floor(rnd() * 10))
    if (i % 5 === 0) s = '2' + s.slice(1, 12).padEnd(12, '0')
    if (i % 7 === 0) s = s + gtinCheckDigit(s)
    if (i % 11 === 0) s = `SKU-${s}`
    const cfg = cfgs[i % cfgs.length]
    assert.deepStrictEqual(mobile.analyseScan(s, cfg), server.analyseScan(s, cfg), s)
  }
})

console.log(`\n${passed} barcode checks passed${process.exitCode ? ' (with failures)' : ''}`)
