import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { employeeProfiles, users } from '@/lib/db/schema'
import { ilike, sql, eq, and, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { toApiError } from '@/lib/db/errors'
import { mapUnmappedPunches, normalizeBiometricId } from '@/lib/attendance/ingest'
import { loadHrSettings } from '@/lib/attendance/settings'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { employeeProfilesListSchema, createEmployeeProfileSchema } from '@/lib/validation/schemas/hr'

// GET all employee profiles for the tenant (with pagination support)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageEmployees')
    if (permError) return permError

    const parsed = validateSearchParams(request, employeeProfilesListSchema)
    if (!parsed.success) return parsed.response
    const { all, page, pageSize, search, status } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause conditions
      const conditions = []

      if (status) {
        conditions.push(eq(employeeProfiles.employmentStatus, status))
      }

      if (search) {
        const escaped = escapeLikePattern(search)
        conditions.push(
          or(
            ilike(users.fullName, `%${escaped}%`),
            ilike(employeeProfiles.employeeCode, `%${escaped}%`)
          )
        )
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined

      // Return all employee profiles (for dropdowns)
      if (all) {
        const result = await db
          .select({
            id: employeeProfiles.id,
            tenantId: employeeProfiles.tenantId,
            userId: employeeProfiles.userId,
            employeeCode: employeeProfiles.employeeCode,
            employmentType: employeeProfiles.employmentType,
            employmentStatus: employeeProfiles.employmentStatus,
            department: employeeProfiles.department,
            designation: employeeProfiles.designation,
            hireDate: employeeProfiles.hireDate,
            baseSalary: employeeProfiles.baseSalary,
            salaryFrequency: employeeProfiles.salaryFrequency,
            biometricUserId: employeeProfiles.biometricUserId,
            defaultShiftId: employeeProfiles.defaultShiftId,
            warehouseId: employeeProfiles.warehouseId,
            otEligible: employeeProfiles.otEligible,
            otRateMultiplier: employeeProfiles.otRateMultiplier,
            hourlyRate: employeeProfiles.hourlyRate,
            createdAt: employeeProfiles.createdAt,
            updatedAt: employeeProfiles.updatedAt,
            // User info
            fullName: users.fullName,
            email: users.email,
            role: users.role,
          })
          .from(employeeProfiles)
          .leftJoin(users, eq(employeeProfiles.userId, users.id))
          .where(whereClause)
          .orderBy(users.fullName)
          .limit(1000)

        return NextResponse.json(result)
      }

      // Get total count
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(employeeProfiles)
        .leftJoin(users, eq(employeeProfiles.userId, users.id))
        .where(whereClause)

      const total = Number(count)
      const totalPages = Math.ceil(total / pageSize)
      const offset = (page - 1) * pageSize

      // Get paginated results with user info
      const result = await db
        .select({
          id: employeeProfiles.id,
          tenantId: employeeProfiles.tenantId,
          userId: employeeProfiles.userId,
          employeeCode: employeeProfiles.employeeCode,
          employmentType: employeeProfiles.employmentType,
          employmentStatus: employeeProfiles.employmentStatus,
          department: employeeProfiles.department,
          designation: employeeProfiles.designation,
          hireDate: employeeProfiles.hireDate,
          baseSalary: employeeProfiles.baseSalary,
          salaryFrequency: employeeProfiles.salaryFrequency,
          biometricUserId: employeeProfiles.biometricUserId,
          defaultShiftId: employeeProfiles.defaultShiftId,
          warehouseId: employeeProfiles.warehouseId,
          otEligible: employeeProfiles.otEligible,
          otRateMultiplier: employeeProfiles.otRateMultiplier,
          hourlyRate: employeeProfiles.hourlyRate,
          createdAt: employeeProfiles.createdAt,
          updatedAt: employeeProfiles.updatedAt,
          // User info
          fullName: users.fullName,
          email: users.email,
          role: users.role,
        })
        .from(employeeProfiles)
        .leftJoin(users, eq(employeeProfiles.userId, users.id))
        .where(whereClause)
        .orderBy(users.fullName)
        .limit(pageSize)
        .offset(offset)

      return NextResponse.json({
        data: result,
        pagination: { page, pageSize, total, totalPages },
      })
    })
  } catch (error) {
    logError('api/employee-profiles', error)
    return NextResponse.json({ error: 'Failed to fetch employee profiles' }, { status: 500 })
  }
}

// POST create new employee profile
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageEmployees')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createEmployeeProfileSchema, { keepEmptyStrings: true })
    if (!parsed.success) return parsed.response
    const {
      userId, employeeCode, employmentType, employmentStatus,
      department, designation, hireDate, confirmationDate,
      baseSalary, salaryFrequency,
      bankName, bankBranch, bankAccountNumber, bankAccountName, bankRoutingNumber,
      taxId, taxIdType, socialSecurityId, socialSecurityIdType,
      employerContributionId, employerContributionIdType,
      dateOfBirth, gender, emergencyContactName, emergencyContactPhone,
      address, notes,
      biometricUserId, defaultShiftId, warehouseId, otEligible, otRateMultiplier, hourlyRate,
    } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Check for duplicate userId (one profile per user per tenant, RLS scopes the query)
      const existingProfile = await db.query.employeeProfiles.findFirst({
        where: eq(employeeProfiles.userId, userId),
      })
      if (existingProfile) {
        return NextResponse.json({ error: 'An employee profile already exists for this user' }, { status: 400 })
      }

      const [newProfile] = await db.insert(employeeProfiles).values({
        tenantId: session.user.tenantId,
        userId,
        employeeCode: employeeCode || null,
        employmentType: employmentType || 'full_time',
        employmentStatus: employmentStatus || 'active',
        department: department || null,
        designation: designation || null,
        hireDate: hireDate || null,
        confirmationDate: confirmationDate || null,
        baseSalary: String(baseSalary),
        salaryFrequency: salaryFrequency || 'monthly',
        bankName: bankName || null,
        bankBranch: bankBranch || null,
        bankAccountNumber: bankAccountNumber || null,
        bankAccountName: bankAccountName || null,
        bankRoutingNumber: bankRoutingNumber || null,
        taxId: taxId || null,
        taxIdType: taxIdType || null,
        socialSecurityId: socialSecurityId || null,
        socialSecurityIdType: socialSecurityIdType || null,
        employerContributionId: employerContributionId || null,
        employerContributionIdType: employerContributionIdType || null,
        dateOfBirth: dateOfBirth || null,
        gender: gender || null,
        emergencyContactName: emergencyContactName || null,
        emergencyContactPhone: emergencyContactPhone || null,
        address: address || null,
        notes: notes || null,
        // Attendance (drizzle/0183)
        biometricUserId: normalizeBiometricId(biometricUserId),
        defaultShiftId: defaultShiftId || null,
        warehouseId: warehouseId || null,
        otEligible: otEligible ?? false,
        ...(otRateMultiplier !== undefined ? { otRateMultiplier: String(otRateMultiplier) } : {}),
        hourlyRate: hourlyRate === '' || hourlyRate == null ? null : String(hourlyRate),
      }).returning()

      if (newProfile.biometricUserId) {
        const { timezone } = await loadHrSettings(db, session.user.tenantId)
        await mapUnmappedPunches(db, session.user.tenantId, newProfile.biometricUserId, newProfile.id, timezone)
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session.user.tenantId, 'employee-profile', 'created', newProfile.id)

      return NextResponse.json(newProfile)
    })
  } catch (error) {
    const mapped = toApiError(error) // e.g. a fingerprint user id already used by another employee
    if (mapped) return mapped
    logError('api/employee-profiles', error)
    return NextResponse.json({ error: 'Failed to create employee profile' }, { status: 500 })
  }
}
