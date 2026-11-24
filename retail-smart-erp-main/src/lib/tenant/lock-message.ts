/**
 * Human-facing lock / suspend copy and structured due metadata for vendor dashboards (web + mobile).
 * Free-text SA reasons are stored on tenants.settings.lockMessage; structured pause & billing due
 * details are stored on tenants.settings.lockDetails and soft due warnings on tenants.settings.dueNotice.
 */

export type TenantAccessStatus = 'active' | 'suspended' | 'cancelled' | 'locked'

export type PauseScenario =
  | 'server_monthly_due'
  | 'subscription_overdue'
  | 'payment_verification'
  | 'policy_hold'
  | 'maintenance'
  | 'custom'

export const SUPPORTED_DUE_CURRENCIES = [
  'USD',
  'LKR',
  'EUR',
  'GBP',
  'AED',
  'INR',
  'SGD',
  'AUD',
] as const

export const PAUSE_SCENARIO_LABELS: Record<PauseScenario, string> = {
  server_monthly_due: 'Server Monthly Subscription Due',
  subscription_overdue: 'Subscription Payment Overdue',
  payment_verification: 'Pending Payment Confirmation',
  policy_hold: 'Account / Compliance Hold',
  maintenance: 'Scheduled Maintenance',
  custom: 'Platform Support Pause',
}

export const PAUSE_SCENARIO_DEFAULTS: Record<
  PauseScenario,
  { title: string; message: string; tone: 'warning' | 'danger' | 'info' }
> = {
  server_monthly_due: {
    title: 'Server Monthly Subscription Due',
    message:
      'Your monthly server & platform subscription payment is due. Settle the outstanding balance to restore sales and staff access immediately. All your business data is safely preserved.',
    tone: 'danger',
  },
  subscription_overdue: {
    title: 'Subscription Payment Overdue',
    message:
      'Your subscription payment is overdue. Renew your plan to unlock sales, inventory, and staff sign-in. No data has been deleted.',
    tone: 'danger',
  },
  payment_verification: {
    title: 'Pending Payment Confirmation',
    message:
      'Access is temporarily paused while accounts verify your recent payment. Contact platform support if you have already sent the slip.',
    tone: 'warning',
  },
  policy_hold: {
    title: 'Account Temporarily Paused',
    message:
      'This business has been temporarily paused by platform support. Your data is kept safe. Please contact skyERPOS support for assistance.',
    tone: 'danger',
  },
  maintenance: {
    title: 'Scheduled Account Maintenance',
    message:
      'Your store workspace is temporarily paused for maintenance. Sales and sign-in will resume shortly.',
    tone: 'info',
  },
  custom: {
    title: 'This business is paused',
    message:
      'Sign-in and sales are paused by skyERPOS platform support. Your data is kept safe. Contact support to restore access.',
    tone: 'danger',
  },
}

export interface LockDetails {
  scenario: PauseScenario
  title?: string | null
  message?: string | null
  dueAmount?: number | null
  dueCurrency?: string | null
  dueDate?: string | null
  billingPeriod?: string | null
  contactNote?: string | null
  updatedAt?: string
}

export type DueBannerTone = 'auto' | 'green' | 'amber' | 'red'

export interface DueNotice {
  enabled: boolean
  scenario: PauseScenario
  title: string
  message: string
  dueAmount?: number | null
  dueCurrency?: string | null
  dueDate?: string | null
  billingPeriod?: string | null
  contactNote?: string | null
  showToCashier?: boolean
  bannerTone?: DueBannerTone | null
  updatedAt: string
}

export interface ResolvedDueUrgency {
  color: 'green' | 'amber' | 'red'
  label: string
  daysRemaining: number | null
  countdownText: string | null
}

/**
 * Resolve traffic-light ("road lamp") color & countdown from a DueNotice.
 * Auto mode: >7 days = green (upcoming), 1–7 days = amber (due soon), <=0 days = red (due today/overdue).
 */
export function resolveDueNoticeUrgency(
  notice: Pick<DueNotice, 'dueDate' | 'bannerTone' | 'scenario'>
): ResolvedDueUrgency {
  let daysRemaining: number | null = null
  let countdownText: string | null = null

  if (notice.dueDate) {
    const parsed = new Date(notice.dueDate)
    if (!Number.isNaN(parsed.getTime())) {
      const now = new Date()
      const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
      const dueUtc = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
      daysRemaining = Math.round((dueUtc - todayUtc) / 86_400_000)

      if (daysRemaining > 1) countdownText = `Due in ${daysRemaining} days`
      else if (daysRemaining === 1) countdownText = 'Due tomorrow'
      else if (daysRemaining === 0) countdownText = 'Due today'
      else if (daysRemaining === -1) countdownText = 'Overdue by 1 day'
      else countdownText = `Overdue by ${Math.abs(daysRemaining)} days`
    }
  }

  const manual = notice.bannerTone && notice.bannerTone !== 'auto' ? notice.bannerTone : null
  let color: 'green' | 'amber' | 'red'
  if (manual) {
    color = manual
  } else if (daysRemaining !== null) {
    color = daysRemaining > 7 ? 'green' : daysRemaining >= 1 ? 'amber' : 'red'
  } else {
    color = notice.scenario === 'subscription_overdue' ? 'red' : 'amber'
  }

  const label =
    color === 'green'
      ? 'UPCOMING'
      : color === 'red'
      ? daysRemaining !== null && daysRemaining === 0
        ? 'DUE TODAY'
        : 'OVERDUE'
      : 'DUE SOON'

  return { color, label, daysRemaining, countdownText }
}

export interface LockMessage {
  title: string
  description: string
  tone: 'warning' | 'danger' | 'info'
  /** Suggested owner action label */
  ctaLabel?: string
  ctaHref?: (slug: string, tenantId: string) => string
  scenario?: PauseScenario | null
  scenarioLabel?: string | null
  dueAmount?: number | null
  dueCurrency?: string | null
  formattedDueAmount?: string | null
  dueDate?: string | null
  billingPeriod?: string | null
  contactNote?: string | null
}

const REASON_COPY: Record<string, LockMessage> = {
  admin_suspended: {
    title: 'This business is suspended',
    description:
      'Sign-in and sales are paused by skyERPOS platform support. Your data is kept. Contact support or settle outstanding payment to restore access.',
    tone: 'danger',
  },
  admin_locked: {
    title: 'This business is locked',
    description:
      'Access was locked by the platform. Please contact skyERPOS support for help restoring it.',
    tone: 'danger',
  },
  admin_archived: {
    title: 'This business is archived',
    description:
      'The company was archived by the platform. Data is retained but staff cannot operate until it is reactivated.',
    tone: 'warning',
  },
  trial_expired: {
    title: 'Your trial has ended',
    description:
      'Upgrade to a paid plan to continue selling and managing this company.',
    tone: 'warning',
    ctaLabel: 'Upgrade now',
    ctaHref: (_slug, tenantId) => `/account/subscription/${tenantId}`,
  },
  subscription_expired: {
    title: 'Payment required',
    description:
      'Your subscription payment is overdue. Renew to unlock sales, inventory, and staff sign-in.',
    tone: 'danger',
    ctaLabel: 'Pay & renew',
    ctaHref: (_slug, tenantId) => `/account/subscription/${tenantId}`,
  },
  storage_full: {
    title: 'Storage limit exceeded',
    description:
      'This company has used all of its plan storage. Upgrade to a higher plan to continue.',
    tone: 'warning',
    ctaLabel: 'Upgrade plan',
    ctaHref: (_slug, tenantId) => `/account/subscription/${tenantId}`,
  },
}

export function formatDueAmount(
  amount: number | null | undefined,
  currency?: string | null
): string | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null
  const code = (currency || 'USD').trim().toUpperCase()
  try {
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
    return formatted.includes(code) ? formatted : `${formatted} ${code}`
  } catch {
    return `${code} ${amount.toFixed(2)}`
  }
}

export function readLockMessageFromSettings(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object') return null
  const msg = (settings as Record<string, unknown>).lockMessage
  return typeof msg === 'string' && msg.trim() ? msg.trim().slice(0, 500) : null
}

export function withLockMessage(
  settings: unknown,
  message: string | null
): Record<string, unknown> {
  const base =
    settings && typeof settings === 'object'
      ? { ...(settings as Record<string, unknown>) }
      : {}
  if (message && message.trim()) base.lockMessage = message.trim().slice(0, 500)
  else delete base.lockMessage
  return base
}

export function readLockDetailsFromSettings(settings: unknown): LockDetails | null {
  if (!settings || typeof settings !== 'object') return null
  const raw = (settings as Record<string, unknown>).lockDetails
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const scenario =
    typeof obj.scenario === 'string' && obj.scenario in PAUSE_SCENARIO_LABELS
      ? (obj.scenario as PauseScenario)
      : 'custom'
  const dueAmount =
    typeof obj.dueAmount === 'number' && Number.isFinite(obj.dueAmount) && obj.dueAmount > 0
      ? obj.dueAmount
      : null
  return {
    scenario,
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim().slice(0, 140) : null,
    message: typeof obj.message === 'string' && obj.message.trim() ? obj.message.trim().slice(0, 1000) : null,
    dueAmount,
    dueCurrency:
      typeof obj.dueCurrency === 'string' && obj.dueCurrency.trim()
        ? obj.dueCurrency.trim().toUpperCase().slice(0, 10)
        : null,
    dueDate: typeof obj.dueDate === 'string' && obj.dueDate.trim() ? obj.dueDate.trim() : null,
    billingPeriod:
      typeof obj.billingPeriod === 'string' && obj.billingPeriod.trim()
        ? obj.billingPeriod.trim().slice(0, 120)
        : null,
    contactNote:
      typeof obj.contactNote === 'string' && obj.contactNote.trim()
        ? obj.contactNote.trim().slice(0, 300)
        : null,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
  }
}

export function withLockDetails(
  settings: unknown,
  details: LockDetails | null
): Record<string, unknown> {
  const base =
    settings && typeof settings === 'object'
      ? { ...(settings as Record<string, unknown>) }
      : {}
  if (details) {
    base.lockDetails = {
      ...details,
      updatedAt: details.updatedAt || new Date().toISOString(),
    }
  } else {
    delete base.lockDetails
  }
  return base
}

export function readDueNoticeFromSettings(settings: unknown): DueNotice | null {
  if (!settings || typeof settings !== 'object') return null
  const raw = (settings as Record<string, unknown>).dueNotice
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (!obj.enabled) return null
  const scenario =
    typeof obj.scenario === 'string' && obj.scenario in PAUSE_SCENARIO_LABELS
      ? (obj.scenario as PauseScenario)
      : 'server_monthly_due'
  const dueAmount =
    typeof obj.dueAmount === 'number' && Number.isFinite(obj.dueAmount) && obj.dueAmount > 0
      ? obj.dueAmount
      : null
  const message =
    typeof obj.message === 'string' && obj.message.trim()
      ? obj.message.trim().slice(0, 1000)
      : PAUSE_SCENARIO_DEFAULTS[scenario].message
  const title =
    typeof obj.title === 'string' && obj.title.trim()
      ? obj.title.trim().slice(0, 140)
      : PAUSE_SCENARIO_DEFAULTS[scenario].title
  return {
    enabled: true,
    scenario,
    title,
    message,
    dueAmount,
    dueCurrency:
      typeof obj.dueCurrency === 'string' && obj.dueCurrency.trim()
        ? obj.dueCurrency.trim().toUpperCase().slice(0, 10)
        : null,
    dueDate: typeof obj.dueDate === 'string' && obj.dueDate.trim() ? obj.dueDate.trim() : null,
    billingPeriod:
      typeof obj.billingPeriod === 'string' && obj.billingPeriod.trim()
        ? obj.billingPeriod.trim().slice(0, 120)
        : null,
    contactNote:
      typeof obj.contactNote === 'string' && obj.contactNote.trim()
        ? obj.contactNote.trim().slice(0, 300)
        : null,
    showToCashier: Boolean(obj.showToCashier),
    bannerTone:
      obj.bannerTone === 'green' || obj.bannerTone === 'amber' || obj.bannerTone === 'red' || obj.bannerTone === 'auto'
        ? obj.bannerTone
        : 'auto',
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
  }
}

export function withDueNotice(
  settings: unknown,
  notice: DueNotice | null
): Record<string, unknown> {
  const base =
    settings && typeof settings === 'object'
      ? { ...(settings as Record<string, unknown>) }
      : {}
  if (notice && notice.enabled) {
    base.dueNotice = notice
  } else {
    delete base.dueNotice
  }
  return base
}

export function resolveLockMessage(input: {
  status: string
  lockedReason?: string | null
  settings?: unknown
}): LockMessage {
  const details = readLockDetailsFromSettings(input.settings)
  const custom = readLockMessageFromSettings(input.settings)
  const reason = input.lockedReason || ''
  const base =
    REASON_COPY[reason] ||
    (input.status === 'suspended'
      ? REASON_COPY.admin_suspended
      : input.status === 'cancelled'
        ? REASON_COPY.admin_archived
        : {
            title: 'Company access restricted',
            description:
              'This company cannot be used right now. Please contact skyERPOS support or renew your plan.',
            tone: 'warning' as const,
          })

  const scenarioDefaults = details?.scenario
    ? PAUSE_SCENARIO_DEFAULTS[details.scenario]
    : null

  const title = details?.title || scenarioDefaults?.title || base.title
  const description = details?.message || custom || base.description
  const tone = scenarioDefaults?.tone || base.tone
  const formattedDueAmount = formatDueAmount(details?.dueAmount, details?.dueCurrency)

  const showBillingCta =
    details?.scenario === 'server_monthly_due' ||
    details?.scenario === 'subscription_overdue' ||
    !!base.ctaHref

  return {
    ...base,
    title,
    description,
    tone,
    ctaLabel: base.ctaLabel || (showBillingCta ? 'View billing & pay' : undefined),
    ctaHref:
      base.ctaHref ||
      (showBillingCta
        ? (_slug, tenantId) => `/account/subscription/${tenantId}`
        : undefined),
    scenario: details?.scenario ?? null,
    scenarioLabel: details?.scenario ? PAUSE_SCENARIO_LABELS[details.scenario] : null,
    dueAmount: details?.dueAmount ?? null,
    dueCurrency: details?.dueCurrency ?? null,
    formattedDueAmount,
    dueDate: details?.dueDate ?? null,
    billingPeriod: details?.billingPeriod ?? null,
    contactNote: details?.contactNote ?? null,
  }
}
