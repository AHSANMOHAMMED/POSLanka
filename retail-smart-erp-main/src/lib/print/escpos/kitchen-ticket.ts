/**
 * Kitchen order ticket (KOT) ESC/POS builder. Pure (no DOM): safe in Node
 * tests, workers and the browser.
 *
 * The ticket carries what the kitchen needs and nothing else: order no,
 * order type, table, server, time and the items of *this* batch with
 * quantity, modifiers and notes in double-size font. No prices.
 */
import { builderFor, wrapText, type CodePage, type PaperWidth, type TextRasterizer } from './encoder'

export type KitchenOrderType = 'dine_in' | 'takeaway' | 'delivery'

export interface KitchenTicketItem {
  name: string
  quantity: number
  /** Modifier labels (see `kitchenModifierLabels` for raw modifier objects). */
  modifiers?: string[]
  notes?: string | null
  /**
   * Change line for an item that was already sent: 'add' prints "+3 x Burger" (quantity
   * increased by 3 since the last ticket), 'void' prints "VOID 1 x Burger" (quantity
   * reduced / line removed). Omitted for a normal new line.
   */
  mark?: 'add' | 'void'
}

export interface KitchenTicketInput {
  orderNo: string
  orderType?: KitchenOrderType | string | null
  table?: string | null
  tableArea?: string | null
  server?: string | null
  /** Ticket time (Date or ISO string). Unparseable strings are printed as-is. */
  time: Date | string
  items: KitchenTicketItem[]
  /** Prints a "REPRINT" banner (KDS reprint). */
  reprint?: boolean
  /** Optional order-level note. */
  note?: string | null
}

export interface KitchenTicketOptions {
  paperWidth: PaperWidth
  codePage?: CodePage
  unicodeAsBitmap?: boolean
  rasterizer?: TextRasterizer | null
  noCut?: boolean
  /** Override time formatting (defaults to local "YYYY-MM-DD HH:mm"). */
  formatTime?: (d: Date) => string
}

export function kitchenOrderTypeLabel(t: string | null | undefined): string {
  if (t === 'dine_in') return 'DINE-IN'
  if (t === 'takeaway') return 'TAKEAWAY'
  if (t === 'delivery') return 'DELIVERY'
  return t ? t.replace(/_/g, ' ').toUpperCase() : ''
}

/** Normalise stored modifiers (strings or `{ name }` objects) to labels. */
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

function defaultFormatTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function qtyText(q: number): string {
  if (!Number.isFinite(q)) return '0'
  return Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function kitchenQtyPrefix(it: KitchenTicketItem): string {
  return it.mark === 'add' ? '+' : it.mark === 'void' ? 'VOID ' : ''
}

/** Wrap `text` to `width` with `prefix` on the first line and a hanging indent after. */
function hanging(prefix: string, text: string, width: number): string[] {
  const indent = ' '.repeat(Math.min(prefix.length, Math.max(0, width - 4)))
  const body = wrapText(text, Math.max(4, width - indent.length))
  return body.map((l, i) => (i === 0 ? prefix + l : indent + l))
}

export function buildKitchenTicketEscPos(input: KitchenTicketInput, opts: KitchenTicketOptions): Uint8Array {
  const b = builderFor(opts)
  const cols = b.columns
  const bigCols = Math.floor(cols / 2)
  const big = { size: 2 as const, bold: true }

  const t = input.time instanceof Date ? input.time : new Date(input.time)
  const timeText = Number.isNaN(t.getTime()) ? String(input.time) : (opts.formatTime ?? defaultFormatTime)(t)

  b.init()
  b.selectCodePage()

  // Header
  b.align('center')
  if (input.reprint) b.styledLine('** REPRINT **', { bold: true, size: 2, align: 'center' })
  b.styledLine('KITCHEN ORDER', { bold: true, align: 'center' })
  b.paragraph(`#${input.orderNo}`, { bold: true, size: 2, align: 'center' })
  const typeLabel = kitchenOrderTypeLabel(input.orderType)
  if (typeLabel) b.paragraph(typeLabel, { bold: true, size: 2, align: 'center' })
  if (input.table) {
    const t = input.table.trim()
    b.paragraph(/^table\b/i.test(t) ? t : `Table ${t}`, { bold: true, size: 2, align: 'center' })
  }
  b.align('left')
  b.hr('=')
  if (input.tableArea) b.row('Area:', input.tableArea)
  if (input.server) b.row('Server:', input.server)
  b.row('Time:', timeText)
  b.hr('=')

  // Items (double size, no prices)
  let count = 0
  input.items.forEach((it, idx) => {
    if (idx > 0) b.line()
    if (it.mark !== 'void') count += Number.isFinite(it.quantity) ? it.quantity : 0
    for (const l of hanging(`${kitchenQtyPrefix(it)}${qtyText(it.quantity)} x `, it.name, bigCols)) b.styledLine(l, big)
    for (const m of it.modifiers || []) {
      for (const l of hanging('  + ', m, bigCols)) b.styledLine(l, { size: 2 })
    }
    const notes = (it.notes || '').trim()
    if (notes) {
      for (const l of hanging('  * ', notes, bigCols)) b.styledLine(l, { size: 2 })
    }
  })

  if (input.note && input.note.trim()) {
    b.hr()
    for (const l of wrapText(`NOTE: ${input.note.trim()}`, bigCols)) b.styledLine(l, big)
  }

  b.hr('=')
  b.row(`${input.items.length} line(s)`, `${qtyText(count)} item(s)`)
  if (input.reprint) b.styledLine('** REPRINT **', { bold: true, align: 'center' })
  b.feed(3)
  if (!opts.noCut) b.cut(true)
  return b.build()
}
