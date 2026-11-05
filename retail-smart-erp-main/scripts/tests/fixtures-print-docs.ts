/**
 * Fixed documents / configs for the document-printing tests (l18-document-print.ts).
 * The legacy-render hashes in l18 were taken from the renderer before paper sizes, mm margins,
 * pre-printed forms and letterheads were added: old templates must render byte-identically.
 */
import type { InvoiceCompany, InvoiceDoc } from '../../src/lib/print/invoice-template'

export const FIXED_COMPANY: InvoiceCompany = {
  name: 'Lanka Electronics', legalName: 'Lanka Electronics (Pvt) Ltd', address: '12 Main Street\nKandy', phone: '081 222 3333',
  email: 'shop@example.lk', website: 'example.lk', taxId: '123456789-7000', brn: 'PV 1234', logoUrl: '', currency: 'LKR',
}

export const FIXED_DOC: InvoiceDoc = {
  kind: 'invoice',
  number: 'INV-000456',
  date: '2026-10-01',
  dueDate: '2026-10-31',
  terms: 'Net 30',
  reference: 'PO-7781',
  salesperson: 'Nimal Perera',
  customer: { name: 'Kamal Fernando', address: '25, Galle Road\nColombo 03', phone: '077 123 4567', email: 'kamal@example.lk', taxId: '' },
  lines: [
    { name: 'Double Door Refrigerator 340L', description: 'Inverter, frost free', sku: 'FRG-340', quantity: 1, unit: 'Nos', unitPrice: 245000, discount: 5000, taxRate: 18, taxAmount: 43200, amount: 240000, serialNumbers: ['RF340-22A91873'], warrantyMonths: 24, warrantyUntil: '2028-10-01' },
    { name: 'Smart LED TV 55"', sku: 'TV-55U', quantity: 1, unit: 'Nos', unitPrice: 189900, taxRate: 18, taxAmount: 34182, amount: 189900 },
    { name: 'Voltage Guard', quantity: 3, unit: 'Nos', unitPrice: 3500, amount: 10500 },
  ],
  subtotal: 440400,
  discount: 0,
  tax: 77382,
  taxBreakdown: [{ name: 'VAT', rate: 18, amount: 77382 }],
  total: 517782,
  paid: 300000,
  balanceDue: 217782,
  notes: 'Keep this invoice for warranty claims.',
}

/** Stored configs / legacy rows as saved by earlier versions (margins in inches, legacy mm columns). */
export const LEGACY_CASES: Array<{ name: string; row: Record<string, unknown>; preview?: boolean }> = [
  { name: 'empty config (built-in default)', row: { config: {} } },
  { name: 'legacy columns only (a5 landscape, mm margins)', row: { config: {}, paperSize: 'a5', orientation: 'landscape', margins: { top: 10, right: 12, bottom: 8, left: 15 }, showLogo: false, showFooter: true } },
  {
    name: 'designer config (inch margins, header band, letter)',
    row: { config: { version: 1, general: { paperSize: 'letter', orientation: 'portrait', margins: { top: 0.4, bottom: 0.6, left: 0.75, right: 0.3 }, fontFamily: 'serif', backgroundImage: '' }, header: { show: true, text: 'Head office', firstPageOnly: false, height: 0.8 }, table: { striped: true }, footer: { showPageNumber: true } } },
  },
  { name: 'designer preview (a4)', row: { config: { general: { margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } } } }, preview: true },
]
