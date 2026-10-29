/**
 * L10 — generated printer setup commands (src/lib/labels/printer-setup-script.ts). No database.
 *
 *   npx tsx scripts/tests/l10-printer-setup-script.ts
 */
import { cupsSetupScript, setupPaperMm, windowsSetupScript, zebraConfigZpl, zebraTestZpl } from '../../src/lib/labels/printer-setup-script'
import { setupFromPreset, STICKER_PRESETS } from '../../src/lib/labels/sticker-stock'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail !== undefined ? `  — ${JSON.stringify(detail)}` : ''}`)
}

const twin = setupFromPreset(STICKER_PRESETS.find((p) => p.id === '38x25x2')!, { isDefault: true })

check('gap paper = liner x label', JSON.stringify(setupPaperMm(twin, 'gap')) === JSON.stringify({ widthMm: 80, heightMm: 25, name: 'Label 80x25mm' }), setupPaperMm(twin, 'gap'))
check('continuous paper = liner x (label + gap)', setupPaperMm(twin, 'continuous').heightMm === 27, setupPaperMm(twin, 'continuous'))
check('gap config: web sensing, 639 x 200 dots, feed on power-up, saved', zebraConfigZpl(twin, 'gap') === '^XA^MNY^PW639^LL200^MFF,F^LH0,0^JUS^XZ', zebraConfigZpl(twin, 'gap'))
check('continuous config: no motion on power-up / lid close, 27 mm = 216 dots', zebraConfigZpl(twin, 'continuous') === '^XA^MNN^PW639^LL216^MFN,N^LH0,0^JUS^XZ', zebraConfigZpl(twin, 'continuous'))

const test = zebraTestZpl(twin, 'gap')
check('test: 2 formats, 4 numbered boxes', (test.match(/\^XA/g) || []).length === 2 && (test.match(/\^GB/g) || []).length === 4 && /\^FD4\^FS/.test(test), test)
check('test: second column starts at 1 + 38 + 2 + 0.5 mm = 332 dots', test.includes('^FO332,'), test)
const shifted = zebraTestZpl({ ...twin, offsetYMm: 2 }, 'gap')
check('test follows the up/down offset (2.5 mm = 20 dots)', shifted.includes('^FO12,20^GB'), shifted)

const ps = windowsSetupScript(twin, 'gap')
check('windows: finds the Zebra queue, adds the paper, sends config + calibration + test', ps.includes("Get-Printer") && ps.includes("AddPaper('Label 80x25mm', 80000, 25000)") && ps.includes(zebraConfigZpl(twin, 'gap')) && ps.includes("'~JC'") && ps.includes(test))
check('windows: here-string terminator at line start', /\n'@\n/.test(ps))
check('windows: no JS template leftovers', !ps.includes('${') && !ps.includes('undefined') && !ps.includes('NaN'))
check('windows continuous: no calibration', !windowsSetupScript(twin, 'continuous').includes('~JC'))
const sh = cupsSetupScript(twin, 'continuous')
check('cups: raw config + page size', sh.includes(`'${zebraConfigZpl(twin, 'continuous')}' | lp -d "$Q" -o raw`) && sh.includes('PageSize=Custom.80x27mm'), sh)

for (const p of STICKER_PRESETS) {
  const s = setupFromPreset(p, { isDefault: false })
  for (const mode of ['gap', 'continuous'] as const) {
    const out = windowsSetupScript(s, mode) + cupsSetupScript(s, mode)
    if (out.includes('NaN') || out.includes('undefined')) check(`preset ${p.id} ${mode} builds`, false)
  }
}
check('every preset builds both commands without NaN / undefined', true)

console.log(`\n${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
