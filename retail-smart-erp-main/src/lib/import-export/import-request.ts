// Shared parsing of import form posts (preview + execute) and job access checks.

import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { z } from 'zod'
import type { CompanySession } from '@/lib/auth'
import { hasPermission, requirePermission, type Permission } from '@/lib/auth/roles'
import { logError } from '@/lib/ai/error-logger'
import { getEntityConfig, type EntityConfig, type ImportMode } from './entity-config'
import { parseCsv, parseXlsx, mapColumns } from './import-utils'
import type { ImportJobOptions, ImportJobRecord } from './import-job-store'

const optionsSchema = z.object({
  mode: z.enum(['insert', 'update', 'upsert']).default('insert'),
  matchBy: z.array(z.string().max(50)).max(10).optional(),
  stockMode: z.enum(['set', 'add', 'none']).default('none'),
  skipErrors: z.boolean().default(true),
  columnMapping: z.record(z.string(), z.string()).optional(),
})

export interface ParsedImportRequest {
  entityName: string
  entityConfig: EntityConfig
  mode: ImportMode
  options: ImportJobOptions & { skipErrors: boolean }
  rawRows: Record<string, string>[]
  headers: string[]
  columnMapping: Record<string, string>
  fileName: string
  fileHash: string
  businessType?: string
}

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key)
  return typeof v === 'string' ? v : null
}

/**
 * Parse `file`, `entity`, `mode`, `matchBy`, `stockMode`, `skipErrors`,
 * `columnMapping` from a multipart import request. Returns a NextResponse on
 * any validation / permission failure.
 */
export async function parseImportRequest(
  request: Request,
  session: CompanySession,
): Promise<ParsedImportRequest | NextResponse> {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })
  }
  const file = formData.get('file')
  const entityName = str(formData, 'entity')
  if (!(file instanceof File) || !entityName) {
    return NextResponse.json({ error: 'File and entity are required' }, { status: 400 })
  }

  const entityConfig = getEntityConfig(entityName)
  if (!entityConfig || !entityConfig.importable) {
    return NextResponse.json({ error: `Import not supported for: ${entityName}` }, { status: 400 })
  }
  const permError = requirePermission(session, entityConfig.permission as Permission)
  if (permError) return permError

  let mapping: unknown
  const mappingStr = str(formData, 'columnMapping')
  if (mappingStr) {
    try { mapping = JSON.parse(mappingStr) } catch {
      return NextResponse.json({ error: 'Invalid column mapping format' }, { status: 400 })
    }
  }
  const matchByStr = str(formData, 'matchBy')
  const parsedOpts = optionsSchema.safeParse({
    mode: str(formData, 'mode') || undefined,
    matchBy: matchByStr ? matchByStr.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    stockMode: str(formData, 'stockMode') || undefined,
    skipErrors: str(formData, 'skipErrors') !== null ? str(formData, 'skipErrors') === 'true' : undefined,
    columnMapping: mapping,
  })
  if (!parsedOpts.success) {
    return NextResponse.json({ error: 'Invalid import options', details: parsedOpts.error.flatten() }, { status: 400 })
  }

  const fileName = file.name
  const lower = fileName.toLowerCase()
  const buffer = await file.arrayBuffer()
  const fileHash = createHash('sha256').update(Buffer.from(buffer)).digest('hex')
  let rawRows: Record<string, string>[]
  try {
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      rawRows = await parseXlsx(buffer)
    } else if (lower.endsWith('.csv')) {
      rawRows = parseCsv(new TextDecoder('utf-8').decode(buffer))
    } else {
      return NextResponse.json({ error: 'Unsupported file format. Use CSV or XLSX.' }, { status: 400 })
    }
  } catch (error) {
    logError('import-file-parse', error, { errorSource: 'system', context: { fileName, entity: entityName, fileSize: file.size } })
    return NextResponse.json({ error: 'Failed to parse file. Check file format and content.' }, { status: 400 })
  }
  if (rawRows.length === 0) {
    return NextResponse.json({ error: 'File contains no data rows' }, { status: 400 })
  }

  const headers = Object.keys(rawRows[0])
  const businessType = session.user.businessType || undefined
  const columnMapping = parsedOpts.data.columnMapping || mapColumns(headers, entityConfig, businessType)

  return {
    entityName,
    entityConfig,
    mode: parsedOpts.data.mode,
    options: {
      matchBy: parsedOpts.data.matchBy,
      stockMode: parsedOpts.data.stockMode,
      blankPolicy: 'keep',
      skipErrors: parsedOpts.data.skipErrors,
      businessType,
      headers,
      columnMapping,
    },
    rawRows,
    headers,
    columnMapping,
    fileName,
    fileHash,
    businessType,
  }
}

/** True when the session may see / control another user's import job. */
export function canManageAllImports(session: CompanySession): boolean {
  const role = session.user.role
  if (role === 'owner' || role === 'manager') return true
  const u = session.user as unknown as Record<string, unknown>
  return hasPermission(role, 'manageItems', session.user.tenantId, (u.customRoleId as string | null) ?? null)
}

/** Access check for a job: entity permission + (job owner | manager / manageItems). */
export function checkJobAccess(session: CompanySession, job: ImportJobRecord): NextResponse | null {
  if (job.tenantId !== session.user.tenantId) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  const config = getEntityConfig(job.entityName)
  if (config) {
    const permError = requirePermission(session, config.permission as Permission)
    if (permError) return permError
  }
  if (job.userId !== session.user.id && !canManageAllImports(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}
