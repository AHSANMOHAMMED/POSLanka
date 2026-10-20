/**
 * C3: mobile QR encoder (apps/mobile/src/lib/qr.ts) vs the `qrcode` npm package.
 * Byte mode, EC level M, versions 1-10: module matrices must be identical, both
 * with the auto-selected mask and with every forced mask.
 * Run: npx tsx scripts/tests/c3-mobile-qr.ts
 */
import { encodeQrCode, qrSvg, qrByteCapacity, QR_MAX_VERSION } from '../../apps/mobile/src/lib/qr'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const QRCode = require('qrcode')

let pass = 0
let fail = 0
function check(cond: boolean, msg: string) {
  if (cond) pass++
  else {
    fail++
    console.error(`  FAIL: ${msg}`)
  }
}

function libMatrix(text: string, opts: { version?: number; maskPattern?: number } = {}) {
  const q = QRCode.create([{ data: text, mode: 'byte' }], { errorCorrectionLevel: 'M', ...opts })
  const size: number = q.modules.size
  const rows: boolean[][] = []
  for (let r = 0; r < size; r++) {
    const row: boolean[] = []
    for (let c = 0; c < size; c++) row.push(!!q.modules.data[r * size + c])
    rows.push(row)
  }
  return { version: q.version as number, mask: q.maskPattern as number, rows }
}

const same = (a: boolean[][], b: boolean[][]) => a.length === b.length && a.every((row, r) => row.every((v, c) => v === b[r][c]))

function strOfLen(n: number, seed: number) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_/.:'
  let s = ''
  let x = seed
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    s += alphabet[x % alphabet.length]
  }
  return s
}

console.log('C3 mobile QR encoder tests')

const samples: string[] = [
  'HELLO WORLD',
  'INV-000123',
  'OFF-20261021-0001',
  'https://poslanka.lk/r/INV-2026-000001',
  'Rice "Keeri" 5kg – රු 1500 / ரூ',
  // (empty input omitted: the qrcode package drops empty segments entirely)
]
for (let v = 1; v <= QR_MAX_VERSION; v++) {
  samples.push(strOfLen(qrByteCapacity(v), v)) // exactly full
  samples.push(strOfLen(Math.max(1, qrByteCapacity(v) - 3), v * 7)) // nearly full
}

const capsM = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]
for (let v = 1; v <= QR_MAX_VERSION; v++) check(qrByteCapacity(v) === capsM[v - 1], `byte capacity v${v} = ${capsM[v - 1]}`)

const versionsSeen = new Set<number>()
for (const s of samples) {
  const mine = encodeQrCode(s)
  const lib = libMatrix(s)
  versionsSeen.add(mine.version)
  check(mine.version === lib.version, `version for ${JSON.stringify(s.slice(0, 20))} (${mine.version} vs ${lib.version})`)
  check(mine.mask === lib.mask, `auto mask for ${JSON.stringify(s.slice(0, 20))} v${mine.version} (${mine.mask} vs ${lib.mask})`)
  check(same(mine.modules, lib.rows), `matrix (auto mask) for ${JSON.stringify(s.slice(0, 20))} v${mine.version}`)
  for (let m = 0; m < 8; m++) {
    const a = encodeQrCode(s, { mask: m })
    const b = libMatrix(s, { maskPattern: m })
    check(same(a.modules, b.rows), `matrix mask ${m} for ${JSON.stringify(s.slice(0, 20))} v${a.version}`)
  }
}
// forced larger versions
for (let v = 1; v <= QR_MAX_VERSION; v++) {
  const a = encodeQrCode('INV-1', { version: v })
  const b = libMatrix('INV-1', { version: v })
  check(a.size === 17 + 4 * v && same(a.modules, b.rows), `forced version ${v}`)
}
check(versionsSeen.size === QR_MAX_VERSION, `covered versions 1-${QR_MAX_VERSION} (${[...versionsSeen].sort((x, y) => x - y).join(',')})`)

let threw = false
try {
  encodeQrCode('x'.repeat(214))
} catch {
  threw = true
}
check(threw, 'too long data throws')

const svg = qrSvg('INV-000123', 120)
check(svg.startsWith('<svg') && svg.includes('width="120"') && svg.includes('viewBox="0 0 29 29"') && svg.includes('<path d="M'), 'qrSvg output')

console.log(`  ${pass} passed, ${fail} failed`)
console.log(fail ? 'FAIL' : 'PASS')
if (fail) process.exit(1)
