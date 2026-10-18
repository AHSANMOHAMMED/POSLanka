'use client'

import { useState, useCallback } from 'react'
import { DollarSign, TrendingUp, RotateCcw, Clock } from 'lucide-react'
import { InfoCard } from '@/components/ui/section-card'
import { useRealtimeData } from '@/hooks'
import { useCurrency } from '@/hooks/useCurrency'

interface DashboardStats {
  today: {
    totalSales: number
    totalReturns: number
    netSales: number
    transactionCount: number
    returnCount: number
    pendingCount: number
  }
  week: {
    totalSales: number
    netSales: number
    transactionCount: number
  }
  month: {
    totalSales: number
    netSales: number
    transactionCount: number
  }
  paymentBreakdown: {
    method: string
    count: number
    total: string
  }[]
}

export function SalesDashboard() {
  const { currency: currencyCode } = useCurrency()

  function formatAmount(amount: number): string {
    return `${currencyCode} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  const [stats, setStats] = useState<DashboardStats | null>(null)

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/sales/dashboard-stats')
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error)
    }
  }, [])

  useRealtimeData(fetchStats, { entityType: 'sale' })

  if (!stats) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-4 animate-pulse">
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20 mb-3" />
            <div className="h-7 bg-gray-200 dark:bg-gray-700 rounded w-28" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
      <InfoCard
        title="Today's Sales"
        value={formatAmount(stats.today.netSales)}
        subtitle={`${stats.today.transactionCount} transaction${stats.today.transactionCount !== 1 ? 's' : ''}`}
        icon={<DollarSign size={20} />}
      />
      <InfoCard
        title="This Week"
        value={formatAmount(stats.week.netSales)}
        subtitle={`${stats.week.transactionCount} transaction${stats.week.transactionCount !== 1 ? 's' : ''}`}
        icon={<TrendingUp size={20} />}
      />
      <InfoCard
        title="Returns Today"
        value={formatAmount(stats.today.totalReturns)}
        subtitle={`${stats.today.returnCount} return${stats.today.returnCount !== 1 ? 's' : ''}`}
        icon={<RotateCcw size={20} />}
      />
      <InfoCard
        title="Pending Payments"
        value={String(stats.today.pendingCount)}
        subtitle="Awaiting payment"
        icon={<Clock size={20} />}
      />
    </div>
  )
}
