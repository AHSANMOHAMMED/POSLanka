'use client'

/**
 * "Print A4" button for sales invoices and quotations (drizzle/0179 template designer).
 * Prints with the default template of the document type; when several templates exist a small
 * menu lets the user choose one. Without any template the built-in default layout is used.
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2, Printer } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { renderInvoiceHtml, type InvoiceCompany, type InvoiceDoc } from '@/lib/print/invoice-template'
import { fetchPrintTemplates, pickTemplateConfig, printHtmlDocument, type PrintTemplateRow } from '@/lib/print/invoice-document'

export interface PrintA4ButtonProps {
  /** Template document types, in preference order (TEMPLATE_DOC_TYPES.sale / .quotation). */
  documentTypes: readonly string[]
  loadDocument: () => Promise<{ doc: InvoiceDoc; company: InvoiceCompany }>
  label?: string
  className?: string
  /** Print once on mount (e.g. ?print=1 links). */
  autoPrint?: boolean
}

export function PrintA4Button({ documentTypes, loadDocument, label = 'Print A4', className, autoPrint }: PrintA4ButtonProps) {
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

  async function doPrint(templateId?: string) {
    setOpen(false)
    setBusy(true)
    try {
      const list = templates ?? await fetchPrintTemplates(typesKey.split(','))
      const { doc, company } = await loadDocument()
      const ok = await printHtmlDocument(renderInvoiceHtml(pickTemplateConfig(list, templateId), doc, company))
      if (!ok) toast.error('Allow pop-ups to print this document')
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

  const btnClass = className || 'px-4 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5 disabled:opacity-50'
  const several = (templates?.length || 0) > 1

  return (
    <div className="relative inline-flex">
      <button type="button" onClick={() => (several ? setOpen((o) => !o) : doPrint())} disabled={busy} className={btnClass}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
        {label}
        {several && <ChevronDown size={12} />}
      </button>
      {open && several && (
        <div className="absolute left-0 top-full mt-1 z-40 min-w-[200px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg py-1">
          {templates!.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => doPrint(t.id)}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              {t.name}{t.isDefault ? ' (default)' : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
