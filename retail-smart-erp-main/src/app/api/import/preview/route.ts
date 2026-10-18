import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { getEntityConfig, getImportFields } from '@/lib/import-export/entity-config'
import { parseCsv, parseXlsx, mapColumns, validateRows } from '@/lib/import-export/import-utils'
import { LookupCache, type LookupConfig } from '@/lib/import-export/lookup-cache'
import { withTenant } from '@/lib/db'
import { sql } from 'drizzle-orm'
import * as schema from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'

export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File
    const entityName = formData.get('entity') as string
    const mode = (formData.get('mode') as string) || 'insert'

    if (!file || !entityName) {
      return NextResponse.json({ error: 'File and entity are required' }, { status: 400 })
    }

    const entityConfig = getEntityConfig(entityName)
    if (!entityConfig) {
      return NextResponse.json({ error: `Unknown entity: ${entityName}` }, { status: 400 })
    }

    if (!entityConfig.importable) {
      return NextResponse.json({ error: `Import not supported for: ${entityName}` }, { status: 400 })
    }

    const permError = requirePermission(session, entityConfig.permission as Parameters<typeof requirePermission>[1])
    if (permError) return permError

    const businessType = session.user.businessType || undefined

    // Parse file
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
        return NextResponse.json({ error: 'Unsupported file format. Use CSV or XLSX.' }, { status: 400 })
      }
    } catch (error) {
      console.error('File parsing error:', error)
      logError('import-preview-file-parse', error, {
        errorSource: 'system',
        context: { fileName, entity: entityName, fileSize: file.size }
      })
      return NextResponse.json({ error: 'Failed to parse file. Check file format and content.' }, { status: 400 })
    }

    if (rawRows.length === 0) {
      return NextResponse.json({ error: 'File contains no data rows' }, { status: 400 })
    }

    // Map columns — use custom mapping if provided, otherwise auto-detect
    const headers = Object.keys(rawRows[0])
    const customMappingStr = formData.get('columnMapping') as string | null
    let columnMapping: Record<string, string>
    if (customMappingStr) {
      try {
        columnMapping = JSON.parse(customMappingStr)
      } catch {
        return NextResponse.json({ error: 'Invalid column mapping format' }, { status: 400 })
      }
    } else {
      columnMapping = mapColumns(headers, entityConfig, businessType)
    }

    // Validate rows
    const validation = validateRows(rawRows, entityConfig, columnMapping, mode as 'insert' | 'update', businessType)

    // Resolve lookups and check duplicates server-side
    const lookupFields = getImportFields(entityConfig, businessType).filter(f => f.type === 'lookup' && f.lookup)
    const lookupWarnings: { row: number; column: string; message: string }[] = []
    const duplicateWarnings: { row: number; column: string; message: string }[] = []

    await withTenant(session.user.tenantId, async (db) => {
      // Initialize LookupCache with schema resolver
      const lookupCache = new LookupCache(
        getSchemaTable,
        {
          ttl: 10 * 60 * 1000, // 10 minutes for import operations
          batchSize: 500
        }
      )

      // Pre-resolve all lookups using batch resolution
      const lookupConfigs = new Map<string, LookupConfig>()
      const lookupValues = new Map<string, Set<string>>()
      
      for (const field of lookupFields) {
        const lookup = field.lookup!
        const config: LookupConfig = {
          entity: lookup.entity,
          table: lookup.table,
          matchField: lookup.matchField,
          valueField: lookup.valueField
        }
        lookupConfigs.set(field.key, config)
        
        // Collect all values for this lookup field
        if (!lookupValues.has(field.key)) {
          lookupValues.set(field.key, new Set())
        }
        for (const row of [...validation.validRows, ...validation.invalidRows]) {
          const val = row.data[field.key] as string
          if (val && val.trim()) {
            lookupValues.get(field.key)!.add(val)
          }
        }
      }

      // Batch resolve all lookup values
      const resolvedLookups = new Map<string, Map<string, string>>()
      for (const [fieldKey, config] of Array.from(lookupConfigs.entries())) {
        const values = Array.from(lookupValues.get(fieldKey) || [])
        if (values.length > 0) {
          try {
            const resolved = await lookupCache.getBatch(config, values, db)
            resolvedLookups.set(fieldKey, resolved)
            // Log statistics for large batches
            if (values.length > 50) {
              console.log(`LookupCache: Resolved ${resolved.size}/${values.length} values for ${config.table}`)
            }
          } catch (error) {
            console.error(`LookupCache batch resolution failed for ${config.table}:`, error)
            logError('import-preview-lookup', error, {
              errorSource: 'system',
              context: { entity: entityName, field: fieldKey, valueCount: values.length }
            })
            // Initialize empty map on error - will show warnings for all values
            resolvedLookups.set(fieldKey, new Map())
          }
        } else {
          resolvedLookups.set(fieldKey, new Map())
        }
      }

      // Check each row for missing lookups
      for (const field of lookupFields) {
        const resolvedMap = resolvedLookups.get(field.key)
        if (!resolvedMap) continue

        const missingValues = new Set<string>()
        for (const row of validation.validRows) {
          const val = row.data[field.key] as string
          if (!val) continue
          const normalizedValue = val.toLowerCase().trim()
          const resolved = resolvedMap.get(normalizedValue)
          if (!resolved && !missingValues.has(normalizedValue)) {
            missingValues.add(normalizedValue)
            lookupWarnings.push({
              row: row.rowIndex,
              column: field.label,
              message: `"${val}" not found in ${field.lookup!.entity} — will be auto-created`,
            })
          }
        }
      }

      // Check compatible models (items only) — missing makes/models will be auto-created
      if (entityName === 'items') {
        const allMakes = await db.select({ id: schema.vehicleMakes.id, name: schema.vehicleMakes.name })
          .from(schema.vehicleMakes)
        const makesSet = new Map<string, string>()
        for (const m of allMakes) makesSet.set(m.name.toLowerCase(), m.id)

        const allModels = await db.select({ id: schema.vehicleModels.id, name: schema.vehicleModels.name, makeId: schema.vehicleModels.makeId })
          .from(schema.vehicleModels)
        const makeIdToName = new Map<string, string>()
        for (const m of allMakes) makeIdToName.set(m.id, m.name.toLowerCase())
        const modelsSet = new Map<string, Map<string, string>>()
        for (const m of allModels) {
          const makeName = makeIdToName.get(m.makeId)
          if (makeName) {
            if (!modelsSet.has(makeName)) modelsSet.set(makeName, new Map())
            modelsSet.get(makeName)!.set(m.name.toLowerCase(), m.id)
          }
        }

        for (const row of validation.validRows) {
          const compatRaw = row.data.compatibleModels as string || ''
          const separateMake = row.data.compatibleMake as string || ''
          // Build entries from combined + separate columns
          const entries: string[] = []
          if (compatRaw.trim()) entries.push(...compatRaw.split(';').map(s => s.trim()).filter(Boolean))
          if (separateMake.trim()) {
            const makes = separateMake.split(';').map(s => s.trim()).filter(Boolean)
            const models = (row.data.compatibleModel as string || '').split(';').map(s => s.trim())
            makes.forEach((make, i) => {
              const model = models[i] || ''
              entries.push(model ? `${make} ${model}` : make)
            })
          }

          for (const entry of entries) {
            // Strip year range from end
            const rest = entry.replace(/\s+\d{4}\s*[-–]\s*\d{4}$/, '').replace(/\s+\d{4}$/, '').trim()
            const parts = rest.split(/\s+/)
            const makeName = parts[0] || ''
            const modelName = parts.slice(1).join(' ') || ''

            if (makeName && !makesSet.has(makeName.toLowerCase())) {
              lookupWarnings.push({
                row: row.rowIndex,
                column: 'Compatible Models',
                message: `Make "${makeName}" not found — will be auto-created`,
              })
              // Add to set so we don't warn again for same make
              makesSet.set(makeName.toLowerCase(), 'pending')
            }
            if (modelName && makesSet.has(makeName.toLowerCase())) {
              const modelMap = modelsSet.get(makeName.toLowerCase())
              if (!modelMap || !modelMap.has(modelName.toLowerCase())) {
                lookupWarnings.push({
                  row: row.rowIndex,
                  column: 'Compatible Models',
                  message: `Model "${modelName}" (${makeName}) not found — will be auto-created`,
                })
                // Track to avoid duplicate warnings
                if (!modelsSet.has(makeName.toLowerCase())) modelsSet.set(makeName.toLowerCase(), new Map())
                modelsSet.get(makeName.toLowerCase())!.set(modelName.toLowerCase(), 'pending')
              }
            }
          }
        }
      }

      // Check for duplicates in insert mode
      if (mode === 'insert' && entityConfig.uniqueMatchFields) {
        for (const matchField of entityConfig.uniqueMatchFields) {
          const importField = getImportFields(entityConfig, businessType).find(f => f.key === matchField)
          if (!importField) continue

          const allValues = new Set<string>()
          for (const row of validation.validRows) {
            const val = row.data[matchField] as string
            if (val) allValues.add(val)
          }

          if (allValues.size === 0) continue

          const schemaTable = getSchemaTable(entityConfig.table)
          if (!schemaTable) continue

          const dbField = schemaTable[matchField as keyof typeof schemaTable]
          if (!dbField) continue

          const existingValues = await db
            .select({ value: dbField })
            .from(schemaTable)
            .where(sql`${dbField} IN ${Array.from(allValues)}`)

          const existingSet = new Set((existingValues as { value: string }[]).map(r => String(r.value).toLowerCase()))

          for (const row of validation.validRows) {
            const val = row.data[matchField] as string
            if (val && existingSet.has(val.toLowerCase())) {
              duplicateWarnings.push({
                row: row.rowIndex,
                column: importField.label,
                message: `${importField.label} "${val}" already exists — will be skipped in insert mode`,
              })
            }
          }
        }
      }
    })

    // Build preview response — lookup warnings are NOT errors (auto-created during import)
    const previewRows = [...validation.validRows, ...validation.invalidRows]
      .sort((a, b) => a.rowIndex - b.rowIndex)
      .slice(0, 100) // Show first 100 rows in preview
      .map(row => ({
        row: row.rowIndex,
        status: row.errors.length > 0 ? 'error' as const : 'valid' as const,
        data: row.data,
        errors: row.errors,
        warnings: [
          ...row.warnings,
          ...lookupWarnings.filter(w => w.row === row.rowIndex),
          ...duplicateWarnings.filter(w => w.row === row.rowIndex),
        ],
      }))

    return NextResponse.json({
      totalRows: validation.totalRows,
      validRows: validation.validCount,
      errorRows: validation.errorCount,
      columns: Object.keys(columnMapping),
      mappedColumns: columnMapping,
      preview: previewRows,
      errors: validation.errors,
      warnings: [...validation.warnings, ...lookupWarnings, ...duplicateWarnings],
    })
  } catch (error) {
    logError('api/import/preview', error)
    return NextResponse.json({ error: 'Import preview failed' }, { status: 500 })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSchemaTable(tableName: string): any {
  const tableMap: Record<string, unknown> = {
    categories: schema.categories,
    items: schema.items,
    customers: schema.customers,
    suppliers: schema.suppliers,
    vehicles: schema.vehicles,
    service_types: schema.serviceTypes,
    service_type_groups: schema.serviceTypeGroups,
  }
  return tableMap[tableName] || null
}
