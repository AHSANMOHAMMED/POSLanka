'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { BellRing, CheckCheck, Settings2 } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'

interface InboxItem {
  id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown> | null
  readAt: string | null
  createdAt: string
}

const POLL_MS = 60_000

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** Web link for an alert, from the same `data` the mobile app uses. */
function linkFor(base: string, item: InboxItem): string | null {
  const d = item.data || {}
  if (typeof d.saleId === 'string') return `${base}/sales/${d.saleId}`
  switch (d.screen) {
    case 'inventory': return `${base}/stock/reorder-dashboard`
    case 'approvals': return d.kind === 'employee_advance' ? `${base}/hr/employee-advances` : `${base}/purchase-requisitions`
    case 'intake': return `${base}/stock`
    default: break
  }
  if (item.type === 'import_finished') return `${base}/settings/import-export`
  return null
}

/** In-app alert inbox (low stock, refunds, approvals, reminders …) for the signed-in user. */
export function InboxBell() {
  const { tenantSlug } = useCompany()
  const base = `/c/${tenantSlug}`
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<InboxItem[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?pageSize=15')
      if (!res.ok) return
      const json = await res.json()
      setItems(Array.isArray(json.data) ? json.data : [])
      setUnread(typeof json.unreadCount === 'number' ? json.unreadCount : 0)
    } catch {
      // offline / transient: keep the last state
    }
  }, [])

  useEffect(() => {
    const first = setTimeout(() => { void load() }, 0)
    const t = setInterval(() => { void load() }, POLL_MS)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [load])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const markRead = useCallback(async (body: { ids?: string[]; all?: true }) => {
    try {
      const res = await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) return
      const json = await res.json()
      const now = new Date().toISOString()
      setItems((prev) => prev.map((i) => (body.all || body.ids?.includes(i.id) ? { ...i, readAt: i.readAt || now } : i)))
      if (typeof json.unreadCount === 'number') setUnread(json.unreadCount)
    } catch {
      // ignore
    }
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(!open); if (!open) void load() }}
        className="p-1.5 rounded-md transition-colors relative"
        style={{ color: 'var(--sidebar-text-muted)' }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--sidebar-hover-bg)' }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
        title="Alerts"
        aria-label={unread > 0 ? `Alerts (${unread} unread)` : 'Alerts'}
      >
        <BellRing size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 sm:w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-50 max-h-[480px] flex flex-col">
          <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-900 dark:text-white">Alerts</span>
            <div className="flex items-center gap-3">
              {unread > 0 && (
                <button type="button" onClick={() => markRead({ all: true })} className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
                  <CheckCheck size={12} /> Mark all read
                </button>
              )}
              <Link href={`${base}/settings/notifications/alerts`} onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" title="Alert settings">
                <Settings2 size={14} />
              </Link>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">No alerts yet</div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {items.map((item) => {
                  const href = linkFor(base, item)
                  const content = (
                    <>
                      <p className="text-sm font-medium text-gray-900 dark:text-white leading-snug">{item.title}</p>
                      {item.body && <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 line-clamp-2">{item.body}</p>}
                      <span className="text-xs text-gray-400">{formatRelative(item.createdAt)}</span>
                    </>
                  )
                  return (
                    <li key={item.id} className={`px-3 py-2.5 ${!item.readAt ? 'bg-blue-50/60 dark:bg-blue-900/10' : ''}`}>
                      {href ? (
                        <Link href={href} className="block" onClick={() => { setOpen(false); if (!item.readAt) void markRead({ ids: [item.id] }) }}>
                          {content}
                        </Link>
                      ) : (
                        <button type="button" className="block text-left w-full" onClick={() => { if (!item.readAt) void markRead({ ids: [item.id] }) }}>
                          {content}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
