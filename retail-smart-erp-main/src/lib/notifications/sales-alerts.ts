/**
 * Sales-side alerts (called after commit, fire-and-forget).
 */
import { logError } from '@/lib/ai/error-logger'
import { deliverAlert, type NotifyOutcome } from './notify'
import { getAlertSettings } from './alert-settings'

const money = (n: number) => n.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export interface ReturnAlertInput {
  returnId: string
  returnNo: string
  originalInvoiceNo?: string | null
  /** true when the return has no original sale (manual return without receipt) */
  manual: boolean
  refundTotal: number
  actorUserId?: string | null
  actorName?: string | null
}

/** large_refund (≥ tenant largeRefundAmount) and manual_return → manageSales. */
export async function handleReturnAlerts(tenantId: string, r: ReturnAlertInput): Promise<NotifyOutcome[]> {
  const out: NotifyOutcome[] = []
  const who = r.actorName || 'A cashier'
  const data = { screen: 'alerts', saleId: r.returnId }
  const settings = await getAlertSettings(tenantId)
  if (settings.largeRefundAmount && r.refundTotal >= settings.largeRefundAmount) {
    out.push(await deliverAlert(tenantId, 'large_refund', {
      title: `Large refund ${money(r.refundTotal)}`,
      body: `${who} refunded ${money(r.refundTotal)} on ${r.returnNo}${r.originalInvoiceNo ? ` (invoice ${r.originalInvoiceNo})` : ''}.`,
      data,
      permission: 'manageSales',
      excludeUserId: r.actorUserId || undefined,
    }))
  }
  if (r.manual) {
    out.push(await deliverAlert(tenantId, 'manual_return', {
      title: 'Return without receipt',
      body: `${who} processed ${r.returnNo} (${money(r.refundTotal)}) without an original invoice.`,
      data,
      permission: 'manageSales',
      excludeUserId: r.actorUserId || undefined,
    }))
  }
  return out
}

export function notifyReturnAlerts(tenantId: string, r: ReturnAlertInput): void {
  handleReturnAlerts(tenantId, r).catch((error) => logError('notifications/sales-alerts', error, { tenantId, stage: 'return' }))
}

export function notifySaleVoided(tenantId: string, v: { saleId: string; invoiceNo: string; total: number; reason?: string | null; actorUserId?: string | null; actorName?: string | null }): void {
  deliverAlert(tenantId, 'sale_void', {
    title: `Sale voided: ${v.invoiceNo}`,
    body: `${v.actorName || 'A user'} voided ${v.invoiceNo} (${money(v.total)})${v.reason ? `: ${v.reason}` : ''}.`,
    data: { screen: 'alerts', saleId: v.saleId },
    permission: 'manageSales',
    excludeUserId: v.actorUserId || undefined,
  }).catch((error) => logError('notifications/sales-alerts', error, { tenantId, stage: 'void' }))
}
