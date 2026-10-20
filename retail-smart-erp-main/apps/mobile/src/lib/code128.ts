// Pure TypeScript Code 128 encoder (no native deps) used to draw the invoice
// barcode as inline SVG on HTML / PDF receipts (expo-print). Uses code set C
// for all-digit data of even length >= 4, otherwise code set B (printable ASCII).

/** Bar/space widths for symbol values 0..106 (106 = stop, 7 elements). */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

const START_B = 104
const START_C = 105
const STOP = 106

/** Symbol values (start, data, checksum, stop) for `data`. Non-ASCII characters become '?'. */
export function code128Values(data: string): number[] {
  const clean = Array.from(String(data ?? ''))
    .map((ch) => {
      const c = ch.charCodeAt(0)
      return c >= 0x20 && c <= 0x7e ? ch : '?'
    })
    .join('')
  const useC = /^\d+$/.test(clean) && clean.length >= 4 && clean.length % 2 === 0
  const values: number[] = [useC ? START_C : START_B]
  if (useC) {
    for (let i = 0; i < clean.length; i += 2) values.push(parseInt(clean.slice(i, i + 2), 10))
  } else {
    for (const ch of clean) values.push(ch.charCodeAt(0) - 32)
  }
  let sum = values[0]
  for (let i = 1; i < values.length; i++) sum += values[i] * i
  values.push(sum % 103)
  values.push(STOP)
  return values
}

/** Alternating bar/space module widths, starting with a bar. */
export function code128Widths(data: string): number[] {
  const out: number[] = []
  for (const v of code128Values(data)) for (const d of PATTERNS[v]) out.push(Number(d))
  return out
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Inline SVG for `data`. Width scales with the container (viewBox); quiet zones
 * of 10 modules are included on both sides.
 */
export function code128Svg(data: string, opts: { height?: number; showText?: boolean } = {}): string {
  const widths = code128Widths(data)
  const quiet = 10
  const total = widths.reduce((s, w) => s + w, 0) + quiet * 2
  const barH = opts.height ?? 40
  const textH = opts.showText === false ? 0 : 12
  let x = quiet
  let rects = ''
  widths.forEach((w, i) => {
    if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${barH}"/>`
    x += w
  })
  const text =
    opts.showText === false
      ? ''
      : `<text x="${total / 2}" y="${barH + 10}" text-anchor="middle" font-family="monospace" font-size="10">${escapeXml(data)}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${barH + textH}" preserveAspectRatio="none" style="width:100%;height:${barH + textH}px" fill="#000">${rects}${text}</svg>`
}
