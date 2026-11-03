// Search + pagination + pull-to-refresh state for the native list screens. Reads the common list
// shapes of the API: { data, pagination } · { <key>: [] } · bare array.
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, asList, isNetworkError, qs } from './api'

export function usePagedList<T = any>(
  endpoint: string,
  opts: { search?: string; pageSize?: number; extra?: Record<string, string | number | boolean | undefined>; listKeys?: string[]; paged?: boolean } = {}
) {
  const { search = '', pageSize = 30, extra, listKeys = [], paged = true } = opts
  const [rows, setRows] = useState<T[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const extraKey = JSON.stringify(extra || {})
  const keysKey = listKeys.join(',')

  const load = useCallback(
    async (p: number, append: boolean) => {
      const s = ++seq.current
      if (append) setLoadingMore(true)
      const params = { ...(extra || {}), search: search.trim() || undefined, ...(paged ? { page: p, pageSize } : {}) }
      const res = await apiGet<any>(`${endpoint}${qs(params as Record<string, string | number | boolean | undefined>)}`)
      if (s !== seq.current) return
      if (res.ok) {
        const list = asList<T>(res.data, ...listKeys)
        setRows((prev) => (append ? [...prev, ...list] : list))
        setPage(p)
        setTotalPages(res.data?.pagination?.totalPages || 1)
        setTotal(typeof res.data?.pagination?.total === 'number' ? res.data.pagination.total : list.length)
        setError(null)
      } else {
        if (!append) setRows([])
        setError(
          isNetworkError(res)
            ? 'Offline — this list needs a connection.'
            : res.status === 403
              ? 'Your role or this business does not have access to this list.'
              : res.error
        )
      }
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endpoint, search, pageSize, extraKey, keysKey, paged]
  )

  useEffect(() => {
    setLoading(true)
    const t = setTimeout(() => load(1, false), search ? 300 : 0)
    return () => clearTimeout(t)
  }, [load, search])

  return {
    rows,
    total,
    loading,
    loadingMore,
    refreshing,
    error,
    hasMore: paged && page < totalPages,
    reload: () => load(1, false),
    refresh: () => {
      setRefreshing(true)
      return load(1, false)
    },
    loadMore: () => {
      if (paged && !loadingMore && !loading && page < totalPages) load(page + 1, true)
    },
  }
}
