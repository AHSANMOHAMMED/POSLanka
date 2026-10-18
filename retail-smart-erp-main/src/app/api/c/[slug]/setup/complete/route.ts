import { NextRequest, NextResponse } from 'next/server'
import * as crypto from 'crypto'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { tenants, staffInvites, users, accounts, posProfileUsers } from '@/lib/db/schema'
import { eq, and, isNull, gt } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { createSeedData } from '@/lib/setup/create-seed-data'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'
import { logError } from '@/lib/ai/error-logger'
import { sendStaffInviteEmail } from '@/lib/email/system-email'
import type { UserRole } from '@/lib/auth/roles'
import { validateBody } from '@/lib/validation/helpers'
import { setupCompleteSchema } from '@/lib/validation/schemas/settings'
import { requireQuota } from '@/lib/db/storage-quota'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { slug } = await params

    const parsed = await validateBody(request, setupCompleteSchema)
    if (!parsed.success) return parsed.response
    const body = parsed.data

    // Execute everything in a transaction with FOR UPDATE lock to prevent double-submission
    const transactionResult = await db.transaction(async (tx) => {
      // Set tenant context for RLS
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', '', true)`
      )

      // Find and lock the tenant row to prevent concurrent setup
      const [tenant] = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.slug, slug))
        .for('update')

      if (!tenant) {
        throw new Error('NOT_FOUND')
      }

      // Check if setup is already completed (inside transaction with lock)
      if (tenant.setupCompletedAt) {
        throw new Error('ALREADY_COMPLETED')
      }

      // Set the actual tenant context for RLS before querying tenant-scoped tables
      await tx.execute(
        sql`SELECT set_config('app.tenant_id', ${tenant.id}, true)`
      )

      // Verify the user is an owner of this tenant
      const ownerUser = await tx.query.users.findFirst({
        where: and(
          eq(users.id, session.user.id),
          eq(users.tenantId, tenant.id),
          eq(users.isActive, true)
        ),
      })

      if (!ownerUser || ownerUser.role !== 'owner') {
        throw new Error('FORBIDDEN')
      }

      // Check storage quota before creating seed data
      const quotaError = await requireQuota(tenant.id, 'essential')
      if (quotaError) throw new Error('QUOTA_EXCEEDED')

      // Build wizard data from validated body
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bodyAny = body as any
      const wizardData: SetupWizardData = {
        taxRate: body.taxRate,
        taxInclusive: body.taxInclusive,
        logoUrl: body.logoUrl || '',
        timezone: body.timezone,
        coaTemplate: (body.coaTemplate || 'numbered') as 'numbered' | 'unnumbered',
        fiscalYearStart: body.fiscalYearStart,
        fiscalYearEnd: body.fiscalYearEnd,
        fiscalYearName: body.fiscalYearName,
        selectedCategories: (body.selectedCategories || []) as string[],
        numberOfTables: body.numberOfTables,
        tableAreas: bodyAny.tableAreas,
        selectedServiceGroups: bodyAny.selectedServiceGroups,
        defaultLaborRate: body.defaultLaborRate,
        warehouses: bodyAny.warehouses,
        warehouseName: body.warehouseName || 'Main Warehouse',
        costCenters: bodyAny.costCenters,
        defaultCostCenter: body.defaultCostCenter,
        bankAccounts: body.bankAccounts
          ?.filter(ba => ba.accountName) // Skip entries with no account name
          .map(ba => ({
            accountName: ba.accountName || '',
            bankName: ba.bankName || '',
            accountNumber: ba.accountNumber || '',
            branchCode: ba.branchCode,
            isDefault: ba.isDefault || false,
          })),
        accountOverrides: body.accountOverrides,
        paymentMethods: body.paymentMethods || ['cash'],
        posProfileName: body.posProfileName || 'Default POS',
        receiptFormat: body.receiptFormat || '80mm',
        posWarehouseName: body.posWarehouseName,
        posCostCenter: body.posCostCenter,
      }

      const seedResult = await createSeedData(
        tx,
        tenant.id,
        tenant.businessType, // Always use tenant's actual business type
        wizardData,
        tenant.currency,
        ownerUser.id
      )

      // Process user invitations after setup data is created
      const createdUserIds: string[] = []
      if (body.users) {
        const usersData = body.users

        for (const userData of usersData) {
          const email = userData.email?.toLowerCase().trim()
          if (!email) continue
          const userRole = (userData.role || 'cashier') as UserRole // Default role if missing

          // Check if user already exists in this tenant (RLS scoped)
          const existingUser = await tx.query.users.findFirst({
            where: eq(users.email, email),
          })

          if (existingUser) {
            // User already exists in this tenant, skip
            continue
          }

          // Check if a global account exists
          const existingAccount = await tx.query.accounts.findFirst({
            where: eq(accounts.email, email),
          })

          if (existingAccount) {
            // Account exists — add user record
            const [newUser] = await tx.insert(users).values({
              tenantId: tenant.id,
              accountId: existingAccount.id,
              email: email,
              fullName: existingAccount.fullName || email,
              passwordHash: existingAccount.passwordHash || '',
              role: userRole,
              isActive: true,
            }).returning()

            createdUserIds.push(newUser.id)
          } else if (userData.sendInvite !== false) {
            // No account exists — create invitation
            // Check for existing pending invite to the same email
            const existingInvite = await tx.query.staffInvites.findFirst({
              where: and(
                eq(staffInvites.email, email),
                isNull(staffInvites.acceptedAt),
                gt(staffInvites.expiresAt, new Date())
              ),
            })

            if (existingInvite) {
              // Check if this invite already includes the current tenant
              const assignments = existingInvite.tenantAssignments as Array<{ tenantId: string; role: string }>
              const alreadyInvited = assignments.some(a => a.tenantId === tenant.id)
              if (alreadyInvited) {
                continue // Already invited
              }

              // Add this tenant to existing invite
              const updatedAssignments = [...assignments, { tenantId: tenant.id, role: userRole }]
              await tx.update(staffInvites)
                .set({ tenantAssignments: updatedAssignments })
                .where(eq(staffInvites.id, existingInvite.id))
            } else {
              // Generate new invite token
              const token = crypto.randomBytes(32).toString('hex')
              const expiresAt = new Date()
              expiresAt.setDate(expiresAt.getDate() + 7)

              await tx.insert(staffInvites).values({
                email: email,
                token,
                tenantAssignments: [{ tenantId: tenant.id, role: userRole }],
                invitedBy: session.user.accountId || session.user.id,
                expiresAt,
              })
            }
          }
        }
      }

      // Assign newly created users to the default POS profile
      if (createdUserIds.length > 0 && seedResult.posProfileId) {
        for (const userId of createdUserIds) {
          await tx.insert(posProfileUsers).values({
            tenantId: tenant.id,
            posProfileId: seedResult.posProfileId,
            userId,
            isDefault: false,
          })
        }
      }

      return { seedResult, tenant }
    })

    // Post-transaction: send invitation emails
    const failedInvites: string[] = []
    if (body.users) {
      const usersData = body.users

      for (const userData of usersData) {
        const email = userData.email?.toLowerCase().trim()
        if (!email || userData.sendInvite === false) continue

        // Check if this user needed an invitation (no existing account)
        const existingAccount = await db.query.accounts.findFirst({
          where: eq(accounts.email, email),
        })

        if (!existingAccount) {
          // Find the latest invite for this email
          const invite = await db.query.staffInvites.findFirst({
            where: and(
              eq(staffInvites.email, email),
              isNull(staffInvites.acceptedAt),
              gt(staffInvites.expiresAt, new Date())
            ),
            orderBy: (staffInvites, { desc }) => [desc(staffInvites.createdAt)],
          })

          if (invite) {
            const inviteUrl = `${process.env.NEXTAUTH_URL || ''}/invite/${invite.token}`
            try {
              await sendStaffInviteEmail({
                email: email,
                inviterName: session.user?.name || 'A team member',
                companyName: transactionResult.tenant?.name || 'the company',
                role: userData.role || 'cashier',
                inviteUrl,
              })
            } catch (emailError) {
              logError('api/c/[slug]/setup/complete/invite-email', emailError)
              failedInvites.push(email)
              // Don't fail the setup if email fails
            }
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      warehouseId: transactionResult.seedResult.warehouseId,
      posProfileId: transactionResult.seedResult.posProfileId,
      ...(failedInvites.length > 0 && { failedInvites }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }
    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Only the business owner can complete setup' }, { status: 403 })
    }
    if (message === 'ALREADY_COMPLETED') {
      return NextResponse.json({ error: 'Setup already completed' }, { status: 400 })
    }
    if (message === 'QUOTA_EXCEEDED') {
      return NextResponse.json({ error: 'Storage quota exceeded. Please upgrade your plan.' }, { status: 402 })
    }

    // Log detailed error for debugging
    console.error('Setup transaction failed:', error)

    logError('api/c/[slug]/setup/complete', error)
    return NextResponse.json(
      { error: 'Setup failed. Please try again. Details have been logged.' },
      { status: 500 }
    )
  }
}
