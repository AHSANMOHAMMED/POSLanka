import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ------------------------------------------------------------------ AdminPage */

export interface Crumb {
  label: string
  href?: string
}

export interface AdminPageProps {
  title: ReactNode
  description?: ReactNode
  /** Buttons on the right of the title row; wrap below the title on small screens. */
  actions?: ReactNode
  breadcrumbs?: Crumb[]
  /** Small element next to the title (badge, live dot…). */
  titleAside?: ReactNode
  className?: string
  children: ReactNode
}

/** Standard page frame: header (breadcrumbs, title, description, actions) + stacked content. */
export function AdminPage({ title, description, actions, breadcrumbs, titleAside, className, children }: AdminPageProps) {
  return (
    <div className={cn('mx-auto w-full max-w-[1480px] space-y-5 pb-10', className)}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav aria-label="Breadcrumb" className="mb-1.5 flex flex-wrap items-center gap-1 text-[12.5px] text-adm-subtle">
              {breadcrumbs.map((c, i) => (
                <span key={`${c.label}-${i}`} className="inline-flex items-center gap-1">
                  {i > 0 && <ChevronRight size={13} aria-hidden />}
                  {c.href ? (
                    <Link href={c.href} className="hover:text-adm-fg">{c.label}</Link>
                  ) : (
                    <span className="text-adm-muted">{c.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-adm-fg sm:text-[24px]">{title}</h1>
            {titleAside}
          </div>
          {description && <p className="mt-1 max-w-3xl text-[14px] text-adm-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
      </header>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ AdminCard */

export interface AdminCardProps {
  title?: ReactNode
  description?: ReactNode
  /** Element(s) on the right of the card header. */
  actions?: ReactNode
  icon?: ReactNode
  footer?: ReactNode
  /** Remove body padding (tables, lists that run edge to edge). */
  flush?: boolean
  className?: string
  bodyClassName?: string
  id?: string
  children?: ReactNode
}

/** Bordered surface with an optional header/footer. The main building block of every page. */
export function AdminCard({ title, description, actions, icon, footer, flush, className, bodyClassName, id, children }: AdminCardProps) {
  const hasHeader = title || description || actions
  return (
    <section id={id} className={cn('min-w-0 rounded-xl border border-adm-border bg-adm-surface shadow-[var(--adm-shadow)]', className)}>
      {hasHeader && (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-adm-border px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-start gap-2.5">
            {icon && <span className="mt-0.5 text-adm-muted">{icon}</span>}
            <div className="min-w-0">
              {title && <h2 className="text-[15px] font-semibold leading-snug text-adm-fg">{title}</h2>}
              {description && <p className="mt-0.5 text-[13px] text-adm-muted">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children !== undefined && <div className={cn(flush ? '' : 'p-4 sm:p-5', bodyClassName)}>{children}</div>}
      {footer && <div className="border-t border-adm-border px-4 py-3 sm:px-5">{footer}</div>}
    </section>
  )
}

/** Titled group of content without a surface (use inside a card or between cards). */
export function AdminSection({ title, description, actions, className, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-adm-fg">{title}</h2>
          {description && <p className="text-[13px] text-adm-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

/* ------------------------------------------------------------------ Toolbar */

/**
 * Filter/search row. Children wrap onto new lines on narrow screens; put the
 * search input first and give it `className="w-full sm:w-72"`.
 */
export function AdminToolbar({ children, end, className }: { children?: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 md:flex-row md:items-center md:justify-between', className)}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      {end && <div className="flex flex-wrap items-center gap-2">{end}</div>}
    </div>
  )
}

/** Responsive grid for StatCards: 1 → 2 → 4 columns. */
export function StatGrid({ children, className, cols = 4 }: { children: ReactNode; className?: string; cols?: 2 | 3 | 4 }) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 sm:gap-4',
        cols === 3 && 'lg:grid-cols-3',
        cols === 4 && 'xl:grid-cols-4',
        className
      )}
    >
      {children}
    </div>
  )
}

/** Label/value pairs (detail panels). */
export function KeyValueList({ items, className }: { items: Array<{ label: ReactNode; value: ReactNode }>; className?: string }) {
  return (
    <dl className={cn('divide-y divide-[var(--adm-border)]', className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-start justify-between gap-4 py-2.5 text-[13.5px]">
          <dt className="text-adm-muted">{it.label}</dt>
          <dd className="min-w-0 text-right font-medium text-adm-fg break-words">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}
