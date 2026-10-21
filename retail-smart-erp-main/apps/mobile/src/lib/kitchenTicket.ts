// Kitchen order ticket (KOT) builder + kitchen send planner for the mobile POS.
// Pure TS port of the web src/lib/print/escpos/kitchen-ticket.ts and src/lib/print/kitchen-delta.ts:
// for the same input and paper width the bytes are identical to the web ticket (cp437, no
// bitmap text). Output goes through the mobile EscPosBuilder; a tiny writer below reproduces
// the web builder's styled-line semantics (style applied, line printed, style restored).
import { EscPosBuilder, type PaperWidth } from './escpos'

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

export type KitchenOrderType = 'dine_in' | 'takeaway' | 'delivery'

export interface KitchenTicketItem {
  name: string
  quantity: number
  modifiers?: string[]
  notes?: string | null
  /** 'add' prints "+3 x Burger" (increase since the last ticket), 'void' prints "VOID 1 x Burger". */
  mark?: 'add' | 'void'
}

export interface KitchenTicketInput {
  orderNo: string
  orderType?: KitchenOrderType | string | null
  table?: string | null
  tableArea?: string | null
  server?: string | null
  time: Date | string
  items: KitchenTicketItem[]
  reprint?: boolean
  note?: string | null
}

export interface KitchenTicketOptions {
  paperWidth: PaperWidth
  noCut?: boolean
  formatTime?: (d: Date) => string
}

export function kitchenOrderTypeLabel(t: string | null | undefined): string {
  if (t === 'dine_in') return 'DINE-IN'
  if (t === 'takeaway') return 'TAKEAWAY'
  if (t === 'delivery') return 'DELIVERY'
  return t ? t.replace(/_/g, ' ').toUpperCase() : ''
}

export function kitchenModifierLabels(modifiers: unknown): string[] {
  if (!Array.isArray(modifiers)) return []
  return modifiers
    .map((m) => {
      if (typeof m === 'string') return m
      if (m && typeof m === 'object') {
        const o = m as Record<string, unknown>
        const name = o.name ?? o.modifierName ?? o.label
        return typeof name === 'string' ? name : null
      }
      return null
    })
    .filter((m): m is string => !!m && m.trim().length > 0)
}

// ---------------------------------------------------------------------------
// Text helpers (same algorithms as the web encoder)
// ---------------------------------------------------------------------------
function encodeCp437(text: string): number[] {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    out.push(c === LF || c === 0x09 || (c >= 0x20 && c <= 0x7e) ? c : 0x3f)
  }
  return out
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length)
}

function padLeft(text: string, width: number): string {
  return text.length >= width ? text.slice(text.length - width) : ' '.repeat(width - text.length) + text
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let cur = ''
    for (const w of words) {
      if (w.length > width) {
        if (cur) lines.push(cur)
        cur = ''
        for (let i = 0; i < w.length; i += width) lines.push(w.slice(i, i + width))
        continue
      }
      if (!cur) cur = w
      else if (cur.length + 1 + w.length <= width) cur += ' ' + w
      else {
        lines.push(cur)
        cur = w
      }
    }
    if (cur) lines.push(cur)
  }
  return lines
}

type Align = 'left' | 'center' | 'right'
interface Style {
  bold?: boolean
  size?: 1 | 2
  align?: Align
}

/** Styled-line writer on top of the mobile EscPosBuilder (web EscPosBuilder semantics). */
class KotWriter {
  readonly b: EscPosBuilder
  readonly columns: number
  private curAlign: Align = 'left'
  private curBold = false
  private curSize: 1 | 2 = 1

  constructor(paperWidth: PaperWidth) {
    this.b = new EscPosBuilder(paperWidth)
    this.columns = this.b.cols
  }

  line(str = ''): this {
    this.b.raw(encodeCp437(str)).raw([LF])
    return this
  }

  align(a: Align): this {
    this.curAlign = a
    this.b.align(a)
    return this
  }

  styledLine(str: string, style?: Style): this {
    const alignByte = (a: Align) => (a === 'center' ? 1 : a === 'right' ? 2 : 0)
    if (style) {
      if (style.align !== undefined) this.b.raw([ESC, 0x61, alignByte(style.align)])
      if (style.bold !== undefined) this.b.raw([ESC, 0x45, style.bold ? 1 : 0])
      if (style.size !== undefined) this.b.raw([GS, 0x21, style.size === 2 ? 0x11 : 0])
    }
    this.line(str)
    if (style) {
      if (style.align !== undefined) this.b.raw([ESC, 0x61, alignByte(this.curAlign)])
      if (style.bold !== undefined) this.b.raw([ESC, 0x45, this.curBold ? 1 : 0])
      if (style.size !== undefined) this.b.raw([GS, 0x21, this.curSize === 2 ? 0x11 : 0])
    }
    return this
  }

  paragraph(text: string, style?: Style): this {
    const size = style?.size ?? this.curSize
    const width = size === 2 ? Math.floor(this.columns / 2) : this.columns
    for (const l of wrap(text, width)) this.styledLine(l, style)
    return this
  }

  hr(char = '-'): this {
    return this.line(char.repeat(this.columns))
  }

  row(left: string, right: string): this {
    const rightW = Math.min(right.length, this.columns - 1)
    const leftW = this.columns - rightW - 1
    const leftLines = wrap(left, Math.max(1, leftW))
    for (let i = 0; i < leftLines.length; i++) {
      if (i === leftLines.length - 1) this.styledLine(padRight(leftLines[i], leftW) + ' ' + padLeft(right, rightW))
      else this.styledLine(leftLines[i])
    }
    return this
  }
}

function defaultFormatTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function qtyText(q: number): string {
  if (!Number.isFinite(q)) return '0'
  return Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function qtyPrefix(it: KitchenTicketItem): string {
  return it.mark === 'add' ? '+' : it.mark === 'void' ? 'VOID ' : ''
}

function hanging(prefix: string, text: string, width: number): string[] {
  const indent = ' '.repeat(Math.min(prefix.length, Math.max(0, width - 4)))
  const body = wrap(text, Math.max(4, width - indent.length))
  return body.map((l, i) => (i === 0 ? prefix + l : indent + l))
}

export function buildKitchenTicket(input: KitchenTicketInput, opts: KitchenTicketOptions): Uint8Array {
  const w = new KotWriter(opts.paperWidth)
  const bigCols = Math.floor(w.columns / 2)
  const big: Style = { size: 2, bold: true }

  const t = input.time instanceof Date ? input.time : new Date(input.time)
  const timeText = Number.isNaN(t.getTime()) ? String(input.time) : (opts.formatTime ?? defaultFormatTime)(t)

  w.b.init()
  w.b.raw([ESC, 0x74, 0]) // ESC t 0: CP437

  w.align('center')
  if (input.reprint) w.styledLine('** REPRINT **', { bold: true, size: 2, align: 'center' })
  w.styledLine('KITCHEN ORDER', { bold: true, align: 'center' })
  w.paragraph(`#${input.orderNo}`, { bold: true, size: 2, align: 'center' })
  const typeLabel = kitchenOrderTypeLabel(input.orderType)
  if (typeLabel) w.paragraph(typeLabel, { bold: true, size: 2, align: 'center' })
  if (input.table) {
    const tb = input.table.trim()
    w.paragraph(/^table\b/i.test(tb) ? tb : `Table ${tb}`, { bold: true, size: 2, align: 'center' })
  }
  w.align('left')
  w.hr('=')
  if (input.tableArea) w.row('Area:', input.tableArea)
  if (input.server) w.row('Server:', input.server)
  w.row('Time:', timeText)
  w.hr('=')

  let count = 0
  input.items.forEach((it, idx) => {
    if (idx > 0) w.line()
    if (it.mark !== 'void') count += Number.isFinite(it.quantity) ? it.quantity : 0
    for (const l of hanging(`${qtyPrefix(it)}${qtyText(it.quantity)} x `, it.name, bigCols)) w.styledLine(l, big)
    for (const m of it.modifiers || []) {
      for (const l of hanging('  + ', m, bigCols)) w.styledLine(l, { size: 2 })
    }
    const notes = (it.notes || '').trim()
    if (notes) {
      for (const l of hanging('  * ', notes, bigCols)) w.styledLine(l, { size: 2 })
    }
  })

  if (input.note && input.note.trim()) {
    w.hr()
    for (const l of wrap(`NOTE: ${input.note.trim()}`, bigCols)) w.styledLine(l, big)
  }

  w.hr('=')
  w.row(`${input.items.length} line(s)`, `${qtyText(count)} item(s)`)
  if (input.reprint) w.styledLine('** REPRINT **', { bold: true, align: 'center' })
  w.b.feed(3)
  if (!opts.noCut) w.b.raw([GS, 0x56, 1])
  return w.b.bytes()
}

// ---------------------------------------------------------------------------
// Kitchen send planner (port of web src/lib/print/kitchen-delta.ts)
// ---------------------------------------------------------------------------
const EPS = 1e-6

export interface KitchenCartLine {
  cartLineId: string
  itemId?: string | null
  name: string
  quantity: number
  modifiers?: string[]
  notes?: string | null
}

export interface KitchenSentEntry {
  name: string
  itemId?: string | null
  quantity: number
  modifiers?: string[]
  notes?: string | null
}

export type KitchenSentMap = Record<string, KitchenSentEntry>

export interface KitchenPlan {
  added: KitchenCartLine[]
  increased: Array<{ line: KitchenCartLine; delta: number }>
  decreased: Array<{ cartLineId: string; entry: KitchenSentEntry; delta: number; removed: boolean }>
}

export function roundKitchenQty(q: number): number {
  return Math.round((Number.isFinite(q) ? q : 0) * 1000) / 1000
}

export function planKitchenSend(lines: KitchenCartLine[], sent: KitchenSentMap): KitchenPlan {
  const plan: KitchenPlan = { added: [], increased: [], decreased: [] }
  const seen = new Set<string>()
  for (const line of lines) {
    seen.add(line.cartLineId)
    const q = roundKitchenQty(line.quantity)
    const prev = sent[line.cartLineId]
    if (!prev) {
      if (q > EPS) plan.added.push({ ...line, quantity: q })
      continue
    }
    const delta = roundKitchenQty(q - prev.quantity)
    if (delta > EPS) plan.increased.push({ line: { ...line, quantity: q }, delta })
    else if (delta < -EPS) plan.decreased.push({ cartLineId: line.cartLineId, entry: prev, delta: -delta, removed: q <= EPS })
  }
  for (const [id, entry] of Object.entries(sent)) {
    if (seen.has(id) || entry.quantity <= EPS) continue
    plan.decreased.push({ cartLineId: id, entry, delta: roundKitchenQty(entry.quantity), removed: true })
  }
  return plan
}

export function isEmptyKitchenPlan(plan: KitchenPlan): boolean {
  return plan.added.length === 0 && plan.increased.length === 0 && plan.decreased.length === 0
}

export function kitchenPlanTicketItems(plan: KitchenPlan): KitchenTicketItem[] {
  return [
    ...plan.added.map((l) => ({ name: l.name, quantity: l.quantity, modifiers: l.modifiers, notes: l.notes ?? null })),
    ...plan.increased.map(({ line, delta }) => ({ name: line.name, quantity: delta, modifiers: line.modifiers, notes: line.notes ?? null, mark: 'add' as const })),
    ...plan.decreased.map(({ entry, delta }) => ({ name: entry.name, quantity: delta, modifiers: entry.modifiers, mark: 'void' as const })),
  ]
}

export function applyKitchenPlan(sent: KitchenSentMap, plan: KitchenPlan): KitchenSentMap {
  const next: KitchenSentMap = { ...sent }
  for (const l of plan.added) next[l.cartLineId] = { name: l.name, itemId: l.itemId ?? null, quantity: l.quantity, modifiers: l.modifiers, notes: l.notes ?? null }
  for (const { line } of plan.increased) next[line.cartLineId] = { ...next[line.cartLineId], name: line.name, quantity: line.quantity }
  for (const d of plan.decreased) {
    if (d.removed) delete next[d.cartLineId]
    else next[d.cartLineId] = { ...next[d.cartLineId], quantity: roundKitchenQty(next[d.cartLineId].quantity - d.delta) }
  }
  return next
}
