/**
 * S1 — security helpers: HTML/CSS sanitizing, safe URLs, CSV formula escaping, SSRF host guard,
 * HTML escaping of template variables. No database.
 *
 *   npx tsx scripts/tests/s1-security-sanitize.ts
 */
import { isSafeUrl, sanitizeCss, sanitizeHtml } from '../../src/lib/utils/sanitize-html'
import { neutralizeCsvFormula } from '../../src/lib/utils/csv-safe'
import { assertPublicHttpUrl, isPrivateAddress } from '../../src/lib/http/ssrf-guard'
import { hashSessionToken, sessionTokenCandidates } from '../../src/lib/auth/token-hash'
import { internalSecret, verifyInternalSecret } from '../../src/lib/security/internal-secret'
import { clientErrorMessage } from '../../src/lib/api/client-error'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${JSON.stringify(detail)}` : ''}`)
}

// ── sanitizeHtml (server path: no DOMParser under tsx) ──
const cases: Array<[string, string]> = [
  ['<script>alert(1)</script><b>x</b>', 'script'],
  ['<img src=x onerror=alert(1)>', 'onerror'],
  ['<a href="java&#9;script:alert(1)">x</a>', 'script:'],
  ['<a href=" javascript:alert(1)">x</a>', 'javascript'],
  ['<a href="JaVaScRiPt&colon;alert(1)">x</a>', 'alert'],
  ['<a href=javascript:alert(1)>x</a>', 'javascript'],
  ['<svg><script>alert(1)</script></svg>', 'svg'],
  ['<iframe src="https://evil"></iframe>', 'iframe'],
  ['<div style="background:url(javascript:alert(1))">x</div>', 'javascript'],
  ['<scr<script>ipt>alert(1)</script>', '<script'],
  ['<img src="x" onerror="alert(1)"', '<img'],
  ['<details open ontoggle=alert(1)>', 'ontoggle'],
  ['<math><mi xlink:href="javascript:alert(1)">', 'javascript'],
]
for (const [input, bad] of cases) {
  const out = sanitizeHtml(input)
  check(`strips ${JSON.stringify(input)}`, !out.toLowerCase().includes(bad.toLowerCase()), out)
}
const keep = '<table border="1"><tr><td style="color:red" colspan="2"><b>Shop</b> &amp; Co</td></tr></table><p align="center"><img src="https://cdn.example.com/logo.png" alt="logo"></p>'
check('keeps normal letterhead markup', sanitizeHtml(keep) === keep, sanitizeHtml(keep))
check('keeps https link', sanitizeHtml('<a href="https://x.lk/a?b=1">x</a>') === '<a href="https://x.lk/a?b=1">x</a>', sanitizeHtml('<a href="https://x.lk/a?b=1">x</a>'))
check('keeps raster data: image in img', sanitizeHtml('<img src="data:image/png;base64,AAAA">').includes('data:image/png'))
check('drops data:text/html', !sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>').includes('data:'))

// ── isSafeUrl ──
check('url: relative ok', isSafeUrl('/c/shop/sales'))
check('url: tab-split javascript blocked', !isSafeUrl('java\tscript:alert(1)'))
check('url: entity javascript blocked', !isSafeUrl('&#106;avascript:alert(1)'))
check('url: mailto ok', isSafeUrl('mailto:a@b.lk'))

// ── sanitizeCss ──
const css = sanitizeCss('</sty</stylele><script>alert(1)</script> body{color:red}')
check('css: cannot close <style>', !css.includes('<'), css)
check('css: keeps rules', css.includes('body{color:red}'), css)
check('css: null safe', sanitizeCss(null) === '')

// ── CSV formula guard ──
check('csv: =cmd neutralised', neutralizeCsvFormula('=HYPERLINK("x")') === `'=HYPERLINK("x")`)
check('csv: @SUM neutralised', neutralizeCsvFormula('@SUM(A1)').startsWith("'"))
check('csv: +cmd neutralised', neutralizeCsvFormula('+cmd|calc').startsWith("'"))
check('csv: negative number untouched', neutralizeCsvFormula('-150.00') === '-150.00')
check('csv: phone untouched', neutralizeCsvFormula('+94 77 123 4567') === '+94 77 123 4567')
check('csv: plain text untouched', neutralizeCsvFormula('Rice 5kg') === 'Rice 5kg')

// ── SSRF guard ──
for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.5', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1'])
  check(`ssrf: ${ip} is private`, isPrivateAddress(ip))
check('ssrf: 8.8.8.8 is public', !isPrivateAddress('8.8.8.8'))

// ── session token hashing ──
const raw = 'a'.repeat(64)
check('token: stored hash is not the token', hashSessionToken(raw) !== raw && hashSessionToken(raw).startsWith('h1$'))
check('token: bearer keeps sa_ prefix', hashSessionToken('sa_' + raw).startsWith('sa_h1$'))
check('token: candidates = hash + legacy raw', JSON.stringify(sessionTokenCandidates(raw)) === JSON.stringify([hashSessionToken(raw), raw]))
check('token: a stored hash cannot be presented as a token', sessionTokenCandidates(hashSessionToken(raw)).length === 0)

// ── internal secret ──
process.env.NEXTAUTH_SECRET ||= 's1-test-secret'
check('internal: derived, not the master secret', internalSecret('broadcast') !== process.env.NEXTAUTH_SECRET && internalSecret('broadcast').length === 64)
check('internal: verify ok', verifyInternalSecret('broadcast', internalSecret('broadcast')))
check('internal: purposes differ', !verifyInternalSecret('lookup-tenant', internalSecret('broadcast')))
check('internal: master secret refused', !verifyInternalSecret('broadcast', process.env.NEXTAUTH_SECRET))

// ── client error messages ──
check('error: driver text hidden', clientErrorMessage(new Error('Failed query: select * from sales'), 'Failed') === 'Failed')
check('error: allowed message kept', clientErrorMessage(new Error('INSUFFICIENT_STOCK:x'), 'Failed', /^INSUFFICIENT_STOCK/) === 'INSUFFICIENT_STOCK:x')

async function asyncChecks() {
  for (const u of ['http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'file:///etc/passwd', 'http://user:pw@example.com/', 'http://localhost:3000/'])
    check(`ssrf url refused: ${u}`, await assertPublicHttpUrl(u).then(() => false, () => true))
}

asyncChecks().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
})
