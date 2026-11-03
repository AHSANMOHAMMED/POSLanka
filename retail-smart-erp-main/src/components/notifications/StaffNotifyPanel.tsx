'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, Megaphone, Send } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type Audience = 'selected' | 'managers' | 'all'
interface StaffRow { id: string; fullName: string; role: string }

/**
 * Managers / owners only (manageUsers). Server rejects cashiers.
 */
export function StaffNotifyPanel() {
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [canNotify, setCanNotify] = useState(false)
  const [canBroadcastAll, setCanBroadcastAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [audience, setAudience] = useState<Audience>('selected')
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/staff/notifications')
      if (res.status === 403) {
        setCanNotify(false)
        setStaff([])
        return
      }
      if (!res.ok) throw new Error('Could not load staff')
      const data = await res.json()
      setStaff(Array.isArray(data.staff) ? data.staff : [])
      setCanBroadcastAll(!!data.canBroadcastAll)
      setCanNotify(data.canNotify !== false)
    } catch {
      toast.error('Could not load colleagues for notify')
      setCanNotify(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (!loading && !canNotify) return null

  async function send() {
    const t = title.trim()
    const b = body.trim()
    if (t.length < 3) return toast.error('Enter a title (3+ characters)')
    if (b.length < 3) return toast.error('Enter a message (3+ characters)')
    const userIds = Object.keys(picked).filter((id) => picked[id])
    if (audience === 'selected' && userIds.length === 0) return toast.error('Pick at least one colleague')
    setSending(true)
    try {
      const res = await fetch('/api/staff/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: t, body: b, audience, userIds: audience === 'selected' ? userIds : [] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Send failed')
      toast.success(`Sent to ${data.recipients} · ${data.pushSent} phone push${data.pushSent === 1 ? '' : 'es'}`)
      setTitle('')
      setBody('')
      setPicked({})
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          <Megaphone className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Notify staff (push)</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Managers only. Message goes to the Alerts inbox and to phones with the skyERPOS app.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-gray-700 dark:text-gray-300">Title</span>
          <input
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Need change at counter 2"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium text-gray-700 dark:text-gray-300">Message</span>
          <textarea
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
            rows={4}
            maxLength={2000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What should they know?"
          />
        </label>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">Send to</p>
        <div className="flex flex-wrap gap-2">
          {([
            { value: 'selected' as const, label: 'Selected people' },
            ...(canBroadcastAll
              ? [
                  { value: 'managers' as const, label: 'Managers' },
                  { value: 'all' as const, label: 'Everyone' },
                ]
              : []),
          ]).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setAudience(opt.value)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${
                audience === opt.value
                  ? 'bg-teal-700 text-white ring-teal-700'
                  : 'bg-white text-gray-700 ring-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:ring-gray-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {audience === 'selected' && (
        <div className="max-h-48 overflow-y-auto rounded-md border border-gray-200 dark:border-gray-700">
          {loading ? (
            <p className="p-3 text-sm text-gray-500">Loading…</p>
          ) : staff.length === 0 ? (
            <p className="p-3 text-sm text-gray-500">No other staff in this company.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {staff.map((s) => {
                const on = !!picked[s.id]
                return (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setPicked((p) => ({ ...p, [s.id]: !p[s.id] }))}
                        className="h-4 w-4"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">{s.fullName}</span>
                        <span className="block text-xs text-gray-500">{s.role}</span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs text-gray-500">
          <Bell className="h-3.5 w-3.5" aria-hidden />
          Recipients must have the mobile app signed in once for phone push.
        </p>
        <Button onClick={send} disabled={sending} className="gap-2">
          <Send className="h-4 w-4" />
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </Card>
  )
}
