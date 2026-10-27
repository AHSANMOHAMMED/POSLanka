/**
 * Barcode wedge scanners "type" a whole code in one fast burst of key presses, then send a
 * terminator (Enter, sometimes Tab). People type far slower. This tracker tells the two apart
 * from key timing alone, so Tab can end a scan without breaking normal Tab navigation.
 * Pure (no DOM): the POS page feeds it every printable key press.
 */

/** A gap longer than this starts a new burst (Bluetooth / slow wedge scanners can pause ~150 ms). */
export const SCAN_BURST_RESET_MS = 300
/** Average gap between the keys of a scan (scanners: 5–40 ms; fast typists rarely < 80 ms). */
export const SCAN_AVG_GAP_MS = 50
/** Shortest code treated as a scan */
export const SCAN_MIN_CHARS = 4

export interface ScanBurst {
  /** printable characters in the current burst */
  count: number
  /** time of the first and the last key of the burst */
  start: number
  last: number
}

export function emptyBurst(): ScanBurst {
  return { count: 0, start: 0, last: 0 }
}

/** Record one printable key press at `now` (ms). Returns the updated burst (mutates `b`). */
export function pushBurstKey(b: ScanBurst, now: number): ScanBurst {
  if (b.count === 0 || now - b.last > SCAN_BURST_RESET_MS) {
    b.count = 1
    b.start = now
  } else {
    b.count += 1
  }
  b.last = now
  return b
}

/** Average gap between the keys of the burst (Infinity for fewer than 2 keys). */
export function burstAvgGap(b: ScanBurst): number {
  return b.count < 2 ? Infinity : (b.last - b.start) / (b.count - 1)
}

/**
 * True when a terminator key (Tab) pressed at `now` ends a scanner burst: at least
 * SCAN_MIN_CHARS characters, average gap under SCAN_AVG_GAP_MS, and the terminator itself
 * arriving right after the last character.
 */
export function isScanTerminator(b: ScanBurst, now: number): boolean {
  return b.count >= SCAN_MIN_CHARS && burstAvgGap(b) < SCAN_AVG_GAP_MS && now - b.last < SCAN_BURST_RESET_MS / 2
}

/**
 * AIM symbology identifier a 2D / Code 128 scanner may put in front of the data
 * ("]C0", "]E0", "]Q1" …). GS1 ones (]C1 ]d2 ]Q3 ]e0) are left for the server's GS1 parser.
 * Returns the code without it, or null when there is no (non-GS1) identifier.
 */
export function stripAimPrefix(code: string): string | null {
  if (!/^\][A-Za-z][0-9]/.test(code) || /^\](C1|d2|Q3|e0)/.test(code)) return null
  const rest = code.slice(3)
  return rest.length > 0 ? rest : null
}

/** Visible form of a raw scan: Enter, Tab and control characters as markers ("⏎", "⇥", "[GS]"). */
export function visibleScanText(raw: string): string {
  let out = ''
  for (const ch of raw) {
    const c = ch.charCodeAt(0)
    if (ch === '\n' || ch === '\r') out += '⏎'
    else if (ch === '\t') out += '⇥'
    else if (c === 0x1d) out += '[GS]'
    else if (c === 0x1e) out += '[RS]'
    else if (c === 0x04) out += '[EOT]'
    else if (c === 0) out += '[NUL]'
    else if (c < 0x20 || c === 0x7f) out += `[0x${c.toString(16).padStart(2, '0')}]`
    else if (ch === ' ') out += '␣'
    else out += ch
  }
  return out
}
