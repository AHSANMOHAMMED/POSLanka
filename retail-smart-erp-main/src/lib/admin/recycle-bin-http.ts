/** Shared bits of the super-admin recycle-bin routes (/api/sys-control/vendors/[id]/recycle-bin). */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { pgErrorToDataError } from '@/lib/admin/vendor-data'
import { RecycleBinError } from '@/lib/recycle-bin'

export const entryParamsSchema = z.object({ id: z.string().uuid(), entryId: z.string().uuid() })

export async function vendorExists(id: string) {
  return !!(await db.query.tenants.findFirst({ where: eq(tenants.id, id), columns: { id: true } }))
}

/** Maps recycle-bin and database errors to a clear response (null = unexpected). */
export function binErrorResponse(err: unknown, action: 'restore' | 'purge' | 'view') {
  if (err instanceof RecycleBinError) return NextResponse.json({ error: err.message }, { status: err.status })
  const mapped = pgErrorToDataError(err)
  if (!mapped) return null
  const message = action === 'purge' && mapped.status === 409
    ? `Cannot purge: other records still reference it. ${mapped.message} Keep it in the recycle bin (it stays hidden) or restore it.`
    : action === 'restore'
      ? `Cannot restore: ${mapped.message}`
      : mapped.message
  return NextResponse.json({ error: message }, { status: mapped.status })
}
