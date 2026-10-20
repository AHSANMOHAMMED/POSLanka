import { listProblemRows, type ImportJobOptions, type ImportJobRecord, type ImportRowPayload } from './import-job-store'

function esc(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/**
 * CSV of the job's error + skipped rows: original file columns (in file order)
 * followed by `Error`. Re-uploading it maps the original columns again; the
 * Error column is not mapped and therefore ignored.
 */
export async function buildErrorsCsv(tenantId: string, job: ImportJobRecord): Promise<string> {
  const rows = await listProblemRows(tenantId, job.id)
  const options = (job.options || {}) as ImportJobOptions
  const headers = [...(options.headers || [])]
  const known = new Set(headers)
  for (const r of rows) {
    const raw = ((r.payload as unknown as ImportRowPayload)?.raw) || {}
    for (const h of Object.keys(raw)) if (!known.has(h)) { known.add(h); headers.push(h) }
  }
  const lines = [[...headers, 'Error'].map(esc).join(',')]
  for (const r of rows) {
    const raw = ((r.payload as unknown as ImportRowPayload)?.raw) || {}
    const msg = `Row ${r.rowIndex} ${r.status === 'skipped' ? 'skipped' : 'failed'}: ${r.error || r.status}`
    lines.push([...headers.map(h => esc(String(raw[h] ?? ''))), esc(msg)].join(','))
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}
