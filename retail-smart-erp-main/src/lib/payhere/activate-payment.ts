/**
 * Apply a successful PayHere payment exactly once, even when the notification is retried.
 *
 * payhere_transactions.activated_at records that the payment's effect (subscription renewal /
 * upgrade, wallet debit, tenant unlock, or company creation) has been applied. The renewal path
 * runs in ONE database transaction together with setting activated_at while the transaction row
 * is locked (FOR UPDATE), so it is all-or-nothing and concurrent notifications serialize.
 * Company creation (activateCompanyFromPending) is itself atomic and guarded by the pending
 * row's status, so it runs first and a retry after a partial failure is safe.
 *
 * A payment that is `success` but not activated (activation threw) is therefore retried by
 * the next PayHere notification and by the enforce-subscriptions cron
 * (retryUnactivatedPayments) — "paid but not activated" cannot stay that way.
 */
import { db } from '@/lib/db'
import { payhereTransactions, subscriptions, tenants, pendingCompanies, pricingTiers, accounts, creditTransactions } from '@/lib/db/schema'
import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import { getNextPeriodDates, renewalStartDate } from '@/lib/billing/proration'
import { syncTenantPlanExpiry } from '@/lib/billing/subscription-state'
import { activateCompanyFromPending, ActivationError } from '@/lib/billing/activate-company'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { recordCouponRedemption } from '@/lib/billing/coupons'

type PaymentTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface ActivationOutcome {
  activated: boolean
  /** true when an earlier call already applied it */
  alreadyActivated: boolean
}

/**
 * Apply the payment of a `success` transaction once. Throws when activation fails (the caller
 * answers 500 so PayHere retries; activated_at stays NULL).
 */
export async function activatePaidTransaction(transactionId: string): Promise<ActivationOutcome> {
  const current = await db.query.payhereTransactions.findFirst({ where: eq(payhereTransactions.id, transactionId) })
  if (!current || current.status !== 'success') return { activated: false, alreadyActivated: false }
  if (current.activatedAt) return { activated: false, alreadyActivated: true }

  const billingCycle = (current.billingCycle || 'monthly') as 'monthly' | 'yearly'

  // Case 2 first: company creation is atomic + status-guarded (safe to repeat)
  if (current.pendingCompanyId) {
    const pending = await db.query.pendingCompanies.findFirst({
      where: eq(pendingCompanies.id, current.pendingCompanyId),
    })
    if (pending && pending.status === 'pending_payment') {
      try {
        await activateCompanyFromPending(pending, billingCycle)
      } catch (err) {
        // A concurrent notification won the race: the company exists, nothing left to do here
        if (!(err instanceof ActivationError && err.code === 'ALREADY_PROCESSED')) throw err
      }
    }
  }

  const broadcasts: Array<() => void> = []
  const applied = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(payhereTransactions)
      .where(eq(payhereTransactions.id, transactionId))
      .for('update')
    if (!locked || locked.status !== 'success' || locked.activatedAt) return false
    if (locked.subscriptionId) {
      await applySubscriptionPayment(tx, locked, billingCycle, broadcasts)
    }
    // Promo code: one use, counted with the payment (unique per transaction — retries are no-ops)
    if (locked.couponCode) {
      await recordCouponRedemption(tx, {
        couponId: locked.couponId,
        couponCode: locked.couponCode,
        accountId: locked.accountId,
        source: 'payhere',
        payhereTransactionId: locked.id,
        subscriptionId: locked.subscriptionId,
        listAmount: locked.listAmount ?? (Number(locked.amount) + Number(locked.discountAmount || 0) + Number(locked.walletCreditApplied || 0)),
        discountAmount: locked.discountAmount || 0,
        paidAmount: Number(locked.amount) + Number(locked.walletCreditApplied || 0),
      })
    }
    await tx.update(payhereTransactions)
      .set({ activatedAt: new Date(), updatedAt: new Date() })
      .where(eq(payhereTransactions.id, transactionId))
    return true
  })
  if (applied) broadcasts.forEach((fn) => fn())
  return { activated: applied, alreadyActivated: !applied }
}

async function applySubscriptionPayment(
  tx: PaymentTx,
  transaction: {
    accountId: string
    subscriptionId: string | null
    newTierId: string | null
    walletCreditApplied: string | null
  },
  billingCycle: 'monthly' | 'yearly',
  broadcasts: Array<() => void>,
): Promise<void> {
  const subscription = await tx.query.subscriptions.findFirst({
    where: eq(subscriptions.id, transaction.subscriptionId!),
  })
  if (!subscription) return
  const now = new Date()

  // If this is a prorated upgrade (newTierId set), apply the tier change
  // and keep the current period dates (customer already paid for this period).
  // For renewals (no newTierId), start a new billing period.
  const isUpgradePayment = !!transaction.newTierId

  const updateData: Record<string, unknown> = {
    status: 'active',
    billingCycle,
    lastPaymentAt: now,
    updatedAt: now,
  }

  if (isUpgradePayment) {
    // Prorated upgrade: apply new tier AND lock in its price — otherwise the next renewal
    // checkout would charge the old (cheaper) grandfathered price for the new plan.
    updateData.tierId = transaction.newTierId
    const newTier = await tx.query.pricingTiers.findFirst({
      where: eq(pricingTiers.id, transaction.newTierId!),
      columns: { priceMonthly: true, priceYearly: true },
    })
    if (newTier) {
      updateData.subscribedPriceMonthly = newTier.priceMonthly
      updateData.subscribedPriceYearly = newTier.priceYearly
      updateData.priceLockedAt = now
    }
    // Trial → paid (full price, no proration) or a lapsed period: the payment buys a
    // fresh billing period. A prorated mid-period upgrade keeps the current period.
    const periodEnd = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null
    if (subscription.status === 'trial' || !periodEnd || periodEnd.getTime() <= now.getTime()) {
      const { periodStart, periodEnd: nextEnd } = getNextPeriodDates(now, billingCycle)
      updateData.currentPeriodStart = periodStart
      updateData.currentPeriodEnd = nextEnd
      updateData.trialEndsAt = null
    }
  } else {
    // Renewal: next period starts when the current one ends (early renewal keeps the
    // remaining days), or now if it already lapsed.
    const { periodStart, periodEnd } = getNextPeriodDates(renewalStartDate(now, subscription), billingCycle)
    updateData.currentPeriodStart = periodStart
    updateData.currentPeriodEnd = periodEnd
    if (subscription.status === 'trial') updateData.trialEndsAt = null
  }

  // Wallet part of a split upgrade payment — deducted only now that the card payment
  // succeeded (the upgrade route no longer pre-deducts it).
  const walletPart = Number(transaction.walletCreditApplied || 0)
  if (walletPart > 0) {
    const [acc] = await tx.update(accounts)
      .set({
        walletBalance: sql`${accounts.walletBalance} - least(${accounts.walletBalance}, ${walletPart.toFixed(2)}::numeric)`,
        updatedAt: now,
      })
      .where(eq(accounts.id, transaction.accountId))
      .returning({ walletBalance: accounts.walletBalance })
    if (acc) {
      await tx.insert(creditTransactions).values({
        accountId: transaction.accountId,
        type: 'debit',
        amount: walletPart.toFixed(2),
        description: 'Wallet portion of plan upgrade (card payment confirmed)',
        balanceAfter: Number(acc.walletBalance).toFixed(2),
        subscriptionId: subscription.id,
      })
    }
  }

  await tx.update(subscriptions)
    .set(updateData)
    .where(eq(subscriptions.id, subscription.id))

  // Lift a billing lock (a vendor suspended or archived by the platform admin stays so)
  await tx.update(tenants)
    .set({
      status: 'active',
      lockedAt: null,
      lockedReason: null,
      deletionScheduledAt: null,
      updatedAt: now,
    })
    .where(and(eq(tenants.id, subscription.tenantId), eq(tenants.status, 'locked')))
  // Move the sign-in cut-off with the new period (it was only ever set at signup)
  await syncTenantPlanExpiry(subscription.tenantId, tx)

  // Broadcast subscription update (after commit)
  broadcasts.push(
    () => broadcastAccountChange(transaction.accountId, 'account-subscription', 'updated', subscription.id),
    () => broadcastAccountChange(transaction.accountId, 'account-wallet', 'updated', transaction.accountId),
  )
}

/**
 * Backstop for the cron: successful payments whose activation failed (and that PayHere did
 * not re-notify) are activated here. Only rows older than `minAgeMs` to stay out of the way of
 * an in-flight notification.
 */
export async function retryUnactivatedPayments(minAgeMs = 5 * 60 * 1000, limit = 50): Promise<{ retried: number; activated: number; failed: number }> {
  const cutoff = new Date(Date.now() - minAgeMs)
  const rows = await db.select({ id: payhereTransactions.id }).from(payhereTransactions)
    .where(and(eq(payhereTransactions.status, 'success'), isNull(payhereTransactions.activatedAt), lt(payhereTransactions.updatedAt, cutoff)))
    .limit(limit)
  let activated = 0
  let failed = 0
  for (const r of rows) {
    try {
      const out = await activatePaidTransaction(r.id)
      if (out.activated) activated++
    } catch (err) {
      failed++
      logError('payhere/retry-activation', err, { params: { transactionId: r.id } })
    }
  }
  return { retried: rows.length, activated, failed }
}
