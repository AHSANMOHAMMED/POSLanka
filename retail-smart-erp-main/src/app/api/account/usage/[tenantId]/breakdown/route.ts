import { NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { withTenant } from '@/lib/db'
import { tenants, items, files } from '@/lib/db/schema'
import { eq, desc, sql } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { TABLE_MODULES, getFileCategory, FILE_CATEGORY_COLORS } from '@/lib/storage/table-modules'
import { validateParams } from '@/lib/validation/helpers'
import { z } from 'zod'

interface TableBreakdown {
  name: string
  label: string
  rows: number
  bytes: number
}

interface ModuleBreakdown {
  key: string
  label: string
  color: string
  totalBytes: number
  totalRows: number
  tables: TableBreakdown[]
}

// GET /api/account/usage/[tenantId]/breakdown
export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, z.object({ tenantId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { tenantId } = paramsParsed.data

    // Verify user is the primary owner
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { id: true, primaryOwnerId: true },
    })

    if (!tenant || tenant.primaryOwnerId !== session.user.accountId) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
    }

    // --- Database breakdown ---
    const modules: ModuleBreakdown[] = []
    let totalDbBytes = 0

    await withTenant(tenantId, async (tdb) => {
      for (const [moduleKey, mod] of Object.entries(TABLE_MODULES)) {
        const tableCounts: TableBreakdown[] = []
        let moduleTotalBytes = 0
        let moduleTotalRows = 0

        for (const [tableName, tableInfo] of Object.entries(mod.tables)) {
          try {
            const result = await tdb.execute(
              sql.raw(`SELECT COUNT(*)::int AS cnt FROM "${tableName}"`)
            )
            const rows = (result.rows[0] as { cnt: number })?.cnt || 0
            if (rows > 0) {
              const bytes = Math.round(rows * tableInfo.bytesPerRow * 1.2)
              tableCounts.push({
                name: tableName,
                label: tableInfo.label,
                rows,
                bytes,
              })
              moduleTotalBytes += bytes
              moduleTotalRows += rows
            }
          } catch {
            // Table might not exist in this DB version, skip
          }
        }

        if (tableCounts.length > 0) {
          // Sort tables by bytes desc
          tableCounts.sort((a, b) => b.bytes - a.bytes)
          modules.push({
            key: moduleKey,
            label: mod.label,
            color: mod.color,
            totalBytes: moduleTotalBytes,
            totalRows: moduleTotalRows,
            tables: tableCounts,
          })
          totalDbBytes += moduleTotalBytes
        }
      }
    })

    // Sort modules by totalBytes desc
    modules.sort((a, b) => b.totalBytes - a.totalBytes)

    // --- File storage breakdown ---
    const fileCategories: { category: string; bytes: number; count: number; color: string }[] = []
    let totalFileBytes = 0
    let topFiles: { id: string; fileName: string; fileType: string; fileSize: number; createdAt: string; thumbnailUrl: string | null }[] = []

    await withTenant(tenantId, async (tdb) => {
      // Group files by MIME type category
      const fileRows = await tdb
        .select({
          fileType: files.fileType,
          totalSize: sql<string>`COALESCE(SUM(${files.fileSize}), 0)`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(files)
        .where(eq(files.isFolder, false))
        .groupBy(files.fileType)

      // Aggregate by category
      const categoryMap: Record<string, { bytes: number; count: number }> = {}
      for (const row of fileRows) {
        const cat = getFileCategory(row.fileType || '')
        if (!categoryMap[cat]) categoryMap[cat] = { bytes: 0, count: 0 }
        categoryMap[cat].bytes += parseInt(String(row.totalSize)) || 0
        categoryMap[cat].count += row.count
      }

      // Item images (bypass files table)
      const [imgResult] = await tdb
        .select({
          totalSize: sql<string>`COALESCE(SUM(${items.imageSize}), 0)`,
          count: sql<number>`COUNT(CASE WHEN ${items.imageSize} > 0 THEN 1 END)::int`,
        })
        .from(items)

      const itemImageBytes = parseInt(String(imgResult.totalSize)) || 0
      const itemImageCount = imgResult.count || 0
      if (itemImageBytes > 0) {
        categoryMap['Item Images'] = { bytes: itemImageBytes, count: itemImageCount }
      }

      // Logo (bypass files table)
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, tenantId),
        columns: { logoSize: true },
      })
      if (tenant?.logoSize) {
        categoryMap['Logos'] = { bytes: tenant.logoSize, count: 1 }
      }

      // Convert to array
      for (const [category, data] of Object.entries(categoryMap)) {
        fileCategories.push({
          category,
          bytes: data.bytes,
          count: data.count,
          color: FILE_CATEGORY_COLORS[category] || '#64748b',
        })
        totalFileBytes += data.bytes
      }
      fileCategories.sort((a, b) => b.bytes - a.bytes)

      // Top 10 files by size
      const bigFiles = await tdb.query.files.findMany({
        where: eq(files.isFolder, false),
        orderBy: [desc(files.fileSize)],
        limit: 10,
        columns: {
          id: true,
          fileName: true,
          fileType: true,
          fileSize: true,
          createdAt: true,
          thumbnailUrl: true,
        },
      })
      topFiles = bigFiles.map(f => ({
        id: f.id,
        fileName: f.fileName,
        fileType: f.fileType || '',
        fileSize: f.fileSize || 0,
        createdAt: f.createdAt?.toISOString() || '',
        thumbnailUrl: f.thumbnailUrl || null,
      }))
    })

    return NextResponse.json({
      database: {
        totalBytes: totalDbBytes,
        modules,
      },
      files: {
        totalBytes: totalFileBytes,
        byCategory: fileCategories,
        topFiles,
      },
    })
  } catch (error) {
    logError('api/account/usage/[tenantId]/breakdown', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
