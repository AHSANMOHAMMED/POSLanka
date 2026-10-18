'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
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

  return (
    <div className="bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden w-full flex flex-col">
      <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
        <h3 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
          {title}
        </h3>
      </div>
      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center" style={{ height: height || 300 }}>
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
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
