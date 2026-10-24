import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requireAnyPermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { files } from '@/lib/db/schema'
import { validateFile, validateFileContent, storeFile, computeFileHash } from '@/lib/files'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota, invalidateStorageCache } from '@/lib/db/storage-quota'
import { readFormData } from '@/lib/api/form-data'

const BILL_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_BILL_SIZE = 5 * 1024 * 1024

/**
 * POST /api/expenses/attachment — multipart `file`: a photo or PDF of the bill for an expense or
 * claim. Open to everyone who may record one (cashier paying from the drawer, accounts, a staff
 * member claiming), unlike the File Manager upload. Stored as a private file (listed in the File
 * Manager under "expense"); returns { fileUrl } for the expense's attachmentUrl, which opens
 * through GET /api/expenses/attachment/<id> for the same people.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const permError = requireAnyPermission(session, ['createSales', 'manageAccounting', 'requestAdvance'])
    if (permError) return permError

    const formData = await readFormData(request)
    if (formData instanceof NextResponse) return formData
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Choose a photo or PDF of the bill' }, { status: 400 })

    const validation = validateFile(file, { allowedTypes: BILL_TYPES, maxSize: MAX_BILL_SIZE })
    if (!validation.valid) return NextResponse.json({ error: validation.error || 'Use a JPG, PNG, WebP or PDF up to 5 MB' }, { status: 400 })

    const quotaError = await requireQuota(session.user.tenantId, 'file', file.size)
    if (quotaError) return quotaError

    const buffer = Buffer.from(await file.arrayBuffer())
    const content = validateFileContent(buffer, file.name)
    if (!content.valid) return NextResponse.json({ error: content.error }, { status: 400 })

    const stored = await storeFile(buffer, file.name, { tenantSlug: session.user.tenantSlug, isPrivate: true })
    const [row] = await withTenant(session.user.tenantId, (db) => db.insert(files).values({
      tenantId: session.user.tenantId,
      fileName: file.name,
      fileUrl: stored.fileUrl,
      fileSize: stored.fileSize,
      fileType: file.type,
      contentHash: computeFileHash(buffer),
      isPrivate: true,
      isFolder: false,
      attachedToType: 'expense',
      attachedToField: 'attachmentUrl',
      category: 'expense',
      description: 'Expense bill',
      uploadedBy: session.user.id,
    }).returning({ id: files.id }))
    invalidateStorageCache(session.user.tenantId)

    return NextResponse.json({ fileUrl: `/api/expenses/attachment/${row.id}`, fileName: file.name }, { status: 201 })
  } catch (error) {
    logError('api/expenses/attachment', error)
    return NextResponse.json({ error: 'Failed to upload the bill' }, { status: 500 })
  }
}
