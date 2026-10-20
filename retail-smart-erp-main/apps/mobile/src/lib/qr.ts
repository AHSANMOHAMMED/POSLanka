// Pure-TS QR Code encoder (ISO/IEC 18004) used for HTML / PDF receipts.
//
//   - byte mode (UTF-8), error correction level M, versions 1-10 (up to 213 bytes)
//   - Reed-Solomon over GF(256) / 0x11D, block interleaving
//   - format + version information (BCH), all 8 masks scored with the four
//     standard penalty rules (same scoring as the `qrcode` npm package, so the
//     auto-selected mask matches it)
// No dependencies: runs in Hermes, node and the browser.

export const QR_MAX_VERSION = 10

/** EC level M: [ecc codewords per block, number of blocks] for versions 1..10. */
const ECC_M: Array<[number, number]> = [
  [10, 1],
  [16, 1],
  [26, 1],
  [18, 2],
  [24, 2],
  [16, 4],
  [18, 4],
  [22, 4],
  [22, 5],
  [26, 5],
]

export interface QrOptions {
  /** Force a version (1-10). Default: smallest that fits. */
  version?: number
  /** Force a mask (0-7). Default: lowest penalty. */
  mask?: number
}

export interface QrCode {
  version: number
  mask: number
  size: number
  /** modules[row][col], true = dark. */
  modules: boolean[][]
}

// ---------------------------------------------------------------------------
// UTF-8 (identical to TextEncoder, incl. U+FFFD for lone surrogates)
// ---------------------------------------------------------------------------
export function utf8Bytes(s: string): number[] {
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00)
        i++
      } else c = 0xfffd
    } else if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

// ---------------------------------------------------------------------------
// Capacity helpers
// ---------------------------------------------------------------------------
function rawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (ver >= 7) result -= 36
  }
  return result
}

function dataCodewords(ver: number): number {
  const [ecc, blocks] = ECC_M[ver - 1]
  return Math.floor(rawDataModules(ver) / 8) - ecc * blocks
}

/** Max byte-mode payload (bytes) at EC level M for a version. */
export function qrByteCapacity(ver: number): number {
  const ccBits = ver <= 9 ? 8 : 16
  return Math.floor((dataCodewords(ver) * 8 - 4 - ccBits) / 8)
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return []
  const size = ver * 4 + 17
  const numAlign = Math.floor(ver / 7) + 2
  const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2
  const result = [6]
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos)
  return result
}

// ---------------------------------------------------------------------------
// Reed-Solomon
// ---------------------------------------------------------------------------
function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function rsDivisor(degree: number): number[] {
  const result: number[] = new Array(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < degree) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return result
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result: number[] = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    divisor.forEach((coef, i) => (result[i] ^= gfMul(coef, factor)))
  }
  return result
}

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------
function buildCodewords(bytes: number[], ver: number): number[] {
  const bits: number[] = []
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  put(0x4, 4) // byte mode
  put(bytes.length, ver <= 9 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  const capBits = dataCodewords(ver) * 8
  put(0, Math.min(4, capBits - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]
    data.push(v)
  }
  for (let pad = 0xec; data.length < capBits / 8; pad ^= 0xec ^ 0x11) data.push(pad)

  // Split into blocks, add ECC, interleave.
  const [eccLen, numBlocks] = ECC_M[ver - 1]
  const rawCodewords = Math.floor(rawDataModules(ver) / 8)
  const numShort = numBlocks - (rawCodewords % numBlocks)
  const shortLen = Math.floor(rawCodewords / numBlocks)
  const divisor = rsDivisor(eccLen)
  const blocks: number[][] = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1))
    k += dat.length
    const ecc = rsRemainder(dat, divisor)
    if (i < numShort) dat.push(0) // placeholder so all blocks have equal length
    blocks.push(dat.concat(ecc))
  }
  const result: number[] = []
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - eccLen || j >= numShort) result.push(block[i])
    })
  }
  return result
}

function maskBit(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0
    case 1:
      return row % 2 === 0
    case 2:
      return col % 3 === 0
    case 3:
      return (row + col) % 3 === 0
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0
    default:
      return (((row * col) % 3) + ((row + col) % 2)) % 2 === 0
  }
}

/** Penalty score (N1 runs, N2 2x2 blocks, N3 finder-like, N4 balance). */
export function qrPenalty(m: boolean[][]): number {
  const size = m.length
  let points = 0
  // N1
  for (let a = 0; a < size; a++) {
    for (const horizontal of [true, false]) {
      let run = 0
      let last: boolean | null = null
      for (let b = 0; b < size; b++) {
        const v = horizontal ? m[a][b] : m[b][a]
        if (v === last) run++
        else {
          if (run >= 5) points += 3 + (run - 5)
          last = v
          run = 1
        }
      }
      if (run >= 5) points += 3 + (run - 5)
    }
  }
  // N2
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const s = +m[r][c] + +m[r][c + 1] + +m[r + 1][c] + +m[r + 1][c + 1]
      if (s === 0 || s === 4) points += 3
    }
  }
  // N3
  for (let a = 0; a < size; a++) {
    let bh = 0
    let bv = 0
    for (let b = 0; b < size; b++) {
      bh = ((bh << 1) & 0x7ff) | (m[a][b] ? 1 : 0)
      bv = ((bv << 1) & 0x7ff) | (m[b][a] ? 1 : 0)
      if (b >= 10 && (bh === 0x5d0 || bh === 0x05d)) points += 40
      if (b >= 10 && (bv === 0x5d0 || bv === 0x05d)) points += 40
    }
  }
  // N4
  let dark = 0
  for (const row of m) for (const v of row) if (v) dark++
  const k = Math.abs(Math.ceil((dark * 100) / (size * size) / 5) - 10)
  points += k * 10
  return points
}

/** Encodes `text` (UTF-8 byte mode, EC level M). Throws when it does not fit version 10. */
export function encodeQrCode(text: string, opts: QrOptions = {}): QrCode {
  const bytes = utf8Bytes(text)
  let ver = opts.version ?? 0
  if (ver) {
    if (ver < 1 || ver > QR_MAX_VERSION) throw new RangeError(`QR version must be 1-${QR_MAX_VERSION}`)
    if (bytes.length > qrByteCapacity(ver)) throw new RangeError(`Data does not fit QR version ${ver}`)
  } else {
    for (let v = 1; v <= QR_MAX_VERSION; v++) {
      if (bytes.length <= qrByteCapacity(v)) {
        ver = v
        break
      }
    }
    if (!ver) throw new RangeError(`QR data too long (${bytes.length} bytes, max ${qrByteCapacity(QR_MAX_VERSION)})`)
  }

  const size = ver * 4 + 17
  const mods: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const fn: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (row: number, col: number, dark: boolean) => {
    mods[row][col] = dark
    fn[row][col] = true
  }

  // Timing patterns
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  // Finder patterns + separators
  const finder = (cr: number, cc: number) => {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const r = cr + dr
        const c = cc + dc
        if (r < 0 || r >= size || c < 0 || c >= size) continue
        const d = Math.max(Math.abs(dr), Math.abs(dc))
        set(r, c, d !== 2 && d !== 4)
      }
    }
  }
  finder(3, 3)
  finder(3, size - 4)
  finder(size - 4, 3)
  // Alignment patterns
  const al = alignmentPositions(ver)
  for (let i = 0; i < al.length; i++) {
    for (let j = 0; j < al.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(al[i] + dr, al[j] + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1)
    }
  }
  // Format area reservation (real bits drawn per mask) + dark module
  const drawFormat = (mask: number) => {
    const data = (0 << 3) | mask // EC level M = 00
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bits = ((data << 10) | rem) ^ 0x5412
    const bit = (i: number) => ((bits >>> i) & 1) !== 0
    for (let i = 0; i <= 5; i++) set(i, 8, bit(i))
    set(7, 8, bit(6))
    set(8, 8, bit(7))
    set(8, 7, bit(8))
    for (let i = 9; i < 15; i++) set(8, 14 - i, bit(i))
    for (let i = 0; i < 8; i++) set(8, size - 1 - i, bit(i))
    for (let i = 8; i < 15; i++) set(size - 15 + i, 8, bit(i))
    set(size - 8, 8, true)
  }
  drawFormat(0)
  // Version information
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(b, a, dark)
      set(a, b, dark)
    }
  }

  // Data placement (zig-zag)
  const codewords = buildCodewords(bytes, ver)
  let bitIdx = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j
        const upward = ((right + 1) & 2) === 0
        const row = upward ? size - 1 - vert : vert
        if (!fn[row][col] && bitIdx < codewords.length * 8) {
          mods[row][col] = ((codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) !== 0
          bitIdx++
        }
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!fn[r][c] && maskBit(mask, r, c)) mods[r][c] = !mods[r][c]
  }

  let mask = opts.mask ?? -1
  if (mask < 0 || mask > 7) {
    let best = Infinity
    for (let p = 0; p < 8; p++) {
      drawFormat(p)
      applyMask(p)
      const pen = qrPenalty(mods)
      applyMask(p)
      if (pen < best) {
        best = pen
        mask = p
      }
    }
  }
  applyMask(mask)
  drawFormat(mask)
  return { version: ver, mask, size, modules: mods }
}

/** Module matrix (rows of booleans, true = dark) for `text`. */
export function encodeQr(text: string, opts: QrOptions = {}): boolean[][] {
  return encodeQrCode(text, opts).modules
}

/**
 * Inline SVG for `text`. `sizePx` is the rendered width/height including a
 * quiet zone of `margin` modules (default 4).
 */
export function qrSvg(text: string, sizePx = 120, opts: QrOptions & { margin?: number } = {}): string {
  const m = encodeQr(text, opts)
  const margin = Math.max(0, Math.round(opts.margin ?? 4))
  const total = m.length + margin * 2
  let d = ''
  for (let r = 0; r < m.length; r++) {
    let c = 0
    while (c < m.length) {
      if (!m[r][c]) {
        c++
        continue
      }
      let end = c
      while (end < m.length && m[r][end]) end++
      d += `M${c + margin} ${r + margin}h${end - c}v1h-${end - c}z`
      c = end
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
}
