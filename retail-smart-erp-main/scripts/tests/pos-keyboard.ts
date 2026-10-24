/**
 * POS keyboard-first logic: shortcut mapping, typed cart quantity, variant option typing / stock,
 * secondary-screen choice for the customer display.
 * Run: npx tsx scripts/tests/pos-keyboard.ts
 */
import { matchPosShortcut, paymentMethodIndexForKey, POS_SHORTCUTS, shortcutBadge, isFunctionKey } from '../../src/lib/pos/shortcuts'
import { applyQtyKey, parseQtyBuffer, moveSelection } from '../../src/lib/pos/qty-buffer'
import {
  buildVariantRows, findVariant, optionStock, selectOption, initialSelection, matchTypedOption,
  normalizeOptionText, stepOption, SYNTHETIC_KEY,
} from '../../src/lib/pos/variant-options'
import { pickSecondaryScreen } from '../../src/lib/pos/customer-display-window'

let pass = 0
let fail = 0
function eq<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) pass++
  else { fail++; console.error(`  FAIL: ${msg}\n    expected ${e}\n    actual   ${a}`) }
}

// ---------------------------------------------------------------- shortcuts
const k = (key: string, extra: Record<string, unknown> = {}) => ({ key, ...extra })
eq(matchPosShortcut(k('F9'), { inTextInput: true }), 'payment', 'F9 = payment, even from the search box')
eq(matchPosShortcut(k('F1'), { inTextInput: false }), 'focusSearch', 'F1 = focus search (kept)')
eq(matchPosShortcut(k('F2'), { inTextInput: true }), 'holdSale', 'F2 = hold (kept)')
eq(matchPosShortcut(k('F3'), { inTextInput: true }), 'recallHeld', 'F3 = recall held (kept)')
eq(matchPosShortcut(k('F10'), { inTextInput: true }), 'floatDrop', 'F10 = float (kept)')
eq(matchPosShortcut(k('F9', { shiftKey: true }), { inTextInput: true }), null, 'Shift+F9 is not payment')
eq(matchPosShortcut(k('Delete', { ctrlKey: true }), { inTextInput: false }), 'newSale', 'Ctrl+Del = new sale (kept)')
eq(matchPosShortcut(k('Delete'), { inTextInput: false }), null, 'plain Delete is not a page shortcut (cart handles it)')
eq(matchPosShortcut(k('ç', { code: 'KeyC', altKey: true }), { inTextInput: true }), 'customer', 'Alt+C by code (macOS Option)')
eq(matchPosShortcut(k('r', { code: 'KeyR', altKey: true }), { inTextInput: true }), 'reprintLast', 'Alt+R reprint')
eq(matchPosShortcut(k('d', { code: 'KeyD', altKey: true }), { inTextInput: false }), 'customerDisplay', 'Alt+D display')
eq(matchPosShortcut(k('r', { code: 'KeyR', ctrlKey: true }), { inTextInput: false }), null, 'Ctrl+R stays the browser reload')
eq(matchPosShortcut(k('w', { code: 'KeyW', ctrlKey: true }), { inTextInput: false }), null, 'Ctrl+W never bound')
eq(matchPosShortcut(k('*'), { inTextInput: false }), 'focusCart', '* focuses the cart outside inputs')
eq(matchPosShortcut(k('*'), { inTextInput: true }), null, '* is typed in the search box ("5*CODE")')
eq(matchPosShortcut(k('?', { shiftKey: true }), { inTextInput: false }), 'help', '? = help')
eq(matchPosShortcut(k('?', { shiftKey: true }), { inTextInput: true }), null, '? typed in an input stays text')
eq(matchPosShortcut(k('/', { ctrlKey: true }), { inTextInput: true }), 'help', 'Ctrl+/ = help anywhere')
eq(matchPosShortcut(k('/'), { inTextInput: false }), 'focusSearch', '/ focuses search')
eq(matchPosShortcut(k('a'), { inTextInput: false }), null, 'letters are not shortcuts')
eq(shortcutBadge('payment'), 'F9', 'badge F9')
eq(isFunctionKey('F5'), true, 'F5 is a function key'); eq(isFunctionKey('F'), false, '"F" is not')
// every action is unique and no browser-reserved combo is bound
const actions = POS_SHORTCUTS.map((d) => d.action)
eq(new Set(actions).size, actions.length, 'unique actions')
const reserved = POS_SHORTCUTS.flatMap((d) => d.bindings).filter((b) =>
  b.key === 'F11' || b.key === 'F12' || (b.ctrl && ['KeyW', 'KeyT', 'KeyN', 'KeyR', 'KeyL'].includes(b.code || '')))
eq(reserved.length, 0, 'no browser-reserved bindings')
// two shortcuts never share one key
const seen = new Set<string>()
let dup = ''
for (const b of POS_SHORTCUTS.flatMap((d) => d.bindings)) {
  const id = `${b.ctrl ? 'C' : ''}${b.alt ? 'A' : ''}${b.key || b.code}`
  if (seen.has(id)) dup = id
  seen.add(id)
}
eq(dup, '', 'no duplicate bindings')

// payment method keys
eq(paymentMethodIndexForKey(k('F1'), { inTextInput: true, count: 5 }), 0, 'F1 = 1st method even while typing the amount')
eq(paymentMethodIndexForKey(k('F5'), { inTextInput: true, count: 5 }), 4, 'F5 = 5th method')
eq(paymentMethodIndexForKey(k('F6'), { inTextInput: true, count: 5 }), null, 'no 6th method')
eq(paymentMethodIndexForKey(k('2'), { inTextInput: true, count: 5 }), null, 'digit while typing the amount = amount')
eq(paymentMethodIndexForKey(k('2'), { inTextInput: false, count: 5 }), 1, 'digit outside inputs = method')
eq(paymentMethodIndexForKey(k('F10'), { inTextInput: true, count: 5 }), null, 'F10 is not a method key')

// ---------------------------------------------------------------- quantity buffer
let buf = ''
for (const ch of ['3']) buf = applyQtyKey(buf, ch, false) ?? buf
eq(parseQtyBuffer(buf, false), 3, 'type 3 → qty 3')
buf = ''
for (const ch of ['1', '2']) buf = applyQtyKey(buf, ch, false) ?? buf
eq(parseQtyBuffer(buf, false), 12, 'type 12 → 12')
eq(applyQtyKey('12', '.', false), '12', 'no decimal point for piece items')
buf = ''
for (const ch of ['1', '.', '2', '5', '.']) buf = applyQtyKey(buf, ch, true) ?? buf
eq(buf, '1.25', 'one decimal point only')
eq(parseQtyBuffer(buf, true), 1.25, '1.25 kg')
eq(applyQtyKey('', '.', true), '0.', '. starts 0.')
eq(parseQtyBuffer('0.', true), 0, '"0." = 0')
eq(applyQtyKey('0', '5', false), '5', 'no leading zero')
eq(applyQtyKey('12', 'Backspace', false), '1', 'backspace')
eq(applyQtyKey('12', 'Enter', false), null, 'Enter is not a buffer key')
eq(applyQtyKey('12', '+', false), null, '+ is not a buffer key')
eq(parseQtyBuffer('', false), null, 'empty = nothing')
eq(parseQtyBuffer('0', false), 0, '0 = remove')
eq(applyQtyKey('12345678', '9', false), '12345678', 'length cap')
eq(moveSelection(-1, 1, 3), 0, '↓ with nothing selected → first')
eq(moveSelection(-1, -1, 3), 2, '↑ with nothing selected → last')
eq(moveSelection(2, 1, 3), 2, 'clamped at the end')
eq(moveSelection(0, -1, 3), 0, 'clamped at the start')
eq(moveSelection(0, 1, 0), -1, 'empty cart')

// ---------------------------------------------------------------- variants
const v = (id: string, size: string, colour: string, stock: number) => ({
  id, name: `Tee ${size} ${colour}`, variantAttributes: { Size: size, Colour: colour }, trackStock: true, availableStock: String(stock),
})
const tees = [
  v('s-b', 'S', 'Black', 2), v('m-b', 'M', 'Black', 0), v('l-b', 'L', 'Black', 5), v('xl-b', 'XL', 'Black', 1), v('xxl-b', 'XXL', 'Black', 3),
  v('s-w', 'S', 'White', 0), v('m-w', 'M', 'White', 4), v('l-w', 'L', 'White', 0), v('xl-w', 'XL', 'White', 0), v('xxl-w', 'XXL', 'White', 0),
]
const rows = buildVariantRows(tees, ['Size', 'Colour'], { Size: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], Colour: ['Black', 'White'] })
eq(rows.map((r) => r.options), [['S', 'M', 'L', 'XL', 'XXL'], ['Black', 'White']], 'rows keep the configured order, only present values')
const sel0 = initialSelection(tees, rows)
eq(sel0, { Size: 'S', Colour: 'Black' }, 'initial = first in-stock variant')
eq(optionStock(tees, rows, sel0, 'Size', 'M'), { stock: 0, exists: true, sellable: true }, 'M Black = 0 but M sellable (White)')
eq(optionStock(tees, rows, sel0, 'Size', 'L').stock, 5, 'L Black stock 5')
eq(optionStock(tees, rows, sel0, 'Colour', 'White').sellable, true, 'White sellable')
eq(optionStock(tees, rows, { Size: 'XXL', Colour: 'Black' }, 'Colour', 'White'), { stock: 0, exists: true, sellable: true }, 'XXL White out')
eq(selectOption(tees, rows, sel0, 'Size', 'M'), { Size: 'M', Colour: 'White' }, 'picking M moves to the in-stock colour')
eq(selectOption(tees, rows, sel0, 'Size', 'L'), { Size: 'L', Colour: 'Black' }, 'L keeps Black')
eq(findVariant(tees, rows, { Size: 'XL', Colour: 'Black' })?.id, 'xl-b', 'find XL Black')
eq(findVariant(tees, rows, { Size: 'XL' }), null, 'incomplete selection → none')

const sizes = rows[0].options
const noneDisabled = sizes.map(() => false)
const typeSeq = (seq: string, disabled = noneDisabled, opts = sizes) => {
  let b = ''
  let idx: number | null = null
  for (const ch of seq) { const r = matchTypedOption(opts, disabled, b, ch); b = r.buffer; idx = r.index }
  return idx === null ? null : opts[idx]
}
eq(typeSeq('m'), 'M', 'm → M')
eq(typeSeq('l'), 'L', 'l → L (exact before prefix)')
eq(typeSeq('x'), 'XL', 'x → first X… (XL)')
eq(typeSeq('xl'), 'XL', 'xl → XL')
eq(typeSeq('xx'), 'XXL', 'xx → XXL')
eq(typeSeq('xxl'), 'XXL', 'xxl → XXL')
eq(typeSeq('2'), 'M', 'digit 2 → 2nd option')
eq(typeSeq('5'), 'XXL', 'digit 5 → 5th option')
eq(typeSeq('9'), null, 'digit beyond the list → nothing')
eq(typeSeq('mx'), 'XL', 'no match for "mx" → restart with "x"')
eq(typeSeq('m', [false, true, false, false, false]), null, 'disabled M is not picked')
eq(normalizeOptionText('2XL'), 'xxl', '2XL normalises to xxl')
eq(typeSeq('2xl', noneDisabled, ['S', 'M', '2XL']), '2XL', '"2xl" matches a 2XL label')
eq(typeSeq('xxl', noneDisabled, ['S', 'M', '2XL']), '2XL', '"xxl" matches a 2XL label')
const waist = ['28', '30', '32', '34']
eq(typeSeq('3', waist.map(() => false), waist), '30', 'numeric labels match as text first')
eq(typeSeq('32', waist.map(() => false), waist), '32', '"32" → 32 (not the 32nd option)')
eq(typeSeq('1', waist.map(() => false), waist), '28', 'digit with no label match → nth')
const colours = ['Black', 'Blue', 'White']
eq(typeSeq('bl', [false, false, false], colours), 'Black', 'bl → Black')
eq(typeSeq('blu', [false, false, false], colours), 'Blue', 'blu → Blue')
eq(stepOption([false, true, false], 0, 1), 2, '→ skips disabled')
eq(stepOption([false, true, false], 0, -1), 2, '← wraps')
eq(stepOption([true, true], 0, 1), 0, 'all disabled → stay')

// variants without attributes → one synthetic row of names
const plain = [{ id: 'a', name: 'Red pack', trackStock: false }, { id: 'b', name: 'Blue pack', trackStock: false }]
const prow = buildVariantRows(plain, [], {})
eq(prow.map((r) => [r.key, r.options]), [[SYNTHETIC_KEY, ['Red pack', 'Blue pack']]], 'synthetic row')
eq(findVariant(plain, prow, { [SYNTHETIC_KEY]: 'Blue pack' })?.id, 'b', 'synthetic find')
eq(optionStock(plain, prow, {}, SYNTHETIC_KEY, 'Red pack').stock, Infinity, 'untracked = unlimited')

// ---------------------------------------------------------------- customer display screen choice
const primary = { left: 0, top: 0, width: 1920, height: 1080, isPrimary: true }
const second = { left: 1920, top: 0, width: 1280, height: 800, isPrimary: false }
eq(pickSecondaryScreen([primary], primary), null, 'one screen → none')
eq(pickSecondaryScreen([primary, second], primary), second, 'POS on primary → the other one')
eq(pickSecondaryScreen([primary, second], second), primary, 'POS on the 2nd screen → primary')
eq(pickSecondaryScreen([primary, second], null), second, 'unknown current → non-primary')

console.log(`pos-keyboard: ${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
