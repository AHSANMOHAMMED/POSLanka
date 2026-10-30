/** CSV for console downloads: RFC 4180 quoting, with a BOM so Excel reads Sinhala / Tamil text. */

export const CSV_BOM = '﻿'

/** One cell; text that starts like a spreadsheet formula (=, +, -, @) is neutralised, real numbers are not. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',')
}

/** A file name part: letters, digits and dashes only */
export function fileSlug(s: string): string {
  return s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'vendor'
}
