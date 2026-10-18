import type { EntityConfig } from './entity-config'
import { getImportFields } from './entity-config'
import Papa from 'papaparse'

export interface ImportError {
  row: number
  column: string
  message: string
  value: unknown
}

export interface ImportWarning {
  row: number
  column: string
  message: string
}

export interface ParsedRow {
  rowIndex: number
  data: Record<string, unknown>
  errors: ImportError[]
  warnings: ImportWarning[]
}

export interface ValidationResult {
  validRows: ParsedRow[]
  invalidRows: ParsedRow[]
  errors: ImportError[]
  warnings: ImportWarning[]
  totalRows: number
  validCount: number
  errorCount: number
  columns: string[]
}

// Parse CSV string into raw rows using papaparse for robust parsing
export function parseCsv(csvString: string): Record<string, string>[] {
  const result = Papa.parse(csvString, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
    transform: (value: string) => value.trim(),
    // Skip instruction/comment rows that may appear as first data row
    beforeFirstChunk: (chunk: string) => {
      const lines = chunk.split('\n')
      if (lines.length > 1) {
        const firstDataLine = lines[1]?.toLowerCase() || ''
        if (firstDataLine.includes('required') || firstDataLine.includes('string') || firstDataLine.includes('number')) {
          // Remove the instruction row
          return lines.slice(0, 1).concat(lines.slice(2)).join('\n')
        }
      }
      return chunk
    }
  })

  if (result.errors.length > 0) {
    console.warn('CSV parsing warnings:', result.errors)
  }

  return result.data as Record<string, string>[]
}

// Parse XLSX buffer into raw rows using SheetJS (supports both .xls and .xlsx)
export async function parseXlsx(buffer: ArrayBuffer): Promise<Record<string, string>[]> {
  const XLSX = await import('xlsx')

  // Read workbook from buffer
  const workbook = XLSX.read(buffer, { type: 'array' })

  // We only process the first worksheet
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []

  const worksheet = workbook.Sheets[sheetName]

  // Convert to array of arrays to handle headers and skipping manually
  const jsonData = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    blankrows: false,
    defval: ''
  }) as unknown[][]

  if (!jsonData || jsonData.length === 0) return []

  const rows: Record<string, string>[] = []
  let headers: string[] = []

  // Process rows
  for (let i = 0; i < jsonData.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = jsonData[i] as any[]
    const rowIndex = i + 1

    // First row contains headers
    if (rowIndex === 1) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      headers = row.map((val: any) => {
        let strVal = String(val || '').trim()
        // Remove required marker
        strVal = strVal.replace(/\s*\*$/, '')
        return strVal
      })
      continue
    }

    // Skip instruction rows (row 2 in templates)
    if (rowIndex === 2) {
      const firstCell = String(row[0] || '').toLowerCase()
      if (firstCell.includes('required') || firstCell.includes('string') ||
        firstCell.includes('number') || firstCell.includes(',')) {
        continue
      }
    }

    // Skip empty rows
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasData = row.some((val: any) => val !== null && val !== undefined && String(val).trim() !== '')
    if (!hasData) continue

    // Build record from row values
    const record: Record<string, string> = {}

    // Safety check: ensure we don't access out of bounds if row has fewer cells than headers
    // But also row might have more cells (ignore extra)
    headers.forEach((header, colIndex) => {
      if (header) {
        const val = row[colIndex]
        let strVal = ''
        if (val instanceof Date) {
          strVal = val.toISOString().split('T')[0]
        } else if (val !== null && val !== undefined) {
          strVal = String(val).trim()
        }
        record[header] = strVal
      }
    })

    rows.push(record)

    // Limit processing
    if (rows.length >= 50000) {
      console.warn('Excel file contains more than 50,000 rows. Processing limited to first 50,000 rows.')
      break
    }
  }

  return rows
}

// Map column headers (label) to field keys
export function mapColumns(
  rawHeaders: string[],
  config: EntityConfig,
  businessType?: string
): Record<string, string> {
  const importFields = getImportFields(config, businessType)
  const mapping: Record<string, string> = {}

  for (const header of rawHeaders) {
    const normalized = header.trim().replace(/\s*\*$/, '') // Remove required marker

    // Try exact label match
    const exactMatch = importFields.find(f =>
      f.label.toLowerCase() === normalized.toLowerCase()
    )
    if (exactMatch) {
      mapping[header] = exactMatch.key
      continue
    }

    // Try key match
    const keyMatch = importFields.find(f =>
      f.key.toLowerCase() === normalized.toLowerCase()
    )
    if (keyMatch) {
      mapping[header] = keyMatch.key
      continue
    }

    // Fuzzy: remove spaces, dashes, underscores
    const clean = normalized.toLowerCase().replace(/[\s\-_]/g, '')
    const fuzzyMatch = importFields.find(f => {
      const cleanLabel = f.label.toLowerCase().replace(/[\s\-_]/g, '')
      const cleanKey = f.key.toLowerCase().replace(/[\s\-_]/g, '')
      return cleanLabel === clean || cleanKey === clean
    })
    if (fuzzyMatch) {
      mapping[header] = fuzzyMatch.key
    }
  }

  return mapping
}

// Validate all rows against entity config
export function validateRows(
  rawRows: Record<string, string>[],
  config: EntityConfig,
  columnMapping: Record<string, string>,
  mode: 'insert' | 'update',
  businessType?: string
): ValidationResult {
  const importFields = getImportFields(config, businessType)
  const _fieldsByKey = new Map(importFields.map(f => [f.key, f]))

  const validRows: ParsedRow[] = []
  const invalidRows: ParsedRow[] = []
  const allErrors: ImportError[] = []
  const allWarnings: ImportWarning[] = []
  const columns = Object.values(columnMapping)

  const MAX_ROWS = 30000
  const rowsToProcess = rawRows.slice(0, MAX_ROWS)

  if (rawRows.length > MAX_ROWS) {
    allWarnings.push({
      row: 0,
      column: '',
      message: `File contains ${rawRows.length} rows. Only the first ${MAX_ROWS} will be processed.`,
    })
  }

  for (let i = 0; i < rowsToProcess.length; i++) {
    const rawRow = rowsToProcess[i]
    const rowIndex = i + 1 // 1-indexed for user display
    const errors: ImportError[] = []
    const warnings: ImportWarning[] = []
    const data: Record<string, unknown> = {}

    // Map raw data using column mapping
    for (const [header, value] of Object.entries(rawRow)) {
      const fieldKey = columnMapping[header]
      if (fieldKey) {
        data[fieldKey] = value
      }
    }

    // Validate each field
    for (const field of importFields) {
      const value = data[field.key]
      const strValue = value !== undefined && value !== null ? String(value).trim() : ''

      // Apply transforms
      let transformedValue: string = strValue
      if (field.transform === 'lowercase') transformedValue = strValue.toLowerCase()
      if (field.transform === 'uppercase') transformedValue = strValue.toUpperCase()
      if (field.transform === 'trim') transformedValue = strValue.trim()

      // Required check
      if (field.required && !transformedValue) {
        // In update mode, only ID/unique match field is required
        if (mode === 'update') {
          const isMatchField = config.uniqueMatchFields?.includes(field.key) || field.key === 'id'
          if (isMatchField) {
            errors.push({ row: rowIndex, column: field.label, message: `${field.label} is required for update mode`, value: strValue })
          }
        } else {
          errors.push({ row: rowIndex, column: field.label, message: `${field.label} is required`, value: strValue })
        }
        continue
      }

      if (!transformedValue) {
        // Apply default value if empty
        if (field.defaultValue) {
          data[field.key] = field.defaultValue
        }
        continue
      }

      // Type-specific validation
      switch (field.type) {
        case 'number': {
          const num = parseInt(transformedValue, 10)
          if (isNaN(num)) {
            errors.push({ row: rowIndex, column: field.label, message: `Must be a whole number`, value: strValue })
          } else {
            data[field.key] = num
          }
          break
        }
        case 'decimal': {
          const num = parseFloat(transformedValue)
          if (isNaN(num)) {
            errors.push({ row: rowIndex, column: field.label, message: `Must be a number`, value: strValue })
          } else {
            data[field.key] = String(num)
          }
          break
        }
        case 'boolean': {
          const lower = transformedValue.toLowerCase()
          if (['yes', 'true', '1', 'y'].includes(lower)) {
            data[field.key] = true
          } else if (['no', 'false', '0', 'n'].includes(lower)) {
            data[field.key] = false
          } else {
            errors.push({ row: rowIndex, column: field.label, message: `Must be Yes or No`, value: strValue })
          }
          break
        }
        case 'date': {
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/
          if (!dateRegex.test(transformedValue)) {
            errors.push({ row: rowIndex, column: field.label, message: `Must be in YYYY-MM-DD format`, value: strValue })
          } else {
            const d = new Date(transformedValue)
            if (isNaN(d.getTime())) {
              errors.push({ row: rowIndex, column: field.label, message: `Invalid date`, value: strValue })
            } else {
              data[field.key] = transformedValue
            }
          }
          break
        }
        case 'enum': {
          if (field.enumValues && !field.enumValues.includes(transformedValue)) {
            errors.push({
              row: rowIndex,
              column: field.label,
              message: `Must be one of: ${field.enumValues.join(', ')}`,
              value: strValue,
            })
          } else {
            data[field.key] = transformedValue
          }
          break
        }
        case 'lookup': {
          // Lookup values are resolved server-side, just store the raw value
          data[field.key] = transformedValue
          break
        }
        default:
          data[field.key] = transformedValue
      }
    }

    const parsed: ParsedRow = { rowIndex, data, errors, warnings }

    if (errors.length > 0) {
      invalidRows.push(parsed)
      allErrors.push(...errors)
    } else {
      validRows.push(parsed)
    }
    allWarnings.push(...warnings)
  }

  return {
    validRows,
    invalidRows,
    errors: allErrors,
    warnings: allWarnings,
    totalRows: rowsToProcess.length,
    validCount: validRows.length,
    errorCount: invalidRows.length,
    columns,
  }
}