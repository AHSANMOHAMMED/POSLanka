import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, asc, desc, eq } from 'drizzle-orm'
import { db, withTenant } from '@/lib/db'
import { tenants, users } from '@/lib/db/schema'
import { adminAuthError, adminAudit, validateAdminSession, withRateLimit, STRICT_LIMIT } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import type { CompanySession } from '@/lib/auth'
import { parseImportRequest } from '@/lib/import-export/import-request'
import { validateImport } from '@/lib/import-export/import-validate'
import { createImportJob, effectiveStatus, getJob, getJobView } from '@/lib/import-export/import-job-store'
import { startImportJobInBackground } from '@/lib/import-export/run-import-job'

/**
 * Platform console: import products for a vendor (new products, prices, stock) from CSV / Excel.
 * Runs the vendor's own import engine (same validation, job store, stock ledger + opening stock) on the
 * vendor's behalf, attributed to its owner user, and audited on the vendor.
 *  POST ?step=preview  → dry run (counts + first rows)
 *  POST ?step=execute  → starts the background job, returns { jobId }
 *  GET  ?jobId=…       → job progress
 */
type Ctx = { params: Promise<{ id: string }> }

/** The vendor's owner, as the user the import is recorded under (items / stock movements need a vendor user). */
async function ownerSession(tenantId: string): Promise<CompanySession | null> {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { id: true, slug: true, name: true, businessType: true },
  })
  if (!tenant) return null
  const [owner] = await withTenant(tenantId, (tdb) =>
    tdb.select({ id: users.id, email: users.email, fullName: users.fullName, isActive: users.isActive })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.role, 'owner')))
      .orderBy(desc(users.isActive), asc(users.createdAt))
      .limit(1))
  if (!owner) return null
  return {
    user: {
      id: owner.id,
      accountId: null,
      email: owner.email,
      name: owner.fullName,
      role: 'owner',
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      businessType: tenant.businessType,
      aiEnabled: false,
      isSuperAdmin: false,
      isOwner: true,
      mode: 'company',
      impersonating: true,
    },
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const rateLimited = await withRateLimit('/api/sys-control/vendors/import', STRICT_LIMIT)
    if (rateLimited) return rateLimited
    const admin = await validateAdminSession('vendors.manage')
    if (!admin) return adminAuthError()
    const { id } = await params
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    const session = await ownerSession(id)
    if (!session) return NextResponse.json({ error: 'Vendor not found or it has no owner user' }, { status: 404 })
    const step = request.nextUrl.searchParams.get('step') === 'execute' ? 'execute' : 'preview'

    const parsed = await parseImportRequest(request, session)
    if (parsed instanceof NextResponse) return parsed
    if (parsed.entityName !== 'items') return NextResponse.json({ error: 'Only products can be imported here' }, { status: 400 })

    const validation = await withTenant(id, (tdb) => validateImport(tdb, {
      tenantId: id,
      entityConfig: parsed.entityConfig,
      rawRows: parsed.rawRows,
      columnMapping: parsed.columnMapping,
      mode: parsed.mode,
      options: parsed.options,
      businessType: parsed.businessType,
    }))

    if (step === 'preview') {
      return NextResponse.json({
        actions: validation.counts,
        mappedColumns: parsed.columnMapping,
        errors: validation.errors.slice(0, 50),
        preview: validation.rows.slice(0, 20).map((r) => ({ row: r.rowIndex, action: r.action, status: r.status, data: r.payload.data, error: r.error ?? null })),
      })
    }

    if (!parsed.options.skipErrors && validation.counts.error > 0) {
      return NextResponse.json({ error: `${validation.counts.error} rows have errors. Fix them or tick "Skip rows with errors".`, errors: validation.errors.slice(0, 20) }, { status: 400 })
    }
    if (validation.counts.insert + validation.counts.update === 0) {
      return NextResponse.json({ error: 'No rows to import', actions: validation.counts }, { status: 400 })
    }
    const created = await createImportJob({
      tenantId: id,
      userId: session.user.id,
      entityName: parsed.entityName,
      mode: parsed.mode,
      options: { ...parsed.options, matchBy: validation.matchBy },
      fileName: parsed.fileName,
      fileHash: parsed.fileHash,
      rows: validation.rows,
    })
    if (!created.ok) {
      const status = created.conflict ? effectiveStatus(created.conflict) : 'processing'
      return NextResponse.json({ error: status === 'interrupted' ? 'This file has an interrupted import (resume it in the vendor app).' : 'This file is already being imported.', jobId: created.conflict?.id ?? null }, { status: 409 })
    }
    startImportJobInBackground(created.job.id, id)
    await adminAudit.create(admin.superAdminId, 'vendor_import', id, {
      op: 'product_import', tenantId: id, jobId: created.job.id, fileName: parsed.fileName, mode: parsed.mode,
      stockMode: parsed.options.stockMode, counts: validation.counts,
    })
    return NextResponse.json({ jobId: created.job.id, total: created.job.total, actions: validation.counts })
  } catch (error) {
    logError('api/sys-control/vendors/[id]/import POST', error)
    return NextResponse.json({ error: 'Import failed' }, { status: 500 })
  }
}

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const admin = await validateAdminSession('vendors.manage')
    if (!admin) return adminAuthError()
    const { id } = await params
    const jobId = request.nextUrl.searchParams.get('jobId') || ''
    if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(jobId).success) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    const job = await getJob(id, jobId)
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    return NextResponse.json(await getJobView(id, jobId, 50))
  } catch (error) {
    logError('api/sys-control/vendors/[id]/import GET', error)
    return NextResponse.json({ error: 'Failed to load the import' }, { status: 500 })
  }
}
