'use client'

/**
 * Document print button (sales invoices, quotations, credit notes, purchase orders).
 * Click = print the way this terminal's document printer is set up (Settings → Printers →
 * Document printer; without one: the default template through the print dialog). The arrow menu
 * picks a template, a paper size (A4 / A5 / Half letter) or dot matrix text (80 / 136 columns).
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2, Printer } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import type { InvoiceCompany, InvoiceDoc } from '@/lib/print/invoice-template'
import { fetchPrintTemplates, type PrintTemplateRow } from '@/lib/print/invoice-document'
import { getDocumentPrinter, printInvoiceDocument, type PrintInvoiceDocumentOptions } from '@/lib/print/document-print'
import { DOC_PAPER_MM, type DocPaperSize } from '@/lib/print/paper'

export interface PrintA4ButtonProps {
  /** Template document types, in preference order (TEMPLATE_DOC_TYPES.sale / .quotation …). */
  documentTypes: readonly string[]
  /** Per-document setting key on the document printer profile (default documentTypes[0]). */
  settingKey?: string
  loadDocument: () => Promise<{ doc: InvoiceDoc; company: InvoiceCompany }>
  label?: string
  className?: string
  /** Print once on mount (e.g. ?print=1 links). */
  autoPrint?: boolean
}

type Choice = Pick<PrintInvoiceDocumentOptions, 'templateId' | 'format' | 'paperSize' | 'dotMatrix'>

const PAPER_CHOICES: DocPaperSize[] = ['a4', 'a5', 'half_letter']

export function PrintDocumentButton({ documentTypes, settingKey, loadDocument, label = 'Print', className, autoPrint }: PrintA4ButtonProps) {
  const [templates, setTemplates] = useState<PrintTemplateRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const autoDone = useRef(false)
  const typesKey = documentTypes.join(',')

  useEffect(() => {
    let cancelled = false
    fetchPrintTemplates(typesKey.split(',')).then((t) => { if (!cancelled) setTemplates(t) })
    return () => { cancelled = true }
  }, [typesKey])

  async function doPrint(choice: Choice = {}) {
    setOpen(false)
    setBusy(true)
    try {
      const list = templates ?? await fetchPrintTemplates(typesKey.split(','))
      const { doc, company } = await loadDocument()
      const res = await printInvoiceDocument(doc, company, { documentTypes: typesKey.split(','), settingKey, templates: list, format: 'auto', ...choice })
      if (!res.ok) toast.error(res.error || 'Allow pop-ups to print this document')
      else if (res.via === 'printer') toast.success('Sent to the printer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to print')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!autoPrint || autoDone.current || templates === null) return
    autoDone.current = true
    void doPrint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint, templates])

  const btnClass = className || 'px-4 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-l hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5 disabled:opacity-50'
  const item = 'w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
  const head = 'px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400'
  const hasDmPrinter = typeof window !== 'undefined' && !!getDocumentPrinter()

  return (
    <div className="relative inline-flex">
      <button type="button" onClick={() => doPrint()} disabled={busy} className={btnClass}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
        {label}
      </button>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        aria-label="Print options"
        className="px-1.5 border border-l-0 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-r hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
      >
        <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-40 min-w-[230px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg py-1">
            {(templates?.length || 0) > 0 && (
              <>
                <div className={head}>Template</div>
                {templates!.map((t) => (
                  <button key={t.id} type="button" onClick={() => doPrint({ templateId: t.id, format: 'page' })} className={item}>
                    {t.name}{t.isDefault ? ' (default)' : ''}
                  </button>
                ))}
              </>
            )}
            <div className={head}>Paper</div>
            {PAPER_CHOICES.map((p) => (
              <button key={p} type="button" onClick={() => doPrint({ format: 'page', paperSize: p })} className={item}>
                {DOC_PAPER_MM[p].label}
              </button>
            ))}
            <div className={head}>Dot matrix (text)</div>
            <button type="button" onClick={() => doPrint({ format: 'dotmatrix', dotMatrix: { cpi: 10 } })} className={item}>80 columns (10 cpi)</button>
            <button type="button" onClick={() => doPrint({ format: 'dotmatrix', dotMatrix: { cpi: 17 } })} className={item}>136 columns (17 cpi condensed)</button>
            <button type="button" onClick={() => doPrint({ format: 'dotmatrix', dotMatrix: { cpi: 10, pageLengthInches: 5.5 } })} className={item}>Half page 9.5 × 5.5 in</button>
            {!hasDmPrinter && (
              <p className="px-3 py-1.5 text-[11px] text-gray-400 max-w-[240px]">
                Prints through the browser. Add a Document printer (Printers settings) to send straight to a dot matrix printer.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

/** Backwards-compatible name (sales / quotation pages). */
export const PrintA4Button = PrintDocumentButton
