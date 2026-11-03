/**
 * Human-facing lock / suspend copy for vendor dashboards (web + future mobile).
 * Free-text SA reasons are stored on tenants.settings.lockMessage when suspending.
 */

export type TenantAccessStatus = 'active' | 'suspended' | 'cancelled' | 'locked'

export interface LockMessage {
  title: string
  description: string
  tone: 'warning' | 'danger' | 'info'
  /** Suggested owner action label */
  ctaLabel?: string
  ctaHref?: (slug: string, tenantId: string) => string
}

const REASON_COPY: Record<string, LockMessage> = {
  admin_suspended: {
    title: 'This business is suspended',
    description: 'Sign-in and sales are paused by skyERPOS platform support. Your data is kept. Contact support or settle outstanding payment to restore access.',
    tone: 'danger',
  },
  admin_locked: {
    title: 'This business is locked',
    description: 'Access was locked by the platform. Please contact skyERPOS support for help restoring it.',
    tone: 'danger',
  },
  admin_archived: {
    title: 'This business is archived',
    description: 'The company was archived by the platform. Data is retained but staff cannot operate until it is reactivated.',
    tone: 'warning',
  },
  trial_expired: {
    title: 'Your trial has ended',
    description: 'Upgrade to a paid plan to continue selling and managing this company.',
    tone: 'warning',
    ctaLabel: 'Upgrade now',
    ctaHref: (_slug, tenantId) => `/account/subscription/${tenantId}`,
  },
  subscription_expired: {
    title: 'Payment required',
    description: 'Your subscription payment is overdue. Renew to unlock sales, inventory, and staff sign-in.',
    tone: 'danger',
    ctaLabel: 'Pay & renew',
    ctaHref: (_slug, tenantId) => `/account/subscription/${tenantId}`,
  },
  storage_full: {
    title: 'Storage limit exceeded',
    description: 'This company has used all of its plan storage. Upgrade to a higher plan to continue.',
    tone: 'warning',
    ctaLabel: 'Upgrade plan',
    ctaHref: (_slug, tenantId) => `/account/subscription/${tenantId}`,
  },
}

export function readLockMessageFromSettings(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object') return null
  const msg = (settings as Record<string, unknown>).lockMessage
  return typeof msg === 'string' && msg.trim() ? msg.trim().slice(0, 500) : null
}

export function withLockMessage(settings: unknown, message: string | null): Record<string, unknown> {
  const base = settings && typeof settings === 'object' ? { ...(settings as Record<string, unknown>) } : {}
  if (message && message.trim()) base.lockMessage = message.trim().slice(0, 500)
  else delete base.lockMessage
  return base
}

export function resolveLockMessage(input: {
  status: string
  lockedReason?: string | null
  settings?: unknown
}): LockMessage {
  const custom = readLockMessageFromSettings(input.settings)
  const reason = input.lockedReason || ''
  const base = REASON_COPY[reason]
    || (input.status === 'suspended'
      ? REASON_COPY.admin_suspended
      : input.status === 'cancelled'
        ? REASON_COPY.admin_archived
        : {
          title: 'Company access restricted',
          description: 'This company cannot be used right now. Please contact skyERPOS support or renew your plan.',
          tone: 'warning' as const,
        })

  if (custom) {
    return { ...base, description: custom }
  }
  return base
}
