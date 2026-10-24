import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { getEntityConfig } from '@/lib/import-export/entity-config'
import { countExport, createExportStream, isExportSupported, type ExportFilters } from '@/lib/import-export/export-stream'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import type { EntityType } from '@/lib/websocket/events'
import { requireAllBranches } from '@/lib/auth/branch-access'

const ENTITY_TYPE_MAP: Record<string, EntityType> = {
  items: 'item', customers: 'customer', suppliers: 'supplier', categories: 'category',
  vehicles: 'vehicle', 'service-types': 'service', sales: 'sale', purchases: 'purchase',
  'purchase-orders': 'purchase-order', 'sales-orders': 'sale', 'work-orders': 'work-order',
  'stock-movements': 'item', appointments: 'appointment', 'activity-logs': 'user',
  'restaurant-orders': 'sale', 'waste-log': 'item', refunds: 'sale',
}

// GET - stream an export (CSV or XLSX). No row cap: rows are read in chunks of 1000.
/** K4: exports without branch data, open to branch-restricted users */
const MASTER_DATA_EXPORTS = new Set(['items', 'customers', 'suppliers', 'categories', 'vehicles', 'service-types', 'appointments'])

export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const entityName = searchParams.get('entity')
    const format = searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv'
    const fieldsParam = searchParams.get('fields')
    const countOnly = searchParams.get('countOnly') === 'true'
    const filters: ExportFilters = {
      search: searchParams.get('search'),
      status: searchParams.get('status'),
      startDate: searchParams.get('startDate'),
      endDate: searchParams.get('endDate'),
      categoryId: searchParams.get('categoryId'),
      supplierId: searchParams.get('supplierId'),
      warehouseId: searchParams.get('warehouseId'),
      movementType: searchParams.get('type'),
      referenceType: searchParams.get('referenceType'),
      orderType: searchParams.get('orderType'),
      action: searchParams.get('action'),
      entityType: searchParams.get('entityType'),
    }

    if (!entityName) {
      return NextResponse.json({ error: 'Entity parameter is required' }, { status: 400 })
    }
    const entityConfig = getEntityConfig(entityName)
    if (!entityConfig) {
      return NextResponse.json({ error: `Unknown entity: ${entityName}` }, { status: 400 })
    }
    const permError = requirePermission(session, entityConfig.permission as Parameters<typeof requirePermission>[1])
    if (permError) return permError
    // K4: documents and stock per branch are not exported for branch-restricted users (the
    // export is company-wide); master data (items without stock, customers, ...) is
    const branchWide = !MASTER_DATA_EXPORTS.has(entityName) || (entityName === 'items' && (!fieldsParam || fieldsParam.split(',').includes('warehouseStock')))
    if (branchWide) {
      const branchError = await requireAllBranches(session)
      if (branchError) return branchError
    }
    if (!isExportSupported(entityName)) {
      return NextResponse.json({ error: `Export not supported for: ${entityName}` }, { status: 400 })
    }

    const req = {
      tenantId: session.user.tenantId,
      entityName,
      format: format as 'csv' | 'xlsx',
      fields: fieldsParam ? fieldsParam.split(',').map(k => k.trim()).filter(Boolean) : null,
      filters,
      businessType: session.user.businessType || undefined,
    }

    const counts = await countExport(req)
    if (countOnly) {
      return NextResponse.json({ count: counts.count, totalCount: counts.totalCount })
    }

    const result = await createExportStream(req)

    // Activity log once the stream has been fully written
    result.done.then((rowCount) => {
      logAndBroadcast(session.user.tenantId, ENTITY_TYPE_MAP[entityName] || 'item', 'updated', '', {
        userId: session.user.id,
        activityAction: 'export',
        description: `Exported ${rowCount} ${entityConfig.label.toLowerCase()} records as ${format.toUpperCase()}`,
        metadata: { format, rowCount, filters: { search: filters.search, status: filters.status, startDate: filters.startDate, endDate: filters.endDate } },
      })
    }).catch((err) => logError('api/export/stream', err))

    return new NextResponse(result.stream, {
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename="${result.fileName}"`,
        'X-Row-Count': String(counts.count),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    logError('api/export', error)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
