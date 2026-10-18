'use client'

import { useState, useRef, useEffect } from 'react'
import { Download, FileSpreadsheet, FileText, Printer, Loader2 } from 'lucide-react'
import { exportToExcel, exportToCSV, exportToPrint, type ExportColumn } from '@/lib/reports/export'

interface ReportExportButtonProps {
  data: Record<string, unknown>[]
  columns: ExportColumn[]
  reportName: string
  printElementId?: string
}

export function ReportExportButton({ data, columns, reportName, printElementId }: ReportExportButtonProps) {
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function handleExcel() {
    setExporting(true)
    try {
      await exportToExcel(data, columns, reportName)
    } finally {
      setExporting(false)
      setOpen(false)
    }
  }

  function handleCSV() {
    exportToCSV(data, columns, reportName)
    setOpen(false)
  }

  function handlePrint() {
    if (printElementId) {
      exportToPrint(printElementId)
    }
    setOpen(false)
  }

  const disabled = !data || data.length === 0

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        Export
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-50 py-1">
          <button
            onClick={handleExcel}
            disabled={exporting}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <FileSpreadsheet size={14} className="text-green-600" />
            Excel (.xlsx)
          </button>
          <button
            onClick={handleCSV}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <FileText size={14} className="text-blue-600" />
            CSV (.csv)
          </button>
          {printElementId && (
            <button
              onClick={handlePrint}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <Printer size={14} className="text-gray-600" />
              Print / PDF
            </button>
          )}
        </div>
      )}
    </div>
  )
}
