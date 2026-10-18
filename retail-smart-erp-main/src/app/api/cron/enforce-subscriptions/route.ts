import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tenants, subscriptions, lockoutEvents, accountNotifications } from '@/lib/db/schema'
import { eq, and, lt, isNull, isNotNull, sql, or } from 'drizzle-orm'
import { cascadeDeleteTenant } from '@/lib/billing/delete-tenant'
import { logError } from '@/lib/ai/error-logger'

// POST /api/cron/enforce-subscriptions
// Runs every 6 hours to enforce subscription limits and lockouts
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = new Date()
    const stats = {
      trialsExpired: 0,
      subscriptionsExpired: 0,
      storageLocked: 0,
      companiesDeleted: 0,
      warningsSent: 0,
    }

    // 1. Expire trials: status='trial' AND trialEndsAt IS NOT NULL AND trialEndsAt < NOW()
    // Free companies have trialEndsAt=null and are never expired
    const expiredTrials = await db
      .select({
        id: subscriptions.id,
        tenantId: subscriptions.tenantId,
        billingAccountId: subscriptions.billingAccountId,
      })
      .from(subscriptions)
      .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
      .where(and(
        eq(subscriptions.status, 'trial'),
        isNotNull(subscriptions.trialEndsAt),
        lt(subscriptions.trialEndsAt, now),
        eq(tenants.status, 'active'), // Only lock active tenants
      ))

    for (const trial of expiredTrials) {
      const deletionDate = new Date(now)
      deletionDate.setDate(deletionDate.getDate() + 7)

      await db.transaction(async (tx) => {
        // Set tenant context for RLS on lockout_events
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${trial.tenantId}, true)`)

        await tx.update(tenants).set({
          status: 'locked',
          lockedAt: now,
          lockedReason: 'trial_expired',
          deletionScheduledAt: deletionDate,
          updatedAt: now,
        }).where(eq(tenants.id, trial.tenantId))

        await tx.update(subscriptions).set({
          status: 'locked',
          updatedAt: now,
        }).where(eq(subscriptions.id, trial.id))

        await tx.insert(lockoutEvents).values({
          tenantId: trial.tenantId,
          eventType: 'trial_expired',
          details: { trialEndedAt: now.toISOString(), deletionScheduledAt: deletionDate.toISOString() },
          notificationSent: true,
        })
      })

      await db.insert(accountNotifications).values({
        accountId: trial.billingAccountId,
        type: 'subscription',
        title: 'Subscription Expired',
        message: 'Your subscription has expired. Upgrade to a paid plan to keep your data.',
        link: `/account/subscription/${trial.tenantId}`,
      })

      stats.trialsExpired++
    }

    // 2. Expire paid subscriptions: status='active' AND currentPeriodEnd < NOW() - 3 days grace
    const threeDaysAgo = new Date(now)
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

    const expiredSubs = await db
      .select({
        id: subscriptions.id,
        tenantId: subscriptions.tenantId,
        billingAccountId: subscriptions.billingAccountId,
      })
      .from(subscriptions)
      .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
      .where(and(
        eq(subscriptions.status, 'active'),
        lt(subscriptions.currentPeriodEnd, threeDaysAgo),
        eq(tenants.status, 'active'),
      ))

    for (const sub of expiredSubs) {
      const deletionDate = new Date(now)
      deletionDate.setDate(deletionDate.getDate() + 7)

      await db.transaction(async (tx) => {
        // Set tenant context for RLS on lockout_events
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${sub.tenantId}, true)`)

        await tx.update(tenants).set({
          status: 'locked',
          lockedAt: now,
          lockedReason: 'subscription_expired',
          deletionScheduledAt: deletionDate,
          updatedAt: now,
        }).where(eq(tenants.id, sub.tenantId))

        await tx.update(subscriptions).set({
          status: 'locked',
          updatedAt: now,
        }).where(eq(subscriptions.id, sub.id))

        await tx.insert(lockoutEvents).values({
          tenantId: sub.tenantId,
          eventType: 'subscription_expired',
          details: { lockedAt: now.toISOString(), deletionScheduledAt: deletionDate.toISOString() },
          notificationSent: true,
        })
      })

      await db.insert(accountNotifications).values({
        accountId: sub.billingAccountId,
        type: 'subscription',
        title: 'Subscription Expired',
        message: 'Your subscription has expired after the grace period. Renew to restore access.',
        link: `/account/subscription/${sub.tenantId}`,
      })

      stats.subscriptionsExpired++
    }

    // 3. Set past_due for subscriptions just past their period end (within grace period)
    await db.update(subscriptions).set({
      status: 'past_due',
      updatedAt: now,
    }).where(and(
      eq(subscriptions.status, 'active'),
      lt(subscriptions.currentPeriodEnd, now),
    ))

    // 4. Delete locked companies past their deletion date
    const deletableTenants = await db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(and(
        eq(tenants.status, 'locked'),
        lt(tenants.deletionScheduledAt, now),
      ))

    for (const tenant of deletableTenants) {
      try {
        await db.transaction(async (tx) => {
          // Set tenant context for RLS on lockout_events
          await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant.id}, true)`)

          await tx.insert(lockoutEvents).values({
            tenantId: tenant.id,
            eventType: 'deleted',
            details: { deletedAt: now.toISOString(), tenantName: tenant.name },
            notificationSent: false,
          })
        })

        await cascadeDeleteTenant(tenant.id)
        stats.companiesDeleted++
      } catch (error) {
        logError('api/cron/enforce-subscriptions', error)
      }
    }

    // 5. Send subscription expiring warnings (2 days before expiry)
    // Only warn if trialEndsAt is set (free companies have null and never expire)
    const twoDaysFromNow = new Date(now)
    twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2)

    const expiringTrials = await db
      .select({
        tenantId: subscriptions.tenantId,
        billingAccountId: subscriptions.billingAccountId,
        trialEndsAt: subscriptions.trialEndsAt,
      })
      .from(subscriptions)
      .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
      .where(and(
        eq(subscriptions.status, 'trial'),
        isNotNull(subscriptions.trialEndsAt),
        lt(subscriptions.trialEndsAt, twoDaysFromNow),
        eq(tenants.status, 'active'),
        or(
          isNull(tenants.lastWarningSentAt),
          lt(tenants.lastWarningSentAt, sql`NOW() - INTERVAL '1 day'`)
        ),
      ))

    for (const trial of expiringTrials) {
      await db.transaction(async (tx) => {
        // Set tenant context for RLS on lockout_events
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${trial.tenantId}, true)`)

        await tx.insert(lockoutEvents).values({
          tenantId: trial.tenantId,
          eventType: 'trial_expiring',
          details: { trialEndsAt: trial.trialEndsAt?.toISOString() },
          notificationSent: true,
        })
      })

      await db.insert(accountNotifications).values({
        accountId: trial.billingAccountId,
        type: 'subscription',
        title: 'Subscription Expiring Soon',
        message: 'Your subscription expires in 2 days. Upgrade now to keep your data.',
        link: `/account/subscription/${trial.tenantId}`,
      })

      await db.update(tenants).set({
        lastWarningSentAt: now,
      }).where(eq(tenants.id, trial.tenantId))

      stats.warningsSent++
    }

    // 6. Send deletion warnings (4 days after lock = 3 days before deletion)
    const fourDaysAgoDate = new Date(now)
    fourDaysAgoDate.setDate(fourDaysAgoDate.getDate() - 4)

    const deletionWarningTenants = await db
      .select({
        id: tenants.id,
        primaryOwnerId: tenants.primaryOwnerId,
      })
      .from(tenants)
      .where(and(
        eq(tenants.status, 'locked'),
        lt(tenants.lockedAt, fourDaysAgoDate),
        or(
          isNull(tenants.lastWarningSentAt),
          lt(tenants.lastWarningSentAt, sql`NOW() - INTERVAL '1 day'`)
        ),
      ))

    for (const t of deletionWarningTenants) {
      if (t.primaryOwnerId) {
        await db.transaction(async (tx) => {
          // Set tenant context for RLS on lockout_events
          await tx.execute(sql`SELECT set_config('app.tenant_id', ${t.id}, true)`)

          await tx.insert(lockoutEvents).values({
            tenantId: t.id,
            eventType: 'deletion_warning',
            notificationSent: true,
          })
        })

        await db.insert(accountNotifications).values({
          accountId: t.primaryOwnerId,
          type: 'subscription',
          title: 'Data Deletion Warning',
          message: 'Your company data will be permanently deleted in 3 days. Upgrade now to prevent data loss.',
          link: `/account/subscription/${t.id}`,
        })

        await db.update(tenants).set({
          lastWarningSentAt: now,
        }).where(eq(tenants.id, t.id))

        stats.warningsSent++
      }
    }

    return NextResponse.json({
      success: true,
      stats,
      executedAt: now.toISOString(),
    })
  } catch (error) {
    logError('api/cron/enforce-subscriptions', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
