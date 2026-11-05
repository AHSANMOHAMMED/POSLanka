'use client'

/**
 * Settings of a 'document' printer profile (PrinterSettingsModal): page printer (A4 / A5 through
 * the print dialog) or dot matrix (ESC/P text: Epson LQ-310 …), pitch / carriage / form length,
 * and per document type the template and paper to use on this terminal.
 */
import { useEffect, useState } from 'react'
import { FormCheckbox, FormField, FormSelect } from '@/components/ui/form-elements'
import type { PrinterProfile } from '@/lib/print/printer-profiles'
import { DOCUMENT_PAPER_CHOICES, type DocumentPrinterConfig } from '@/lib/print/printer-profiles'
import { DOC_PAPER_MM } from '@/lib/print/paper'
import { ESCP_CPIS } from '@/lib/print/escp'
import { textColsFor } from '@/lib/print/text-document'
import { TEMPLATE_DOC_TYPES, companyFromTenant, type PrintTemplateRow } from '@/lib/print/invoice-document'
import { sampleInvoiceDoc } from '@/lib/print/invoice-template'
import { printInvoiceDocument } from '@/lib/print/document-print'
import { fetchTenantInfo } from '@/lib/print/receipt-loader'

/** Document types configurable per terminal (key = profile.document.docs key). */
export const DOCUMENT_PRINT_TYPES: Array<{ key: string; label: string; templateTypes: readonly string[] }> = [
  { key: 'invoice', label: 'Sales invoice', templateTypes: TEMPLATE_DOC_TYPES.sale },
  { key: 'quotation', label: 'Quotation', templateTypes: TEMPLATE_DOC_TYPES.quotation },
  { key: 'credit_note', label: 'Credit note', templateTypes: TEMPLATE_DOC_TYPES.credit_note },
  { key: 'purchase_order', label: 'Purchase order', templateTypes: TEMPLATE_DOC_TYPES.purchase_order },
]

/** Test print: a sample invoice exactly as invoices will print on this printer. */
export async function testDocumentPrinter(profile: PrinterProfile): Promise<boolean> {
  const company = companyFromTenant(await fetchTenantInfo().catch(() => null))
  const res = await printInvoiceDocument(sampleInvoiceDoc('invoice'), company, { documentTypes: TEMPLATE_DOC_TYPES.sale, settingKey: 'invoice', profile })
  if (!res.ok) throw new Error(res.error || 'Printing was blocked (allow pop-ups)')
  return true
}

export function DocumentPrinterSettings({ profile, onChange }: { profile: PrinterProfile; onChange: (patch: Partial<DocumentPrinterConfig>) => void }) {
  const d = profile.document
  const [templates, setTemplates] = useState<PrintTemplateRow[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/print-templates')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: PrintTemplateRow[]) => { if (!cancelled && Array.isArray(rows)) setTemplates(rows.filter((t) => t.isActive !== false)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const setDoc = (key: string, patch: Partial<DocumentPrinterConfig['docs'][string]>) => {
    const cur = d.docs[key] || { templateId: '', paperSize: '' }
    onChange({ docs: { ...d.docs, [key]: { ...cur, ...patch } } })
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Printer type</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {([
            ['page', 'Page printer (A4 / A5)', 'Laser / inkjet: print templates, letter heads and pre-printed forms through the print dialog'],
            ['dotmatrix', 'Dot matrix (text)', 'Epson LQ-310 / LX-350 and compatibles: fast text on continuous paper (ESC/P)'],
          ] as const).map(([mode, title, desc]) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange({ mode })}
              className={`text-left rounded-xl border p-3 transition-colors ${d.mode === mode ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}
            >
              <div className="font-semibold">{title}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {d.mode === 'dotmatrix' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FormField label="Carriage">
              <FormSelect value={String(d.carriageInches)} onChange={(e) => onChange({ carriageInches: Number(e.target.value) })} selectSize="sm">
                <option value="8">Narrow 8 in (LQ-310, LX-350)</option>
                <option value="13.6">Wide 13.6 in (LQ-590, FX-2175)</option>
              </FormSelect>
            </FormField>
            <FormField label="Characters per inch">
              <FormSelect value={String(d.cpi)} onChange={(e) => onChange({ cpi: Number(e.target.value) as DocumentPrinterConfig['cpi'] })} selectSize="sm">
                {ESCP_CPIS.map((c) => (
                  <option key={c} value={c}>{c} cpi{c >= 17 ? ' condensed' : ''} = {textColsFor(d.carriageInches, c)} columns</option>
                ))}
              </FormSelect>
            </FormField>
            <FormField label="Form length">
              <FormSelect value={String(d.pageLengthInches)} onChange={(e) => onChange({ pageLengthInches: Number(e.target.value) })} selectSize="sm">
                <option value="11">11 in (9.5 × 11 continuous)</option>
                <option value="12">12 in (A4-length continuous)</option>
                <option value="5.5">5.5 in (half page)</option>
                <option value="8.5">8.5 in</option>
                <option value="6">6 in</option>
              </FormSelect>
            </FormField>
            <FormField label="Paper width (browser fallback)">
              <FormSelect value={String(d.paperWidthMm)} onChange={(e) => onChange({ paperWidthMm: Number(e.target.value) })} selectSize="sm">
                <option value="241.3">9.5 in continuous (241 mm)</option>
                <option value="210">A4 width (210 mm)</option>
                <option value="381">15 in continuous (381 mm)</option>
              </FormSelect>
            </FormField>
          </div>
          <FormCheckbox label="Letter quality (slower, sharper; off = draft)" checked={d.letterQuality} onChange={(e) => onChange({ letterQuality: e.target.checked })} />
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Connection <strong>Print agent</strong> (or USB) sends ESC/P text straight to the printer — on Windows pick the printer installed with its Epson driver.
            With <strong>Browser</strong> the same layout prints through the print dialog as a monospace page (set the paper size there).
            Set the printer&apos;s top-of-form at the perforation before printing.
          </p>
        </>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Page printers always print through the browser print dialog (pick the printer, tick &quot;Background graphics&quot;, scale 100 %).
          The connection setting above is not used for documents.
        </p>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Documents on this terminal</p>
        <div className="space-y-2">
          {DOCUMENT_PRINT_TYPES.map((t) => {
            const s = d.docs[t.key] || { templateId: '', paperSize: '' }
            const options = templates.filter((x) => t.templateTypes.includes(x.documentType))
            return (
              <div key={t.key} className="grid grid-cols-1 sm:grid-cols-[130px_1fr_150px] gap-2 items-center">
                <span className="text-sm text-gray-700 dark:text-gray-300">{t.label}</span>
                <FormSelect value={s.templateId} onChange={(e) => setDoc(t.key, { templateId: e.target.value })} selectSize="sm" disabled={d.mode === 'dotmatrix'}>
                  <option value="">Default template</option>
                  {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </FormSelect>
                <FormSelect value={s.paperSize} onChange={(e) => setDoc(t.key, { paperSize: e.target.value as typeof s.paperSize })} selectSize="sm" disabled={d.mode === 'dotmatrix'}>
                  <option value="">Template paper</option>
                  {DOCUMENT_PAPER_CHOICES.map((p) => <option key={p} value={p}>{DOC_PAPER_MM[p].label}</option>)}
                </FormSelect>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
