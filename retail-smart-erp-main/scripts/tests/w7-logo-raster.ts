/**
 * W7 logo raster test: npx tsx scripts/tests/w7-logo-raster.ts
 * Generates sample PNGs with sharp and checks GS v 0 packing / centering.
 */
import sharp from 'sharp'
import { rasterizeLogo } from '../../src/lib/print/logo-raster'

let pass = 0
let fail = 0
const check = (c: boolean, m: string) => (c ? pass++ : (fail++, console.error('  FAIL: ' + m)))

function bit(data: Uint8Array, width: number, x: number, y: number) {
  const bpr = Math.ceil(width / 8)
  return (data[y * bpr + (x >> 3)] >> (7 - (x & 7))) & 1
}

async function main() {
  console.log('W7 logo raster test')
  // 200x100: left half black, right half white, transparent bottom strip
  const w = 200
  const h = 100
  const raw = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const black = x < w / 2
      raw[i] = raw[i + 1] = raw[i + 2] = black ? 0 : 255
      raw[i + 3] = y >= 90 ? 0 : 255 // transparent -> flattened to white
    }
  const png = await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()

  for (const paper of [384, 576]) {
    const r = await rasterizeLogo(png, { paperDots: paper, pct: 50 })
    const data = new Uint8Array(Buffer.from(r.data, 'base64'))
    const logoW = Math.round((paper * 50) / 100)
    check(r.width === paper, `${paper}: bitmap width = paper width`)
    check(r.logoWidth === logoW, `${paper}: logo width = 50% (${r.logoWidth} vs ${logoW})`)
    check(r.height === Math.round((h * logoW) / w), `${paper}: aspect ratio kept (h=${r.height})`)
    check(data.length === (paper / 8) * r.height, `${paper}: ${paper / 8} bytes per row`)
    const off = Math.floor((paper - logoW) / 2)
    const midY = Math.floor(r.height / 3)
    check(bit(data, paper, off + 2, midY) === 1, `${paper}: left part black (MSB-first, black=1)`)
    check(bit(data, paper, off + logoW - 3, midY) === 0, `${paper}: right part white`)
    check(bit(data, paper, off - 2, midY) === 0 && bit(data, paper, off + logoW + 2, midY) === 0, `${paper}: margins white (centered)`)
    check(bit(data, paper, off + 2, r.height - 1) === 0, `${paper}: transparent area flattened to white`)
    const meta = await sharp(Buffer.from(r.pngBase64, 'base64')).metadata()
    check(meta.format === 'png' && meta.width === logoW, `${paper}: pngBase64 is a ${logoW}px PNG`)
  }

  // Very tall logos are capped
  const tall = await sharp({ create: { width: 50, height: 1000, channels: 3, background: '#000' } }).png().toBuffer()
  const t = await rasterizeLogo(tall, { paperDots: 576, pct: 100 })
  check(t.height <= 240, 'tall logo capped at 240 dots')
  // Gray 50% gets dithered (some but not all bits)
  const gray = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#808080' } }).png().toBuffer()
  const g = await rasterizeLogo(gray, { paperDots: 384, pct: 40 })
  const gd = new Uint8Array(Buffer.from(g.data, 'base64'))
  let ones = 0
  for (const b of gd) for (let i = 0; i < 8; i++) ones += (b >> i) & 1
  const area = g.logoWidth * g.height
  check(ones > area * 0.3 && ones < area * 0.7, `gray dithered to ~50% (${((ones / area) * 100).toFixed(1)}%)`)

  console.log(`  ${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
