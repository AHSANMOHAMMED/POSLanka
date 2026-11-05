'use client'

/**
 * Public document-printing API (browser). Use these from any page / module that prints a
 * document (sales invoices, quotations, credit notes, purchase orders, job cards, warranty cards …).
 *
 *   printHtmlPage(bodyHtml, { paperSize: 'a5', orientation: 'landscape', marginsMm: 8, title })
 *     Print your own HTML fragment on a page of the given paper (A4 / A5 / A6 / Letter / Legal /
 *     Half letter / 9.5" continuous / custom mm). Escape your data. → Promise<boolean>
 *
 *   printInvoiceDocument(doc, company, { documentTypes: ['invoice'], settingKey: 'invoice' })
 *     Print an InvoiceDoc (invoice-template.ts) the way this terminal's document printer is set up:
 *     page mode = the tenant's print template (+ letter head, pre-printed form, paper override)
 *     through the print dialog; dot matrix = ESC/P text via the print agent / USB, or the same text
 *     layout as a monospace page in the browser. `format` forces 'page' or 'dotmatrix'.
 *
 *   printTextDocument(doc, company, setup?)  — dot matrix text, explicitly.
 *   getDocumentPrinter()                      — this terminal's 'document' printer profile (or null).
 *   buildHtmlPage(...) (paper.ts)             — the HTML printHtmlPage prints (pure, for previews).
 *
 * Per-document-type choices (template / paper) live on the document printer profile under
 * `document.docs[settingKey]` — e.g. 'invoice', 'quotation', 'credit_note', 'purchase_order',
 * 'job_card', 'warranty_card'.
 */
import { buildHtmlPage, isDocPaperSize, type DocPaperSize, type HtmlPageOptions } from './paper'
import { renderFormCalibrationHtml, renderInvoiceHtml, templateConfigFromRow, type InvoiceCompany, type InvoiceDoc, type InvoiceTemplateConfig } from './invoice-template'
import { fetchLetterHead, fetchPrintTemplates, pickTemplateRow, printHtmlDocument, type PrintTemplateRow } from './invoice-document'
import { DEFAULT_DOCUMENT_CONFIG, getPrinterForRole, sendToPrinter, type DocumentPrinterConfig, type PrinterProfile } from './printer-profiles'
import { documentToEscp, layoutTextDocument, dotMatrixCols, textPagesToHtml, type DotMatrixSetup } from './text-document'
import { linesPerPage } from './escp'

export { buildHtmlPage, printHtmlDocument }
export type { HtmlPageOptions, DocPaperSize }

/** Print an HTML body fragment on a page of the given paper size (browser print dialog). */
export function printHtmlPage(bodyHtml: string, opts: HtmlPageOptions = {}): Promise<boolean> {
  return printHtmlDocument(buildHtmlPage(bodyHtml, opts))
}

/** This terminal's document printer (first profile with role 'document'). */
export function getDocumentPrinter(): PrinterProfile | null {
  return getPrinterForRole('document')
}

export type DocumentPrintFormat = 'auto' | 'page' | 'dotmatrix'

export interface PrintInvoiceDocumentOptions {
  /** Template document types in preference order (TEMPLATE_DOC_TYPES.sale …). */
  documentTypes: readonly string[]
  /** Key of the per-document setting on the printer profile (default documentTypes[0]). */
  settingKey?: string
  /** Template to use (overrides the profile's choice). */
  templateId?: string | null
  /** Default 'auto' = the profile's mode for this document type (page when no profile). */
  format?: DocumentPrintFormat
  /** Page mode: print on this paper instead of the template's (ignored for pre-printed forms). */
  paperSize?: DocPaperSize | null
  /** Already-fetched templates (skips the request). */
  templates?: PrintTemplateRow[] | null
  /** Dot matrix: force a setup (e.g. 136 columns) instead of the profile's. */
  dotMatrix?: Partial<DotMatrixSetup> | null
  profile?: PrinterProfile | null
}

export interface PrintResult {
  ok: boolean
  via: 'dialog' | 'printer'
  error?: string
}

function dotMatrixSetupOf(cfg: DocumentPrinterConfig, over?: Partial<DotMatrixSetup> | null): DotMatrixSetup {
  return {
    cpi: over?.cpi ?? cfg.cpi,
    carriageInches: over?.carriageInches ?? cfg.carriageInches,
    pageLengthInches: over?.pageLengthInches ?? cfg.pageLengthInches,
    paperWidthMm: over?.paperWidthMm ?? cfg.paperWidthMm,
    letterQuality: over?.letterQuality ?? cfg.letterQuality,
  }
}

/** Print the document as dot matrix text (ESC/P to the printer, or a monospace page in the browser). */
export async function printTextDocument(
  doc: InvoiceDoc,
  company: InvoiceCompany,
  opts: { profile?: PrinterProfile | null; setup?: Partial<DotMatrixSetup> | null; template?: InvoiceTemplateConfig | null } = {},
): Promise<PrintResult> {
  const profile = opts.profile === undefined ? getDocumentPrinter() : opts.profile
  const setup = dotMatrixSetupOf(profile?.document || DEFAULT_DOCUMENT_CONFIG, opts.setup)
  const t = opts.template
  const extra = t
    ? { titles: t.titles, dateFormat: t.general.dateFormat, footerText: t.footer.show ? t.footer.text : '', signature: t.other.signature.show }
    : {}
  // Raw ESC/P only to a printer set up as dot matrix (never to a laser that happens to use the agent)
  const raw = !!profile && profile.transport !== 'browser' && profile.document.mode === 'dotmatrix'
  if (raw && profile) {
    try {
      const bytes = documentToEscp(doc, company, setup, extra)
      for (let i = 0; i < Math.max(1, profile.copies); i++) await sendToPrinter(profile, bytes)
      return { ok: true, via: 'printer' }
    } catch (e) {
      return { ok: false, via: 'printer', error: e instanceof Error ? e.message : String(e) }
    }
  }
  const pages = layoutTextDocument(doc, company, { ...extra, cols: dotMatrixCols(setup), linesPerPage: linesPerPage(setup.pageLengthInches) })
  const ok = await printHtmlDocument(textPagesToHtml(pages, setup, `${doc.number}`))
  return { ok, via: 'dialog' }
}

/**
 * Print an InvoiceDoc as this terminal's document printer is set up (see the header comment).
 * Returns { ok:false, error } instead of throwing for printer errors.
 */
export async function printInvoiceDocument(doc: InvoiceDoc, company: InvoiceCompany, opts: PrintInvoiceDocumentOptions): Promise<PrintResult> {
  const profile = opts.profile === undefined ? getDocumentPrinter() : opts.profile
  const key = opts.settingKey || opts.documentTypes[0] || 'invoice'
  const setting = profile?.document.docs[key]
  const mode = opts.format && opts.format !== 'auto' ? opts.format : profile?.document.mode || 'page'
  const templates = opts.templates ?? await fetchPrintTemplates(opts.documentTypes)
  const row = pickTemplateRow(templates, opts.templateId || setting?.templateId || null)
  const cfg = templateConfigFromRow(row)

  if (mode === 'dotmatrix') return printTextDocument(doc, company, { profile, setup: opts.dotMatrix, template: cfg })

  const paper = opts.paperSize || (setting?.paperSize || null)
  const effective: InvoiceTemplateConfig = paper && isDocPaperSize(paper) && !cfg.form.enabled
    ? { ...cfg, general: { ...cfg.general, paperSize: paper } }
    : cfg
  const letterHead = effective.form.enabled ? null : await fetchLetterHead(row?.letterHeadId)
  const ok = await printHtmlDocument(renderInvoiceHtml(effective, doc, company, { letterHead }))
  return { ok, via: 'dialog' }
}

/** Calibration page (mm grid + field outlines) of a pre-printed form template. */
export function printFormCalibration(config: InvoiceTemplateConfig): Promise<boolean> {
  return printHtmlDocument(renderFormCalibrationHtml(config))
}
