'use client'

import { useState } from 'react'
import { FileSpreadsheet, Loader2, Download } from 'lucide-react'
import { ReportPageLayout, SummaryCard } from '@/components/reports/ReportPageLayout'
import { toast } from '@/components/ui/toast'

type Tab = 'summary' | 'output' | 'input'

interface OutputRow {
  date: string
  docType: 'invoice' | 'return' | 'credit_note' | 'debit_note'
  docId: string
  docNo: string
  refDocNo: string | null
  buyerTin: string | null
  buyerName: string | null
  taxableValue: number
  vat: number
  zeroRatedValue: number
  exemptValue: number
  otherValue: number
  total: number
}

interface InputRow {
  date: string
  purchaseId: string
  purchaseNo: string
  supplierInvoiceNo: string | null
  supplierName: string | null
  supplierTin: string | null
  isReturn: boolean
  value: number
  vat: number
  total: number
}

interface Summary {
  output: { taxableValue: number; vat: number; zeroRatedValue: number; exemptValue: number; otherValue: number; total: number; documents: number }
  input: { value: number; vat: number; total: number; documents: number; withoutSupplierTin: number }
  netVatPayable: number
  taxAccounts: { id: string; name: string; accountNumber: string | null }[]
  gl: { outputVat: number; inputVat: number; otherMovements: number; byVoucherType: { voucherType: string; net: number }[] } | null
  differences: { outputVat: number; inputVat: number } | null
}

const DOC_LABELS: Record<OutputRow['docType'], string> = {
  invoice: 'Invoice',
  return: 'Return',
  credit_note: 'Credit note',
  debit_note: 'Debit note',
}

function money(n: number | null | undefined): string {
  return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function monthBounds(): { from: string; to: string } {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return { from: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, to: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(last)}` }
}

const th = 'px-3 py-2 text-xs font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap'
const td = 'px-3 py-2 text-sm text-gray-900 dark:text-white whitespace-nowrap'
const tdNum = 'px-3 py-2 text-sm text-right font-mono tabular-nums text-gray-700 dark:text-gray-300 whitespace-nowrap'

export default function VatSchedulePage() {
  const initial = monthBounds()
  const [fromDate, setFromDate] = useState(initial.from)
  const [toDate, setToDate] = useState(initial.to)
  const [tab, setTab] = useState<Tab>('summary')
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [outputRows, setOutputRows] = useState<OutputRow[] | null>(null)
  const [inputRows, setInputRows] = useState<InputRow[] | null>(null)

  async function load(which: Tab = tab) {
    if (!fromDate || !toDate) { toast.error('Please select both dates'); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ type: which, fromDate, toDate })
      const res = await fetch(`/api/reports/tax-vat-schedule?${params}`)
      const data = await res.json()
      if (!res.ok) { toast.error(typeof data.error === 'string' ? data.error : 'Failed to generate report'); return }
      if (which === 'summary') setSummary(data)
      else if (which === 'output') setOutputRows(data.rows)
      else setInputRows(data.rows)
    } catch {
      toast.error('Error generating report')
    } finally {
      setLoading(false)
    }
  }

  function switchTab(t: Tab) {
    setTab(t)
    if ((t === 'summary' && !summary) || (t === 'output' && !outputRows) || (t === 'input' && !inputRows)) load(t)
  }

  function generate() {
    setSummary(null)
    setOutputRows(null)
    setInputRows(null)
    load(tab)
  }

  const csvHref = (type: 'output' | 'input') =>
    `/api/reports/tax-vat-schedule?${new URLSearchParams({ type, fromDate, toDate, format: 'csv' })}`

  const inputClass = 'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500'
  const hasData = !!(summary || outputRows || inputRows)

  return (
    <ReportPageLayout
      title="VAT Schedules"
      filterBar={
        <div className="flex items-end gap-4 flex-wrap">
          <div className="flex-1 min-w-[150px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">From Date</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={inputClass} />
          </div>
          <div className="flex-1 min-w-[150px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">To Date</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={inputClass} />
          </div>
          <button onClick={generate} disabled={loading} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            Generate
          </button>
          <a href={csvHref('output')} className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 text-sm rounded text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
            <Download size={14} /> Output VAT CSV
          </a>
          <a href={csvHref('input')} className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 text-sm rounded text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
            <Download size={14} /> Input VAT CSV
          </a>
        </div>
      }
      loading={loading}
      hasData={hasData}
      emptyIcon={<FileSpreadsheet size={40} />}
      emptyMessage="Select a VAT period and click Generate."
      summaryCards={summary && tab === 'summary' ? <>
        <SummaryCard label="Output VAT" value={money(summary.output.vat)} color="green" />
        <SummaryCard label="Input VAT" value={money(summary.input.vat)} color="red" />
        <SummaryCard label="Net VAT Payable" value={money(summary.netVatPayable)} color={summary.netVatPayable >= 0 ? 'amber' : 'green'} />
      </> : undefined}
    >
      <div className="mb-3 flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {(['summary', 'output', 'input'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-blue-600 text-blue-600 dark:text-blue-400' : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'}`}
          >
            {t === 'summary' ? 'Summary & GL reconciliation' : t === 'output' ? 'Output VAT schedule' : 'Input VAT schedule'}
          </button>
        ))}
      </div>

      {tab === 'summary' && summary && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Supplies (output)</h3>
            <table className="w-full text-sm">
              <tbody>
                <tr><td className="py-1 text-gray-600 dark:text-gray-400">Standard-rated value</td><td className="py-1 text-right font-mono">{money(summary.output.taxableValue)}</td></tr>
                <tr><td className="py-1 text-gray-600 dark:text-gray-400">Output VAT</td><td className="py-1 text-right font-mono">{money(summary.output.vat)}</td></tr>
                <tr><td className="py-1 text-gray-600 dark:text-gray-400">Zero-rated supplies</td><td className="py-1 text-right font-mono">{money(summary.output.zeroRatedValue)}</td></tr>
                <tr><td className="py-1 text-gray-600 dark:text-gray-400">Exempt supplies</td><td className="py-1 text-right font-mono">{money(summary.output.exemptValue)}</td></tr>
                <tr><td className="py-1 text-gray-600 dark:text-gray-400">Other / unclassified (no VAT template)</td><td className="py-1 text-right font-mono">{money(summary.output.otherValue)}</td></tr>
                <tr className="border-t dark:border-gray-700"><td className="py-1 font-medium">Documents</td><td className="py-1 text-right">{summary.output.documents}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Purchases (input)</h3>
            <table className="w-full text-sm">
              <tbody>
                <tr><td className="py-1 text-gray-600 dark:text-gray-400">Value excl. VAT</td><td className="py-1 text-right font-mono">{money(summary.input.value)}</td></tr>
                <tr><td className="py-1 text-gray-600 dark:text-gray-400">Input VAT</td><td className="py-1 text-right font-mono">{money(summary.input.vat)}</td></tr>
                <tr className="border-t dark:border-gray-700"><td className="py-1 font-medium">Documents</td><td className="py-1 text-right">{summary.input.documents}</td></tr>
                {summary.input.withoutSupplierTin > 0 && (
                  <tr><td colSpan={2} className="py-1 text-amber-700 dark:text-amber-400">{summary.input.withoutSupplierTin} purchase(s) with VAT have no supplier TIN — input VAT may not be claimable.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4 md:col-span-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">Reconciliation to the general ledger</h3>
            {!summary.gl ? (
              <p className="text-sm text-gray-500">No tax account configured (Accounting Settings → default Tax account, or accounts on the tax templates).</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-600 dark:text-gray-400"><th className="text-left py-1"></th><th className="text-right py-1">Schedule</th><th className="text-right py-1">GL</th><th className="text-right py-1">Difference</th></tr>
                </thead>
                <tbody>
                  {(['outputVat', 'inputVat'] as const).map((k) => {
                    const sched = k === 'outputVat' ? summary.output.vat : summary.input.vat
                    const diff = summary.differences?.[k] || 0
                    return (
                      <tr key={k} className="border-t dark:border-gray-700">
                        <td className="py-1">{k === 'outputVat' ? 'Output VAT' : 'Input VAT'}</td>
                        <td className="py-1 text-right font-mono">{money(sched)}</td>
                        <td className="py-1 text-right font-mono">{money(summary.gl![k])}</td>
                        <td className={`py-1 text-right font-mono ${Math.abs(diff) >= 0.01 ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-green-600 dark:text-green-400'}`}>{money(diff)}</td>
                      </tr>
                    )
                  })}
                  <tr className="border-t dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    <td className="py-1">Other postings to tax accounts (VAT payments, journals)</td>
                    <td />
                    <td className="py-1 text-right font-mono">{money(summary.gl.otherMovements)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            )}
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Tax accounts: {summary.taxAccounts.map((a) => `${a.accountNumber || ''} ${a.name}`.trim()).join(', ') || '—'}.
              Differences usually come from documents posted on a different date than recorded, voids in a later period, or manual journals.
            </p>
          </div>
        </div>
      )}

      {tab === 'output' && outputRows && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className={`${th} text-left`}>Date</th>
                <th className={`${th} text-left`}>Type</th>
                <th className={`${th} text-left`}>Invoice / Note No</th>
                <th className={`${th} text-left`}>Original Inv.</th>
                <th className={`${th} text-left`}>Buyer TIN</th>
                <th className={`${th} text-left`}>Buyer</th>
                <th className={`${th} text-right`}>Taxable Value</th>
                <th className={`${th} text-right`}>VAT</th>
                <th className={`${th} text-right`}>Zero-rated</th>
                <th className={`${th} text-right`}>Exempt</th>
                <th className={`${th} text-right`}>Other</th>
                <th className={`${th} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {outputRows.map((r) => (
                <tr key={`${r.docType}-${r.docId}`} className="border-t border-gray-100 dark:border-gray-700">
                  <td className={td}>{r.date}</td>
                  <td className={td}>{DOC_LABELS[r.docType]}</td>
                  <td className={td}>{r.docNo}</td>
                  <td className={td}>{r.refDocNo || ''}</td>
                  <td className={td}>{r.buyerTin || ''}</td>
                  <td className={td}>{r.buyerName || ''}</td>
                  <td className={tdNum}>{money(r.taxableValue)}</td>
                  <td className={tdNum}>{money(r.vat)}</td>
                  <td className={tdNum}>{money(r.zeroRatedValue)}</td>
                  <td className={tdNum}>{money(r.exemptValue)}</td>
                  <td className={tdNum}>{money(r.otherValue)}</td>
                  <td className={tdNum}>{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'input' && inputRows && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className={`${th} text-left`}>Invoice Date</th>
                <th className={`${th} text-left`}>Supplier Invoice No</th>
                <th className={`${th} text-left`}>Purchase No</th>
                <th className={`${th} text-left`}>Supplier TIN</th>
                <th className={`${th} text-left`}>Supplier</th>
                <th className={`${th} text-right`}>Value</th>
                <th className={`${th} text-right`}>VAT</th>
                <th className={`${th} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {inputRows.map((r) => (
                <tr key={r.purchaseId} className="border-t border-gray-100 dark:border-gray-700">
                  <td className={td}>{r.date}</td>
                  <td className={td}>{r.supplierInvoiceNo || ''}</td>
                  <td className={td}>{r.purchaseNo}{r.isReturn ? ' (return)' : ''}</td>
                  <td className={td}>{r.supplierTin || ''}</td>
                  <td className={td}>{r.supplierName || ''}</td>
                  <td className={tdNum}>{money(r.value)}</td>
                  <td className={tdNum}>{money(r.vat)}</td>
                  <td className={tdNum}>{money(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportPageLayout>
  )
}
