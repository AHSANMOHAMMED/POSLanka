import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import ExcelJS from 'exceljs'

export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Bank Statement')

    // Define columns
    sheet.columns = [
      { header: 'Transaction Date', key: 'transactionDate', width: 18 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Reference Number', key: 'referenceNumber', width: 20 },
      { header: 'Debit', key: 'debit', width: 15 },
      { header: 'Credit', key: 'credit', width: 15 },
    ]

    // Style header row
    const headerRow = sheet.getRow(1)
    headerRow.font = { bold: true }
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE2E8F0' },
    }

    // Add sample rows
    sheet.addRow({
      transactionDate: '2026-01-15',
      description: 'Customer payment - INV-001',
      referenceNumber: 'REF001',
      debit: 0,
      credit: 25000,
    })
    sheet.addRow({
      transactionDate: '2026-01-16',
      description: 'Supplier payment - PO-042',
      referenceNumber: 'CHQ1234',
      debit: 15000,
      credit: 0,
    })
    sheet.addRow({
      transactionDate: '2026-01-17',
      description: 'Bank charges',
      referenceNumber: '',
      debit: 250,
      credit: 0,
    })

    const buffer = await workbook.xlsx.writeBuffer()

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="bank-statement-sample.xlsx"',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to generate template' }, { status: 500 })
  }
}
