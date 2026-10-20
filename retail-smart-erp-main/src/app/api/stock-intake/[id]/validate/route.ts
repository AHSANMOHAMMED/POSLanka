import { NextRequest, NextResponse } from 'next/server'
import { withAuthTenant } from '@/lib/db'
import { requirePermission } from '@/lib/auth/roles'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { validateIntakeBatch } from '@/lib/inventory/stock-intake'
import { intakeErrorResponse } from '@/lib/inventory/stock-intake-http'

// POST /api/stock-intake/[id]/validate — dry run: what a sync would add / create / reject
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const p = validateParams(await params, idParamSchema)
  if (!p.success) return p.response
  try {
    const result = await withAuthTenant(async (session, db) => {
      const permError = requirePermission(session, 'submitStockIntake')
      if (permError) return { error: permError }
      return { data: await validateIntakeBatch(db, session.user.tenantId, p.data.id) }
    })
    if (!result) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if ('error' in result) return result.error
    return NextResponse.json(result.data)
  } catch (err) {
    return intakeErrorResponse(err, 'api/stock-intake/[id]/validate', 'Failed to validate batch')
  }
}
