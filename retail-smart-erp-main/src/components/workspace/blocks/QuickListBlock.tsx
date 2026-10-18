'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ChevronRight, Loader2 } from 'lucide-react'
import type { QuickListBlock as QuickListBlockType, QuickListData } from '@/lib/workspace/types'

interface QuickListBlockProps {
  block: QuickListBlockType
  basePath: string
  refreshKey?: number
}

function formatValue(value: unknown, type?: string): string {
  if (value === null || value === undefined) return '-'

  // Guard against objects being rendered directly
  if (typeof value === 'object' && !(value instanceof Date)) {
    try { return JSON.stringify(value) } catch { return '-' }
  }

  if (type === 'currency') {
    const num = Number(value)
    return isNaN(num) ? String(value) : num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  if (type === 'date') {
    const d = value instanceof Date ? value : new Date(value as string)
    if (isNaN(d.getTime())) return String(value)
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  }

  if (type === 'status') {
    const str = String(value)
    return str.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }

  return String(value)
}

const statusColors: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  paid: 'bg-green-100 text-green-700',
  active: 'bg-green-100 text-green-700',
  confirmed: 'bg-blue-100 text-blue-700',
  scheduled: 'bg-blue-100 text-blue-700',
  submitted: 'bg-blue-100 text-blue-700',
  pending: 'bg-yellow-100 text-yellow-700',
  draft: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-100 text-amber-700',
  under_review: 'bg-purple-100 text-purple-700',
  approved: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  void: 'bg-red-100 text-red-700',
  rejected: 'bg-red-100 text-red-700',
  arrived: 'bg-cyan-100 text-cyan-700',
  invoiced: 'bg-violet-100 text-violet-700',
}

export function QuickListBlock({ block, basePath, refreshKey }: QuickListBlockProps) {
  const { title, listKey, limit = 5, href } = block.data
  const [data, setData] = useState<QuickListData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/quick-list?key=${listKey}&limit=${limit}`)
      if (res.ok) {
        const result = await res.json()
        setData(result)
      } else {
        console.error(`Failed to fetch quick list '${listKey}' (${res.status})`)
      }
    } catch (error) {
      console.error('Failed to fetch quick list:', error)
    } finally {
      setLoading(false)
    }
  }, [listKey, limit])

  useEffect(() => {
    fetchData()
  }, [fetchData, refreshKey])

  return (
    <div className="bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden w-full flex flex-col">
      <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
          {title}
        </h3>
        <Link
          href={href}
          className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-0.5"
        >
          View All <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      ) : !data || data.rows.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-400">
          No records found
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700">
                {data.columns.map((col) => (
                  <th
                    key={col.key}
                    className="px-4 py-2 text-left text-xs font-medium text-gray-400 dark:text-gray-500"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => {
                const id = row.id as string
                // Determine detail link based on list key
                const detailHref = getDetailHref(listKey, id, basePath)

                return (
                  <tr
                    key={id || i}
                    className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors cursor-pointer"
                    onClick={() => {
                      if (detailHref) window.location.href = detailHref
                    }}
                  >
                    {data.columns.map((col) => {
                      const val = row[col.key]
                      if (col.type === 'status') {
                        const statusStr = String(val || '')
                        const colorClass = statusColors[statusStr] || 'bg-gray-100 text-gray-600'
                        return (
                          <td key={col.key} className="px-4 py-2.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
                              {formatValue(val, col.type)}
                            </span>
                          </td>
                        )
                      }
                      return (
                        <td key={col.key} className="px-4 py-2.5 text-gray-700 dark:text-gray-300 truncate max-w-[200px]">
                          {formatValue(val, col.type)}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function getDetailHref(listKey: string, id: string, basePath: string): string | null {
  const routes: Record<string, string> = {
    recent_sales: '/sales',
    recent_work_orders: '/work-orders',
    recent_customers: '/customers',
    recent_purchase_orders: '/purchase-orders',
    recent_estimates: '/insurance-estimates',
    recent_appointments: '/appointments',
    low_stock_items: '/items',
  }
  const route = routes[listKey]
  if (!route || !id) return null
  return `${basePath}${route}/${id}`
}
