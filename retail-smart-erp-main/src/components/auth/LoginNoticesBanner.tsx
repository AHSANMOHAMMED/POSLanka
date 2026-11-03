'use client'

import { useEffect, useState } from 'react'
import { Bell, Info, AlertTriangle, AlertCircle, X } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'
import { cn } from '@/lib/utils'

interface Notice {
  id: string
  kind: 'announcement' | 'broadcast'
  category: string
  type: string
  title: string
  body: string
  link?: string | null
  createdAt?: string
}

const TONE: Record<string, { wrap: string; icon: typeof Info }> = {
  info: { wrap: 'bg-sky-50 text-sky-950 ring-sky-200', icon: Info },
  feature: { wrap: 'bg-sky-50 text-sky-950 ring-sky-200', icon: Info },
  warning: { wrap: 'bg-amber-50 text-amber-950 ring-amber-200', icon: AlertTriangle },
  maintenance: { wrap: 'bg-amber-50 text-amber-950 ring-amber-200', icon: AlertTriangle },
  billing: { wrap: 'bg-violet-50 text-violet-950 ring-violet-200', icon: Bell },
  error: { wrap: 'bg-rose-50 text-rose-950 ring-rose-200', icon: AlertCircle },
}

export function LoginNoticesBanner({ slug }: { slug?: string | null }) {
  const { locale, t } = useI18n()
  const [notices, setNotices] = useState<Notice[]>([])
  const [hidden, setHidden] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const params = new URLSearchParams({ locale })
    if (slug) params.set('slug', slug)
    let cancelled = false
    fetch(`/api/system/login-notices?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.notices)) setNotices(data.notices)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [locale, slug])

  const visible = notices.filter((n) => !hidden[n.id])
  if (visible.length === 0) {
    return (
      <div className="mb-3 flex justify-end">
        <LanguageSwitcher />
      </div>
    )
  }

  return (
    <div className="mb-4 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-semibold uppercase tracking-wide text-adm-muted">
          {t('login.notices', 'Notices')}
        </p>
        <LanguageSwitcher />
      </div>
      {visible.map((n) => {
        const tone = TONE[n.type] || TONE.info
        const Icon = tone.icon
        return (
          <div
            key={n.id}
            className={cn('relative rounded-xl px-3.5 py-3 ring-1', tone.wrap)}
            role="status"
          >
            <button
              type="button"
              className="absolute right-2 top-2 rounded p-1 opacity-60 hover:opacity-100"
              aria-label={t('login.dismiss', 'Dismiss')}
              onClick={() => setHidden((h) => ({ ...h, [n.id]: true }))}
            >
              <X size={14} />
            </button>
            <div className="flex gap-2.5 pr-6">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-80" aria-hidden />
              <div className="min-w-0 space-y-1">
                <p className="text-[13.5px] font-semibold leading-snug">{n.title}</p>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed opacity-90">{n.body}</p>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
