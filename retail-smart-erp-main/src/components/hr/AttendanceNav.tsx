'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CalendarCheck, CalendarDays, CalendarX, Clock, Fingerprint } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'

/** Tabs linking the HR attendance pages (attendance, shifts, devices, leave, holidays). */
export function AttendanceNav() {
  const { tenantSlug } = useCompany()
  const pathname = usePathname() || ''
  const base = `/c/${tenantSlug}/hr`
  const tabs = [
    { href: `${base}/attendance`, label: 'Attendance', icon: CalendarCheck },
    { href: `${base}/shifts`, label: 'Shifts', icon: Clock },
    { href: `${base}/attendance-devices`, label: 'Fingerprint Devices', icon: Fingerprint },
    { href: `${base}/leave`, label: 'Leave', icon: CalendarX },
    { href: `${base}/holidays`, label: 'Holidays', icon: CalendarDays },
  ]
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-700 -mx-1 px-1">
      {tabs.map((t) => {
        // Pages may be served at /hr/... on a tenant subdomain: match on the tail
        const tail = t.href.slice(base.length)
        const active = pathname.endsWith(tail) || pathname.includes(`${tail}/`)
        const Icon = t.icon
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex items-center gap-1.5 whitespace-nowrap px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
              active
                ? 'border-blue-600 text-blue-700 dark:text-blue-400 font-medium'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            <Icon size={15} />
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}

export const STATUS_STYLES: Record<string, { code: string; label: string; chip: string; cell: string }> = {
  present: { code: 'P', label: 'Present', chip: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', cell: 'bg-green-50 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  absent: { code: 'A', label: 'Absent', chip: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300', cell: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  half_day: { code: 'HD', label: 'Half day', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', cell: 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  leave: { code: 'L', label: 'Leave', chip: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300', cell: 'bg-purple-50 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  holiday: { code: 'H', label: 'Holiday', chip: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300', cell: 'bg-sky-50 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300' },
  weekly_off: { code: 'WO', label: 'Weekly off', chip: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300', cell: 'bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
}

export function StatusChip({ status, manual, missed }: { status: string; manual?: boolean; missed?: boolean }) {
  const s = STATUS_STYLES[status]
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${s?.chip ?? 'bg-gray-100 text-gray-700'}`}>{s?.label ?? status}</span>
      {missed && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" title="Only one punch: check-out missing">No out</span>}
      {manual && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" title="Corrected manually">Edited</span>}
    </span>
  )
}

export function minutesToHm(minutes: number | null | undefined): string {
  const m = Math.round(Number(minutes) || 0)
  if (m <= 0) return '—'
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

export function formatClock(value: string | null | undefined, timeZone: string): string {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))
  } catch {
    return '—'
  }
}

/** Local 'HH:MM' of an instant (for edit forms) */
export function clockValue(value: string | null | undefined, timeZone: string): string {
  const v = formatClock(value, timeZone)
  return v === '—' ? '' : v
}

export function localToday(timeZone = 'Asia/Colombo'): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

export function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
