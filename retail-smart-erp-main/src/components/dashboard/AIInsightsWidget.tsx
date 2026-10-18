'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Sparkles, TrendingUp, TrendingDown, Minus,
  AlertTriangle, Lightbulb, BarChart3, Info,
  RefreshCw, Loader2,
} from 'lucide-react'

interface Insight {
  title: string
  description: string
  type: 'trend' | 'alert' | 'opportunity' | 'info'
  trend?: 'up' | 'down' | 'stable'
}

interface InsightsData {
  enabled: boolean
  insights: Insight[]
  metrics?: {
    todaySales: number
    todayCount: number
    weekSales: number
    monthSales: number
    lowStockCount: number
    pendingOrders: number
  }
  generatedAt?: string
  message?: string
}

const typeIcons = {
  trend: BarChart3,
  alert: AlertTriangle,
  opportunity: Lightbulb,
  info: Info,
}

const typeColors = {
  trend: 'text-blue-500 bg-blue-50 dark:bg-blue-900/20',
  alert: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20',
  opportunity: 'text-green-500 bg-green-50 dark:bg-green-900/20',
  info: 'text-gray-500 bg-gray-50 dark:bg-gray-800',
}

const trendIcons = {
  up: TrendingUp,
  down: TrendingDown,
  stable: Minus,
}

export function AIInsightsWidget() {
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchInsights = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    try {
      const res = await fetch('/api/ai/insights')
      if (res.ok) {
        const result = await res.json()
        setData(result)
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchInsights()
  }, [fetchInsights])

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={18} className="text-purple-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">AI Insights</h3>
        </div>
        <div className="flex items-center justify-center py-6">
          <Loader2 size={20} className="animate-spin text-purple-400" />
          <span className="ml-2 text-sm text-gray-400">Analyzing your business data...</span>
        </div>
      </div>
    )
  }

  if (!data || !data.enabled) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={18} className="text-gray-400" />
          <h3 className="font-semibold text-gray-900 dark:text-white">AI Insights</h3>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {data?.message || 'AI features are not configured.'}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-purple-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white">AI Insights</h3>
          <span className="text-[10px] bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded-full font-medium">
            AI
          </span>
        </div>
        <button
          type="button"
          onClick={() => fetchInsights(true)}
          disabled={refreshing}
          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
          title="Refresh insights"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {data.insights.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
          Not enough data yet for insights. Keep using the system!
        </p>
      ) : (
        <div className="space-y-2.5">
          {data.insights.map((insight, i) => {
            const TypeIcon = typeIcons[insight.type] || Info
            const TrendIcon = insight.trend ? trendIcons[insight.trend] : null
            const colorClass = typeColors[insight.type] || typeColors.info

            return (
              <div
                key={i}
                className="flex items-start gap-2.5 p-2.5 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className={`p-1.5 rounded-md flex-shrink-0 ${colorClass}`}>
                  <TypeIcon size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-gray-900 dark:text-white">
                      {insight.title}
                    </span>
                    {TrendIcon && (
                      <TrendIcon
                        size={14}
                        className={
                          insight.trend === 'up' ? 'text-green-500' :
                          insight.trend === 'down' ? 'text-red-500' :
                          'text-gray-400'
                        }
                      />
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                    {insight.description}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {data.generatedAt && (
        <div className="mt-3 pt-2 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <span className="text-[10px] text-gray-400">
            Updated {new Date(data.generatedAt).toLocaleTimeString()}
          </span>
          <span className="text-[10px] text-purple-400 flex items-center gap-1">
            <Sparkles size={9} /> Powered by AI
          </span>
        </div>
      )}
    </div>
  )
}
