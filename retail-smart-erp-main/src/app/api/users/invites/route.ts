import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { db } from '@/lib/db'
import { staffInvites } from '@/lib/db/schema'
import { eq, isNull, sql } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

// GET /api/users/invites - List pending invites for current tenant
export async function GET() {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageUsers')
    if (permError) return permError

    // Get all non-accepted, non-expired invites
    const allInvites = await db
      .select()
      .from(staffInvites)
      .where(isNull(staffInvites.acceptedAt))
      .orderBy(sql`${staffInvites.createdAt} DESC`)

    // Filter to invites that include the current tenant
    const tenantId = session.user.tenantId
    const tenantInvites = allInvites.filter((invite) => {
      const assignments = invite.tenantAssignments as Array<{ tenantId: string; role: string }>
      return assignments.some(a => a.tenantId === tenantId)
    })

    // Enrich with status and role for this tenant
    const enriched = tenantInvites.map((invite) => {
      const assignments = invite.tenantAssignments as Array<{ tenantId: string; role: string }>
      const assignment = assignments.find(a => a.tenantId === tenantId)
      const isExpired = new Date(invite.expiresAt) < new Date()

      return {
        id: invite.id,
        email: invite.email,
        role: assignment?.role || 'unknown',
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
        status: isExpired ? 'expired' : 'pending',
      }
    })

    return NextResponse.json(enriched)
  } catch (error) {
    logError('api/users/invites', error)
    return NextResponse.json({ error: 'Failed to fetch invites' }, { status: 500 })
  }
}

// DELETE /api/users/invites?id=xxx - Cancel a pending invite
export async function DELETE(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageUsers')
    if (permError) return permError

    const { searchParams } = new URL(request.url)
    const inviteId = searchParams.get('id')

    if (!inviteId) {
      return NextResponse.json({ error: 'Invite ID is required' }, { status: 400 })
    }

    // Fetch the invite
    const invite = await db.query.staffInvites.findFirst({
      where: eq(staffInvites.id, inviteId),
    })

    if (!invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    if (invite.acceptedAt) {
      return NextResponse.json({ error: 'Cannot cancel an already accepted invite' }, { status: 400 })
    }

    // Verify the invite includes the current tenant
    const assignments = invite.tenantAssignments as Array<{ tenantId: string; role: string }>
    const hasTenant = assignments.some(a => a.tenantId === session.user.tenantId)

    if (!hasTenant) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    // If invite has multiple tenant assignments, only remove this tenant
    if (assignments.length > 1) {
      const updatedAssignments = assignments.filter(a => a.tenantId !== session.user.tenantId)
      await db.update(staffInvites)
        .set({ tenantAssignments: updatedAssignments })
        .where(eq(staffInvites.id, inviteId))
    } else {
      // Only one tenant — delete the invite entirely
      await db.delete(staffInvites).where(eq(staffInvites.id, inviteId))
    }

    logAndBroadcast(session.user.tenantId, 'staff-invite', 'deleted', inviteId, { userId: session.user.id })
    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/users/invites', error)
    return NextResponse.json({ error: 'Failed to cancel invite' }, { status: 500 })
  }
}
