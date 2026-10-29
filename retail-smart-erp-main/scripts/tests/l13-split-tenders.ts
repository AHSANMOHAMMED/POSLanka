/**
 * L13 — POS split payment arithmetic (src/lib/pos/tenders.ts). No database.
 *
 *   npx tsx scripts/tests/l13-split-tenders.ts
 */
import { settleTenders } from '../../src/lib/pos/tenders'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${JSON.stringify(detail)}` : ''}`)
}

let r = settleTenders(10000, [{ method: 'cash', amount: 3000 }, { method: 'card', amount: 4000 }, { method: 'credit', amount: 3000 }])
check('cash + card + credit = bill: no balance, no change', r.balance === 0 && r.change === 0 && r.received === 7000 && r.onAccount === 3000 && r.splits.length === 3 && !r.error, r)

r = settleTenders(10000, [{ method: 'card', amount: 6000 }, { method: 'cash', amount: 5000 }])
check('cash over the rest → change 1000, saved cash 4000', r.change === 1000 && r.balance === 0 && r.splits.find((s) => s.method === 'cash')?.amount === 4000 && r.received === 10000, r)

r = settleTenders(10000, [{ method: 'card', amount: 6000 }, { method: 'cheque', amount: 2000 }])
check('short → balance 2000', r.balance === 2000 && r.change === 0 && r.paid === 8000, r)

r = settleTenders(10000, [{ method: 'card', amount: 8000 }, { method: 'cheque', amount: 3000 }])
check('card + cheque over the bill → error, no change', !!r.error && r.change === 0, r)

r = settleTenders(10000, [{ method: 'cheque', amount: 2000 }, { method: 'cheque', amount: 2000 }, { method: 'cash', amount: 6000 }])
check('two cheques → error', r.error === 'Only one cheque per bill', r)

r = settleTenders(5000, [{ method: 'cash', amount: 0 }, { method: 'card', amount: 5000 }])
check('zero lines are dropped from the saved splits', r.splits.length === 1 && r.splits[0].method === 'card', r)

r = settleTenders(999.99, [{ method: 'cash', amount: 500.005 }, { method: 'card', amount: 499.99 }])
check('money rounded to cents', r.balance === 0 && r.change === 0.01, r)

console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
