/**
 * A4 Printable HTML Document Generator for Daily Shift & Sales Reconciliation.
 * Formatted for standard desktop/A4 printers, PDF rendering, and WhatsApp owner summaries.
 */

export interface ShiftSummaryA4Data {
  company: {
    name: string
    address?: string | null
    phone?: string | null
    email?: string | null
    taxId?: string | null
    logoUrl?: string | null
  }
  shift: {
    entryNumber: string
    posProfileName: string
    cashierName: string
    openingTime: string
    closingTime: string
  }
  financials: {
    totalSales: number
    totalReturns: number
    netSales: number
    totalTransactions: number
    taxTotal?: number
    discountTotal?: number
    totalVariance?: number
    varianceReason?: string | null
  }
  cashControl: {
    openingFloat: number
    cashSales: number
    cashMovementsIn: number
    cashMovementsOut: number
    totalCountedCash: number
    cashOutHandover: number
    retainedDrawerFloat: number
  }
  paymentTenders: Array<{
    method: string
    expected: number
    actual: number
    variance: number
  }>
  externalBills?: Array<{
    billNo: string
    description: string
    amount: number
    paymentMethod: string
  }>
  notes?: string | null
  currency?: string
}

export function generateShiftSummaryA4Html(data: ShiftSummaryA4Data): string {
  const cur = data.currency || 'Rs.'
  const fmt = (n: number) =>
    `${cur} ${Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const externalBillsRows = (data.externalBills || [])
    .map(
      (b, idx) => `
      <tr>
        <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; font-size: 12px;">${idx + 1}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; font-weight: 500; font-size: 12px;">${b.billNo}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; font-size: 12px;">${b.description}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; font-size: 12px; text-transform: uppercase;">${b.paymentMethod}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; text-align: right; font-family: monospace; font-size: 12px;">${fmt(b.amount)}</td>
      </tr>`
    )
    .join('')

  const tenderRows = (data.paymentTenders || [])
    .map(
      (t) => `
      <tr>
        <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; font-weight: 500; font-size: 12px; text-transform: capitalize;">${t.method.replace('_', ' ')}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; text-align: right; font-family: monospace; font-size: 12px;">${fmt(t.expected)}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; text-align: right; font-family: monospace; font-size: 12px;">${fmt(t.actual)}</td>
        <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; text-align: right; font-family: monospace; font-size: 12px; color: ${Math.abs(t.variance) >= 0.01 ? (t.variance < 0 ? '#dc2626' : '#16a34a') : '#4b5563'};">
          ${t.variance > 0 ? '+' : ''}${fmt(t.variance)}
        </td>
      </tr>`
    )
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Shift Summary - ${data.shift.entryNumber}</title>
  <style>
    @page { size: A4 portrait; margin: 15mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1f2937;
      margin: 0;
      padding: 20px;
      font-size: 13px;
      line-height: 1.4;
      background: #fff;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 14px;
      margin-bottom: 16px;
    }
    .company-title {
      font-size: 20px;
      font-weight: 800;
      color: #111827;
      margin: 0 0 4px 0;
    }
    .meta-box {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 10px 14px;
      margin-bottom: 16px;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }
    .meta-item label {
      display: block;
      font-size: 10px;
      text-transform: uppercase;
      color: #6b7280;
      font-weight: 600;
      margin-bottom: 2px;
    }
    .meta-item span {
      font-size: 12px;
      font-weight: 600;
      color: #111827;
    }
    .section-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #1e40af;
      margin: 14px 0 6px 0;
      border-bottom: 1px solid #dbeafe;
      padding-bottom: 3px;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10px;
    }
    th {
      background: #f3f4f6;
      text-align: left;
      font-size: 11px;
      text-transform: uppercase;
      color: #4b5563;
      padding: 6px 10px;
      border-bottom: 1px solid #d1d5db;
    }
    .kpi-card {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 10px 14px;
      background: #fafafa;
    }
    .kpi-row {
      display: flex;
      justify-content: space-between;
      padding: 4px 0;
      border-bottom: 1px dotted #e5e7eb;
      font-size: 12px;
    }
    .kpi-row.total {
      font-weight: 800;
      font-size: 14px;
      color: #1e3a8a;
      border-top: 1px solid #cbd5e1;
      border-bottom: none;
      padding-top: 6px;
    }
    .highlight-box {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 6px;
      padding: 10px 14px;
    }
    .sign-section {
      margin-top: 35px;
      display: flex;
      justify-content: space-between;
      page-break-inside: avoid;
    }
    .sign-box {
      width: 45%;
      border-top: 1px solid #9ca3af;
      padding-top: 6px;
      text-align: center;
      font-size: 11px;
      color: #4b5563;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="company-title">${data.company.name}</h1>
      <div style="font-size: 11px; color: #4b5563;">
        ${data.company.address ? `<div>${data.company.address}</div>` : ''}
        ${data.company.phone ? `<div>Tel: ${data.company.phone}</div>` : ''}
        ${data.company.taxId ? `<div>Tax/BR Reg: ${data.company.taxId}</div>` : ''}
      </div>
    </div>
    <div style="text-align: right;">
      <div style="font-size: 18px; font-weight: 800; color: #2563eb;">DAILY SHIFT SUMMARY</div>
      <div style="font-size: 12px; font-weight: 600; color: #111827; margin-top: 2px;">Shift #${data.shift.entryNumber}</div>
      <div style="font-size: 11px; color: #6b7280; margin-top: 2px;">Printed: ${new Date().toLocaleString()}</div>
    </div>
  </div>

  <div class="meta-box">
    <div class="meta-item">
      <label>POS Counter</label>
      <span>${data.shift.posProfileName}</span>
    </div>
    <div class="meta-item">
      <label>Cashier</label>
      <span>${data.shift.cashierName}</span>
    </div>
    <div class="meta-item">
      <label>Shift Opened</label>
      <span>${new Date(data.shift.openingTime).toLocaleString()}</span>
    </div>
    <div class="meta-item">
      <label>Shift Closed</label>
      <span>${new Date(data.shift.closingTime).toLocaleString()}</span>
    </div>
  </div>

  <div class="grid-2">
    <!-- Financial Sales Overview -->
    <div>
      <div class="section-title">Sales Overview</div>
      <div class="kpi-card">
        <div class="kpi-row">
          <span>Gross Sales:</span>
          <span style="font-family: monospace;">${fmt(data.financials.totalSales)}</span>
        </div>
        <div class="kpi-row">
          <span>Returns & Refunds:</span>
          <span style="font-family: monospace; color: #dc2626;">-${fmt(data.financials.totalReturns)}</span>
        </div>
        <div class="kpi-row">
          <span>Total Transactions:</span>
          <span>${data.financials.totalTransactions} bills</span>
        </div>
        ${data.financials.discountTotal ? `
        <div class="kpi-row">
          <span>Discounts Allowed:</span>
          <span style="font-family: monospace;">${fmt(data.financials.discountTotal)}</span>
        </div>` : ''}
        ${data.financials.taxTotal ? `
        <div class="kpi-row">
          <span>Taxes (VAT/SSCL):</span>
          <span style="font-family: monospace;">${fmt(data.financials.taxTotal)}</span>
        </div>` : ''}
        <div class="kpi-row total">
          <span>Net Registered Sales:</span>
          <span style="font-family: monospace;">${fmt(data.financials.netSales)}</span>
        </div>
      </div>
    </div>

    <!-- Cash Handover & Control -->
    <div>
      <div class="section-title">Drawer Cash Handover</div>
      <div class="highlight-box">
        <div class="kpi-row">
          <span>Opening Drawer Float:</span>
          <span style="font-family: monospace;">${fmt(data.cashControl.openingFloat)}</span>
        </div>
        <div class="kpi-row">
          <span>Cash Sales + Paid-In:</span>
          <span style="font-family: monospace;">${fmt(data.cashControl.cashSales + data.cashControl.cashMovementsIn)}</span>
        </div>
        <div class="kpi-row">
          <span>Cash Paid-Out (Expenses):</span>
          <span style="font-family: monospace; color: #dc2626;">-${fmt(data.cashControl.cashMovementsOut)}</span>
        </div>
        <div class="kpi-row" style="font-weight: 700; border-top: 1px solid #bfdbfe; padding-top: 4px;">
          <span>Total Counted Cash in Drawer:</span>
          <span style="font-family: monospace; color: #1e3a8a;">${fmt(data.cashControl.totalCountedCash)}</span>
        </div>
        <div class="kpi-row" style="color: #92400e; font-weight: 700;">
          <span>💵 Cash Handover (To Owner/Safe):</span>
          <span style="font-family: monospace;">${fmt(data.cashControl.cashOutHandover)}</span>
        </div>
        <div class="kpi-row total" style="color: #15803d; border-top: 2px solid #86efac;">
          <span>🏦 Retained Float for Next Day:</span>
          <span style="font-family: monospace;">${fmt(data.cashControl.retainedDrawerFloat)}</span>
        </div>
      </div>
    </div>
  </div>

  <div class="section-title">Payment Tender Reconciliation</div>
  <table>
    <thead>
      <tr>
        <th>Tender / Method</th>
        <th style="text-align: right;">Expected</th>
        <th style="text-align: right;">Counted / Actual</th>
        <th style="text-align: right;">Variance</th>
      </tr>
    </thead>
    <tbody>
      ${tenderRows}
    </tbody>
  </table>

  ${data.externalBills && data.externalBills.length > 0 ? `
  <div class="section-title">External / Manual Bills Recorded</div>
  <table>
    <thead>
      <tr>
        <th style="width: 30px;">#</th>
        <th>Bill No. / Ref</th>
        <th>Item Description</th>
        <th>Tender</th>
        <th style="text-align: right;">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${externalBillsRows}
    </tbody>
  </table>
  ` : ''}

  ${data.notes ? `
  <div style="margin-top: 10px; padding: 8px 12px; background: #fefce8; border: 1px solid #fef08a; border-radius: 4px; font-size: 11px;">
    <strong>Shift Remarks / Notes:</strong> ${data.notes}
  </div>` : ''}

  <div class="sign-section">
    <div class="sign-box">
      <strong>Cashier Signature</strong><br />
      ${data.shift.cashierName}
    </div>
    <div class="sign-box">
      <strong>Manager / Owner Verification</strong><br />
      Verified & Float Confirmed
    </div>
  </div>
</body>
</html>`
}
