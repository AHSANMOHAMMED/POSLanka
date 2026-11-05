/**
 * Document printing (round 18): paper sizes + landscape, mm margins (old inch templates render
 * byte-identically), pre-printed form overlay positioning / pagination, letter heads, ESC/P bytes
 * for dot matrix printers (LQ-310) and the fixed-width text layout.
 * Run: npx tsx scripts/tests/l18-document-print.ts
 */
import { createHash } from 'node:crypto'
import { EscpEncoder, encodeTextPages, linesPerPage, toEscpText } from '../../src/lib/print/escp'
import {
  dotMatrixCols,
  layoutTextDocument,
  monoFontSizeMm,
  textColsFor,
  textPagesToHtml,
  textTableColumns,
  wrapText,
} from '../../src/lib/print/text-document'
import {
  mergeTemplateConfig,
  renderFormCalibrationHtml,
  renderInvoiceHtml,
  templateConfigFromRow,
  templatePageMm,
  withMarginsInMm,
  type InvoiceDoc,
} from '../../src/lib/print/invoice-template'
import { formBoxCss, formPreset, paginateRows, sanitizeFormFields } from '../../src/lib/print/form-layout'
import { buildHtmlPage, pageRuleCss, resolvePageMm } from '../../src/lib/print/paper'
import { letterHeadBlockHtml } from '../../src/lib/print/template-renderer'
import { sanitizePrinterProfile } from '../../src/lib/print/printer-profiles'
import { FIXED_COMPANY, FIXED_DOC, LEGACY_CASES } from './fixtures-print-docs'

let pass = 0
let fail = 0
function check(cond: boolean, msg: string, extra?: string) {
  if (cond) pass++
  else {
    fail++
    console.error(`  FAIL: ${msg}${extra ? `\n${extra}` : ''}`)
  }
}
const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ')
const has = (hay: Uint8Array, needle: number[]) => hex(hay).includes(hex(needle))
const count = (hay: Uint8Array, byte: number) => Array.from(hay).filter((x) => x === byte).length

function manyLines(n: number): InvoiceDoc {
  const lines = Array.from({ length: n }, (_, i) => ({ name: `Item number ${i + 1}`, quantity: 1, unitPrice: 100, amount: 100 }))
  return { ...FIXED_DOC, lines, subtotal: n * 100, tax: 0, taxBreakdown: null, total: n * 100, paid: 0, balanceDue: n * 100 }
}

// ─── 1. Old templates render exactly as before (hashes taken from the pre-round-18 renderer) ──
console.log('legacy templates')
const LEGACY_HASHES: Record<string, string> = {
  'empty config (built-in default)': '5a13ae223284b1acbcedb04e6874709278826af77d7549e0bf8f06e81688310e',
  'legacy columns only (a5 landscape, mm margins)': '913f7e117e33aea908b4dacc05d06a1dd70d2182766e0e95c2ace55850e5834d',
  'designer config (inch margins, header band, letter)': 'b38c99b4e96d400bba50ac886f90b99937e8eda22d2fd3d295c3f65ff6d378b6',
  'designer preview (a4)': '1b7cd51442ec5cc59026182266c625ff51d8edd0ab58ce7e799620d88cfb7a24',
}
for (const c of LEGACY_CASES) {
  const html = renderInvoiceHtml(templateConfigFromRow(c.row as never), FIXED_DOC, FIXED_COMPANY, { preview: c.preview })
  check(createHash('sha256').update(html).digest('hex') === LEGACY_HASHES[c.name], `legacy render unchanged: ${c.name}`)
}
const legacyCfg = mergeTemplateConfig({ general: { margins: { top: 0.4, bottom: 0.6, left: 0.75, right: 0.3 } } })
check(legacyCfg.general.marginUnit === 'in', 'configs without marginUnit stay in inches')
check(renderInvoiceHtml(legacyCfg, FIXED_DOC, FIXED_COMPANY).includes('margin: 0.4in 0.3in 0.6in 0.75in;'), 'inch margins in @page')
check(mergeTemplateConfig({ general: { margins: { top: 9, bottom: 1, left: 1, right: 1 } } }).general.margins.top === 3, 'inch margins still capped at 3 in')
check(mergeTemplateConfig({ general: { marginUnit: 'mm', margins: { top: 25, bottom: 1, left: 1, right: 1 } } }).general.margins.top === 25, 'mm margins up to 80 mm kept')
const toMm = withMarginsInMm(legacyCfg)
check(toMm.general.marginUnit === 'mm' && toMm.general.margins.top === 10.16 && toMm.general.margins.left === 19.05, 'inch → mm conversion (0.4 in = 10.16 mm)')
check(renderInvoiceHtml(toMm, FIXED_DOC, FIXED_COMPANY).includes('margin: 10.16mm 7.62mm 15.24mm 19.05mm;'), 'mm margins in @page')
check(withMarginsInMm(toMm) === toMm, 'mm config converted only once')

// ─── 2. Paper sizes / landscape ─────────────────────────────────────────────
console.log('paper sizes')
const pr = (size: string, o = 'portrait', custom?: { widthMm: number; heightMm: number }) => resolvePageMm(size, o, custom)
check(JSON.stringify(pr('a4')) === '{"width":210,"height":297}', 'A4 portrait')
check(JSON.stringify(pr('a5', 'landscape')) === '{"width":210,"height":148}', 'A5 landscape swaps')
check(JSON.stringify(pr('a6')) === '{"width":105,"height":148}', 'A6')
check(JSON.stringify(pr('half_letter', 'landscape')) === '{"width":215.9,"height":139.7}', 'half letter landscape')
check(JSON.stringify(pr('cont_9_5x11')) === '{"width":241.3,"height":279.4}', '9.5 x 11 continuous')
check(JSON.stringify(pr('cont_9_5x5_5', 'landscape')) === '{"width":139.7,"height":241.3}', '9.5 x 5.5 continuous landscape swaps')
check(JSON.stringify(pr('custom', 'portrait', { widthMm: 100, heightMm: 150 })) === '{"width":100,"height":150}', 'custom mm')
check(JSON.stringify(pr('custom', 'landscape', { widthMm: 100, heightMm: 150 })) === '{"width":150,"height":100}', 'custom landscape')
check(JSON.stringify(pr('custom', 'portrait', { widthMm: 5, heightMm: 5000 })) === '{"width":40,"height":1200}', 'custom size clamped')
check(JSON.stringify(pr('bogus')) === '{"width":210,"height":297}', 'unknown size → A4')
check(pageRuleCss(210, 148, { top: 10, right: 12, bottom: 8, left: 15 }) === '@page { size: 210mm 148mm; margin: 10mm 12mm 8mm 15mm; }', 'pageRuleCss')
const a5l = mergeTemplateConfig({ general: { paperSize: 'a5', orientation: 'landscape', marginUnit: 'mm', margins: { top: 10, right: 12, bottom: 8, left: 15 } } })
check(renderInvoiceHtml(a5l, FIXED_DOC, FIXED_COMPANY).includes('@page { size: 210mm 148mm; margin: 10mm 12mm 8mm 15mm; }'), 'template @page A5 landscape with mm margins')
const contCfg = mergeTemplateConfig({ general: { paperSize: 'cont_9_5x5_5' } })
check(renderInvoiceHtml(contCfg, FIXED_DOC, FIXED_COMPANY).includes('@page { size: 241.3mm 139.7mm;'), 'template @page continuous half')
const customCfg = mergeTemplateConfig({ general: { paperSize: 'custom', orientation: 'landscape', customWidthMm: 120, customHeightMm: 180 } })
check(JSON.stringify(templatePageMm(customCfg)) === '{"width":180,"height":120}', 'template custom landscape size')
check(mergeTemplateConfig({ general: { paperSize: 'b4' } }).general.paperSize === 'a4', 'unknown paper size falls back to A4')
const page = buildHtmlPage('<p>Job card</p>', { paperSize: 'a5', orientation: 'landscape', marginsMm: 6, title: 'JC-1' })
check(page.includes('@page { size: 210mm 148mm; margin: 6mm 6mm 6mm 6mm; }') && page.includes('<p>Job card</p>') && page.includes('<title>JC-1</title>'), 'buildHtmlPage (public API)')
check(buildHtmlPage('x').includes('@page { size: 210mm 297mm; margin: 10mm 10mm 10mm 10mm; }'), 'buildHtmlPage defaults to A4 / 10 mm')

// ─── 3. Pre-printed form overlay ───────────────────────────────────────────
console.log('form overlay')
const formCfg = mergeTemplateConfig({
  general: { paperSize: 'a5', orientation: 'portrait' },
  form: {
    enabled: true,
    backgroundImage: '/files/form.png',
    printBackground: false,
    offsetX: 1.5,
    offsetY: -2,
    fields: [
      { id: 'a', key: 'customer.name', x: 12.5, y: 30, width: 60, fontSize: 11, bold: true, align: 'right' },
      { id: 'b', key: 'totals.total', x: 100, y: 190, width: 40, fontSize: 10, pages: 'last', text: 'Rs. ' },
      { id: 'c', key: 'page', x: 100, y: 200, width: 40 },
      { id: 'd', key: 'continued', x: 100, y: 185, width: 40 },
      { id: 'e', key: 'customer.address', x: 12.5, y: 36, width: 60, lines: 2, fontSize: 9 },
      { id: 'bad', key: 'nope', x: 1, y: 1 },
    ],
    items: { show: true, x: 10, y: 60, width: 128, rowHeight: 6.5, maxRows: 10, fontSize: 9 },
    columns: [{ key: 'item', x: 8, width: 70 }, { key: 'amount', x: 100, width: 28, align: 'right' }],
  },
})
check(formCfg.form.fields.length === 5, 'unknown field keys dropped')
const formHtml = renderInvoiceHtml(formCfg, manyLines(25), FIXED_COMPANY)
check(formHtml.includes('@page { size: 148mm 210mm; margin: 0; }'), 'form page: exact paper, no margins')
check(formHtml.includes('.flayer { position: absolute; left: 1.5mm; top: -2mm;'), 'calibration offset on the layer')
check(formHtml.includes('style="left:12.5mm;top:30mm;width:60mm;font-size:11pt;text-align:right;font-weight:700;white-space:nowrap"'), 'field box in mm/pt')
check(formHtml.includes('left:12.5mm;top:36mm;width:60mm;font-size:9pt;text-align:left;font-weight:400;white-space:pre-wrap;max-height:21.6pt'), 'multi-line field capped at its lines')
check((formHtml.match(/class="fpage"/g) || []).length === 3, '25 items / 10 rows → 3 sheets')
check((formHtml.match(/Rs\. 2,500\.00/g) || []).length === 1, "'last' total printed once, with prefix")
check(formHtml.includes('Page 1 of 3') && formHtml.includes('Page 3 of 3'), 'page numbers')
check((formHtml.match(/Continued…/g) || []).length === 2, 'continued on all sheets but the last')
check(formHtml.includes('left:18mm;top:60mm;width:70mm') && formHtml.includes('left:110mm;top:60mm;width:28mm'), 'column x = items.x + column.x')
check(formHtml.includes('left:18mm;top:66.5mm;') && formHtml.includes('left:18mm;top:118.5mm;'), 'row top = y + i × rowHeight (rows 2 and 10)')
check(!formHtml.includes('form.png'), 'pre-printed paper: background not in the print')
check(renderInvoiceHtml(formCfg, FIXED_DOC, FIXED_COMPANY, { preview: true }).includes('class="fbg screen-only" src="/files/form.png"'), 'designer preview shows the background (screen only)')
const plainPaper = mergeTemplateConfig({ ...formCfg, form: { ...formCfg.form, printBackground: true } })
check(renderInvoiceHtml(plainPaper, FIXED_DOC, FIXED_COMPANY).includes('<img class="fbg" src="/files/form.png"'), 'plain paper: background printed')
check(renderInvoiceHtml(plainPaper, FIXED_DOC, FIXED_COMPANY).includes('.fbg { position: absolute; left: 0; top: 0; width: 148mm; height: 210mm; object-fit: fill; }'), 'background at exact page size (not cover)')
check(formBoxCss({ x: 1.234, y: 2, width: 3, fontSize: 8 }) === 'left:1.23mm;top:2mm;width:3mm;font-size:8pt;text-align:left;font-weight:400;white-space:nowrap', 'formBoxCss rounding')
check(paginateRows([], 5).length === 1 && paginateRows([1, 2, 3, 4, 5, 6], 5).length === 2, 'paginateRows')
check(sanitizeFormFields([{ key: 'doc.number', x: -5, y: 99999, width: 0, fontSize: 100 }])[0].x === 0, 'field numbers clamped')
const preset = formPreset(210, 297)
check(preset.fields.length > 10 && preset.columns.length === 5 && preset.items.maxRows > 10, 'starter layout')
const calib = renderFormCalibrationHtml(formCfg)
check(calib.includes('<svg') && calib.includes('viewBox="0 0 148 210"') && calib.includes('>100</text>') && calib.includes('Customer name'), 'calibration page: mm grid + field outlines')
const escaped = renderInvoiceHtml(formCfg, { ...FIXED_DOC, customer: { name: '<script>x</script>' } }, FIXED_COMPANY)
check(!escaped.includes('<script>x') && escaped.includes('&lt;script&gt;x'), 'form values escaped')

// ─── 4. Letter heads ─────────────────────────────────────────────────────
console.log('letter heads')
const lh = { headerHtml: '<b>Head</b><script>alert(1)</script>', footerHtml: '', headerImage: '/lh.png', footerImage: 'javascript:alert(1)', headerHeight: 40, footerHeight: 20, alignment: 'right' as const }
const lhHead = letterHeadBlockHtml(lh, 'header')
check(lhHead.includes('min-height:40mm') && lhHead.includes('max-height:40mm') && lhHead.includes('text-align:right'), 'letter head heights in mm')
check(!lhHead.includes('<script'), 'letter head HTML sanitised')
check(letterHeadBlockHtml(lh, 'footer') === '', 'unsafe image URL dropped (empty footer)')
const withLh = renderInvoiceHtml(mergeTemplateConfig({}), FIXED_DOC, FIXED_COMPANY, { letterHead: lh })
check(withLh.includes('<thead><tr><td><div class="lh-header"') && withLh.includes('.lh-header {'), 'letter head printed in the repeated page header')

// ─── 5. ESC/P bytes ──────────────────────────────────────────────────────
console.log('ESC/P')
check(hex(new EscpEncoder().init().encode()) === '1b 40', 'ESC @ init')
check(hex(new EscpEncoder().pitch(17).encode()) === '1b 50 0f', '17 cpi = ESC P + SI (condensed)')
check(hex(new EscpEncoder().pitch(20).encode()) === '1b 4d 0f', '20 cpi = ESC M + SI')
check(hex(new EscpEncoder().pitch(12).encode()) === '1b 4d 12', '12 cpi = ESC M, condensed off (DC2)')
check(hex(new EscpEncoder().pitch(10).encode()) === '1b 50 12', '10 cpi = ESC P, DC2')
check(hex(new EscpEncoder().pageLengthInches(11).encode()) === '1b 43 00 0b', 'page length 11 in = ESC C NUL 11')
check(hex(new EscpEncoder().pageLengthLines(33).encode()) === '1b 43 21', 'page length 33 lines = ESC C 33')
check(hex(new EscpEncoder().bold(true).text('A').bold(false).newline().formFeed().encode()) === '1b 45 41 1b 46 0d 0a 0c', 'bold, CR LF, FF')
check(toEscpText('Café “x” – ₹5…') === 'Cafe "x" - ?5...', 'text folded to ASCII')
const bytes = encodeTextPages([[{ text: 'HELLO', bold: true }, { text: 'world   ' }], [{ text: 'p2' }]], { cpi: 17, pageLengthInches: 11 })
check(hex(bytes.slice(0, 2)) === '1b 40', 'job starts with ESC @')
check(has(bytes, [0x1b, 0x32]) && has(bytes, [0x1b, 0x43, 0, 11]) && has(bytes, [0x1b, 0x50, 0x0f]), 'job: 1/6" spacing, page length, condensed')
check(count(bytes, 0x0c) === 2, 'one form feed per page')
check(has(bytes, [0x1b, 0x45, 0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x1b, 0x46]), 'bold line wrapped in ESC E / ESC F')
check(has(bytes, [0x77, 0x6f, 0x72, 0x6c, 0x64, 0x0d, 0x0a]), 'trailing spaces trimmed')
const half = encodeTextPages([[{ text: 'x' }]], { cpi: 10, pageLengthInches: 5.5 })
check(has(half, [0x1b, 0x43, 33]) && !has(half, [0x1b, 0x43, 0]), '5.5 in form = 33 lines (ESC C 33)')
check(has(encodeTextPages([[{ text: 'x' }]], { cpi: 10, pageLengthInches: 11, letterQuality: true }), [0x1b, 0x78, 1]), 'letter quality ESC x 1')
check(linesPerPage(11) === 66 && linesPerPage(5.5) === 33 && linesPerPage(12) === 72, 'lines per page at 6 lpi')

// ─── 6. Text layout ──────────────────────────────────────────────────────
console.log('text layout')
check(textColsFor(8, 10) === 80 && textColsFor(8, 12) === 96 && textColsFor(8, 17) === 136 && textColsFor(13.6, 10) === 136, 'columns from carriage × cpi')
for (const cols of [40, 48, 80, 96, 136]) {
  const tc = textTableColumns(cols)
  check(tc.reduce((s, c) => s + c.width, 0) + tc.length - 1 === cols, `table columns fill exactly ${cols} chars`)
  check(tc.every((c) => c.width > 0), `all columns have width at ${cols}`)
}
check(textTableColumns(136).map((c) => c.key).join() === 'lineNo,sku,item,qty,unit,rate,discount,tax,amount', '136 col: code / unit / disc / tax columns')
check(textTableColumns(80).map((c) => c.key).join() === 'lineNo,item,qty,rate,amount', '80 col columns')
check(textTableColumns(80).find((c) => c.key === 'item')!.width === 41, '80 col item width 41')
for (const cols of [40, 80, 136]) {
  const pages = layoutTextDocument(FIXED_DOC, FIXED_COMPANY, { cols, linesPerPage: 66 })
  const all = pages.flat()
  check(all.every((l) => l.text.length <= cols), `no line wider than ${cols}`)
  const headerRow = all.find((l) => l.bold && /Amount$/.test(l.text))
  check(!!headerRow && headerRow.text.length === cols, `table header exactly ${cols} wide`)
  check(all.some((l) => l.text.includes('517,782.00')) && all.some((l) => l.text.includes('Seventeen Thousand')), `totals + words at ${cols}`)
  check(all.some((l) => l.text.includes('S/N: RF340-22A91873')), `serial printed at ${cols}`)
}
const long = layoutTextDocument(manyLines(60), FIXED_COMPANY, { cols: 80, linesPerPage: 33 })
check(long.length > 2, 'long invoice on half pages → several pages')
check(long.every((p) => p.length <= 33 - 2), 'pages leave the bottom perforation skip')
check(long.slice(0, -1).every((p) => p[p.length - 1].text.trim() === 'Continued...'), 'Continued... at the bottom of every page but the last')
check(long.slice(1).every((p) => p.some((l) => l.text.startsWith('INVOICE INV-000456') && l.text.trimEnd().endsWith(`Page ${long.indexOf(p) + 1}`))), 'continuation header with page number')
check(long[long.length - 1].some((l) => l.text.includes('6,000.00')), 'totals on the last page')
const allRows = long.flat().filter((l) => /^ *\d+ Item number/.test(l.text)).length
check(allRows === 60, 'every item printed once', String(allRows))
check(wrapText('aaaa bbbb cccc', 9).join('|') === 'aaaa bbbb|cccc' && wrapText('x'.repeat(12), 5).join('|') === 'xxxxx|xxxxx|xx', 'wrapText')
const dmHtml = textPagesToHtml(long, { cpi: 10, carriageInches: 8, pageLengthInches: 5.5, paperWidthMm: 241.3 })
check(dmHtml.includes('@page { size: 241.3mm 139.7mm; margin: 0mm 0mm 0mm 0mm; }'), 'browser fallback: continuous half page')
check(dmHtml.includes(`font-size: ${monoFontSizeMm(10)}mm; line-height: 4.23mm`) && monoFontSizeMm(10) === 4.23 && monoFontSizeMm(17) === 2.49, 'monospace at pitch, 6 lpi')
check(dmHtml.includes('padding-left: 19.05mm'), '80 columns centred on 9.5 in paper')
check((dmHtml.match(/class="tpage"/g) || []).length === long.length, 'one HTML page per text page')
check(dotMatrixCols({ cpi: 17, carriageInches: 8, pageLengthInches: 11, paperWidthMm: 241.3 }) === 136, 'dotMatrixCols')

// ─── 7. Document printer profile ─────────────────────────────────────────
console.log('printer profile')
const prof = sanitizePrinterProfile({ role: 'document', document: { mode: 'dotmatrix', cpi: 17, carriageInches: 8, pageLengthInches: 5.4, paperWidthMm: 241.3, letterQuality: true, docs: { invoice: { templateId: 't1', paperSize: 'a5' }, quotation: { templateId: '', paperSize: 'custom' as never }, 'Bad Key': { templateId: 'x', paperSize: '' } } } } as never)
check(prof.role === 'document' && prof.document.mode === 'dotmatrix' && prof.document.cpi === 17, 'document role + dot matrix kept')
check(prof.document.pageLengthInches === 5.5, 'form length rounded to half inches')
check(prof.document.docs.invoice?.paperSize === 'a5' && prof.document.docs.quotation?.paperSize === '' && !('Bad Key' in prof.document.docs), 'per-document settings sanitised')
check(sanitizePrinterProfile({ role: 'receipt' }).document.mode === 'page', 'other roles get the default document config')
check(sanitizePrinterProfile({ role: 'weird' as never }).role === 'receipt', 'unknown role → receipt')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
