/**
 * L16 — mobile app: split payments match the web POS, and who sees the till. No database.
 *
 *   npx tsx scripts/tests/l16-mobile-pay.ts
 *
 * Excluded from the web tsc (tsconfig.json): it imports the app's roles.ts, whose types reach Expo
 * packages; the mobile tsc checks those files.
 */
import { settleTenders as web } from '../../src/lib/pos/tenders'
import { settleTenders as app } from '../../apps/mobile/src/lib/tenders'
import { allowedTenders, TENDER_METHOD } from '../../apps/mobile/src/lib/tenderRules'
import { isBackOffice, homeRoute } from '../../apps/mobile/src/lib/roles'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${JSON.stringify(detail)}` : ''}`)
}

const cases: Array<[number, Array<{ method: string; amount: number }>]> = [
  [600, [{ method: 'cash', amount: 250 }, { method: 'card', amount: 350 }]],
  [10000, [{ method: 'cash', amount: 3000 }, { method: 'card', amount: 4000 }, { method: 'credit', amount: 3000 }]],
  [10000, [{ method: 'card', amount: 6000 }, { method: 'cash', amount: 5000 }]],
  [10000, [{ method: 'card', amount: 8000 }, { method: 'cheque', amount: 3000 }]],
  [10000, [{ method: 'cheque', amount: 2000 }, { method: 'cheque', amount: 2000 }, { method: 'cash', amount: 6000 }]],
  [999.99, [{ method: 'cash', amount: 500.005 }, { method: 'bank_transfer', amount: 499.99 }]],
  [1500, [{ method: 'cash', amount: 2000 }]],
]
for (const [due, lines] of cases) {
  const a = app(due, lines)
  const w = web(due, lines)
  check(`app = web for ${due} ← ${lines.map((l) => `${l.method} ${l.amount}`).join(' + ')}`, JSON.stringify(a) === JSON.stringify(w), { a, w })
}
const r = app(600, [{ method: 'cash', amount: 250 }, { method: 'card', amount: 350 }])
check('cash 250 + card 350 on 600: paid, nothing owed, two splits', r.balance === 0 && r.change === 0 && r.splits.length === 2 && !r.error, r)
check('LankaQR saves as bank_transfer', TENDER_METHOD.lankaqr === 'bank_transfer')

const t = allowedTenders({ paymentMethods: [{ paymentMethod: 'cash' }, { paymentMethod: 'card' }, { paymentMethod: 'cheque' }] })
check('counter with cash, card, cheque offers card + cheque + credit, no LankaQR', t.has('card') && t.has('cheque') && t.has('credit') && !t.has('lankaqr'), [...t])
const cashOnly = allowedTenders({ paymentMethods: [{ paymentMethod: 'cash' }] })
check('cash-only counter: card is off (the app explains how to switch it on)', !cashOnly.has('card'), [...cashOnly])

type U = Parameters<typeof isBackOffice>[0]
const user = (role: string, permissions?: Record<string, boolean>) => ({ id: 'u', name: 'x', email: 'x', role, permissions } as unknown as U)
check('owner is back office (no Sell tab, no shift prompt)', isBackOffice(user('owner')) && homeRoute(user('owner')) === '/home')
check('manager is back office', isBackOffice(user('manager')))
check('cashier is counter staff → lands on the till', !isBackOffice(user('cashier')) && homeRoute(user('cashier')) === '/pos')
check('pos_user is counter staff', !isBackOffice(user('pos_user')))
check('stock manager (cannot sell) is back office', isBackOffice(user('stock_manager')))
check('custom role with createSales only → till', !isBackOffice(user('custom', { createSales: true })))
check('custom role with createSales + viewReports → back office', isBackOffice(user('custom', { createSales: true, viewReports: true })))

console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
