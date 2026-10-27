/**
 * Print studio size pricing self-check: npx tsx scripts/tests/print-size-pricing.ts
 */
import { calculateSizeLine, pieceArea, piecePerimeter, formatSize, SIZE_PRESETS } from '../../src/lib/print-jobs/size-pricing'

let pass = 0
let fail = 0
const check = (c: boolean, m: string) => (c ? pass++ : (fail++, console.error('  FAIL: ' + m)))
const eq = (a: number, b: number, m: string) => check(Math.abs(a - b) < 0.005, `${m}: expected ${b}, got ${a}`)

console.log('Print studio size pricing test')

// Areas
eq(pieceArea(6, 3, 'ft', 'sqft'), 18, '6x3 ft = 18 sqft')
eq(pieceArea(12, 18, 'inch', 'sqft'), 1.5, '12x18 in = 1.5 sqft')
eq(pieceArea(100, 200, 'cm', 'sqm'), 2, '100x200 cm = 2 sqm')
eq(pieceArea(1, 1, 'm', 'sqft'), 10.76, '1 sqm = 10.76 sqft')
eq(pieceArea(210, 297, 'mm', 'sqft'), 0.67, 'A4 ≈ 0.67 sqft')
eq(piecePerimeter(8, 10, 'inch', 'sqft'), 3, '8x10 in perimeter = 3 ft')

// Flex banner 6x3 ft × 2 @ 120/sqft, eyelets 4/piece @ 10, lamination @ 40
const banner = calculateSizeLine({
  pricingMode: 'area', width: 6, height: 3, sizeUnit: 'ft', quantity: 2, rate: 120, areaUnit: 'sqft',
  finishing: [{ code: 'eyelets', rate: 10, count: 4 }, { code: 'lamination', rate: 40 }],
})
eq(banner.billQty, 36, 'banner billable area')
eq(banner.baseAmount, 4320, 'banner base')
eq(banner.finishing[0].qty, 8, 'eyelets qty')
eq(banner.finishing[0].amount, 80, 'eyelets amount')
eq(banner.finishing[1].amount, 1440, 'lamination amount')
eq(banner.amount, 5840, 'banner total')

// Min charge: sticker 4x4 in (0.11 sqft) with min 1 sqft @ 150, qty 10
const sticker = calculateSizeLine({ pricingMode: 'area', width: 4, height: 4, sizeUnit: 'inch', quantity: 10, rate: 150, minChargeArea: 1 })
check(sticker.minChargeApplied, 'min charge applied')
eq(sticker.billablePerPiece, 1, 'min charge per piece')
eq(sticker.amount, 1500, 'sticker amount')

// Double sided
const ds = calculateSizeLine({ pricingMode: 'area', width: 2, height: 3, sizeUnit: 'ft', quantity: 1, rate: 100, sides: 2 })
eq(ds.amount, 1200, 'double sided doubles print charge')

// Unit mode photo print + frame moulding per running ft
const photo = calculateSizeLine({
  pricingMode: 'unit', width: 8, height: 10, sizeUnit: 'inch', quantity: 3, rate: 250,
  finishing: [{ code: 'frame', rate: 300 }, { code: 'design_fee', rate: 500 }],
})
eq(photo.baseAmount, 750, 'photo base')
eq(photo.finishing[0].qty, 9, 'frame running ft (3 ft × 3)')
eq(photo.finishing[1].amount, 500, 'design fee fixed')
eq(photo.amount, 750 + 2700 + 500, 'photo total')

// Length mode: vinyl 15 ft run @ 80/ft, min 3 ft
const vinyl = calculateSizeLine({ pricingMode: 'length', width: 180, sizeUnit: 'inch', quantity: 1, rate: 80, minChargeArea: 3 })
eq(vinyl.billQty, 15, 'vinyl running ft')
eq(vinyl.amount, 1200, 'vinyl amount')

// Garbage in → zeros, never NaN
const bad = calculateSizeLine({ pricingMode: 'area', width: NaN, height: -1, quantity: 1, rate: 100 })
eq(bad.amount, 0, 'invalid size → 0')

check(formatSize(210, 297, 'mm') === 'A4', 'A4 label')
check(formatSize(6, 3, 'ft') === '6 × 3 ft', 'ft label')
check(SIZE_PRESETS.length === 12, '12 presets')

console.log(`${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
