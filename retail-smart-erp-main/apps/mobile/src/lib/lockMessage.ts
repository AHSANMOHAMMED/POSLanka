/**
 * Human-facing lock / suspend / archive copy for the shop app.
 * Mirrors src/lib/tenant/lock-message.ts on the server.
 */

export type TenantAccessStatus = 'active' | 'suspended' | 'cancelled' | 'locked' | string

export interface LockMessage {
  title: string
  description: string
  tone: 'warning' | 'danger' | 'info'
  statusLabel: string
}

const REASON_COPY: Record<string, Omit<LockMessage, 'statusLabel'>> = {
  admin_suspended: {
    title: 'This business is suspended',
    description:
      'Sign-in and sales are paused by skyERPOS platform support. Your data is kept. Contact support or settle outstanding payment to restore access.',
    tone: 'danger',
  },
  admin_locked: {
    title: 'This business is locked',
    description: 'Access was locked by the platform. Please contact skyERPOS support for help restoring it.',
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
    description: 'Upgrade to a paid plan to continue selling and managing this company.',
    tone: 'warning',
  },
  subscription_expired: {
    title: 'Payment required',
    description:
      'Your subscription payment is overdue. Renew to unlock sales, inventory, and staff sign-in.',
    tone: 'danger',
  },
  storage_full: {
    title: 'Storage limit exceeded',
    description: 'This company has used all of its plan storage. Upgrade to a higher plan to continue.',
    tone: 'warning',
  },
}

function statusLabel(status: string): string {
  if (status === 'suspended') return 'Suspended'
  if (status === 'cancelled') return 'Archived'
  if (status === 'locked') return 'Locked'
  return 'Access paused'
}

export function resolveLockMessage(input: {
  status?: string | null
  lockedReason?: string | null
  title?: string | null
  description?: string | null
  error?: string | null
}): LockMessage {
  if (input.title && input.description) {
    return {
      title: input.title,
      description: input.description,
      tone: input.status === 'cancelled' ? 'warning' : 'danger',
      statusLabel: statusLabel(input.status || 'locked'),
    }
  }

  const reason = input.lockedReason || ''
  const status = input.status || ''
  const base =
    REASON_COPY[reason] ||
    (status === 'suspended'
      ? REASON_COPY.admin_suspended
      : status === 'cancelled'
        ? REASON_COPY.admin_archived
        : status === 'locked'
          ? REASON_COPY.admin_locked
          : {
              title: 'Company access restricted',
              description:
                input.error ||
                'This company cannot be used right now. Contact your owner or skyERPOS support.',
              tone: 'warning' as const,
            })

  return { ...base, statusLabel: statusLabel(status || reason || 'locked') }
}
