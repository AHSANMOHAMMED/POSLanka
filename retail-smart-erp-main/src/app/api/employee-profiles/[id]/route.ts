import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { employeeProfiles } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateEmployeeProfileSchema } from '@/lib/validation/schemas/hr'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single employee profile
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageEmployees')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const profile = await db.query.employeeProfiles.findFirst({
        where: eq(employeeProfiles.id, id),
        with: { user: true },
      })

      if (!profile) {
        return NextResponse.json({ error: 'Employee profile not found' }, { status: 404 })
      }

      return NextResponse.json(profile)
    })
  } catch (error) {
    logError('api/employee-profiles/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch employee profile' }, { status: 500 })
  }
}

// PUT update employee profile
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageEmployees')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateEmployeeProfileSchema)
    if (!parsed.success) return parsed.response
    const {
      employeeCode, employmentType, employmentStatus,
      department, designation, hireDate, confirmationDate, terminationDate,
      baseSalary, salaryFrequency,
      bankName, bankBranch, bankAccountNumber, bankAccountName, bankRoutingNumber,
      taxId, taxIdType, socialSecurityId, socialSecurityIdType,
      employerContributionId, employerContributionIdType,
      dateOfBirth, gender, emergencyContactName, emergencyContactPhone,
      address, notes, expectedUpdatedAt,
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Use transaction with FOR UPDATE to prevent race conditions
      const result = await db.transaction(async (tx) => {
        // Lock and get current profile (RLS scopes the query)
        const [currentProfile] = await tx
          .select()
          .from(employeeProfiles)
          .where(eq(employeeProfiles.id, id))
          .for('update')

        if (!currentProfile) {
          throw new Error('NOT_FOUND')
        }

        // Optimistic locking - check if record was modified since client fetched it
        if (expectedUpdatedAt) {
          const clientUpdatedAt = new Date(expectedUpdatedAt).getTime()
          const serverUpdatedAt = currentProfile.updatedAt ? new Date(currentProfile.updatedAt).getTime() : 0
          if (serverUpdatedAt > clientUpdatedAt) {
            throw new Error('CONFLICT')
          }
        }

        // Build update data - only include fields that were provided
        const updateData: Record<string, unknown> = {
          updatedAt: new Date(),
        }

        if (employeeCode !== undefined) updateData.employeeCode = employeeCode || null
        if (employmentType !== undefined) updateData.employmentType = employmentType
        if (employmentStatus !== undefined) updateData.employmentStatus = employmentStatus
        if (department !== undefined) updateData.department = department || null
        if (designation !== undefined) updateData.designation = designation || null
        if (hireDate !== undefined) updateData.hireDate = hireDate || null
        if (confirmationDate !== undefined) updateData.confirmationDate = confirmationDate || null
        if (terminationDate !== undefined) updateData.terminationDate = terminationDate || null
        if (baseSalary !== undefined) updateData.baseSalary = baseSalary ? String(baseSalary) : '0'
        if (salaryFrequency !== undefined) updateData.salaryFrequency = salaryFrequency
        if (bankName !== undefined) updateData.bankName = bankName || null
        if (bankBranch !== undefined) updateData.bankBranch = bankBranch || null
        if (bankAccountNumber !== undefined) updateData.bankAccountNumber = bankAccountNumber || null
        if (bankAccountName !== undefined) updateData.bankAccountName = bankAccountName || null
        if (bankRoutingNumber !== undefined) updateData.bankRoutingNumber = bankRoutingNumber || null
        if (taxId !== undefined) updateData.taxId = taxId || null
        if (taxIdType !== undefined) updateData.taxIdType = taxIdType || null
        if (socialSecurityId !== undefined) updateData.socialSecurityId = socialSecurityId || null
        if (socialSecurityIdType !== undefined) updateData.socialSecurityIdType = socialSecurityIdType || null
        if (employerContributionId !== undefined) updateData.employerContributionId = employerContributionId || null
        if (employerContributionIdType !== undefined) updateData.employerContributionIdType = employerContributionIdType || null
        if (dateOfBirth !== undefined) updateData.dateOfBirth = dateOfBirth || null
        if (gender !== undefined) updateData.gender = gender || null
        if (emergencyContactName !== undefined) updateData.emergencyContactName = emergencyContactName || null
        if (emergencyContactPhone !== undefined) updateData.emergencyContactPhone = emergencyContactPhone || null
        if (address !== undefined) updateData.address = address || null
        if (notes !== undefined) updateData.notes = notes || null

        const [updated] = await tx.update(employeeProfiles)
          .set(updateData)
          .where(eq(employeeProfiles.id, id))
          .returning()

        return updated
      })

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'employee-profile', 'updated', id)

      return NextResponse.json(result)
    })
  } catch (error) {
    logError('api/employee-profiles/[id]', error)
    const message = error instanceof Error ? error.message : ''

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Employee profile not found' }, { status: 404 })
    }
    if (message === 'CONFLICT') {
      return NextResponse.json({
        error: 'This employee profile was modified by another user. Please refresh and try again.',
        code: 'CONFLICT',
      }, { status: 409 })
    }

    return NextResponse.json({ error: 'Failed to update employee profile' }, { status: 500 })
  }
}

// DELETE employee profile (soft delete - set status to terminated)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageEmployees')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const [updated] = await db.update(employeeProfiles)
        .set({
          employmentStatus: 'terminated',
          terminationDate: new Date().toISOString().split('T')[0], // today's date as YYYY-MM-DD
          updatedAt: new Date(),
        })
        .where(eq(employeeProfiles.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Employee profile not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'employee-profile', 'updated', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/employee-profiles/[id]', error)
    return NextResponse.json({ error: 'Failed to delete employee profile' }, { status: 500 })
  }
}
