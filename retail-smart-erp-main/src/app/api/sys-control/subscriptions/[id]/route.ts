import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { subscriptions, tenants, lockoutEvents } from '@/lib/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { adminAuthError, adminAudit, withRateLimit, STRICT_LIMIT, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { sysUpdateSubscriptionSchema } from '@/lib/validation/schemas/sys-control'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { resumedSubscriptionStatus, syncTenantPlanExpiry } from '@/lib/billing/subscription-state'
import { invalidatePermissionCache } from '@/lib/auth/permission-cache'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Rate limiting
    const rateLimited = await withRateLimit('/api/sys-control/subscriptions', STRICT_LIMIT)
    if (rateLimited) return rateLimited

    const session = await validateAdminSession('billing')
    if (!session) {
      return adminAuthError()
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, sysUpdateSubscriptionSchema)
    if (!parsed.success) return parsed.response
    const { extendMonths, adjustMonths, setEndDate, reason, status, overrideDatabaseBytes, overrideFileStorageBytes, lock, unlock, unlockGrantMonths, lockReason } = parsed.data

    // Get the subscription
    const subscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, id),
      with: { tenant: true },
    })

    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    }

    const tenant = Array.isArray(subscription.tenant) ? subscription.tenant[0] : subscription.tenant
    const auditDetails: Record<string, unknown> = {
      tenantId: subscription.tenantId,
      tenantName: tenant?.name,
    }

    // Use a transaction for lock/unlock to ensure atomicity
    // and set tenant context for RLS on lockout_events table
    if (unlock) {
      // Free time is an explicit choice of the admin (unlockGrantMonths); by default the
      // subscription simply resumes on its own dates and is never resurrected as "active".
      const grantMonths = unlockGrantMonths ?? 0
      if (grantMonths > 0) {
        const now = new Date()
        const newEnd = new Date(now)
        newEnd.setMonth(newEnd.getMonth() + grantMonths)
        updateData.status = 'active'
        updateData.currentPeriodStart = now
        updateData.currentPeriodEnd = newEnd
        auditDetails.grantedMonths = grantMonths
        auditDetails.newPeriodEnd = newEnd.toISOString()
      } else {
        updateData.status = resumedSubscriptionStatus(subscription)
        auditDetails.grantedMonths = 0
      }
      auditDetails.action = 'unlock'
      auditDetails.reason = reason || null
      auditDetails.statusChange = { from: subscription.status, to: updateData.status }

      await db.transaction(async (tx) => {
        // Set tenant context for RLS on lockout_events
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${subscription.tenantId}, true)`)

        // Clear lockout fields on tenant
        await tx.update(tenants)
          .set({
            status: 'active',
            lockedAt: null,
            lockedReason: null,
            deletionScheduledAt: null,
          })
          .where(and(eq(tenants.id, subscription.tenantId), eq(tenants.status, 'locked')))

        // Log the unlock event
        await tx.insert(lockoutEvents).values({
          tenantId: subscription.tenantId,
          eventType: 'unlocked',
          details: { unlockedBy: 'admin', adminId: session.superAdminId, grantedMonths: unlockGrantMonths ?? 0 },
          notificationSent: false,
        })

        // Update subscription status within the same transaction
        await tx.update(subscriptions)
          .set(updateData)
          .where(eq(subscriptions.id, id))
      })
    } else if (lock) {
      updateData.status = 'locked'
      auditDetails.action = 'lock'
      auditDetails.lockReason = lockReason || reason || 'admin_action'
      auditDetails.statusChange = { from: subscription.status, to: 'locked' }

      await db.transaction(async (tx) => {
        // Set tenant context for RLS on lockout_events
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${subscription.tenantId}, true)`)

        await tx.update(tenants)
          .set({
            status: 'locked',
            lockedAt: new Date(),
            lockedReason: 'admin_locked', // the free-text reason goes to the audit log / lockout event
            // A manual lock never schedules the automatic data deletion that billing lockouts do.
            deletionScheduledAt: null,
          })
          .where(eq(tenants.id, subscription.tenantId))

        await tx.insert(lockoutEvents).values({
          tenantId: subscription.tenantId,
          eventType: 'locked',
          details: { lockedBy: 'admin', adminId: session.superAdminId, reason: lockReason || reason || 'admin_action' },
          notificationSent: false,
        })

        // Update subscription status within the same transaction
        await tx.update(subscriptions)
          .set(updateData)
          .where(eq(subscriptions.id, id))
      })
    } else {
      // Non-lock/unlock operations (extend, status change, storage overrides)

      // Extend subscription period (legacy: extendMonths)
      const monthsToAdjust = adjustMonths ?? (extendMonths && extendMonths > 0 ? extendMonths : null)

      if (setEndDate) {
        // Set exact end date
        const newEnd = new Date(setEndDate)
        const now = new Date()

        if (newEnd.getTime() < now.getTime()) {
          return NextResponse.json({ error: 'End date cannot be in the past' }, { status: 400 })
        }

        updateData.currentPeriodEnd = newEnd
        auditDetails.setEndDate = newEnd.toISOString()
        auditDetails.previousEndDate = subscription.currentPeriodEnd
        if (reason) auditDetails.reason = reason

        // If in trial, also update trial end
        if (subscription.status === 'trial') {
          updateData.trialEndsAt = newEnd
        }

        // Reactivate if inactive
        if (['past_due', 'cancelled', 'locked'].includes(subscription.status)) {
          updateData.status = 'active'
          updateData.currentPeriodStart = now
          auditDetails.reactivated = true

          if (subscription.status === 'locked') {
            await db.update(tenants)
              .set({
                status: 'active',
                lockedAt: null,
                lockedReason: null,
                deletionScheduledAt: null,
              })
              .where(and(eq(tenants.id, subscription.tenantId), eq(tenants.status, 'locked')))
          }
        }
      } else if (monthsToAdjust !== null && monthsToAdjust !== undefined && monthsToAdjust !== 0) {
        const now = new Date()
        const currentEnd = subscription.currentPeriodEnd
          ? new Date(subscription.currentPeriodEnd)
          : now

        const newEnd = new Date(Math.max(currentEnd.getTime(), now.getTime()))
        newEnd.setMonth(newEnd.getMonth() + monthsToAdjust)

        // Validate the new end date is not in the past
        if (newEnd.getTime() < now.getTime()) {
          return NextResponse.json({ error: 'Resulting end date would be in the past' }, { status: 400 })
        }

        updateData.currentPeriodEnd = newEnd
        auditDetails.adjustMonths = monthsToAdjust
        auditDetails.previousEndDate = subscription.currentPeriodEnd
        auditDetails.newEndDate = newEnd.toISOString()
        if (reason) auditDetails.reason = reason

        // If in trial, also adjust trial end
        if (subscription.status === 'trial' && subscription.trialEndsAt) {
          const trialEnd = new Date(subscription.trialEndsAt)
          trialEnd.setMonth(trialEnd.getMonth() + monthsToAdjust)
          updateData.trialEndsAt = trialEnd
        }

        // If subscription was past_due, cancelled, or locked, reactivate it
        if (['past_due', 'cancelled', 'locked'].includes(subscription.status) && monthsToAdjust > 0) {
          updateData.status = 'active'
          updateData.currentPeriodStart = now
          auditDetails.reactivated = true

          // Also clear lockout on tenant if it was locked
          if (subscription.status === 'locked') {
            await db.update(tenants)
              .set({
                status: 'active',
                lockedAt: null,
                lockedReason: null,
                deletionScheduledAt: null,
              })
              .where(and(eq(tenants.id, subscription.tenantId), eq(tenants.status, 'locked')))
          }
        }
      }

      // Update status if provided
      if (status) {
        auditDetails.statusChange = { from: subscription.status, to: status }
        updateData.status = status
      }

      // Storage overrides
      if (overrideDatabaseBytes !== undefined) {
        updateData.overrideDatabaseBytes = overrideDatabaseBytes
        auditDetails.overrideDatabaseBytes = overrideDatabaseBytes
      }
      if (overrideFileStorageBytes !== undefined) {
        updateData.overrideFileStorageBytes = overrideFileStorageBytes
        auditDetails.overrideFileStorageBytes = overrideFileStorageBytes
      }

      await db.update(subscriptions)
        .set(updateData)
        .where(eq(subscriptions.id, id))
    }

    // Keep the sign-in cut-off in step with the period we just changed
    await syncTenantPlanExpiry(subscription.tenantId)

    // Audit log
    if (unlock || lock) {
      await adminAudit.update(session.superAdminId, 'subscription', id, auditDetails)
    } else if (adjustMonths || setEndDate || extendMonths) {
      await adminAudit.extend(session.superAdminId, 'subscription', id, auditDetails)
    } else if (status || overrideDatabaseBytes !== undefined || overrideFileStorageBytes !== undefined) {
      await adminAudit.update(session.superAdminId, 'subscription', id, auditDetails)
    }

    // Lock/unlock changes whether staff may sign in: drop cached session checks (after commit)
    invalidatePermissionCache(subscription.tenantId)
    return NextResponse.json({ success: true })
  } catch (error) {
    logError('api/sys-control/subscriptions/[id]', error)
    return NextResponse.json({ error: 'Failed to update subscription' }, { status: 500 })
  }
}
