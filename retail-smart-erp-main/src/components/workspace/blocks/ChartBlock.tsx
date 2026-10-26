'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, BarChart3, TrendingUp, PieChart as PieIcon } from 'lucide-react'
import type { ChartBlock as ChartBlockType, ChartData } from '@/lib/workspace/types'
import BarChart from '../charts/BarChart'
import LineChart from '../charts/LineChart'
import PieChart from '../charts/PieChart'
import DoughnutChart from '../charts/DoughnutChart'

interface ChartBlockProps {
  block: ChartBlockType
  refreshKey?: number
}

export function ChartBlock({ block, refreshKey }: ChartBlockProps) {
  const { title, chartKey, chartType, color, height } = block.data
  const [data, setData] = useState<ChartData | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/chart-data?key=${chartKey}`)
      if (res.ok) {
        const result = await res.json()
        setData(result)
      } else {
        console.error(`Failed to fetch chart data '${chartKey}' (${res.status})`)
      }
    } catch (error) {
      console.error('Failed to fetch chart data:', error)
    } finally {
      setLoading(false)
    }
  }, [chartKey])

  useEffect(() => {
    fetchData()
  }, [fetchData, refreshKey])

  const chartProps = data ? {
    labels: data.labels,
    datasets: data.datasets,
    height: height || 300,
    color: color,
  } : null

  const ChartComponent = {
    bar: BarChart,
    line: LineChart,
    pie: PieChart,
    doughnut: DoughnutChart,
  }[chartType]

  const TypeIcon = {
    bar: BarChart3,
    line: TrendingUp,
    pie: PieIcon,
    doughnut: PieIcon,
  }[chartType] || BarChart3

  return (
    <div className="bg-white dark:bg-gray-800/90 backdrop-blur-sm rounded-xl border border-gray-200/90 dark:border-gray-700/80 shadow-sm overflow-hidden w-full flex flex-col transition-all hover:border-gray-300 dark:hover:border-gray-600">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700/60 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
            <TypeIcon className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-semibold text-gray-800 dark:text-gray-200 uppercase tracking-wider truncate">
            {title}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200/60 dark:border-emerald-800/40">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        </div>
      </div>
      <div className="p-4 flex-1">
        {loading ? (
          <div className="flex items-center justify-center" style={{ height: height || 300 }}>
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : chartProps ? (
          <ChartComponent {...chartProps} />
        ) : (
          <div className="flex items-center justify-center text-sm text-gray-400" style={{ height: height || 300 }}>
            No data available
          </div>
        )}
      </div>
    </div>
  )
}
