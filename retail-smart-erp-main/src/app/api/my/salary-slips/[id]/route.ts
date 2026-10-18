import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { salarySlips } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      const slip = await db.query.salarySlips.findFirst({
        where: and(
          eq(salarySlips.id, id),
          eq(salarySlips.userId, session.user.id),
          eq(salarySlips.status, 'submitted'),
        ),
        with: {
          components: { orderBy: (c, { asc }) => [asc(c.sortOrder)] },
        },
      })

      if (!slip) {
        return NextResponse.json({ error: 'Salary slip not found' }, { status: 404 })
      }

      return NextResponse.json(slip)
    })
  } catch (error) {
    logError('api/my/salary-slips/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch salary slip' }, { status: 500 })
  }
}
