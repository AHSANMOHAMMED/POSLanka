// Proration engine for plan upgrades/downgrades

/**
 * Calculate prorated amount for a plan change
 */
export function calculateProration(options: {
  currentPlanPrice: number    // Monthly or yearly price of current plan
  newPlanPrice: number        // Monthly or yearly price of new plan
  currentPeriodStart: Date
  currentPeriodEnd: Date
  changeDate?: Date           // Defaults to now
}): {
  daysRemaining: number
  totalDaysInPeriod: number
  creditAmount: number        // Credit from current plan's unused time
  newPlanCost: number         // Cost of new plan for remaining days
  amountDue: number           // Positive = pay, negative = credit to wallet
  isUpgrade: boolean
} {
  const changeDate = options.changeDate || new Date()
  const periodStart = new Date(options.currentPeriodStart)
  const periodEnd = new Date(options.currentPeriodEnd)

  const totalDaysInPeriod = Math.ceil(
    (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)
  )
  const daysRemaining = Math.max(0, Math.ceil(
    (periodEnd.getTime() - changeDate.getTime()) / (1000 * 60 * 60 * 24)
  ))

  const dailyRateCurrent = options.currentPlanPrice / totalDaysInPeriod
  const dailyRateNew = options.newPlanPrice / totalDaysInPeriod

  const creditAmount = Math.round(dailyRateCurrent * daysRemaining * 100) / 100
  const newPlanCost = Math.round(dailyRateNew * daysRemaining * 100) / 100
  const amountDue = Math.round((newPlanCost - creditAmount) * 100) / 100

  return {
    daysRemaining,
    totalDaysInPeriod,
    creditAmount,
    newPlanCost,
    amountDue,
    isUpgrade: options.newPlanPrice > options.currentPlanPrice,
  }
}

/**
 * Get the price based on billing cycle
 */
export function getPriceForCycle(
  priceMonthly: number,
  priceYearly: number,
  billingCycle: 'monthly' | 'yearly'
): number {
  return billingCycle === 'yearly' ? priceYearly : priceMonthly
}

/**
 * Calculate next period dates based on billing cycle
 */
export function getNextPeriodDates(
  startDate: Date,
  billingCycle: 'monthly' | 'yearly'
): { periodStart: Date; periodEnd: Date } {
  const periodStart = new Date(startDate)
  const periodEnd = new Date(startDate)

  if (billingCycle === 'yearly') {
    periodEnd.setFullYear(periodEnd.getFullYear() + 1)
  } else {
    periodEnd.setMonth(periodEnd.getMonth() + 1)
  }

  return { periodStart, periodEnd }
}

/**
 * Generate a human-readable description of the proration calculation.
 * Useful for invoices, credit transaction descriptions, and UI explanations.
 */
export function describeProration(options: {
  currentPlanName: string
  newPlanName: string
  currentBillingCycle: 'monthly' | 'yearly'
  newBillingCycle: 'monthly' | 'yearly'
  daysRemaining: number
  totalDaysInPeriod: number
  creditAmount: number
  newPlanCost: number
  amountDue: number
  isUpgrade: boolean
}): {
  summary: string
  details: string[]
} {
  const {
    currentPlanName,
    newPlanName,
    currentBillingCycle,
    newBillingCycle,
    daysRemaining,
    totalDaysInPeriod,
    creditAmount,
    newPlanCost,
    amountDue,
    isUpgrade,
  } = options

  const cycleChanging = currentBillingCycle !== newBillingCycle
  const action = isUpgrade ? 'Upgrade' : 'Downgrade'
  const daysUsed = totalDaysInPeriod - daysRemaining

  const details: string[] = []

  details.push(
    `${action} from ${currentPlanName} to ${newPlanName}`
  )

  if (cycleChanging) {
    details.push(
      `Billing cycle changing from ${currentBillingCycle} to ${newBillingCycle}`
    )
  }

  details.push(
    `${daysUsed} days used out of ${totalDaysInPeriod}-day period (${daysRemaining} days remaining)`
  )

  details.push(
    `Credit for unused time on ${currentPlanName}: ${creditAmount.toFixed(2)}`
  )

  details.push(
    `Cost of ${newPlanName} for ${daysRemaining} remaining days: ${newPlanCost.toFixed(2)}`
  )

  let summary: string
  if (amountDue > 0) {
    summary = `${action}: Pay ${amountDue.toFixed(2)} for the remainder of this billing period`
  } else if (amountDue < 0) {
    summary = `${action}: ${Math.abs(amountDue).toFixed(2)} will be credited to your wallet`
  } else {
    summary = `${action}: No additional charge for this billing period`
  }

  return { summary, details }
}
