import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { getEntityConfig, getExportFields } from '@/lib/import-export/entity-config'
import { generateCsv, generateXlsx, flattenParentChildRows } from '@/lib/import-export/export-utils'
import { sql, ilike, and, or, gte, lte } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import * as schema from '@/lib/db/schema'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

const MAX_EXPORT_ROWS = 5000

// Map entity names to their Drizzle table + query config
function getEntityQuery(entityName: string) {
  switch (entityName) {
    case 'items':
      return {
        table: schema.items,
        searchFields: [schema.items.name, schema.items.sku, schema.items.barcode],
        relations: { category: true, supplier: true },
        orderBy: (t: typeof schema.items) => [sql`${t.name} ASC`],
        transform: (row: Record<string, unknown>) => {
          const cat = row.category as { name: string } | null
          const sup = row.supplier as { name: string } | null
          return { ...row, categoryName: cat?.name || '', supplierName: sup?.name || '' }
        },
      }
    case 'customers':
      return {
        table: schema.customers,
        searchFields: [schema.customers.name, schema.customers.email, schema.customers.phone],
        orderBy: (t: typeof schema.customers) => [sql`${t.name} ASC`],
      }
    case 'suppliers':
      return {
        table: schema.suppliers,
        searchFields: [schema.suppliers.name, schema.suppliers.email],
        orderBy: (t: typeof schema.suppliers) => [sql`${t.name} ASC`],
      }
    case 'categories':
      return {
        table: schema.categories,
        searchFields: [schema.categories.name],
        orderBy: (t: typeof schema.categories) => [sql`${t.name} ASC`],
      }
    case 'vehicles':
      return {
        table: schema.vehicles,
        searchFields: [schema.vehicles.make, schema.vehicles.model, schema.vehicles.licensePlate, schema.vehicles.vin],
        orderBy: (t: typeof schema.vehicles) => [sql`${t.make} ASC`],
      }
    case 'service-types':
      return {
        table: schema.serviceTypes,
        searchFields: [schema.serviceTypes.name],
        relations: { group: true },
        orderBy: (t: typeof schema.serviceTypes) => [sql`${t.name} ASC`],
        transform: (row: Record<string, unknown>) => {
          const grp = row.group as { name: string } | null
          return { ...row, groupName: grp?.name || '' }
        },
      }
    case 'sales':
      return {
        table: schema.sales,
        searchFields: [schema.sales.invoiceNo, schema.sales.customerName],
        dateField: schema.sales.createdAt,
        statusField: schema.sales.status,
        orderBy: (t: typeof schema.sales) => [sql`${t.createdAt} DESC`],
        children: [
          { childTable: schema.saleItems, parentKey: 'saleId', configName: 'saleItems' },
        ],
      }
    case 'purchases':
      return {
        table: schema.purchases,
        searchFields: [schema.purchases.purchaseNo],
        dateField: schema.purchases.createdAt,
        statusField: schema.purchases.status,
        orderBy: (t: typeof schema.purchases) => [sql`${t.createdAt} DESC`],
        // Join supplier name
        joinSupplier: true,
        children: [
          { childTable: schema.purchaseItems, parentKey: 'purchaseId', configName: 'purchaseItems' },
        ],
      }
    case 'purchase-orders':
      return {
        table: schema.purchaseOrders,
        searchFields: [schema.purchaseOrders.orderNo],
        dateField: schema.purchaseOrders.createdAt,
        statusField: schema.purchaseOrders.status,
        orderBy: (t: typeof schema.purchaseOrders) => [sql`${t.createdAt} DESC`],
      }
    case 'sales-orders':
      return {
        table: schema.salesOrders,
        searchFields: [schema.salesOrders.orderNo],
        dateField: schema.salesOrders.createdAt,
        statusField: schema.salesOrders.status,
        orderBy: (t: typeof schema.salesOrders) => [sql`${t.createdAt} DESC`],
      }
    case 'work-orders':
      return {
        table: schema.workOrders,
        searchFields: [schema.workOrders.orderNo, schema.workOrders.customerName, schema.workOrders.vehiclePlate],
        dateField: schema.workOrders.createdAt,
        statusField: schema.workOrders.status,
        orderBy: (t: typeof schema.workOrders) => [sql`${t.createdAt} DESC`],
        children: [
          { childTable: schema.workOrderServices, parentKey: 'workOrderId', configName: 'workOrderServices' },
          { childTable: schema.workOrderParts, parentKey: 'workOrderId', configName: 'workOrderParts' },
        ],
      }
    case 'stock-movements':
      return {
        table: schema.stockMovements,
        searchFields: [],
        dateField: schema.stockMovements.createdAt,
        orderBy: (t: typeof schema.stockMovements) => [sql`${t.createdAt} DESC`],
        // Need to join item name and warehouse name
        joins: ['item', 'warehouse'],
      }
    case 'appointments':
      return {
        table: schema.appointments,
        searchFields: [schema.appointments.customerName, schema.appointments.vehiclePlate],
        statusField: schema.appointments.status,
        orderBy: (t: typeof schema.appointments) => [sql`${t.scheduledDate} DESC`],
      }
    case 'activity-logs':
      return {
        table: schema.activityLogs,
        searchFields: [],
        dateField: schema.activityLogs.createdAt,
        orderBy: (t: typeof schema.activityLogs) => [sql`${t.createdAt} DESC`],
        joins: ['user'],
      }
    case 'restaurant-orders':
      return {
        table: schema.restaurantOrders,
        searchFields: [schema.restaurantOrders.orderNo],
        dateField: schema.restaurantOrders.createdAt,
        orderBy: (t: typeof schema.restaurantOrders) => [sql`${t.createdAt} DESC`],
      }
    case 'waste-log':
      return {
        table: schema.wasteLog,
        searchFields: [],
        dateField: schema.wasteLog.recordedAt,
        orderBy: (t: typeof schema.wasteLog) => [sql`${t.recordedAt} DESC`],
        joins: ['item'],
      }
    case 'refunds':
      return {
        table: schema.refunds,
        searchFields: [],
        dateField: schema.refunds.createdAt,
        orderBy: (t: typeof schema.refunds) => [sql`${t.createdAt} DESC`],
        joins: ['sale', 'originalSale'],
      }
    default:
      return null
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const entityName = searchParams.get('entity')
    const format = (searchParams.get('format') || 'csv') as 'csv' | 'xlsx'
    const fieldsParam = searchParams.get('fields') // comma-separated field keys
    const search = searchParams.get('search')
    const status = searchParams.get('status')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const countOnly = searchParams.get('countOnly') === 'true'
    // Entity-specific filters
    const categoryId = searchParams.get('categoryId')
    const supplierId = searchParams.get('supplierId')
    const warehouseId = searchParams.get('warehouseId')
    const movementType = searchParams.get('type') // stock movement type
    const referenceType = searchParams.get('referenceType')
    const orderType = searchParams.get('orderType') // restaurant order type
    const action = searchParams.get('action') // activity log action
    const entityType = searchParams.get('entityType') // activity log entity type

    if (!entityName) {
      return NextResponse.json({ error: 'Entity parameter is required' }, { status: 400 })
    }

    const entityConfig = getEntityConfig(entityName)
    if (!entityConfig) {
      return NextResponse.json({ error: `Unknown entity: ${entityName}` }, { status: 400 })
    }

    // Check permission
    const permError = requirePermission(session, entityConfig.permission as Parameters<typeof requirePermission>[1])
    if (permError) return permError

    const queryConfig = getEntityQuery(entityName)
    if (!queryConfig) {
      return NextResponse.json({ error: `Export not supported for: ${entityName}` }, { status: 400 })
    }

    // Determine which fields to export
    const businessType = session.user.businessType || undefined
    let exportFields = getExportFields(entityConfig, businessType)
    if (fieldsParam) {
      const selectedKeys = new Set(fieldsParam.split(',').map(k => k.trim()))
      exportFields = exportFields.filter(f => selectedKeys.has(f.key))
    }

    // Execute query with RLS
    const result = await withTenant(session.user.tenantId, async (db) => {
      // Build where conditions
      const conditions = []

      // Search filter
      if (search && queryConfig.searchFields.length > 0) {
        const escaped = escapeLikePattern(search)
        const searchConditions = queryConfig.searchFields.map(field =>
          ilike(field, `%${escaped}%`)
        )
        conditions.push(or(...searchConditions))
      }

      // Status filter
      if (status && 'statusField' in queryConfig && queryConfig.statusField) {
        conditions.push(sql`${queryConfig.statusField} = ${status}`)
      }

      // Date range filter
      if ('dateField' in queryConfig && queryConfig.dateField) {
        if (startDate) {
          conditions.push(gte(queryConfig.dateField, new Date(startDate)))
        }
        if (endDate) {
          conditions.push(lte(queryConfig.dateField, new Date(endDate + 'T23:59:59')))
        }
      }

      // Entity-specific filters
      if (categoryId && entityName === 'items') {
        conditions.push(sql`${schema.items.categoryId} = ${categoryId}`)
      }
      if (supplierId) {
        if (entityName === 'items') conditions.push(sql`${schema.items.supplierId} = ${supplierId}`)
        if (entityName === 'purchases') conditions.push(sql`${schema.purchases.supplierId} = ${supplierId}`)
        if (entityName === 'purchase-orders') conditions.push(sql`${schema.purchaseOrders.supplierId} = ${supplierId}`)
      }
      if (warehouseId) {
        if (entityName === 'stock-movements') conditions.push(sql`${schema.stockMovements.warehouseId} = ${warehouseId}`)
      }
      if (movementType && entityName === 'stock-movements') {
        conditions.push(sql`${schema.stockMovements.type} = ${movementType}`)
      }
      if (referenceType && entityName === 'stock-movements') {
        conditions.push(sql`${schema.stockMovements.referenceType} = ${referenceType}`)
      }
      if (orderType && entityName === 'restaurant-orders') {
        conditions.push(sql`${schema.restaurantOrders.orderType} = ${orderType}`)
      }
      if (action && entityName === 'activity-logs') {
        conditions.push(sql`${schema.activityLogs.action} = ${action}`)
      }
      if (entityType && entityName === 'activity-logs') {
        conditions.push(sql`${schema.activityLogs.entityType} = ${entityType}`)
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Count queries
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(queryConfig.table)
        .where(whereClause)

      // Total count (unfiltered) for "X of Y" display
      let totalCount = count
      if (countOnly && whereClause) {
        const [{ total }] = await db
          .select({ total: sql<number>`count(*)::int` })
          .from(queryConfig.table)
        totalCount = total
      }

      if (countOnly) {
        return { count, totalCount, data: [], childData: new Map() }
      }

      // Main data query using relational API when possible
      let data: Record<string, unknown>[]

      if ('relations' in queryConfig && queryConfig.relations) {
        // Use relational query for entities with relations
        const tableName = entityConfig.table.replace(/_([a-z])/g, (_, l) => l.toUpperCase()) as keyof typeof db.query
        const queryObj = db.query[tableName]
        if (queryObj && 'findMany' in queryObj) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const results = await (queryObj as any).findMany({
            where: whereClause,
            with: queryConfig.relations,
            limit: MAX_EXPORT_ROWS,
            orderBy: queryConfig.orderBy(queryConfig.table as never),
          })
          data = results as Record<string, unknown>[]
        } else {
          data = await db.select().from(queryConfig.table).where(whereClause).limit(MAX_EXPORT_ROWS) as Record<string, unknown>[]
        }
      } else {
        data = await db.select().from(queryConfig.table).where(whereClause).limit(MAX_EXPORT_ROWS) as Record<string, unknown>[]
      }

      // Apply transforms
      if ('transform' in queryConfig && queryConfig.transform) {
        data = data.map(row => queryConfig.transform!(row) as Record<string, unknown>)
      }

      // Handle special joins for entities that need denormalized names
      if (entityName === 'stock-movements' && data.length > 0) {
        const itemIds = [...new Set(data.map(d => d.itemId as string).filter(Boolean))]
        const warehouseIds = [...new Set(data.map(d => d.warehouseId as string).filter(Boolean))]

        const itemNames = new Map<string, string>()
        const warehouseNames = new Map<string, string>()

        if (itemIds.length > 0) {
          const items = await db.select({ id: schema.items.id, name: schema.items.name })
            .from(schema.items)
            .where(sql`${schema.items.id} IN ${itemIds}`)
          for (const item of items) itemNames.set(item.id, item.name)
        }

        if (warehouseIds.length > 0) {
          const whs = await db.select({ id: schema.warehouses.id, name: schema.warehouses.name })
            .from(schema.warehouses)
            .where(sql`${schema.warehouses.id} IN ${warehouseIds}`)
          for (const wh of whs) warehouseNames.set(wh.id, wh.name)
        }

        data = data.map(d => ({
          ...d,
          itemName: itemNames.get(d.itemId as string) || '',
          warehouseName: warehouseNames.get(d.warehouseId as string) || '',
        }))
      }

      if (entityName === 'activity-logs' && data.length > 0) {
        const userIds = [...new Set(data.map(d => d.userId as string).filter(Boolean))]
        const userNames = new Map<string, string>()

        if (userIds.length > 0) {
          const users = await db.select({ id: schema.users.id, fullName: schema.users.fullName })
            .from(schema.users)
            .where(sql`${schema.users.id} IN ${userIds}`)
          for (const u of users) userNames.set(u.id, u.fullName)
        }

        data = data.map(d => ({
          ...d,
          userName: userNames.get(d.userId as string) || 'System',
        }))
      }

      if (entityName === 'waste-log' && data.length > 0) {
        const itemIds = [...new Set(data.map(d => d.itemId as string).filter(Boolean))]
        const itemNames = new Map<string, string>()

        if (itemIds.length > 0) {
          const items = await db.select({ id: schema.items.id, name: schema.items.name })
            .from(schema.items)
            .where(sql`${schema.items.id} IN ${itemIds}`)
          for (const item of items) itemNames.set(item.id, item.name)
        }

        data = data.map(d => ({
          ...d,
          itemName: itemNames.get(d.itemId as string) || '',
        }))
      }

      if (entityName === 'purchases' && data.length > 0) {
        const supplierIds = [...new Set(data.map(d => d.supplierId as string).filter(Boolean))]
        const supplierNames = new Map<string, string>()

        if (supplierIds.length > 0) {
          const suppliers = await db.select({ id: schema.suppliers.id, name: schema.suppliers.name })
            .from(schema.suppliers)
            .where(sql`${schema.suppliers.id} IN ${supplierIds}`)
          for (const s of suppliers) supplierNames.set(s.id, s.name)
        }

        data = data.map(d => ({
          ...d,
          supplierName: supplierNames.get(d.supplierId as string) || '',
        }))
      }

      if (entityName === 'purchase-orders' && data.length > 0) {
        const supplierIds = [...new Set(data.map(d => d.supplierId as string).filter(Boolean))]
        const supplierNames = new Map<string, string>()

        if (supplierIds.length > 0) {
          const suppliers = await db.select({ id: schema.suppliers.id, name: schema.suppliers.name })
            .from(schema.suppliers)
            .where(sql`${schema.suppliers.id} IN ${supplierIds}`)
          for (const s of suppliers) supplierNames.set(s.id, s.name)
        }

        data = data.map(d => ({
          ...d,
          supplierName: supplierNames.get(d.supplierId as string) || '',
        }))
      }

      if (entityName === 'refunds' && data.length > 0) {
        const saleIds = [...new Set([
          ...data.map(d => d.saleId as string),
          ...data.map(d => d.originalSaleId as string),
        ].filter(Boolean))]
        const invoiceNos = new Map<string, string>()

        if (saleIds.length > 0) {
          const salesData = await db.select({ id: schema.sales.id, invoiceNo: schema.sales.invoiceNo })
            .from(schema.sales)
            .where(sql`${schema.sales.id} IN ${saleIds}`)
          for (const s of salesData) invoiceNos.set(s.id, s.invoiceNo)
        }

        data = data.map(d => ({
          ...d,
          saleInvoiceNo: invoiceNos.get(d.saleId as string) || '',
          originalInvoiceNo: invoiceNos.get(d.originalSaleId as string) || '',
        }))
      }

      if (entityName === 'sales-orders' && data.length > 0) {
        const customerIds = [...new Set(data.map(d => d.customerId as string).filter(Boolean))]
        const customerNames = new Map<string, string>()

        if (customerIds.length > 0) {
          const customers = await db.select({ id: schema.customers.id, name: schema.customers.name })
            .from(schema.customers)
            .where(sql`${schema.customers.id} IN ${customerIds}`)
          for (const c of customers) customerNames.set(c.id, c.name)
        }

        data = data.map(d => ({
          ...d,
          customerName: customerNames.get(d.customerId as string) || '',
        }))
      }

      // Fetch child data for parent-child entities
      const childData = new Map<string, Map<string, Record<string, unknown>[]>>()
      if ('children' in queryConfig && queryConfig.children && data.length > 0) {
        const parentIds = data.map(d => d.id as string)
        for (const childDef of queryConfig.children) {
          const childRows = await db
            .select()
            .from(childDef.childTable)
            .where(sql`${childDef.childTable[childDef.parentKey as keyof typeof childDef.childTable]} IN ${parentIds}`)

          const grouped = new Map<string, Record<string, unknown>[]>()
          for (const row of childRows) {
            const parentId = (row as Record<string, unknown>)[childDef.parentKey] as string
            if (!grouped.has(parentId)) grouped.set(parentId, [])
            grouped.get(parentId)!.push(row as Record<string, unknown>)
          }
          childData.set(childDef.configName, grouped)

          // For work order parts, resolve item names
          if (childDef.configName === 'workOrderParts') {
            const itemIds = [...new Set((childRows as Record<string, unknown>[]).map(r => r.itemId as string).filter(Boolean))]
            if (itemIds.length > 0) {
              const itemNameMap = new Map<string, string>()
              const items = await db.select({ id: schema.items.id, name: schema.items.name })
                .from(schema.items)
                .where(sql`${schema.items.id} IN ${itemIds}`)
              for (const item of items) itemNameMap.set(item.id, item.name)

              for (const [, rows] of grouped) {
                for (const row of rows) {
                  row.itemName = itemNameMap.get(row.itemId as string) || ''
                }
              }
            }
          }
        }
      }

      return { count, data, childData }
    })

    // Return count only for the dialog preview
    if (countOnly) {
      return NextResponse.json({ count: result.count, totalCount: result.totalCount })
    }

    let fileData: string | Buffer
    let contentType: string
    let fileName: string
    const dateStr = new Date().toISOString().split('T')[0]

    // Check if we need parent-child flattening
    if (entityConfig.children && entityConfig.children.length > 0 && result.childData.size > 0) {
      const childConfigs = entityConfig.children.map(cc => ({
        config: cc,
        data: result.childData.get(cc.name) || new Map<string, Record<string, unknown>[]>(),
      }))
      const { fields: flatFields, rows: flatRows } = flattenParentChildRows(
        result.data,
        exportFields,
        childConfigs
      )

      if (format === 'xlsx') {
        fileData = await generateXlsx(flatRows, flatFields, entityConfig.label)
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        fileName = `${entityName}_${dateStr}.xlsx`
      } else {
        fileData = generateCsv(flatRows, flatFields)
        contentType = 'text/csv; charset=utf-8'
        fileName = `${entityName}_${dateStr}.csv`
      }
    } else {
      if (format === 'xlsx') {
        fileData = await generateXlsx(result.data, exportFields, entityConfig.label)
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        fileName = `${entityName}_${dateStr}.xlsx`
      } else {
        fileData = generateCsv(result.data, exportFields)
        contentType = 'text/csv; charset=utf-8'
        fileName = `${entityName}_${dateStr}.csv`
      }
    }

    // Log activity (export is read-only, broadcast is a no-op but activity gets logged)
    const entityTypeMap: Record<string, string> = {
      items: 'item', customers: 'customer', suppliers: 'supplier', categories: 'category',
      vehicles: 'vehicle', 'service-types': 'service', sales: 'sale', purchases: 'purchase',
      'purchase-orders': 'purchase-order', 'sales-orders': 'sale', 'work-orders': 'work-order',
      'stock-movements': 'item', appointments: 'appointment', 'activity-logs': 'user',
      'restaurant-orders': 'sale', 'waste-log': 'item', refunds: 'sale',
    }
    const broadcastEntityType = entityTypeMap[entityName] || 'item'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logAndBroadcast(session.user.tenantId, broadcastEntityType as any, 'updated', '', {
      userId: session.user.id,
      activityAction: 'export',
      description: `Exported ${result.data.length} ${entityConfig.label.toLowerCase()} records as ${format.toUpperCase()}`,
      metadata: { format, rowCount: result.data.length, filters: { search, status, startDate, endDate } },
    })

    const body = typeof fileData === 'string' ? fileData : new Uint8Array(fileData)
    return new NextResponse(body, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'X-Row-Count': String(result.data.length),
      },
    })
  } catch (error) {
    logError('api/export', error)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
