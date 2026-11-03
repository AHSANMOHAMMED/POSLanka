// Shared helpers for the platform-admin (sys-control) screens: confirmations, result alerts,
// parsing, formatting, opening the public web console, and a paged-list hook.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Linking } from 'react-native'
import { getPublicWebBase, type ApiResult } from './api'
import { adminGet } from './adminApi'

/** Alert.alert with Cancel + one confirm button. */
export function confirmAction(title: string, message: string, confirmLabel: string, onConfirm: () => void, destructive = false) {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ])
}

/** Shows the server error of a failed result; returns true when the call succeeded. */
export function alertIfFailed(res: ApiResult<any>, title = 'Request failed'): boolean {
  if (res.ok) return true
  Alert.alert(title, res.error || 'Something went wrong.')
  return false
}

/** Opens a console page in the browser. Always the public web host, never localhost. */
export function openWebPath(path: string) {
  const url = `${getPublicWebBase()}${path.startsWith('/') ? path : `/${path}`}`
  Linking.openURL(url).catch(() => Alert.alert('Cannot open link', url))
}

/** Parses a user-typed number; undefined for blank / invalid input. */
export function parseNum(s: string | null | undefined): number | undefined {
  if (s == null) return undefined
  const t = String(s).replace(/,/g, '').trim()
  if (!t) return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

export function parseIntStrict(s: string | null | undefined): number | undefined {
  const n = parseNum(s)
  return n !== undefined && Number.isInteger(n) ? n : undefined
}

/** YYYY-MM-DD check (valid calendar date). */
export function isDateOnly(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function fmtDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  // Subscriptions that never expire carry a far-future end date
  if (d.getFullYear() >= 2099) return 'Never'
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

export function fmtDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function fmtBytes(n: number | string | null | undefined): string {
  const v = Number(n ?? 0)
  if (!Number.isFinite(v) || v <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(v) / Math.log(1024)))
  return `${(v / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function fmtMoney(amount: number | string | null | undefined, currency?: string | null): string {
  const v = Number(amount ?? 0)
  const n = Number.isFinite(v) ? v : 0
  return `${currency || 'LKR'} ${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** First array found in a response body (array, or { <key>: [...] }). */
export function pickList<T = any>(body: any, ...keys: string[]): T[] {
  if (Array.isArray(body)) return body as T[]
  if (body && typeof body === 'object') {
    for (const key of [...keys, 'data', 'items']) if (Array.isArray(body[key])) return body[key] as T[]
  }
  return []
}

export const BUSINESS_TYPES = [
  'retail', 'restaurant', 'supermarket', 'auto_service', 'dealership', 'pharmacy', 'electronics', 'hardware', 'print_studio', 'office',
] as const

export const BILLING_CYCLES = ['monthly', 'yearly', 'lifetime'] as const
export type BillingCycle = (typeof BILLING_CYCLES)[number]

export interface PagedListOptions<T> {
  /** Request path (with query) for a 1-based page. */
  path: (page: number) => string
  /** Pull the rows and total out of the response body. */
  pick: (body: any) => { rows: T[]; total?: number }
  /** Reload from page 1 whenever one of these changes. */
  deps: unknown[]
  enabled?: boolean
}

/** Paged sys-control list: first page replaces, `loadMore` appends, `refresh` is silent. */
export function usePagedList<T>(opts: PagedListOptions<T>) {
  const [rows, setRows] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extra, setExtra] = useState<any>(null)
  const seq = useRef(0)
  const optsRef = useRef(opts)
  optsRef.current = opts

  const fetchPage = useCallback(async (p: number, mode: 'replace' | 'append' | 'silent') => {
    const mine = ++seq.current
    if (mode === 'append') setLoadingMore(true)
    else if (mode === 'replace') setLoading(true)
    setError(null)
    const res = await adminGet<any>(optsRef.current.path(p))
    if (mine !== seq.current) return
    if (!res.ok) {
      setError(res.error)
      if (mode !== 'append') setRows([])
    } else {
      const picked = optsRef.current.pick(res.data)
      setRows((prev) => (mode === 'append' ? [...prev, ...picked.rows] : picked.rows))
      setTotal(picked.total ?? picked.rows.length)
      setPage(p)
      if (p === 1) setExtra(res.data)
    }
    setLoading(false)
    setLoadingMore(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    if (opts.enabled === false) return
    fetchPage(1, 'replace')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPage, opts.enabled, ...opts.deps])

  return {
    rows,
    setRows,
    total,
    loading,
    loadingMore,
    refreshing,
    error,
    /** Raw body of the first page (counts, tiers, …). */
    extra,
    hasMore: rows.length < total,
    reload: () => fetchPage(1, 'replace'),
    silentReload: () => fetchPage(1, 'silent'),
    refresh: () => {
      setRefreshing(true)
      return fetchPage(1, 'silent')
    },
    loadMore: () => {
      if (loadingMore || loading || rows.length >= total) return
      return fetchPage(page + 1, 'append')
    },
  }
}
