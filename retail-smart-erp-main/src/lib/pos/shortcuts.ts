/**
 * POS keyboard shortcuts: one table that drives the key handler, the kbd badges on the buttons
 * and the "Keyboard shortcuts" help overlay. Pure (no React / DOM) so it can be self-tested
 * (scripts/pos-keyboard-selftest.ts).
 *
 * Rules
 *  - F-keys F1–F10 keep the meanings they always had (F1 search … F10 float/drop).
 *  - New actions use Alt+letter (matched on KeyboardEvent.code so macOS Option still works).
 *  - Never bind browser-reserved keys (Ctrl+W/T/N/Tab, F11, F12); every match is preventDefault()ed.
 */

export type PosShortcutAction =
  | 'focusSearch'
  | 'holdSale'
  | 'recallHeld'
  | 'quickAdd'
  | 'discount'
  | 'returnSale'
  | 'priceCheck'
  | 'lock'
  | 'payment'
  | 'floatDrop'
  | 'focusCart'
  | 'customer'
  | 'newSale'
  | 'reprintLast'
  | 'billsHistory'
  | 'openShift'
  | 'closeShift'
  | 'cashMovement'
  | 'customerDisplay'
  | 'actions'
  | 'saveQuotation'
  | 'help'

export interface KeyLike {
  key: string
  code?: string
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  metaKey?: boolean
}

interface Binding {
  /** e.key value (F-keys, symbols) */
  key?: string
  /** e.code value (letters with Alt, layout/Option independent) */
  code?: string
  ctrl?: boolean
  alt?: boolean
  /** Only when focus is not in a text field (plain printable keys) */
  outsideInput?: boolean
}

export interface PosShortcutDef {
  action: PosShortcutAction
  label: string
  group: 'Sale' | 'Cart' | 'Customer & bills' | 'Till & shift' | 'Screen'
  /** Text shown on badges / help (first entry is the badge) */
  keys: string[]
  bindings: Binding[]
}

export const POS_SHORTCUTS: PosShortcutDef[] = [
  { action: 'focusSearch', group: 'Screen', label: 'Focus search / scan box', keys: ['F1', 'Esc', '/'],
    bindings: [{ key: 'F1' }, { key: '/', outsideInput: true }] },
  { action: 'focusCart', group: 'Cart', label: 'Go to the cart (select a line, type a quantity)', keys: ['*', '↓'],
    bindings: [{ key: '*', outsideInput: true }] },
  { action: 'payment', group: 'Sale', label: 'Payment', keys: ['F9'], bindings: [{ key: 'F9' }] },
  { action: 'holdSale', group: 'Sale', label: 'Hold sale', keys: ['F2'], bindings: [{ key: 'F2' }] },
  { action: 'recallHeld', group: 'Sale', label: 'Recall held sale', keys: ['F3'], bindings: [{ key: 'F3' }] },
  { action: 'quickAdd', group: 'Sale', label: 'Quick add item', keys: ['F4'], bindings: [{ key: 'F4' }] },
  { action: 'discount', group: 'Sale', label: 'Discount', keys: ['F5'], bindings: [{ key: 'F5' }] },
  { action: 'returnSale', group: 'Sale', label: 'Return / refund', keys: ['F6'], bindings: [{ key: 'F6' }] },
  { action: 'priceCheck', group: 'Sale', label: 'Price & stock check', keys: ['F7'], bindings: [{ key: 'F7' }] },
  { action: 'newSale', group: 'Sale', label: 'New sale (clear cart, asks first)', keys: ['Ctrl+Del', 'Alt+N'],
    bindings: [{ key: 'Delete', ctrl: true }, { code: 'KeyN', alt: true }] },
  { action: 'saveQuotation', group: 'Sale', label: 'Save the cart as a quotation', keys: ['Alt+Q'], bindings: [{ code: 'KeyQ', alt: true }] },
  { action: 'customer', group: 'Customer & bills', label: 'Select / add customer', keys: ['Alt+C'], bindings: [{ code: 'KeyC', alt: true }] },
  { action: 'reprintLast', group: 'Customer & bills', label: 'Reprint last bill', keys: ['Alt+R'], bindings: [{ code: 'KeyR', alt: true }] },
  { action: 'billsHistory', group: 'Customer & bills', label: 'Bills history', keys: ['Alt+B'], bindings: [{ code: 'KeyB', alt: true }] },
  { action: 'lock', group: 'Till & shift', label: 'Lock terminal', keys: ['F8'], bindings: [{ key: 'F8' }] },
  { action: 'floatDrop', group: 'Till & shift', label: 'Cash float / safe drop', keys: ['F10'], bindings: [{ key: 'F10' }] },
  { action: 'cashMovement', group: 'Till & shift', label: 'Cash in / out', keys: ['Alt+M'], bindings: [{ code: 'KeyM', alt: true }] },
  { action: 'openShift', group: 'Till & shift', label: 'Open shift', keys: ['Alt+O'], bindings: [{ code: 'KeyO', alt: true }] },
  { action: 'closeShift', group: 'Till & shift', label: 'Close shift', keys: ['Alt+X'], bindings: [{ code: 'KeyX', alt: true }] },
  { action: 'customerDisplay', group: 'Screen', label: 'Open customer display (2nd screen)', keys: ['Alt+D'], bindings: [{ code: 'KeyD', alt: true }] },
  { action: 'actions', group: 'Screen', label: 'Actions panel (shift, bills, reprint, quotation …)', keys: ['Alt+A', 'Ctrl+K'],
    bindings: [{ code: 'KeyA', alt: true }, { code: 'KeyK', ctrl: true }] },
  { action: 'help', group: 'Screen', label: 'Keyboard shortcuts (this list)', keys: ['?', 'Ctrl+/'],
    bindings: [{ key: '?', outsideInput: true }, { key: '/', ctrl: true }] },
]

/** Keys handled inside the cart and the pickers (help overlay only; handled by their own code). */
export const POS_CONTEXT_SHORTCUTS: Array<{ group: string; keys: string; label: string }> = [
  { group: 'Cart', keys: '↑ ↓', label: 'Select the previous / next line (↓ from an empty search box enters the cart)' },
  { group: 'Cart', keys: '0–9 .', label: 'Type the quantity of the selected line (decimals for kg / litre items)' },
  { group: 'Cart', keys: 'Enter', label: 'Confirm the typed quantity (Enter again → back to search)' },
  { group: 'Cart', keys: '+ / −', label: 'Add / remove one (also from an empty search box)' },
  { group: 'Cart', keys: 'Del', label: 'Remove the selected line' },
  { group: 'Cart', keys: 'U', label: 'Change the unit of the selected line (kg → g, pcs → box …)' },
  { group: 'Cart', keys: 'Esc', label: 'Cancel typing / back to search' },
  { group: 'Variants', keys: '← → Tab', label: 'Move between sizes / colours (Tab = next attribute)' },
  { group: 'Variants', keys: 'm, l, xl, 1–9', label: 'Type a size or its number to pick it' },
  { group: 'Variants', keys: 'Enter / Esc', label: 'Add the variant / cancel' },
  { group: 'Actions panel', keys: '← → ↑ ↓', label: 'Move between the action tiles (Home / End = first / last)' },
  { group: 'Actions panel', keys: 'Enter / Space', label: 'Run the highlighted action' },
  { group: 'Actions panel', keys: 'a–z', label: 'Type to filter the actions (Backspace = undo)' },
  { group: 'Actions panel', keys: 'Esc', label: 'Close and go back to search' },
  { group: 'Payment', keys: 'F1–F6', label: 'Pick the payment method shown on the button (1–6 when not typing an amount)' },
  { group: 'Payment', keys: 'Enter / Esc', label: 'Complete the sale / close' },
  { group: 'Sale completed', keys: 'D', label: 'Schedule delivery for the invoice (deliveries module, opens a new tab)' },
  { group: 'Size entry', keys: 'Enter / Esc', label: 'Add the sized line / cancel (area or length priced items; +/− on the line reopens it)' },
]

function bindingMatches(b: Binding, e: KeyLike, inTextInput: boolean): boolean {
  const ctrl = !!(e.ctrlKey || e.metaKey)
  const alt = !!e.altKey
  if (!!b.ctrl !== ctrl) return false
  if (!!b.alt !== alt) return false
  if (b.outsideInput && inTextInput) return false
  if (b.code) return e.code === b.code
  if (b.key) {
    // F-keys and Delete must not carry Shift; printable symbols (?, *) may need it
    if (/^F\d+$|^Delete$/.test(b.key) && e.shiftKey) return false
    return e.key === b.key
  }
  return false
}

/** Which POS action a key press means (null = not a POS shortcut). */
export function matchPosShortcut(e: KeyLike, opts: { inTextInput: boolean }): PosShortcutAction | null {
  for (const def of POS_SHORTCUTS) {
    if (def.bindings.some((b) => bindingMatches(b, e, opts.inTextInput))) return def.action
  }
  return null
}

/** Badge text for an action ("F9", "Alt+R" …) */
export function shortcutBadge(action: PosShortcutAction): string {
  return POS_SHORTCUTS.find((d) => d.action === action)?.keys[0] ?? ''
}

/** True for F1–F12: the browser default (help, reload, fullscreen …) must always be suppressed on the POS. */
export function isFunctionKey(key: string): boolean {
  return /^F([1-9]|1[0-2])$/.test(key)
}

/**
 * Payment-method keys in the payment modal: F1… by position, or the plain digit when the cashier is
 * not typing in an input. Returns the 0-based method index or null.
 */
export function paymentMethodIndexForKey(e: KeyLike, opts: { inTextInput: boolean; count: number }): number | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null
  let n: number | null = null
  const f = /^F(\d)$/.exec(e.key)
  if (f) n = parseInt(f[1], 10)
  else if (!opts.inTextInput && /^[1-9]$/.test(e.key)) n = parseInt(e.key, 10)
  if (n === null || n < 1 || n > Math.min(opts.count, 9)) return null
  return n - 1
}
