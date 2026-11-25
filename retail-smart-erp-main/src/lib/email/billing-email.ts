import { sendSystemEmail } from './system-email'
import { formatDueAmount, type DueNotice } from '@/lib/tenant/lock-message'

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

export async function sendBillingStatementEmail(options: {
  to: string
  ownerName?: string | null
  companyName: string
  statementNo: string
  billingPeriod: string
  tierName: string
  amountDue: number
  currency: string
  dueDate?: string | null
  dueTime?: string | null
  usage?: {
    databaseBytes: number
    fileStorageBytes: number
    usersCount: number
    salesCount: number
    itemsCount: number
    customersCount: number
  } | null
  dueNotice?: DueNotice | null
  billingUrl?: string
}) {
  const appName = process.env.NEXT_PUBLIC_APP_NAME || 'skyERPOS'
  const isPaid = options.dueNotice?.status === 'paid'
  const paid = options.dueNotice?.paidDetails
  const formattedTotal = formatDueAmount(
    isPaid ? (paid?.amount ?? options.amountDue) : options.amountDue,
    isPaid ? (paid?.currency ?? options.currency) : options.currency
  ) || `${options.currency} ${options.amountDue.toFixed(2)}`

  const headerBg = isPaid
    ? 'linear-gradient(135deg, #059669 0%, #10b981 100%)'
    : 'linear-gradient(135deg, #1e40af 0%, #2563eb 100%)'

  const subject = isPaid
    ? `Payment Receipt (${formattedTotal}) — ${options.companyName} | ${appName}`
    : `Billing Statement & Payment Notice (${formattedTotal}) — ${options.companyName} | ${appName}`

  const dueStr = options.dueDate
    ? `${new Date(options.dueDate).toLocaleDateString()}${options.dueTime ? ` at ${options.dueTime}` : ''}`
    : null

  const usageRows = options.usage
    ? `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;">Database &amp; Transaction Metering</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${formatBytes(options.usage.databaseBytes)} DB · ${options.usage.itemsCount.toLocaleString()} items · ${options.usage.salesCount.toLocaleString()} sales</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#6b7280;">Included</td>
      </tr>
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;">File Storage &amp; Staff Accounts</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${formatBytes(options.usage.fileStorageBytes)} stored · ${options.usage.usersCount} active user(s)</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#6b7280;">Included</td>
      </tr>
    `
    : ''

  const paidBanner = isPaid && paid
    ? `
      <div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:10px;padding:16px;margin-bottom:20px;">
        <p style="margin:0 0 6px;font-weight:700;color:#065f46;font-size:15px;">Payment Received &amp; Verified</p>
        <p style="margin:0;color:#047857;font-size:13px;">
          Amount: <strong>${esc(formattedTotal)}</strong>
          ${paid.method ? ` · Method: <strong>${esc(paid.method)}</strong>` : ''}
          ${paid.reference ? ` · Ref: <strong>${esc(paid.reference)}</strong>` : ''}
          <br/>Received on: ${new Date(paid.paidAt).toLocaleString()}
          ${paid.note ? `<br/>Note: ${esc(paid.note)}` : ''}
        </p>
      </div>
    `
    : ''

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="background:${headerBg};padding:28px 24px;color:#ffffff;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;opacity:0.85;">${esc(appName)} Server &amp; Cloud Billing</div>
        <h1 style="margin:6px 0 0;font-size:22px;font-weight:800;">${isPaid ? 'Payment Receipt' : 'Billing Statement &amp; Invoice'}</h1>
        <p style="margin:4px 0 0;font-size:13px;opacity:0.9;">${esc(options.companyName)} · ${esc(options.statementNo)}</p>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 16px;color:#374151;font-size:14px;">
          Hi ${esc(options.ownerName || options.companyName)},
        </p>
        ${paidBanner}
        ${!isPaid && options.dueNotice?.message ? `
          <div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:14px 16px;margin-bottom:20px;">
            <p style="margin:0 0 4px;font-weight:700;color:#92400e;font-size:14px;">${esc(options.dueNotice.title)}</p>
            <p style="margin:0;color:#78350f;font-size:13px;">${esc(options.dueNotice.message)}</p>
            ${options.dueNotice.contactNote ? `<p style="margin:6px 0 0;color:#92400e;font-size:12px;font-weight:600;">${esc(options.dueNotice.contactNote)}</p>` : ''}
          </div>
        ` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
          <thead>
            <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
              <th style="padding:10px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;">Service / Resource</th>
              <th style="padding:10px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;">Details</th>
              <th style="padding:10px 12px;text-align:right;color:#6b7280;font-size:11px;text-transform:uppercase;">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#111827;">${esc(options.tierName)} Server &amp; POS Plan</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Period: ${esc(options.billingPeriod)}${dueStr && !isPaid ? `<br/>Due: ${esc(dueStr)}` : ''}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#111827;">${esc(formattedTotal)}</td>
            </tr>
            ${usageRows}
          </tbody>
          <tfoot>
            <tr style="background:#f9fafb;">
              <td colspan="2" style="padding:12px;text-align:right;font-weight:700;color:#111827;">${isPaid ? 'Total Paid' : 'Total Balance Due'}</td>
              <td style="padding:12px;text-align:right;font-size:16px;font-weight:800;color:#111827;">${esc(formattedTotal)}</td>
            </tr>
          </tfoot>
        </table>
        ${options.billingUrl ? `
          <div style="text-align:center;margin:24px 0 8px;">
            <a href="${esc(options.billingUrl)}" style="display:inline-block;background:#1e40af;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:12px 24px;border-radius:8px;">
              View Full Billing &amp; Usage Statement
            </a>
          </div>
        ` : ''}
      </div>
      <div style="background:#f9fafb;padding:14px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:center;">
        ${esc(appName)} Automated Billing · Please contact support if you have any questions.
      </div>
    </div>
  `

  const text = isPaid
    ? `Payment Receipt for ${options.companyName}\nAmount Paid: ${formattedTotal}\nMethod: ${paid?.method || '-'}\nReference: ${paid?.reference || '-'}\nPeriod: ${options.billingPeriod}`
    : `Billing Statement for ${options.companyName} (${options.statementNo})\nAmount Due: ${formattedTotal}\nPeriod: ${options.billingPeriod}${dueStr ? `\nDue: ${dueStr}` : ''}\n${options.dueNotice?.message || ''}`

  return sendSystemEmail({
    to: options.to,
    subject,
    html,
    text,
  })
}
