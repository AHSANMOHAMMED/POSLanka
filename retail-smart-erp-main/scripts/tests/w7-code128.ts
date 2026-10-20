/**
 * Mobile Code128 encoder vs bwip-js: npx tsx scripts/tests/w7-code128.ts
 */
import * as bwipjs from 'bwip-js/browser'
import { code128Widths, code128Values, code128Svg } from '../../apps/mobile/src/lib/code128'

let pass = 0
let fail = 0
const check = (c: boolean, m: string) => (c ? pass++ : (fail++, console.error('  FAIL: ' + m)))

console.log('Code128 (mobile) test')
for (const s of ['ABC-xyz', 'OFF-K3J9', 'Hello World!', '12345678', '20260101']) {
  const mine = code128Widths(s)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (bwipjs as any).raw('code128', s, '') as Array<{ sbs: number[] }>
  const ref = raw[0].sbs
  check(mine.join(',') === ref.join(','), `${s}: matches bwip-js (${mine.length} vs ${ref.length})`)
}
// INV-000123 mixes sets in bwip; just check structure
const v = code128Values('INV-000123')
check(v[0] === 104 && v[v.length - 1] === 106, 'INV-000123: start B ... stop')
const widths = code128Widths('INV-000123')
check(widths.reduce((a, b) => a + b, 0) === 11 * (v.length - 1) + 13, 'module count = 11 per symbol + 13 stop')
const svg = code128Svg('INV-1')
check(svg.startsWith('<svg') && svg.includes('<rect') && svg.includes('>INV-1</text>'), 'svg output')
console.log(`  ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
