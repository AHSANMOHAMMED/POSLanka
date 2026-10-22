/**
 * Canonical e-invoice document (H2). Transmitter-agnostic: the Sri Lanka IRD (RAMIS) e-invoicing
 * API is not published yet, so documents are queued in this neutral shape and a transmitter maps
 * it to the authority's format when one is configured (src/lib/einvoice/transmitter.ts).
 */
import type { TaxCategory } from '@/lib/utils/tax-category'

export const EINVOICE_SCHEMA_VERSION = 'poslanka.einvoice/1'

export type EInvoiceDocumentType = 'invoice' | 'credit_note' | 'debit_note'
export type EInvoiceSourceType = 'sale' | 'sale_return' | 'credit_note' | 'debit_note'

export interface EInvoiceParty {
  name: string
  legalName?: string | null
  /** TIN / VAT registration number. */
  tin: string | null
  brn?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
}

export interface EInvoiceLine {
  lineNo: number
  description: string
  itemCode: string | null
  quantity: number
  unit: string | null
  unitPrice: number
  /** Value excl. VAT after discounts. */
  netAmount: number
  vatCategory: TaxCategory
  vatRate: number
  vatAmount: number
  grossAmount: number
}

export interface EInvoiceVatBreakdown {
  category: TaxCategory
  rate: number
  taxableAmount: number
  vatAmount: number
}

export interface EInvoicePayload {
  schemaVersion: typeof EINVOICE_SCHEMA_VERSION
  documentType: EInvoiceDocumentType
  documentNo: string
  /** Tenant-local issue date YYYY-MM-DD. */
  issueDate: string
  /** UTC ISO timestamp. */
  issuedAt: string
  currency: string
  /** Invoice adjusted by a credit / debit note or return. */
  originalDocument: { documentNo: string; issueDate: string | null } | null
  reason: string | null
  supplier: EInvoiceParty
  buyer: EInvoiceParty | null
  /** Buyer has a TIN (business-to-business). */
  isB2B: boolean
  lines: EInvoiceLine[]
  vatBreakdown: EInvoiceVatBreakdown[]
  totals: {
    netAmount: number
    vatAmount: number
    grossAmount: number
    discount: number
  }
  payments: Array<{ method: string; amount: number }>
  source: { type: EInvoiceSourceType; id: string }
}
