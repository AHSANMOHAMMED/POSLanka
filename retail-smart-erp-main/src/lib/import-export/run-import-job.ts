// Background import job runner
// Processes rows in batches of 500, each batch in its own DB transaction
// Broadcasts progress via WebSocket after each batch

import { withTenantTransaction } from '@/lib/db'
import { broadcastAccountChange, logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { getImportFields, type EntityConfig, type EntityFieldConfig } from './entity-config'
import { LookupCache, type LookupConfig } from './lookup-cache'
import { type ParsedRow } from './import-utils'
import { getJob, updateJob } from './import-job-store'
import * as schema from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import type { EntityType } from '@/lib/websocket/events'

const BATCH_SIZE = 500

export interface ImportJobParams {
  jobId: string
  tenantId: string
  userId: string
  entityName: string
  entityConfig: EntityConfig
  businessType: string | undefined
  validRows: ParsedRow[]
  mode: 'insert' | 'update'
  skipErrors: boolean
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

export async function runImportJob(params: ImportJobParams): Promise<void> {
  const {
    jobId, tenantId, userId, entityName, entityConfig,
    businessType, validRows, mode, skipErrors,
  } = params

  const importFields = getImportFields(entityConfig, businessType)
  const lookupFields = importFields.filter(f => f.type === 'lookup' && f.lookup)

  // Job-level accumulators
  let imported = 0
  let skipped = 0
  let autoCreated = 0
  const errors: { row: number; message: string }[] = []

  // Pre-resolved lookup maps (survive across batch transactions)
  const resolvedLookups = new Map<string, Map<string, string>>()
  const lookupConfigs = new Map<string, LookupConfig>()

  // Vehicle compatibility maps
  const isItemsImport = entityName === 'items'
  const makesMap = new Map<string, string>()
  const modelsMap = new Map<string, Map<string, string>>()
  const compatFieldKeys = new Set(['compatibleModels', 'compatibleMake', 'compatibleModel', 'compatibleYearFrom', 'compatibleYearTo'])

  function broadcastProgress(status: 'processing' | 'done' | 'error', extra?: Record<string, unknown>) {
    const job = getJob(jobId)
    if (!job) return
    broadcastAccountChange(userId, 'import-job', 'updated', jobId, {
      jobId,
      status,
      processed: job.processed,
      total: job.total,
      imported,
      skipped,
      autoCreated,
      errors: errors.slice(0, 50),
      ...extra,
    })
  }

  try {
    // Phase 1: Pre-resolve all lookups in a single read transaction
    await withTenantTransaction(tenantId, async (db) => {
      const lookupCache = new LookupCache(getSchemaTable, { ttl: 10 * 60 * 1000, batchSize: 500 })

      for (const field of lookupFields) {
        const lookup = field.lookup!
        const config: LookupConfig = {
          entity: lookup.entity,
          table: lookup.table,
          matchField: lookup.matchField,
          valueField: lookup.valueField,
        }
        lookupConfigs.set(field.key, config)

        const values = new Set<string>()
        for (const row of validRows) {
          const val = row.data[field.key] as string
          if (val && val.trim()) values.add(val)
        }

        if (values.size > 0) {
          try {
            const resolved = await lookupCache.getBatch(config, Array.from(values), db)
            resolvedLookups.set(field.key, resolved)
            if (values.size > 50) {
              console.log(`[ImportJob] Resolved ${resolved.size}/${values.size} values for ${config.table}`)
            }
          } catch (error) {
            console.error(`[ImportJob] Lookup resolution failed for ${config.table}:`, error)
            resolvedLookups.set(field.key, new Map())
          }
        } else {
          resolvedLookups.set(field.key, new Map())
        }
      }

      // Pre-fetch vehicle makes/models for compatibility
      const hasCompatData = isItemsImport && validRows.some(r => {
        const v = r.data.compatibleModels
        const m = r.data.compatibleMake
        return (v && String(v).trim() !== '') || (m && String(m).trim() !== '')
      })

      if (hasCompatData) {
        const allMakes = await db.select({ id: schema.vehicleMakes.id, name: schema.vehicleMakes.name })
          .from(schema.vehicleMakes)
        for (const m of allMakes) {
          makesMap.set(m.name.toLowerCase(), m.id)
        }

        const allModels = await db.select({
          id: schema.vehicleModels.id,
          name: schema.vehicleModels.name,
          makeId: schema.vehicleModels.makeId,
        }).from(schema.vehicleModels)

        const makeIdToName = new Map<string, string>()
        for (const m of allMakes) {
          makeIdToName.set(m.id, m.name.toLowerCase())
        }
        for (const m of allModels) {
          const makeName = makeIdToName.get(m.makeId)
          if (makeName) {
            if (!modelsMap.has(makeName)) modelsMap.set(makeName, new Map())
            modelsMap.get(makeName)!.set(m.name.toLowerCase(), m.id)
          }
        }
      }
    })

    // Phase 2: Process rows in batches
    const batches = chunk(validRows, BATCH_SIZE)
    const schemaTable = getSchemaTable(entityConfig.table)
    if (!schemaTable) throw new Error('Schema table not found')

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx]

      try {
        await withTenantTransaction(tenantId, async (db) => {
          // Auto-create helpers scoped to this transaction's db
          async function autoCreateLookup(field: EntityFieldConfig, rawValue: string): Promise<string | null> {
            const lookup = field.lookup!
            const lookupTable = getSchemaTable(lookup.table)
            if (!lookupTable) return null
            const name = String(rawValue).trim()
            if (!name) return null
            try {
              const [created] = await db.insert(lookupTable).values({ tenantId, name }).returning() as { id: string }[]
              if (created?.id) {
                const config = lookupConfigs.get(field.key)
                if (config) {
                  const resolvedMap = resolvedLookups.get(field.key)
                  if (resolvedMap) resolvedMap.set(name.toLowerCase(), created.id)
                }
                autoCreated++
                return created.id
              }
            } catch (err) {
              console.error(`[ImportJob] Auto-create ${lookup.entity} "${name}" failed:`, err)
            }
            return null
          }

          async function autoCreateMake(name: string): Promise<string | null> {
            try {
              const [created] = await db.insert(schema.vehicleMakes).values({ name }).returning()
              if (created?.id) {
                makesMap.set(name.toLowerCase(), created.id)
                modelsMap.set(name.toLowerCase(), new Map())
                autoCreated++
                return created.id
              }
            } catch (err) {
              console.error(`[ImportJob] Auto-create vehicle make "${name}" failed:`, err)
            }
            return null
          }

          async function autoCreateModel(makeId: string, makeName: string, modelName: string): Promise<string | null> {
            try {
              const [created] = await db.insert(schema.vehicleModels).values({ makeId, name: modelName }).returning()
              if (created?.id) {
                const modelMap = modelsMap.get(makeName.toLowerCase())
                if (modelMap) modelMap.set(modelName.toLowerCase(), created.id)
                autoCreated++
                return created.id
              }
            } catch (err) {
              console.error(`[ImportJob] Auto-create vehicle model "${modelName}" failed:`, err)
            }
            return null
          }

          // Build values for a single row
          async function buildRowValues(parsedRow: ParsedRow): Promise<{ values: Record<string, unknown> | null; compatRaw: string }> {
            const values: Record<string, unknown> = { tenantId }
            let compatRaw = ''

            const separateMake = parsedRow.data.compatibleMake ? String(parsedRow.data.compatibleMake).trim() : ''
            const separateModel = parsedRow.data.compatibleModel ? String(parsedRow.data.compatibleModel).trim() : ''
            const separateYearFrom = parsedRow.data.compatibleYearFrom ? String(parsedRow.data.compatibleYearFrom).trim() : ''
            const separateYearTo = parsedRow.data.compatibleYearTo ? String(parsedRow.data.compatibleYearTo).trim() : ''
            const combinedRaw = parsedRow.data.compatibleModels ? String(parsedRow.data.compatibleModels).trim() : ''

            if (separateMake) {
              const makes = separateMake.split(';').map(s => s.trim()).filter(Boolean)
              const models = separateModel ? separateModel.split(';').map(s => s.trim()) : []
              const yearsFrom = separateYearFrom ? separateYearFrom.split(';').map(s => s.trim()) : []
              const yearsTo = separateYearTo ? separateYearTo.split(';').map(s => s.trim()) : []
              const separateEntries = makes.map((make, i) => {
                const model = models[i] || ''
                const yf = yearsFrom[i] || ''
                const yt = yearsTo[i] || ''
                let entry = make
                if (model) entry += ` ${model}`
                if (yf && yt) entry += ` ${yf}-${yt}`
                else if (yf) entry += ` ${yf}-${yf}`
                return entry
              })
              compatRaw = combinedRaw ? combinedRaw + '; ' + separateEntries.join('; ') : separateEntries.join('; ')
            } else if (combinedRaw) {
              compatRaw = combinedRaw
            }

            for (const field of importFields) {
              const rawValue = parsedRow.data[field.key]
              if (rawValue === undefined || rawValue === null || rawValue === '') continue
              if (compatFieldKeys.has(field.key)) continue

              if (field.type === 'lookup' && field.lookup) {
                const resolvedMap = resolvedLookups.get(field.key)
                let resolved = resolvedMap?.get(String(rawValue).toLowerCase())
                if (!resolved) {
                  const createdId = await autoCreateLookup(field, String(rawValue))
                  if (createdId) resolved = createdId
                }
                if (resolved) {
                  const fkColumn = field.lookup.entity === 'categories' ? 'categoryId' :
                    field.lookup.entity === 'suppliers' ? 'supplierId' :
                    field.lookup.entity === 'customers' ? 'customerId' :
                    field.lookup.entity === 'serviceTypeGroups' ? 'groupId' :
                    field.key.replace('Name', 'Id')
                  values[fkColumn] = resolved
                } else {
                  errors.push({ row: parsedRow.rowIndex, message: `Could not resolve ${field.label}: "${rawValue}"` })
                }
              } else {
                values[field.key] = rawValue
              }
            }

            return { values, compatRaw }
          }

          async function insertCompatibility(itemId: string, compatRaw: string, rowIndex: number) {
            const entries = parseCompatibleModels(compatRaw)
            for (const entry of entries) {
              let makeId = makesMap.get(entry.makeName.toLowerCase())
              if (!makeId) {
                makeId = await autoCreateMake(entry.makeName) ?? undefined
                if (!makeId) {
                  errors.push({ row: rowIndex, message: `Make "${entry.makeName}" could not be created` })
                  continue
                }
              }
              let modelId: string | null = null
              if (entry.modelName) {
                const modelMap = modelsMap.get(entry.makeName.toLowerCase())
                modelId = modelMap?.get(entry.modelName.toLowerCase()) || null
                if (!modelId) {
                  modelId = await autoCreateModel(makeId, entry.makeName, entry.modelName)
                  if (!modelId) {
                    errors.push({ row: rowIndex, message: `Model "${entry.modelName}" could not be created` })
                    continue
                  }
                }
              }
              await db.insert(schema.partCompatibility).values({
                tenantId,
                itemId,
                makeId,
                modelId,
                yearFrom: entry.yearFrom || null,
                yearTo: entry.yearTo || null,
              })
            }
          }

          if (mode === 'insert') {
            const rowsWithCompat: { values: Record<string, unknown>; rowIndex: number; compatRaw: string }[] = []
            const plainRows: { values: Record<string, unknown>; rowIndex: number }[] = []

            for (const parsedRow of batch) {
              const result = await buildRowValues(parsedRow)
              if (!result.values) continue
              if (result.compatRaw) {
                rowsWithCompat.push({ values: result.values, rowIndex: parsedRow.rowIndex, compatRaw: result.compatRaw })
              } else {
                plainRows.push({ values: result.values, rowIndex: parsedRow.rowIndex })
              }
            }

            // Batch insert plain rows
            if (plainRows.length > 0) {
              try {
                await db.insert(schemaTable).values(plainRows.map(r => r.values))
                imported += plainRows.length
              } catch {
                // Fallback to row-by-row
                for (const row of plainRows) {
                  try {
                    await db.insert(schemaTable).values(row.values)
                    imported++
                  } catch (rowErr) {
                    skipped++
                    errors.push({ row: row.rowIndex, message: 'Insert failed' })
                    if (!skipErrors) throw rowErr
                  }
                }
              }
            }

            // Row-by-row for rows with compatibility data
            for (const row of rowsWithCompat) {
              try {
                const insertResult = await db.insert(schemaTable).values(row.values).returning() as { id: string }[]
                imported++
                if (row.compatRaw && insertResult[0]?.id) {
                  await insertCompatibility(insertResult[0].id, row.compatRaw, row.rowIndex)
                }
              } catch (rowErr) {
                skipped++
                errors.push({ row: row.rowIndex, message: 'Insert failed' })
                if (!skipErrors) throw rowErr
              }
            }
          } else {
            // Update mode: row-by-row
            for (const parsedRow of batch) {
              try {
                const { values } = await buildRowValues(parsedRow)
                if (!values) continue
                const id = parsedRow.data.id as string
                if (id) {
                  await db.update(schemaTable)
                    .set(values)
                    .where(sql`${schemaTable['id' as keyof typeof schemaTable]} = ${id}`)
                  imported++
                } else if (entityConfig.uniqueMatchFields) {
                  let matched = false
                  for (const matchField of entityConfig.uniqueMatchFields) {
                    const matchValue = parsedRow.data[matchField] as string
                    if (matchValue) {
                      const dbField = schemaTable[matchField as keyof typeof schemaTable]
                      if (dbField) {
                        const result = await db.update(schemaTable)
                          .set(values)
                          .where(sql`${dbField} = ${matchValue}`)
                          .returning()
                        if ((result as unknown[]).length > 0) {
                          matched = true
                          imported++
                          break
                        }
                      }
                    }
                  }
                  if (!matched) {
                    skipped++
                    errors.push({ row: parsedRow.rowIndex, message: 'No matching record found' })
                  }
                }
              } catch (err) {
                skipped++
                errors.push({ row: parsedRow.rowIndex, message: 'Update failed' })
                if (!skipErrors) throw err
              }
            }
          }
        })
      } catch (batchErr) {
        // If skipErrors is false, the batch threw — stop processing
        if (!skipErrors) {
          updateJob(jobId, {
            status: 'error',
            processed: (batchIdx + 1) * BATCH_SIZE,
            imported,
            skipped,
            autoCreated,
            errors: [...errors],
            errorMessage: 'Import stopped due to errors',
            completedAt: Date.now(),
          })
          broadcastProgress('error', { errorMessage: 'Import stopped due to errors' })
          logError('import-job-batch', batchErr, { errorSource: 'system', context: { jobId, batch: batchIdx } })
          return
        }
        // If skipErrors, log and continue
        logError('import-job-batch', batchErr, { errorSource: 'system', context: { jobId, batch: batchIdx } })
      }

      // Update progress after each batch
      const processed = Math.min((batchIdx + 1) * BATCH_SIZE, validRows.length)
      updateJob(jobId, { processed, imported, skipped, autoCreated, errors: [...errors] })
      broadcastProgress('processing')
    }

    // Phase 3: Finalize
    updateJob(jobId, {
      status: 'done',
      processed: validRows.length,
      imported,
      skipped,
      autoCreated,
      errors: [...errors],
      completedAt: Date.now(),
    })
    broadcastProgress('done')

    // Activity log
    const entityTypeMap: Record<string, EntityType> = {
      items: 'item',
      customers: 'customer',
      suppliers: 'supplier',
      categories: 'category',
      vehicles: 'vehicle',
      'service-types': 'service',
    }
    const broadcastType = entityTypeMap[entityName]
    if (broadcastType) {
      logAndBroadcast(tenantId, broadcastType, 'created', '', {
        userId,
        activityAction: 'import',
        description: `Imported ${imported} ${entityConfig.label.toLowerCase()} records (${skipped} skipped${autoCreated > 0 ? `, ${autoCreated} lookups auto-created` : ''})`,
        metadata: { mode, imported, skipped, autoCreated },
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    updateJob(jobId, { status: 'error', errorMessage: message, completedAt: Date.now() })
    broadcastProgress('error', { errorMessage: message })
    logError('import-job', err, { errorSource: 'system', context: { jobId, entityName } })
  }
}

function parseCompatibleModels(raw: string): { makeName: string; modelName?: string; yearFrom?: number; yearTo?: number }[] {
  if (!raw || !raw.trim()) return []
  return raw.split(';').map(s => s.trim()).filter(Boolean).map(entry => {
    const yearMatch = entry.match(/\s+(\d{4})\s*[-–]\s*(\d{4})$/)
    let yearFrom: number | undefined
    let yearTo: number | undefined
    let rest = entry
    if (yearMatch) {
      yearFrom = parseInt(yearMatch[1])
      yearTo = parseInt(yearMatch[2])
      rest = entry.slice(0, yearMatch.index!).trim()
    } else {
      const singleYear = rest.match(/\s+(\d{4})$/)
      if (singleYear) {
        yearFrom = parseInt(singleYear[1])
        yearTo = yearFrom
        rest = rest.slice(0, singleYear.index!).trim()
      }
    }
    const parts = rest.split(/\s+/)
    const makeName = parts[0] || ''
    const modelName = parts.slice(1).join(' ') || undefined
    return { makeName, modelName, yearFrom, yearTo }
  }).filter(e => e.makeName)
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size))
  return result
}
