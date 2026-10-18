import type { EntityFieldConfig, ChildEntityConfig } from './entity-config'

// Format a single value for export based on field type
export function formatExportValue(value: unknown, field: EntityFieldConfig): string {
  if (value === null || value === undefined) return ''

  switch (field.type) {
    case 'boolean':
      return value === true || value === 'true' || value === 't' ? 'Yes' : 'No'
    case 'date':
      if (!value) return ''
      try {
        const d = new Date(value as string)
        if (isNaN(d.getTime())) return String(value)
        return d.toISOString().split('T')[0] // YYYY-MM-DD
      } catch {
        return String(value)
      }
    case 'datetime':
      if (!value) return ''
      try {
        const d = new Date(value as string)
        if (isNaN(d.getTime())) return String(value)
        return d.toISOString().replace('T', ' ').slice(0, 19) // YYYY-MM-DD HH:MM:SS
      } catch {
        return String(value)
      }
    case 'decimal':
    case 'number':
      return String(value)
    default:
      return String(value)
  }
}

// Generate CSV string from data rows + field config
export function generateCsv(
  data: Record<string, unknown>[],
  fields: EntityFieldConfig[]
): string {
  // Header row
  const headers = fields.map(f => escapeCsvValue(f.label))
  const lines = [headers.join(',')]

  // Data rows
  for (const row of data) {
    const values = fields.map(f => {
      const val = row[f.key]
      return escapeCsvValue(formatExportValue(val, f))
    })
    lines.push(values.join(','))
  }

  return lines.join('\n')
}

function escapeCsvValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

// Generate XLSX buffer from data rows + field config
export async function generateXlsx(
  data: Record<string, unknown>[],
  fields: EntityFieldConfig[],
  sheetName: string
): Promise<Buffer> {
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)

  // Set up columns
  sheet.columns = fields.map(f => ({
    header: f.label,
    key: f.key,
    width: Math.max(f.label.length + 4, 15),
  }))

  // Style header row
  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }

  // Add data rows
  for (const row of data) {
    const values: Record<string, unknown> = {}
    for (const f of fields) {
      values[f.key] = formatExportValue(row[f.key], f)
    }
    sheet.addRow(values)
  }

  // Auto-filter
  if (data.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: fields.length },
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

// Generate blank template (headers only, with optional sample row)
export async function generateTemplate(
  fields: EntityFieldConfig[],
  format: 'csv' | 'xlsx',
  sheetName: string,
  includeSampleRow: boolean = true
): Promise<string | Buffer> {
  // Only include importable fields
  const importFields = fields.filter(f => !f.exportOnly)

  if (format === 'csv') {
    const headers = importFields.map(f => {
      let header = f.label
      if (f.required) header += ' *'
      return escapeCsvValue(header)
    })
    const lines = [headers.join(',')]

    // Instructions row
    const instructions = importFields.map(f => {
      const parts: string[] = []
      if (f.type === 'boolean') parts.push('Yes/No')
      if (f.type === 'date') parts.push('YYYY-MM-DD')
      if (f.type === 'datetime') parts.push('YYYY-MM-DD HH:MM:SS')
      if (f.type === 'enum' && f.enumValues) parts.push(f.enumValues.join(' | '))
      if (f.type === 'lookup' && f.lookup) parts.push(`Enter ${f.lookup.matchField}`)
      if (f.type === 'decimal') parts.push('Number')
      if (f.type === 'number') parts.push('Integer')
      if (f.required) parts.push('Required')
      if (f.unique) parts.push('Unique')
      return escapeCsvValue(parts.join(', ') || f.type)
    })
    lines.push(instructions.join(','))

    if (includeSampleRow) {
      const sample = importFields.map(f => {
        return escapeCsvValue(getSampleValue(f))
      })
      lines.push(sample.join(','))
    }

    return lines.join('\n')
  }

  // XLSX template
  const ExcelJS = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)

  sheet.columns = importFields.map(f => ({
    header: f.label + (f.required ? ' *' : ''),
    key: f.key,
    width: Math.max(f.label.length + 6, 18),
  }))

  // Style header row
  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  }
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' }

  // Instructions row
  const instructionValues: Record<string, string> = {}
  for (const f of importFields) {
    const parts: string[] = []
    if (f.type === 'boolean') parts.push('Yes/No')
    if (f.type === 'date') parts.push('YYYY-MM-DD')
    if (f.type === 'enum' && f.enumValues) parts.push(f.enumValues.join(' | '))
    if (f.type === 'lookup' && f.lookup) parts.push(`Enter ${f.lookup.matchField}`)
    if (f.required) parts.push('Required')
    if (f.unique) parts.push('Unique')
    instructionValues[f.key] = parts.join(', ') || f.type
  }
  const instrRow = sheet.addRow(instructionValues)
  instrRow.font = { italic: true, color: { argb: 'FF808080' } }

  if (includeSampleRow) {
    const sampleValues: Record<string, string> = {}
    for (const f of importFields) {
      sampleValues[f.key] = getSampleValue(f)
    }
    sheet.addRow(sampleValues)
  }

  // Add data validation for enum fields
  for (let colIdx = 0; colIdx < importFields.length; colIdx++) {
    const f = importFields[colIdx]
    if (f.type === 'enum' && f.enumValues && f.enumValues.length > 0) {
      const colLetter = String.fromCharCode(65 + colIdx)
      for (let row = 3; row <= 5002; row++) {
        sheet.getCell(`${colLetter}${row}`).dataValidation = {
          type: 'list',
          allowBlank: !f.required,
          formulae: [`"${f.enumValues.join(',')}"`],
          showErrorMessage: true,
          errorTitle: 'Invalid Value',
          error: `Must be one of: ${f.enumValues.join(', ')}`,
        }
      }
    }
    if (f.type === 'boolean') {
      const colLetter = String.fromCharCode(65 + colIdx)
      for (let row = 3; row <= 5002; row++) {
        sheet.getCell(`${colLetter}${row}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: ['"Yes,No"'],
        }
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

function getSampleValue(field: EntityFieldConfig): string {
  switch (field.key) {
    case 'name': return 'Sample Product'
    case 'sku': return 'SKU-001'
    case 'barcode': return '1234567890'
    case 'sellingPrice': return '100.00'
    case 'costPrice': return '50.00'
    case 'unit': return 'pcs'
    case 'email': return 'example@email.com'
    case 'phone': return '+94771234567'
    case 'firstName': return 'John'
    case 'lastName': return 'Doe'
    case 'make': return 'Toyota'
    case 'model': return 'Corolla'
    case 'year': return '2020'
    case 'licensePlate': return 'ABC-1234'
    case 'address': return '123 Main St'
    case 'city': return 'Colombo'
    case 'country': return 'Sri Lanka'
    case 'defaultHours': return '1.5'
    case 'defaultRate': return '2500.00'
  }
  if (field.type === 'boolean') return 'Yes'
  if (field.type === 'date') return '2026-01-01'
  if (field.type === 'decimal') return '0.00'
  if (field.type === 'number') return '0'
  if (field.type === 'enum' && field.enumValues?.length) return field.enumValues[0]
  return ''
}

// Flatten parent-child data into rows (parent columns blank for child-only rows)
export function flattenParentChildRows(
  parents: Record<string, unknown>[],
  parentFields: EntityFieldConfig[],
  children: { config: ChildEntityConfig; data: Map<string, Record<string, unknown>[]> }[]
): { fields: EntityFieldConfig[]; rows: Record<string, unknown>[] } {
  // Build combined field list: parent fields + child fields (prefixed with ~)
  const allFields = [...parentFields]
  for (const child of children) {
    for (const cf of child.config.fields) {
      allFields.push({ ...cf, key: `~${child.config.name}.${cf.key}`, label: `~${cf.label}` })
    }
  }

  const rows: Record<string, unknown>[] = []

  for (const parent of parents) {
    const parentId = parent.id as string

    // Collect all child rows for this parent
    const childRowSets: Record<string, unknown>[][] = []
    let maxChildRows = 0
    for (const child of children) {
      const childRows = child.data.get(parentId) || []
      childRowSets.push(childRows)
      maxChildRows = Math.max(maxChildRows, childRows.length)
    }

    // If no children, just add parent row
    if (maxChildRows === 0) {
      rows.push({ ...parent })
      continue
    }

    // First row: parent data + first child row of each child type
    for (let i = 0; i < maxChildRows; i++) {
      const row: Record<string, unknown> = {}

      // Only include parent data on first row
      if (i === 0) {
        for (const f of parentFields) {
          row[f.key] = parent[f.key]
        }
      }

      // Add child data
      for (let c = 0; c < children.length; c++) {
        const childRows = childRowSets[c]
        const childRow = childRows[i]
        if (childRow) {
          for (const cf of children[c].config.fields) {
            row[`~${children[c].config.name}.${cf.key}`] = childRow[cf.key]
          }
        }
      }

      rows.push(row)
    }
  }

  return { fields: allFields, rows }
}
