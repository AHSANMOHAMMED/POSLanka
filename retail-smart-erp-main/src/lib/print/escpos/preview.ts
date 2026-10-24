/**
 * Decode ESC/POS bytes produced by our builders into preview lines (text with
 * bold / size / alignment, plus placeholders for images, barcodes and QR codes)
 * so the receipt settings page can show exactly what a raw thermal printer
 * will print, column for column. Pure; understands the commands EscPosBuilder emits.
 */

export interface EscPosPreviewLine {
  kind: 'text' | 'image' | 'barcode' | 'qr' | 'cut'
  text: string
  bold: boolean
  /** Width / height multipliers. */
  w: number
  h: number
  align: 'left' | 'center' | 'right'
  /** Font B (small). */
  small: boolean
  /** Image size in dots. */
  width?: number
  height?: number
}

const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '

export function decodeEscPosPreview(bytes: Uint8Array): EscPosPreviewLine[] {
  const out: EscPosPreviewLine[] = []
  let bold = false
  let w = 1
  let h = 1
  let align: EscPosPreviewLine['align'] = 'left'
  let small = false
  let text = ''
  const push = (kind: EscPosPreviewLine['kind'], t: string, extra: Partial<EscPosPreviewLine> = {}) =>
    out.push({ kind, text: t, bold, w, h, align, small, ...extra })
  const flush = () => {
    push('text', text)
    text = ''
  }
  let i = 0
  const n = bytes.length
  while (i < n) {
    const b = bytes[i]
    if (b === 0x0a) {
      flush()
      i++
    } else if (b === 0x1b) {
      const c = bytes[i + 1]
      if (c === 0x40) {
        bold = false
        w = h = 1
        align = 'left'
        small = false
        i += 2
      } else if (c === 0x61) {
        const v = bytes[i + 2]
        align = v === 1 || v === 0x31 ? 'center' : v === 2 || v === 0x32 ? 'right' : 'left'
        i += 3
      } else if (c === 0x45) {
        bold = !!bytes[i + 2]
        i += 3
      } else if (c === 0x4d) {
        small = bytes[i + 2] === 1 || bytes[i + 2] === 0x31
        i += 3
      } else if (c === 0x64) {
        if (text) flush()
        for (let k = 0; k < bytes[i + 2]; k++) push('text', '')
        i += 3
      } else if (c === 0x70) i += 5
      else i += 3 // ESC t / ESC - / ESC J and other 1-arg commands
    } else if (b === 0x1d) {
      const c = bytes[i + 1]
      if (c === 0x21) {
        const v = bytes[i + 2]
        w = ((v >> 4) & 7) + 1
        h = (v & 7) + 1
        i += 3
      } else if (c === 0x56) {
        if (text) flush()
        push('cut', '')
        i += 3
      } else if (c === 0x6b) {
        // GS k 73 len data (CODE128 with {B prefix)
        const len = bytes[i + 3]
        const data = String.fromCharCode(...bytes.subarray(i + 4, i + 4 + len)).replace(/^\{B/, '')
        push('barcode', data)
        i += 4 + len
      } else if (c === 0x28 && bytes[i + 2] === 0x6b) {
        const len = bytes[i + 3] | (bytes[i + 4] << 8)
        const fn = bytes[i + 6]
        if (fn === 80) push('qr', new TextDecoder().decode(bytes.subarray(i + 8, i + 5 + len)))
        i += 5 + len
      } else if (c === 0x76 && bytes[i + 2] === 0x30) {
        const bpr = bytes[i + 4] | (bytes[i + 5] << 8)
        const rows = bytes[i + 6] | (bytes[i + 7] << 8)
        if (text) flush()
        push('image', '', { width: bpr * 8, height: rows })
        i += 8 + bpr * rows
      } else i += 3 // GS h / GS w / GS H
    } else {
      text += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80] || '?'
      i++
    }
  }
  if (text) flush()
  return out
}
