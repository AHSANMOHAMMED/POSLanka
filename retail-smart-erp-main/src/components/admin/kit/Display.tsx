import type { ReactNode } from 'react'
import Link from 'next/link'
import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

const toneSoft: Record<Tone, string> = {
  neutral: 'bg-adm-surface-3 text-adm-muted',
  primary: 'bg-adm-primary-soft text-adm-primary-soft-fg',
  success: 'bg-adm-success-soft text-adm-success',
  warning: 'bg-adm-warning-soft text-adm-warning',
  danger: 'bg-adm-danger-soft text-adm-danger',
  info: 'bg-adm-info-soft text-adm-info',
}

const toneDot: Record<Tone, string> = {
  neutral: 'bg-adm-subtle',
  primary: 'bg-adm-primary',
  success: 'bg-adm-success',
  warning: 'bg-adm-warning',
  danger: 'bg-adm-danger',
  info: 'bg-adm-info',
}

/* ------------------------------------------------------------------ Badge */

export function Badge({ tone = 'neutral', dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium leading-5', toneSoft[tone], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', toneDot[tone])} aria-hidden />}
      {children}
    </span>
  )
}

/** Map common status strings to a tone (active, trial, locked, pending, failed…). */
export function statusTone(status: string | null | undefined): Tone {
  switch ((status || '').toLowerCase()) {
    case 'active': case 'approved': case 'paid': case 'success': case 'completed': case 'resolved': case 'ok':
      return 'success'
    case 'trial': case 'pending': case 'investigating': case 'processing': case 'past_due': case 'warning':
      return 'warning'
    case 'locked': case 'suspended': case 'failed': case 'rejected': case 'cancelled': case 'expired': case 'error': case 'open':
      return 'danger'
    case 'info': case 'new':
      return 'info'
    default:
      return 'neutral'
  }
}

/* ------------------------------------------------------------------ StatCard */

export interface StatCardProps {
  label: ReactNode
  value: ReactNode
  /** Secondary line under the value. */
  hint?: ReactNode
  icon?: LucideIcon
  tone?: Tone
  /** Makes the whole card a link. */
  href?: string
  /** Footer row (e.g. "3 live · 1 trial"). */
  footer?: ReactNode
  loading?: boolean
  className?: string
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'primary', href, footer, loading, className }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-adm-muted">{label}</p>
          {loading ? (
            <div className="mt-2 h-7 w-24 animate-pulse rounded-md bg-adm-surface-3" />
          ) : (
            <p className="adm-num mt-1 truncate text-[24px] font-semibold leading-tight tracking-[-0.01em] text-adm-fg">{value}</p>
          )}
          {hint && !loading && <p className="mt-1 truncate text-[12.5px] text-adm-subtle">{hint}</p>}
        </div>
        {Icon && (
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', toneSoft[tone])}>
            <Icon size={18} aria-hidden />
          </span>
        )}
      </div>
      {footer && <div className="mt-3 border-t border-adm-border pt-2.5 text-[12.5px] text-adm-muted">{footer}</div>}
    </>
  )
  const cls = cn(
    'block min-w-0 rounded-xl border border-adm-border bg-adm-surface p-4 shadow-[var(--adm-shadow)]',
    href && 'adm-focus transition-colors hover:border-adm-border-strong hover:bg-adm-surface-2',
    className
  )
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>
}

/* ------------------------------------------------------------------ EmptyState */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
  className,
}: {
  icon?: LucideIcon
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-4 py-6' : 'px-6 py-12', className)}>
      {Icon && (
        <span className={cn('mb-3 flex items-center justify-center rounded-full bg-adm-surface-2 text-adm-subtle', compact ? 'h-9 w-9' : 'h-12 w-12')}>
          <Icon size={compact ? 17 : 22} aria-hidden />
        </span>
      )}
      <p className="text-[14px] font-medium text-adm-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-adm-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ Alert */

const alertIcon: Record<Tone, LucideIcon> = {
  neutral: Info,
  primary: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
}

export function Alert({ tone = 'info', title, children, action, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const Icon = alertIcon[tone]
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-lg px-3.5 py-3 text-[13.5px]', toneSoft[tone], className)}>
      <Icon size={17} className="mt-px shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
      </div>
      {action}
    </div>
  )
}

/* ------------------------------------------------------------------ Skeleton / Dot */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-adm-surface-3', className)} aria-hidden />
}

/** Small status dot, optionally pulsing (live indicators). */
export function StatusDot({ tone = 'success', pulse, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex h-2 w-2', className)} aria-hidden>
      {pulse && <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', toneDot[tone])} />}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', toneDot[tone])} />
    </span>
  )
}
