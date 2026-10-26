'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Award, TrendingUp, DollarSign, Star, Trophy, RefreshCw } from 'lucide-react'

interface StaffLeaderboardRow {
  rank: number
  staffId: string | null
  staffName: string
  staffEmail: string
  staffRole: string
  employeeCode: string | null
  salesCount: number
  totalRevenue: number
  totalDiscount: number
  averageOrderValue: number
  starPoints: number
}

interface ReportData {
  period: { fromDate: string; toDate: string }
  leaderboard: StaffLeaderboardRow[]
  totalSalesCount: number
  totalSalesRevenue: number
  totalStarPoints: number
}

export default function StaffPerformanceReportPage() {
  const params = useParams()
  const slug = params.slug as string

  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month' | 'custom'>('month')
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [toDate, setToDate] = useState(() => {
    return new Date().toISOString().slice(0, 10)
  })

  const [report, setReport] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function setPreset(preset: 'today' | 'week' | 'month') {
    setDateFilter(preset)
    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)
    setToDate(todayStr)

    if (preset === 'today') {
      setFromDate(todayStr)
    } else if (preset === 'week') {
      const past = new Date(now.getTime() - 7 * 86400000)
      setFromDate(past.toISOString().slice(0, 10))
    } else if (preset === 'month') {
      setFromDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`)
    }
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/reports/staff-performance?fromDate=${fromDate}&toDate=${toDate}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load staff performance report')
        return
      }
      setReport(data)
    } catch {
      setError('Connection error loading report')
    } finally {
      setLoading(false)
    }
  }, [fromDate, toDate])

  useEffect(() => {
    loadData()
  }, [loadData])

  const topPerformer = report?.leaderboard?.[0]

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href={`/c/${slug}/reports`}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-white"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Trophy className="text-amber-500" size={26} />
              Staff Sales &amp; Performance Leaderboard
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Track cashier sales, employee code attribution, and earned performance star points
            </p>
          </div>
        </div>

        {/* Date Filters */}
        <div className="flex items-center gap-2 bg-white dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold">
          <button
            type="button"
            onClick={() => setPreset('today')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              dateFilter === 'today' ? 'bg-teal-700 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setPreset('week')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              dateFilter === 'week' ? 'bg-teal-700 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            Last 7 Days
          </button>
          <button
            type="button"
            onClick={() => setPreset('month')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              dateFilter === 'month' ? 'bg-teal-700 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            This Month
          </button>
          <button
            type="button"
            onClick={loadData}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase mb-2">
            <DollarSign size={16} className="text-teal-600" /> Total Staff Sales
          </div>
          <p className="text-2xl font-black font-mono text-slate-900 dark:text-white">
            LKR {(report?.totalSalesRevenue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase mb-2">
            <TrendingUp size={16} className="text-blue-600" /> Completed Orders
          </div>
          <p className="text-2xl font-black font-mono text-slate-900 dark:text-white">
            {(report?.totalSalesCount || 0).toLocaleString()} orders
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-xs font-bold uppercase mb-2">
            <Star size={16} className="text-amber-500 fill-amber-500" /> Performance Points
          </div>
          <p className="text-2xl font-black font-mono text-amber-600 dark:text-amber-400">
            {(report?.totalStarPoints || 0).toLocaleString()} pts
          </p>
        </div>

        <div className="bg-gradient-to-br from-amber-50 to-orange-50 dark:from-slate-800 dark:to-slate-800 p-5 rounded-2xl border border-amber-200 dark:border-amber-900/40 shadow-xs">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-400 text-xs font-bold uppercase mb-2">
            <Award size={16} className="text-amber-600" /> Top Salesperson
          </div>
          <p className="text-lg font-black text-slate-900 dark:text-white truncate">
            {topPerformer ? topPerformer.staffName : '—'}
          </p>
          {topPerformer?.employeeCode && (
            <span className="text-[10px] font-mono font-bold bg-amber-200/80 text-amber-900 px-1.5 py-0.5 rounded">
              {topPerformer.employeeCode}
            </span>
          )}
        </div>
      </div>

      {/* Leaderboard Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
          <h3 className="font-extrabold text-slate-800 dark:text-white text-base">
            Sales Performance Leaderboard
          </h3>
          <span className="text-xs text-slate-400">
            Ranked by total revenue &amp; star points
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 text-xs uppercase font-extrabold border-b border-slate-200 dark:border-slate-700">
                <th className="py-3 px-4 w-16 text-center">Rank</th>
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-3 w-32">Employee Code</th>
                <th className="py-3 px-3 text-right">Orders</th>
                <th className="py-3 px-4 text-right">Total Revenue</th>
                <th className="py-3 px-3 text-right">Avg Order</th>
                <th className="py-3 px-4 text-right">Star Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
              {report?.leaderboard?.map((row) => {
                const isTop1 = row.rank === 1
                const isTop2 = row.rank === 2
                const isTop3 = row.rank === 3

                return (
                  <tr key={row.staffId || row.rank} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/30 transition-colors">
                    <td className="py-3 px-4 text-center">
                      {isTop1 ? (
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-800 font-black text-xs shadow-xs">
                          🥇
                        </span>
                      ) : isTop2 ? (
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-200 text-slate-700 font-black text-xs">
                          🥈
                        </span>
                      ) : isTop3 ? (
                        <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-orange-100 text-orange-800 font-black text-xs">
                          🥉
                        </span>
                      ) : (
                        <span className="text-slate-400 font-mono text-xs font-bold">
                          #{row.rank}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 dark:text-white">
                        {row.staffName}
                      </div>
                      <div className="text-xs text-slate-400 capitalize">
                        {row.staffRole}
                      </div>
                    </td>

                    <td className="py-3 px-3">
                      {row.employeeCode ? (
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-600">
                          {row.employeeCode}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 font-mono">—</span>
                      )}
                    </td>

                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-700 dark:text-slate-300">
                      {row.salesCount}
                    </td>

                    <td className="py-3 px-4 text-right font-mono font-bold text-slate-900 dark:text-white">
                      LKR {row.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>

                    <td className="py-3 px-3 text-right font-mono text-slate-600 dark:text-slate-400 text-xs">
                      LKR {row.averageOrderValue.toFixed(2)}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <span className="inline-flex items-center gap-1 font-mono font-black text-amber-600 dark:text-amber-400">
                        <Star size={13} className="fill-amber-500 text-amber-500" />
                        {row.starPoints.toLocaleString()}
                      </span>
                    </td>
                  </tr>
                )
              })}

              {(!report?.leaderboard || report.leaderboard.length === 0) && !loading && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    No sales data found for the selected date range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

