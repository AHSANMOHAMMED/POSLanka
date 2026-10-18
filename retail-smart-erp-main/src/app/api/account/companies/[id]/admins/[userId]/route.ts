import { NextRequest, NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { tenants, users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import bcrypt from 'bcryptjs'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { z } from 'zod'

const updateAdminSchema = z.object({
  fullName: z.string().trim().min(1).max(255).optional(),
  role: z.enum(['owner', 'manager', 'cashier', 'technician']).optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  isActive: z.boolean().optional(),
})

// PUT /api/account/companies/[id]/admins/[userId] — Update admin user
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: companyId, userId } = await params

    // Verify ownership via primaryOwnerId
    const tenant = await db.query.tenants.findFirst({
      where: and(
        eq(tenants.id, companyId),
        eq(tenants.primaryOwnerId, session.user.accountId)
      ),
      columns: { id: true },
    })

    if (!tenant) {
      return NextResponse.json({ error: 'Company not found or not owned by you' }, { status: 404 })
    }

    const parsed = await validateBody(request, updateAdminSchema)
    if (!parsed.success) return parsed.response
    const { fullName, role, password, isActive } = parsed.data

    // Build update data
    const updateData: Record<string, unknown> = {}
    if (fullName !== undefined) updateData.fullName = fullName.trim()
    if (role !== undefined) updateData.role = role
    if (isActive !== undefined) updateData.isActive = isActive
    if (password) updateData.passwordHash = await bcrypt.hash(password, 12)

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const [updated] = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${companyId}, true)`)
      return tx.update(users)
        .set(updateData)
        .where(and(
          eq(users.id, userId),
          eq(users.tenantId, companyId)
        ))
        .returning()
    })

    if (!updated) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({
      id: updated.id,
      fullName: updated.fullName,
      email: updated.email,
      role: updated.role,
      isActive: updated.isActive,
    })
  } catch (error) {
    logError('api/account/companies/[id]/admins/[userId] PUT', error)
    return NextResponse.json({ error: 'Failed to update admin user' }, { status: 500 })
  }
}
