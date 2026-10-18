import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { getEntityConfig, getImportFields } from '@/lib/import-export/entity-config'
import { parseCsv, parseXlsx, mapColumns } from '@/lib/import-export/import-utils'
import { logError } from '@/lib/ai/error-logger'
import { requirePermission, type Permission } from '@/lib/auth/roles'

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const entityName = formData.get('entity') as string

    if (!file || !entityName) {
      return NextResponse.json({ error: 'File and entity are required' }, { status: 400 })
    }

    const entityConfig = getEntityConfig(entityName)
    if (!entityConfig || !entityConfig.importable) {
      return NextResponse.json({ error: `Import not supported for: ${entityName}` }, { status: 400 })
    }

    // Check entity-specific permission
    const permError = requirePermission(session, entityConfig.permission as Permission)
    if (permError) return permError

    const businessType = session.user.businessType || undefined

    // Parse file to get headers
    let rawRows: Record<string, string>[]
    const fileName = file.name.toLowerCase()

    try {
      if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        const buffer = await file.arrayBuffer()
        rawRows = await parseXlsx(buffer)
      } else if (fileName.endsWith('.csv')) {
        const text = await file.text()
        rawRows = parseCsv(text)
      } else {
        return NextResponse.json({ error: 'Unsupported file format' }, { status: 400 })
      }
    } catch (error) {
      console.error('File parsing error:', error)
      logError('import-parse-headers-file-parse', error, {
        errorSource: 'system',
        context: { fileName, entity: entityName, fileSize: file.size }
      })
      return NextResponse.json({ error: 'Failed to parse file. Check file format and content.' }, { status: 400 })
    }

    if (rawRows.length === 0) {
      return NextResponse.json({ error: 'File contains no data rows' }, { status: 400 })
    }

    const headers = Object.keys(rawRows[0])
    const suggestedMapping = mapColumns(headers, entityConfig, businessType)
    const importFields = getImportFields(entityConfig, businessType)

    // Return first few sample values per column for user context
    const sampleData: Record<string, string[]> = {}
    for (const header of headers) {
      sampleData[header] = rawRows
        .slice(0, 3)
        .map(r => r[header] || '')
        .filter(v => v !== '')
    }

    return NextResponse.json({
      headers,
      suggestedMapping,
      rowCount: rawRows.length,
      sampleData,
      fields: importFields.map(f => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: !!f.required,
      })),
    })
  } catch (error) {
    console.error('POST /api/import/parse-headers error:', error)
    return NextResponse.json({ error: 'Failed to parse file headers' }, { status: 500 })
  }
}
