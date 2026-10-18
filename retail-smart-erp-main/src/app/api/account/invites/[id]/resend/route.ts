import { NextRequest, NextResponse } from 'next/server'
import { accountAuth as auth } from '@/lib/auth/account-auth'
import { db } from '@/lib/db'
import { staffInvites, tenants } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { sendStaffInviteEmail } from '@/lib/email/system-email'
import { logError } from '@/lib/ai/error-logger'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// POST /api/account/invites/[id]/resend - Resend invite email (account-level)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.accountId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Fetch the invite - must have been sent by this account
    const invite = await db.query.staffInvites.findFirst({
      where: eq(staffInvites.id, id),
    })

    if (!invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    // Verify the invite was sent by this account
    if (invite.invitedBy !== session.user.accountId) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
    }

    if (invite.acceptedAt) {
      return NextResponse.json({ error: 'Invite has already been accepted' }, { status: 400 })
    }

    // Extend expiry by 7 days from now
    const newExpiry = new Date()
    newExpiry.setDate(newExpiry.getDate() + 7)

    await db.update(staffInvites)
      .set({ expiresAt: newExpiry })
      .where(eq(staffInvites.id, id))

    // Send invite email for each tenant assignment
    const assignments = invite.tenantAssignments as Array<{ tenantId: string; role: string }>
    const inviteUrl = `${process.env.NEXTAUTH_URL || ''}/invite/${invite.token}`

    for (const assignment of assignments) {
      const tenant = await db.query.tenants.findFirst({
        where: eq(tenants.id, assignment.tenantId),
      })

      try {
        await sendStaffInviteEmail({
          email: invite.email,
          inviterName: session.user.name || 'A team member',
          companyName: tenant?.name || 'the company',
          role: assignment.role,
          inviteUrl,
        })
      } catch (emailError) {
        logError('api/account/invites/[id]/resend', emailError)
      }
    }

    return NextResponse.json({
      success: true,
      expiresAt: newExpiry,
    })
  } catch (error) {
    logError('api/account/invites/[id]/resend', error)
    return NextResponse.json({ error: 'Failed to resend invite' }, { status: 500 })
  }
}
