'use client'

import { motion } from 'framer-motion'

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const metrics = [
  {
    label: "Today's Revenue",
    value: '$12,458',
    change: '+8.2%',
    iconBg: 'bg-green-100',
    iconColor: 'text-green-600',
    changeBg: 'bg-green-50 text-green-700',
    icon: (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
      </svg>
    ),
  },
  {
    label: 'Orders',
    value: '84',
    change: '+12 today',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    changeBg: 'bg-blue-50 text-blue-700',
    icon: (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    label: 'Customers',
    value: '156',
    change: '+23 new',
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-600',
    changeBg: 'bg-purple-50 text-purple-700',
    icon: (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    label: 'Avg Order',
    value: '$148.30',
    change: '+5.1%',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    changeBg: 'bg-amber-50 text-amber-700',
    icon: (
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
  },
]

const thisWeek = [2800, 3400, 2100, 4200, 3100, 5800, 4600]
const lastWeek = [2200, 2900, 1800, 3500, 2700, 4900, 3800]
const barLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const maxBarValue = Math.max(...thisWeek, ...lastWeek)

const monthlyTrend = [3200, 4100, 3800, 5200, 4800, 6400]
const monthLabels = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb']

const topProducts = [
  { name: 'Premium Coffee Blend', sales: 142, pct: 100 },
  { name: 'Organic Green Tea', sales: 118, pct: 83 },
  { name: 'Wireless Earbuds Pro', sales: 96, pct: 68 },
  { name: 'Smart Watch Band', sales: 74, pct: 52 },
]

const recentOrders = [
  { id: '#1284', customer: 'Sarah M.', amount: '$234', status: 'Paid', color: 'bg-green-100 text-green-700' },
  { id: '#1283', customer: 'James K.', amount: '$89', status: 'New', color: 'bg-blue-100 text-blue-700' },
  { id: '#1282', customer: 'Emily R.', amount: '$413', status: 'Paid', color: 'bg-green-100 text-green-700' },
  { id: '#1281', customer: 'David L.', amount: '$167', status: 'Pending', color: 'bg-amber-100 text-amber-700' },
]

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function buildPolylinePoints(
  data: number[],
  width: number,
  height: number,
  padX = 0,
  padY = 4,
): string {
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const stepX = (width - padX * 2) / (data.length - 1)
  return data
    .map((v, i) => {
      const x = padX + i * stepX
      const y = padY + (1 - (v - min) / range) * (height - padY * 2)
      return `${x},${y}`
    })
    .join(' ')
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function MockDashboard() {
  const chartW = 200
  const chartH = 48
  const trendPoints = buildPolylinePoints(monthlyTrend, chartW, chartH)

  return (
    <div className="p-3 bg-gray-50 text-[10px] min-w-[540px]" style={{ minHeight: 340 }}>
      {/* ---- Metric cards ---- */}
      <div className="grid grid-cols-4 gap-2 mb-2.5">
        {metrics.map((m, i) => (
          <motion.div
            key={m.label}
            className="bg-white rounded border border-gray-100 p-2 shadow-sm"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-gray-500 font-medium truncate">{m.label}</span>
              <div
                className={`w-5 h-5 rounded-md ${m.iconBg} ${m.iconColor} flex items-center justify-center shrink-0`}
              >
                {m.icon}
              </div>
            </div>
            <div className="text-[13px] font-bold text-gray-900 leading-tight">{m.value}</div>
            <div
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full mt-1 text-[8px] font-medium ${m.changeBg}`}
            >
              {m.change}
            </div>
          </motion.div>
        ))}
      </div>

      {/* ---- Middle row: bar chart + monthly trend ---- */}
      <div className="grid grid-cols-3 gap-2 mb-2.5">
        {/* Weekly Revenue bar chart */}
        <div className="col-span-2 bg-white rounded border border-gray-100 p-2.5 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-gray-900 text-[11px]">Weekly Revenue</span>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
                <span className="text-gray-400">This Week</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-200 inline-block" />
                <span className="text-gray-400">Last Week</span>
              </span>
            </div>
          </div>

          {/* SVG bar chart */}
          <svg viewBox="0 0 280 90" className="w-full" preserveAspectRatio="xMidYMid meet">
            {barLabels.map((label, i) => {
              const groupX = 10 + i * 39
              const twH = (thisWeek[i] / maxBarValue) * 65
              const lwH = (lastWeek[i] / maxBarValue) * 65
              const twY = 72 - twH
              const lwY = 72 - lwH
              return (
                <g key={label}>
                  <motion.rect
                    x={groupX}
                    y={72}
                    width={10}
                    rx={2}
                    fill="#c7d2fe"
                    initial={{ height: 0, y: 72 }}
                    animate={{ height: lwH, y: lwY }}
                    transition={{ delay: 0.3 + i * 0.05, duration: 0.5, ease: 'easeOut' }}
                  />
                  <motion.rect
                    x={groupX + 12}
                    y={72}
                    width={10}
                    rx={2}
                    fill="#6366f1"
                    initial={{ height: 0, y: 72 }}
                    animate={{ height: twH, y: twY }}
                    transition={{ delay: 0.35 + i * 0.05, duration: 0.5, ease: 'easeOut' }}
                  />
                  <text x={groupX + 11} y={84} textAnchor="middle" className="fill-gray-400" fontSize={8}>
                    {label}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>

        {/* Monthly Trend line chart */}
        <div className="bg-white rounded border border-gray-100 p-2.5 shadow-sm flex flex-col">
          <span className="font-semibold text-gray-900 text-[11px] mb-1">Monthly Trend</span>
          <div className="flex-1 flex items-center">
            <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full" preserveAspectRatio="xMidYMid meet">
              <defs>
                <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <motion.polygon
                points={`${trendPoints} ${chartW},${chartH} 0,${chartH}`}
                fill="url(#trendGrad)"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6, duration: 0.6 }}
              />
              <motion.polyline
                points={trendPoints}
                fill="none"
                stroke="#6366f1"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.8, ease: 'easeOut' }}
              />
              {monthlyTrend.map((v, i) => {
                const min = Math.min(...monthlyTrend)
                const max = Math.max(...monthlyTrend)
                const range = max - min || 1
                const stepX = chartW / (monthlyTrend.length - 1)
                const x = i * stepX
                const y = 4 + (1 - (v - min) / range) * (chartH - 8)
                return (
                  <motion.circle
                    key={i}
                    cx={x}
                    cy={y}
                    r={2.5}
                    fill="white"
                    stroke="#6366f1"
                    strokeWidth={1.5}
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.7 + i * 0.06 }}
                  />
                )
              })}
            </svg>
          </div>
          <div className="flex justify-between mt-1">
            {monthLabels.map((l) => (
              <span key={l} className="text-[7px] text-gray-400">{l}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ---- Bottom row: AI Insight + Top Products | Recent Orders ---- */}
      <div className="grid grid-cols-2 gap-2">
        {/* Left column: AI Insight + Top Products stacked */}
        <div className="flex flex-col gap-2">
          {/* AI Insight */}
          <motion.div
            className="bg-white rounded border-2 border-purple-200 p-2.5 shadow-sm relative overflow-hidden"
            animate={{
              borderColor: ['rgb(233,213,255)', 'rgb(196,181,253)', 'rgb(233,213,255)'],
            }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            <div className="absolute top-0 right-0 w-12 h-12 bg-gradient-to-bl from-purple-100 to-transparent rounded-bl-full opacity-50" />
            <div className="flex items-center gap-1 mb-1">
              <div className="w-4 h-4 rounded-md bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center shrink-0">
                <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2L9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2z" />
                </svg>
              </div>
              <span className="font-semibold text-purple-800 text-[11px]">AI Insight</span>
            </div>
            <p className="text-gray-600 leading-relaxed">
              Revenue forecast predicts a{' '}
              <span className="font-bold text-purple-700">23% increase</span> this weekend.
            </p>
          </motion.div>

          {/* Top Products */}
          <div className="bg-white rounded border border-gray-100 p-2.5 shadow-sm flex-1">
            <span className="font-semibold text-gray-900 text-[11px]">Top Products</span>
            <div className="mt-1.5 space-y-1.5">
              {topProducts.map((p, i) => (
                <motion.div
                  key={p.name}
                  className="flex items-center gap-1.5"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + i * 0.07 }}
                >
                  <span className="text-gray-400 w-3 text-right shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-gray-700 font-medium truncate">{p.name}</span>
                      <span className="text-gray-500 shrink-0 ml-1">{p.sales}</span>
                    </div>
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-indigo-400 rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${p.pct}%` }}
                        transition={{ delay: 0.5 + i * 0.07, duration: 0.5, ease: 'easeOut' }}
                      />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column: Recent Orders (wider) */}
        <div className="bg-white rounded border border-gray-100 p-2.5 shadow-sm">
          <span className="font-semibold text-gray-900 text-[11px]">Recent Orders</span>
          <table className="w-full mt-1.5">
            <thead>
              <tr className="text-[8px] text-gray-400 uppercase tracking-wide">
                <th className="text-left font-medium pb-1">Order</th>
                <th className="text-left font-medium pb-1">Customer</th>
                <th className="text-right font-medium pb-1">Amount</th>
                <th className="text-right font-medium pb-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((o, i) => (
                <motion.tr
                  key={o.id}
                  className="border-t border-gray-50"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 + i * 0.08 }}
                >
                  <td className="py-1 text-gray-700 font-medium">{o.id}</td>
                  <td className="py-1 text-gray-500">{o.customer}</td>
                  <td className="py-1 text-right text-gray-700 font-medium">{o.amount}</td>
                  <td className="py-1 text-right">
                    <span className={`inline-block px-1.5 py-0.5 rounded-full text-[7px] font-medium ${o.color}`}>
                      {o.status}
                    </span>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
