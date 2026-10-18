'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useDebouncedValue } from './useDebounce'
import { useRealtimeData } from './useRealtimeData'
import type { EntityType } from '@/lib/websocket/events'

interface PaginationInfo {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

interface UsePaginatedDataOptions {
  /** API endpoint to fetch data from */
  endpoint: string
  /** Entity type for WebSocket updates */
  entityType: EntityType | EntityType[]
  /** Default page size (default: 25) */
  defaultPageSize?: number
  /** localStorage key for persisting page size */
  storageKey?: string
  /** Additional query parameters */
  additionalParams?: Record<string, string>
  /** Whether to enable real-time updates (default: true) */
  realtimeEnabled?: boolean
  /** Search debounce delay in ms (default: 300) */
  searchDebounce?: number
}

interface UsePaginatedDataReturn<T> {
  /** The fetched data */
  data: T[]
  /** Pagination information */
  pagination: PaginationInfo
  /** Loading state */
  loading: boolean
  /** Error message if any */
  error: string | null
  /** Current search term */
  search: string
  /** Update search term */
  setSearch: (search: string) => void
  /** Update current page */
  setPage: (page: number) => void
  /** Update page size */
  setPageSize: (pageSize: number) => void
  /** Update additional params (e.g., filters) */
  setAdditionalParams: (params: Record<string, string>) => void
  /** Manually trigger a refresh */
  refresh: () => void
  /** Whether real-time updates are active */
  isRealtime: boolean
}


/**
 * Hook for paginated data fetching with search, real-time updates, and localStorage persistence
 *
 * @example
 * const {
 *   data,
 *   pagination,
 *   loading,
 *   search,
 *   setSearch,
 *   setPage,
 *   setPageSize,
 *   refresh,
 *   isRealtime,
 * } = usePaginatedData<Customer>({
 *   endpoint: '/api/customers',
 *   entityType: 'customer',
 *   storageKey: 'customers-page-size',
 * })
 */
export function usePaginatedData<T>({
  endpoint,
  entityType,
  defaultPageSize = 25,
  storageKey,
  additionalParams = {},
  realtimeEnabled = true,
  searchDebounce = 300,
}: UsePaginatedDataOptions): UsePaginatedDataReturn<T> {
  // Initialize page size from localStorage or default
  const [pageSize, setPageSizeState] = useState(() => {
    if (typeof window !== 'undefined' && storageKey) {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsed = parseInt(stored, 10)
        if (!isNaN(parsed) && parsed > 0) {
          return parsed
        }
      }
    }
    return defaultPageSize
  })

  const [page, setPage] = useState(1)
  const [search, setSearchState] = useState('')
  const [data, setData] = useState<T[]>([])
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    pageSize: defaultPageSize,
    total: 0,
    totalPages: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dynamicParams, setDynamicParams] = useState<Record<string, string>>({})

  // Track the current request to ignore stale responses (instance-specific counter)
  const requestCounterRef = useRef(0)
  const currentRequestRef = useRef(0)

  // Debounce search
  const debouncedSearch = useDebouncedValue(search, searchDebounce)

  // Merge config additionalParams with dynamic params
  const mergedParams = useMemo(() => ({
    ...additionalParams,
    ...dynamicParams,
  }), [additionalParams, dynamicParams])

  // Memoize additionalParams to prevent infinite loops from object reference changes
  const additionalParamsKey = JSON.stringify(mergedParams)
  const stableAdditionalParams = useMemo(
    () => mergedParams,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [additionalParamsKey]
  )

  // Track if search changed to reset page
  const prevSearchRef = useRef(debouncedSearch)

  // Track if additionalParams changed to reset page
  const prevAdditionalParamsRef = useRef(additionalParamsKey)

  // Reset to page 1 when search changes
  useEffect(() => {
    if (prevSearchRef.current !== debouncedSearch) {
      setPage(1)
      prevSearchRef.current = debouncedSearch
    }
  }, [debouncedSearch])

  // Reset to page 1 when additionalParams change (e.g., filters)
  useEffect(() => {
    if (prevAdditionalParamsRef.current !== additionalParamsKey) {
      setPage(1)
      prevAdditionalParamsRef.current = additionalParamsKey
    }
  }, [additionalParamsKey])

  // Build query string
  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (debouncedSearch) {
      params.set('search', debouncedSearch)
    }
    // Add additional params
    Object.entries(stableAdditionalParams).forEach(([key, value]) => {
      if (value) {
        params.set(key, value)
      }
    })
    return params.toString()
  }, [page, pageSize, debouncedSearch, stableAdditionalParams])

  // Fetch data
  const fetchData = useCallback(async () => {
    // Increment request counter and capture it for this request
    const thisRequest = ++requestCounterRef.current
    currentRequestRef.current = thisRequest

    try {
      setError(null)
      const queryString = buildQueryString()
      const url = `${endpoint}?${queryString}`

      const res = await fetch(url)

      // Check if this response is stale (a newer request was made)
      if (currentRequestRef.current !== thisRequest) {
        return // Ignore stale response
      }

      if (!res.ok) {
        let errorMessage = `Request failed (${res.status})`
        try {
          const errorBody = await res.json()
          if (errorBody.error) errorMessage = errorBody.error
          else if (errorBody.message) errorMessage = errorBody.message
        } catch {
          // Response body wasn't JSON
        }
        throw new Error(errorMessage)
      }

      const result = await res.json()

      // Double-check staleness after JSON parsing
      if (currentRequestRef.current !== thisRequest) {
        return // Ignore stale response
      }

      // Handle paginated response format { data, pagination }
      if (result.data && result.pagination) {
        setData(result.data)
        setPagination(result.pagination)
      } else if (Array.isArray(result)) {
        // Fallback for non-paginated response (backward compatibility)
        setData(result)
        setPagination({
          page: 1,
          pageSize: result.length,
          total: result.length,
          totalPages: 1,
        })
      } else {
        throw new Error('Unexpected response format')
      }
    } catch (err) {
      // Only set error if this is still the current request
      if (currentRequestRef.current === thisRequest) {
        console.error('Error fetching paginated data:', err)
        setError(err instanceof Error ? err.message : 'Failed to fetch data')
      }
    } finally {
      // Only clear loading if this is still the current request
      if (currentRequestRef.current === thisRequest) {
        setLoading(false)
      }
    }
  }, [endpoint, buildQueryString])

  // Initial fetch and fetch on dependencies change
  useEffect(() => {
    setLoading(true)
    fetchData()
  }, [fetchData])

  // Real-time updates
  const { isRealtime } = useRealtimeData(fetchData, {
    entityType,
    enabled: realtimeEnabled,
    refreshOnMount: false, // We handle initial fetch above
  })

  // Persist page size to localStorage
  const setPageSize = useCallback((newSize: number) => {
    setPageSizeState(newSize)
    setPage(1) // Reset to first page when changing page size
    if (storageKey && typeof window !== 'undefined') {
      localStorage.setItem(storageKey, String(newSize))
    }
  }, [storageKey])

  // Search setter
  const setSearch = useCallback((newSearch: string) => {
    setSearchState(newSearch)
  }, [])

  // Additional params setter (for dynamic filters)
  const setAdditionalParams = useCallback((params: Record<string, string>) => {
    setDynamicParams(params)
  }, [])

  return {
    data,
    pagination,
    loading,
    error,
    search,
    setSearch,
    setPage,
    setPageSize,
    setAdditionalParams,
    refresh: fetchData,
    isRealtime,
  }
}
