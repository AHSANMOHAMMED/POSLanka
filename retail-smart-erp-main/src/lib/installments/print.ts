/**
 * Simple HTML print popups for hire purchase agreements / receipts, delivery notes and warranty
 * job sheets (drizzle/0181). Client-only (window.open). A4 by default; `receipt` for an 80 mm
 * thermal slip.
 */

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

export function money(v: unknown, currency = 'Rs'): string {
  const n = Number(v ?? 0) || 0
  return `${esc(currency)} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export interface PrintCompany { name?: string | null; address?: string | null; phone?: string | null; email?: string | null }

export function companyHeader(c: PrintCompany | null | undefined, title: string, docNo: string, date?: string): string {
  return `<div class="hdr"><div><div class="co">${esc(c?.name)}</div><div class="muted">${esc(c?.address)}</div>
    <div class="muted">${c?.phone ? `Tel: ${esc(c.phone)}` : ''}${c?.email ? ` · ${esc(c.email)}` : ''}</div></div>
    <div class="right"><div class="title">${esc(title)}</div><div><b>${esc(docNo)}</b></div>${date ? `<div class="muted">${esc(date)}</div>` : ''}</div></div>`
}

const STYLES = `
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:0;padding:18px}
  .hdr{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}
  .co{font-size:18px;font-weight:bold}.title{font-size:16px;font-weight:bold;text-transform:uppercase}
  .right{text-align:right}.muted{color:#555}.small{font-size:10px}
  table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}
  th{background:#f0f0f0}td.n,th.n{text-align:right}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin:8px 0}.box{border:1px solid #999;padding:8px;margin:8px 0}
  h3{font-size:13px;margin:12px 0 4px;text-transform:uppercase}
  .sig{display:flex;justify-content:space-between;gap:24px;margin-top:48px}.sig div{flex:1;border-top:1px solid #111;padding-top:4px;text-align:center}
  .badge{display:inline-block;padding:2px 8px;border:1px solid #111;border-radius:10px;font-weight:bold}
  body.receipt{width:76mm;padding:4mm;font-size:11px}body.receipt .hdr{display:block;text-align:center}body.receipt .right{text-align:center}
  body.receipt table{font-size:10px}body.receipt .sig{margin-top:28px}
  @media print{body{padding:0}@page{margin:12mm}body.receipt{padding:0}}
`

/** Open a print window with this body; prints when loaded. Returns false when popups are blocked. */
export function openPrint(title: string, bodyHtml: string, opts?: { receipt?: boolean }): boolean {
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) return false
  w.document.open()
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLES}</style></head>
    <body class="${opts?.receipt ? 'receipt' : ''}">${bodyHtml}
    <script>window.onload=function(){setTimeout(function(){window.print()},150)}</script></body></html>`)
  w.document.close()
  return true
}
