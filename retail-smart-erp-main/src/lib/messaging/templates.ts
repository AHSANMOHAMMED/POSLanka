/**
 * Message texts for the platform messaging add-on. Client-safe (no server imports).
 *
 * Vendors can edit the text of each purpose (stored as notification_templates rows with
 * trigger_event 'messaging.<purpose>'); the default below is used otherwise. Placeholders are
 * {{name}}. WhatsApp sends an approved template when the platform has one for the purpose
 * (body variables in WHATSAPP_TEMPLATE_PARAMS order), otherwise the rendered text.
 */

export const MESSAGE_PURPOSES = ['sale_receipt', 'payment_reminder', 'low_stock'] as const
export type MessagePurpose = (typeof MESSAGE_PURPOSES)[number]

export const PURPOSE_LABELS: Record<MessagePurpose, string> = {
  sale_receipt: 'Bill / receipt to the customer',
  payment_reminder: 'Payment reminder (credit customers)',
  low_stock: 'Low-stock alert to the owner',
}

export const PURPOSE_VARIABLES: Record<MessagePurpose, string[]> = {
  sale_receipt: ['shop', 'invoiceNo', 'total', 'link', 'customer', 'date'],
  payment_reminder: ['shop', 'customer', 'balance', 'shopPhone'],
  low_stock: ['shop', 'item', 'qty', 'min', 'warehouse'],
}

/** Body variables {{1}} {{2}} … of the WhatsApp template registered for each purpose. */
export const WHATSAPP_TEMPLATE_PARAMS: Record<MessagePurpose, string[]> = {
  sale_receipt: ['shop', 'invoiceNo', 'total', 'link'],
  payment_reminder: ['shop', 'customer', 'balance'],
  low_stock: ['shop', 'item', 'qty'],
}

export const DEFAULT_TEXTS: Record<MessagePurpose, string> = {
  sale_receipt: '{{shop}}: Thank you! Bill {{invoiceNo}} total {{total}}. View your bill: {{link}}',
  payment_reminder: '{{shop}}: Dear {{customer}}, your outstanding balance is {{balance}}. Please settle at your earliest convenience. Thank you.',
  low_stock: '{{shop}} low stock: {{item}} has {{qty}} left (minimum {{min}}) {{warehouse}}',
}

export const TEMPLATE_TRIGGER_PREFIX = 'messaging.'
export const MAX_TEMPLATE_LENGTH = 640

export function renderMessage(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template
    .replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_, k: string) => {
      const v = vars[k]
      return v === null || v === undefined ? '' : String(v)
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
