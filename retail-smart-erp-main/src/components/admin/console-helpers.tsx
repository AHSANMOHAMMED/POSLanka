'use client'

/**
 * Small helpers shared by the vendor / billing console pages (built on the admin kit).
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronLeft, ChevronRight, Copy, X } from 'lucide-react'
import { Button, fmtNumber } from '@/components/admin/kit'
import { cn } from '@/lib/utils'

/** fetch + JSON with a readable error message (API `{ error }` or the HTTP status). */
export async function adminFetch<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  const res = await fetch(url, {
    cache: 'no-store',
    ...rest,
    headers: json !== undefined ? { 'content-type': 'application/json', ...(rest.headers || {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const details = Array.isArray(body?.details) ? body.details.map((d: { message?: string }) => d.message).filter(Boolean).join(' ') : ''
    // status / body ride along so forms can point at the field the server named
    throw Object.assign(new Error(body?.error ? `${body.error}${details ? ` — ${details}` : ''}` : `Request failed (${res.status})`), { status: res.status, body })
  }
  return body as T
}

export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`
}

export function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-LK', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Days from now until `iso` (negative = past). */
export function daysUntil(iso: string | Date | null | undefined): number | null {
  if (!iso) return null
  const t = typeof iso === 'string' ? Date.parse(iso) : iso.getTime()
  if (!Number.isFinite(t)) return null
  return Math.ceil((t - Date.now()) / 86_400_000)
}

/** Sentinel end date for plans that never expire. */
export function isNeverEnding(iso: string | null | undefined): boolean {
  return !!iso && new Date(iso).getFullYear() >= 2099
}

export const VENDOR_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  suspended: 'Suspended',
  locked: 'Locked',
  cancelled: 'Archived',
}

export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  trial: 'Trial',
  active: 'Active',
  past_due: 'Past due',
  locked: 'Locked',
  cancelled: 'Cancelled',
}

export const LOCK_REASON_LABEL: Record<string, string> = {
  trial_expired: 'Trial ended',
  subscription_expired: 'Subscription lapsed',
  storage_full: 'Storage full',
  admin_locked: 'Locked by admin',
  admin_action: 'Locked by admin',
  admin_suspended: 'Suspended by admin',
  admin_archived: 'Archived by admin',
}

export function labelFor(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return '—'
  return map[key] ?? key.replace(/_/g, ' ')
}

/** "Showing 26–50 of 213" + previous/next. */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
  className,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  className?: string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2 text-[13px] text-adm-muted', className)}>
      <span>
        Showing <span className="adm-num font-medium text-adm-fg">{fmtNumber(from)}–{fmtNumber(to)}</span> of{' '}
        <span className="adm-num font-medium text-adm-fg">{fmtNumber(total)}</span>
      </span>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="secondary" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span className="adm-num px-1.5">
          {page} / {pages}
        </span>
        <Button size="sm" variant="secondary" iconRight={ChevronRight} disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}

/** Icon button that copies `text` and briefly shows a tick. */
export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable (insecure context) — the text stays selectable
    }
  }, [text])
  return (
    <Button size="icon-sm" variant="ghost" onClick={copy} aria-label={copied ? 'Copied' : label} title={copied ? 'Copied' : label} className={className}>
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
    </Button>
  )
}

/** Thin usage bar: used / limit (null limit = unlimited). */
export function UsageBar({ used, limit, format = (n: number) => fmtNumber(n) }: { used: number; limit: number | null; format?: (n: number) => string }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const tone = !limit ? 'bg-adm-primary' : pct >= 100 ? 'bg-adm-danger' : pct >= 80 ? 'bg-adm-warning' : 'bg-adm-success'
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="adm-num font-medium text-adm-fg">{format(used)}</span>
        <span className="text-adm-subtle">{limit ? `of ${format(limit)}` : 'No limit'}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-adm-surface-3" aria-hidden>
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${limit ? Math.max(pct, used > 0 ? 3 : 0) : 0}%` }} />
      </div>
    </div>
  )
}

/**
 * Side panel for row details (audit / error entries). Slides in from the right on
 * tablet+ and covers the screen on phones. Esc and the backdrop close it.
 */
export function AdminDrawer({
  open,
  onClose,
  title,
  description,
  footer,
  children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children?: ReactNode
}) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => panelRef.current?.focus(), 0)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="adm-fade-in relative flex h-full w-full flex-col border-l border-adm-border bg-adm-surface text-adm-fg shadow-[var(--adm-shadow-lg)] outline-none sm:max-w-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-adm-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[16px] font-semibold text-adm-fg">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-adm-muted">{description}</p>}
          </div>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close" className="-mr-1 shrink-0">
            <X size={18} aria-hidden />
          </Button>
        </div>
        <div className="adm-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-adm-border px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  )
}

/** Pretty-printed JSON / code block that wraps instead of widening the page. */
export function CodeBlock({ children, className, maxHeight = 360 }: { children: ReactNode; className?: string; maxHeight?: number }) {
  return (
    <pre
      className={cn('adm-scroll overflow-auto whitespace-pre-wrap break-words rounded-lg border border-adm-border bg-adm-surface-2 p-3 font-mono text-[12px] leading-relaxed text-adm-fg', className)}
      style={{ maxHeight }}
    >
      {children}
    </pre>
  )
}
