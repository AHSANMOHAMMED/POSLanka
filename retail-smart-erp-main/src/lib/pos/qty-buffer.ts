/**
 * Typed-quantity buffer for the selected cart line: the cashier types digits (and one decimal point
 * for weighable / measured lines) and Enter commits. Pure, self-tested in scripts/pos-keyboard-selftest.ts.
 */

export const QTY_BUFFER_MAX_LEN = 8

/**
 * Apply one key to the buffer. Returns the new buffer, or null when the key is not a buffer key
 * (the caller then handles it: Enter, +, −, Delete, arrows …).
 */
export function applyQtyKey(buffer: string, key: string, allowDecimal: boolean): string | null {
  if (/^[0-9]$/.test(key)) {
    if (buffer.length >= QTY_BUFFER_MAX_LEN) return buffer
    if (buffer === '0') return key // no leading zeros
    return buffer + key
  }
  if (key === '.' || key === ',') {
    if (!allowDecimal || buffer.includes('.')) return buffer
    return buffer === '' ? '0.' : buffer + '.'
  }
  if (key === 'Backspace') return buffer.slice(0, -1)
  return null
}

/** Parse a committed buffer: null when empty / not a number. 0 means "remove the line". */
export function parseQtyBuffer(buffer: string, allowDecimal: boolean): number | null {
  if (!buffer || buffer === '.') return null
  const n = Number(buffer.endsWith('.') ? buffer.slice(0, -1) : buffer)
  if (!Number.isFinite(n) || n < 0) return null
  return allowDecimal ? Math.round(n * 1000) / 1000 : Math.floor(n)
}

/** Next selected index for ↑ / ↓ in a list of `count` lines (clamped, no wrap). */
export function moveSelection(index: number, delta: number, count: number): number {
  if (count <= 0) return -1
  if (index < 0) return delta < 0 ? count - 1 : 0
  return Math.min(count - 1, Math.max(0, index + delta))
}
