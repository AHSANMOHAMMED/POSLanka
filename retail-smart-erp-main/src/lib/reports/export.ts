'use client'

import ExcelJS from 'exceljs'
import Papa from 'papaparse'

export interface ExportColumn {
  key: string
  header: string
  width?: number
  format?: 'currency' | 'number' | 'percent' | 'date'
}

export async function exportToExcel(
  data: Record<string, unknown>[],
  columns: ExportColumn[],
  reportName: string
): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'RetailSmart POS'
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet(reportName)

  // Set up columns
  worksheet.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width || 18,
  }))

  // Style header row
  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true, size: 11 }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8EDF5' },
  }
  headerRow.border = {
    bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  }

  // Add data rows
  for (const row of data) {
    const rowData: Record<string, unknown> = {}
    for (const col of columns) {
      let value = row[col.key]
      if (col.format === 'currency' || col.format === 'number' || col.format === 'percent') {
        value = typeof value === 'string' ? parseFloat(value) || 0 : value
      } else if (col.format === 'date' && typeof value === 'string' && value) {
        value = new Date(value)
      }
      rowData[col.key] = value
    }
    worksheet.addRow(rowData)
  }

  // Apply number formats
  for (const col of columns) {
    const colObj = worksheet.getColumn(col.key)
    if (col.format === 'currency') {
      colObj.numFmt = '#,##0.00'
    } else if (col.format === 'percent') {
      colObj.numFmt = '0.00%'
    } else if (col.format === 'number') {
      colObj.numFmt = '#,##0'
    } else if (col.format === 'date') {
      colObj.numFmt = 'yyyy-mm-dd'
    }
  }

  // Auto-filter
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  }

  // Generate and download
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  downloadBlob(blob, `${reportName}.xlsx`)
}

export function exportToCSV(
  data: Record<string, unknown>[],
  columns: ExportColumn[],
  reportName: string
): void {
  // Map data to use column headers with formatting
  const mappedData = data.map((row) => {
    const mapped: Record<string, unknown> = {}
    for (const col of columns) {
      let value = row[col.key]
      if (col.format === 'date' && typeof value === 'string' && value) {
        value = new Date(value).toISOString().split('T')[0]
      } else if (col.format === 'date' && value instanceof Date) {
        value = value.toISOString().split('T')[0]
      } else if (col.format === 'percent') {
        const num = typeof value === 'string' ? parseFloat(value) : (typeof value === 'number' ? value : 0)
        value = (!isNaN(num) ? (num * 100).toFixed(2) : '0.00') + '%'
      }
      mapped[col.header] = value
    }
    return mapped
  })

  const csv = Papa.unparse(mappedData)
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  downloadBlob(blob, `${reportName}.csv`)
}

export function exportToPrint(elementId: string): void {
  const element = document.getElementById(elementId)
  if (!element) return

  const styles = `
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; color: #000; margin: 0; padding: 0; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 4px 8px; text-align: left; border-bottom: 1px solid #ddd; }
    th { font-weight: 600; background: #f5f5f5; }
    .text-right { text-align: right; }
    .font-bold { font-weight: 700; }
    .font-semibold { font-weight: 600; }
    .font-mono { font-family: ui-monospace, monospace; }
    @media print {
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact; }
    }
  `

  // Import is dynamic to avoid pulling client code into non-print paths
  import('@/lib/print/print-executor').then(({ executePrint }) => {
    executePrint('Print Report', styles, element.innerHTML)
  })
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
