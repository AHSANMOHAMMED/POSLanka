import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { db } from '@/lib/db'
import { staffInvites, tenants } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { requirePermission } from '@/lib/auth/roles'
import { sendStaffInviteEmail } from '@/lib/email/system-email'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST /api/users/invites/[id]/resend - Resend invite email and extend expiry
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageUsers')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Fetch the invite
    const invite = await db.query.staffInvites.findFirst({
      where: eq(staffInvites.id, id),
    })

    if (!invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    if (invite.acceptedAt) {
      return NextResponse.json({ error: 'Invite has already been accepted' }, { status: 400 })
    }

    // Verify the invite includes the current tenant
    const assignments = invite.tenantAssignments as Array<{ tenantId: string; role: string }>
    const assignment = assignments.find(a => a.tenantId === session.user.tenantId)

    if (!assignment) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    // Extend expiry by 7 days from now
    const newExpiry = new Date()
    newExpiry.setDate(newExpiry.getDate() + 7)

    await db.update(staffInvites)
      .set({ expiresAt: newExpiry })
      .where(eq(staffInvites.id, id))

    // Get tenant name for the email
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.id, session.user.tenantId),
    })

    // Re-send invite email
    const inviteUrl = `${process.env.NEXTAUTH_URL || ''}/invite/${invite.token}`
    try {
      await sendStaffInviteEmail({
        email: invite.email,
        inviterName: session.user.name || 'A team member',
        companyName: tenant?.name || session.user.tenantName || 'the company',
        role: assignment.role,
        inviteUrl,
      })
    } catch (emailError) {
      logError('api/users/invites/[id]/resend', emailError)
    }

    return NextResponse.json({
      success: true,
      expiresAt: newExpiry,
    })
  } catch (error) {
    logError('api/users/invites/[id]/resend', error)
    return NextResponse.json({ error: 'Failed to resend invite' }, { status: 500 })
  }
}
