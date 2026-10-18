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

const createAdminSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(255),
  email: z.string().email('Valid email is required').transform(v => v.toLowerCase().trim()),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: z.enum(['owner', 'manager', 'cashier', 'technician']).default('manager'),
})

// GET /api/account/companies/[id]/admins — List admin users for a company
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: companyId } = await params

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

    // Set RLS context and query users
    const adminUsers = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${companyId}, true)`)
      return tx
        .select({
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          role: users.role,
          isActive: users.isActive,
          createdAt: users.createdAt,
          lastLoginAt: users.lastLoginAt,
        })
        .from(users)
        .where(eq(users.tenantId, companyId))
    })

    return NextResponse.json(adminUsers)
  } catch (error) {
    logError('api/account/companies/[id]/admins GET', error)
    return NextResponse.json({ error: 'Failed to fetch admin users' }, { status: 500 })
  }
}

// POST /api/account/companies/[id]/admins — Create admin user
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: companyId } = await params

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

    const parsed = await validateBody(request, createAdminSchema)
    if (!parsed.success) return parsed.response
    const { fullName, email, password, role } = parsed.data

    // Check for duplicate email in this tenant
    const existing = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${companyId}, true)`)
      return tx.query.users.findFirst({
        where: and(
          eq(users.email, email),
          eq(users.tenantId, companyId)
        ),
        columns: { id: true },
      })
    })

    if (existing) {
      return NextResponse.json({ error: 'A user with this email already exists in this company' }, { status: 400 })
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const [newUser] = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${companyId}, true)`)
      return tx.insert(users).values({
        tenantId: companyId,
        accountId: null,
        email,
        fullName: fullName.trim(),
        passwordHash,
        role,
      }).returning()
    })

    return NextResponse.json({
      id: newUser.id,
      fullName: newUser.fullName,
      email: newUser.email,
      role: newUser.role,
      createdAt: newUser.createdAt,
    }, { status: 201 })
  } catch (error) {
    logError('api/account/companies/[id]/admins POST', error)
    return NextResponse.json({ error: 'Failed to create admin user' }, { status: 500 })
  }
}
