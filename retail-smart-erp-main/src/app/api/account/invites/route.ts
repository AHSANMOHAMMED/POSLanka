import { NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { staffInvites, tenants } from '@/lib/db/schema'
import { eq, and, isNull, gt, sql, inArray } from 'drizzle-orm'
import crypto from 'crypto'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation/helpers'
import { createInviteSchema } from '@/lib/validation/schemas/account'
import { userRoleValues } from '@/lib/validation/schemas/common'

// GET /api/account/invites - List sent invites
export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get invites sent by this account
    const invites = await db
      .select()
      .from(staffInvites)
      .where(eq(staffInvites.invitedBy, session.user.accountId))
      .orderBy(sql`${staffInvites.createdAt} DESC`)

    // Batch-load all tenant names to avoid N+1 queries
    const allTenantIds = [...new Set(
      invites.flatMap(inv =>
        (inv.tenantAssignments as Array<{ tenantId: string; role: string }>).map(a => a.tenantId)
      )
    )]
    const tenantMap = new Map<string, string>()
    if (allTenantIds.length > 0) {
      const tenantRows = await db.select({ id: tenants.id, name: tenants.name })
        .from(tenants).where(inArray(tenants.id, allTenantIds))
      for (const t of tenantRows) tenantMap.set(t.id, t.name)
    }

    const enrichedInvites = invites.map((invite) => {
      const assignments = invite.tenantAssignments as Array<{ tenantId: string; role: string }>
      const tenantDetails = assignments.map((a) => ({
        tenantId: a.tenantId,
        tenantName: tenantMap.get(a.tenantId) || 'Unknown',
        role: a.role,
      }))

      return {
        id: invite.id,
        email: invite.email,
        tenantAssignments: tenantDetails,
        expiresAt: invite.expiresAt,
        acceptedAt: invite.acceptedAt,
        createdAt: invite.createdAt,
        status: invite.acceptedAt
          ? 'accepted'
          : new Date(invite.expiresAt) < new Date()
            ? 'expired'
            : 'pending',
      }
    })

    return NextResponse.json(enrichedInvites)
  } catch (error) {
    logError('api/account/invites', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/account/invites - Send staff invite
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await validateBody(request, createInviteSchema)
    if (!parsed.success) return parsed.response
    const { email, tenantAssignments } = parsed.data

    // Verify sender is the primary owner of all specified tenants
    for (const assignment of tenantAssignments) {
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, assignment.tenantId),
        columns: { id: true, name: true, primaryOwnerId: true },
      })

      // Must be primary owner to invite
      if (!tenant || tenant.primaryOwnerId !== session.user.accountId) {
        return NextResponse.json({
          error: `Not authorized to invite to tenant ${assignment.tenantId}`,
        }, { status: 403 })
      }

      // Validate role
      if (!(userRoleValues as readonly string[]).includes(assignment.role)) {
        return NextResponse.json({ error: `Invalid role: ${assignment.role}` }, { status: 400 })
      }
    }

    // Check for existing pending invite
    const existingInvite = await db.query.staffInvites.findFirst({
      where: and(
        eq(staffInvites.email, email.toLowerCase()),
        isNull(staffInvites.acceptedAt),
        gt(staffInvites.expiresAt, new Date())
      ),
    })

    if (existingInvite) {
      return NextResponse.json({
        error: 'An active invite already exists for this email',
      }, { status: 400 })
    }

    // Generate invite token
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7) // 7 days

    // Create invite
    const [invite] = await db.insert(staffInvites).values({
      email: email.toLowerCase(),
      token,
      tenantAssignments,
      invitedBy: session.user.accountId,
      expiresAt,
    }).returning()

    // Batch-load tenant names for response
    const assignmentTenantIds = tenantAssignments.map((a: { tenantId: string; role: string }) => a.tenantId)
    const tenantRows = await db.select({ id: tenants.id, name: tenants.name })
      .from(tenants).where(inArray(tenants.id, assignmentTenantIds))
    const tenantNameMap = new Map(tenantRows.map(t => [t.id, t.name]))
    const tenantDetails = tenantAssignments.map((a: { tenantId: string; role: string }) => ({
      tenantId: a.tenantId,
      tenantName: tenantNameMap.get(a.tenantId) || 'Unknown',
      role: a.role,
    }))

    return NextResponse.json({
      id: invite.id,
      email: invite.email,
      token: invite.token,
      tenantAssignments: tenantDetails,
      expiresAt: invite.expiresAt,
      inviteUrl: `${process.env.NEXTAUTH_URL || ''}/invite/${invite.token}`,
    }, { status: 201 })
  } catch (error) {
    logError('api/account/invites', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
