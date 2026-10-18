'use client'

import { motion } from 'framer-motion'

const revenueData = [32, 38, 35, 42, 48, 52]
const expensesData = [24, 28, 26, 30, 31, 34]
const months = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const chartW = 280
const chartH = 100
const padL = 0
const padR = 0
const padT = 5
const padB = 16

const maxVal = 60
const plotW = chartW - padL - padR
const plotH = chartH - padT - padB

function toX(i: number) {
  return padL + (i / (revenueData.length - 1)) * plotW
}

function toY(val: number) {
  return padT + plotH - (val / maxVal) * plotH
}

const revenuePoints = revenueData.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')
const expensesPoints = expensesData.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')

const revenueAreaPoints = `${toX(0)},${padT + plotH} ${revenuePoints} ${toX(revenueData.length - 1)},${padT + plotH}`
const expensesAreaPoints = `${toX(0)},${padT + plotH} ${expensesPoints} ${toX(expensesData.length - 1)},${padT + plotH}`

interface AccountingModule {
  title: string
  subtitle: string
  iconBg: string
  iconColor: string
  icon: React.ReactNode
  extra?: React.ReactNode
}

const modules: AccountingModule[] = [
  {
    title: 'Chart of Accounts',
    subtitle: '142 accounts configured',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
      </svg>
    ),
  },
  {
    title: 'Journal Entries',
    subtitle: '38 entries this month',
    iconBg: 'bg-green-100',
    iconColor: 'text-green-600',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
  {
    title: 'Bank Reconciliation',
    subtitle: '3 accounts to reconcile',
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-600',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
  },
  {
    title: 'Financial Statements',
    subtitle: 'P&L, Balance Sheet',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-600',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    title: 'Tax Management',
    subtitle: '6 tax rules active',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-600',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
      </svg>
    ),
  },
  {
    title: 'Budget Tracking',
    subtitle: '78% of Q1 budget used',
    iconBg: 'bg-teal-100',
    iconColor: 'text-teal-600',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
      </svg>
    ),
    extra: (
      <div className="mt-1.5 w-full h-1.5 rounded-full bg-teal-100">
        <motion.div
          className="h-full rounded-full bg-teal-500"
          initial={{ width: 0 }}
          animate={{ width: '78%' }}
          transition={{ duration: 0.8, delay: 0.5, ease: 'easeOut' }}
        />
      </div>
    ),
  },
]

const stats = [
  { label: 'Revenue MTD', value: '$48,250', color: 'text-gray-900' },
  { label: 'Expenses MTD', value: '$31,180', color: 'text-gray-900' },
  { label: 'Net Profit', value: '$17,070', color: 'text-green-600' },
  { label: 'Receivables', value: '$12,840', color: 'text-amber-600' },
]

export function MockAccounting() {
  return (
    <div className="bg-gray-50 p-3 min-h-[300px] text-[10px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <div>
          <h3 className="font-bold text-gray-900 text-[13px]">Accounting</h3>
          <p className="text-gray-500 mt-0.5">Manage your finances and compliance</p>
        </div>
        <div className="bg-white text-gray-600 px-2 py-1.5 rounded-md border border-gray-200 font-medium text-[10px]">
          FY 2025-26
        </div>
      </div>

      {/* Quick financial stats bar */}
      <motion.div
        className="bg-white rounded border border-gray-200 p-2 shadow-sm flex items-center justify-between mb-2.5"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {stats.map((stat, i) => (
          <div key={stat.label} className="flex items-center gap-3">
            {i > 0 && <div className="w-px h-6 bg-gray-200" />}
            <div>
              <span className="text-gray-500">{stat.label}</span>
              <div className={`font-bold text-[12px] ${stat.color}`}>{stat.value}</div>
            </div>
          </div>
        ))}
      </motion.div>

      {/* Revenue vs Expenses chart */}
      <motion.div
        className="bg-white rounded border border-gray-200 p-3 shadow-sm mb-2.5"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold text-gray-900 text-[11px]">Revenue vs Expenses</span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-gray-400">Revenue</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-gray-400">Expenses</span>
            </div>
          </div>
        </div>

        <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f87171" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#f87171" stopOpacity="0.02" />
            </linearGradient>
            <clipPath id="revealClip">
              <motion.rect
                x="0"
                y="0"
                height={chartH}
                initial={{ width: 0 }}
                animate={{ width: chartW }}
                transition={{ duration: 1.2, delay: 0.3, ease: 'easeOut' }}
              />
            </clipPath>
          </defs>

          {/* Grid lines */}
          {[0, 1, 2, 3].map((i) => {
            const y = padT + (plotH / 3) * i
            return (
              <line
                key={i}
                x1={padL}
                y1={y}
                x2={chartW - padR}
                y2={y}
                stroke="#e5e7eb"
                strokeWidth="0.5"
                strokeDasharray="2,2"
              />
            )
          })}

          {/* Animated area + line group */}
          <g clipPath="url(#revealClip)">
            {/* Revenue area fill */}
            <polygon points={revenueAreaPoints} fill="url(#revGrad)" />
            {/* Expenses area fill */}
            <polygon points={expensesAreaPoints} fill="url(#expGrad)" />
            {/* Revenue line */}
            <polyline
              points={revenuePoints}
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Expenses line */}
            <polyline
              points={expensesPoints}
              fill="none"
              stroke="#f87171"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Revenue dots */}
            {revenueData.map((v, i) => (
              <circle
                key={`r${i}`}
                cx={toX(i)}
                cy={toY(v)}
                r="2.5"
                fill="#fff"
                stroke="#10b981"
                strokeWidth="1.5"
              />
            ))}
            {/* Expenses dots */}
            {expensesData.map((v, i) => (
              <circle
                key={`e${i}`}
                cx={toX(i)}
                cy={toY(v)}
                r="2.5"
                fill="#fff"
                stroke="#f87171"
                strokeWidth="1.5"
              />
            ))}
          </g>

          {/* X-axis labels */}
          {months.map((m, i) => (
            <text
              key={m}
              x={toX(i)}
              y={chartH - 2}
              textAnchor="middle"
              className="fill-gray-400"
              fontSize="8"
            >
              {m}
            </text>
          ))}
        </svg>
      </motion.div>

      {/* 2x3 Accounting module grid */}
      <div className="grid grid-cols-3 gap-2 mb-2.5">
        {modules.map((mod, i) => (
          <motion.div
            key={mod.title}
            className="bg-white rounded border border-gray-200 p-2.5 shadow-sm hover:shadow-md hover:border-gray-300 cursor-pointer group transition-shadow"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.06 }}
            whileHover={{ y: -2 }}
          >
            <div className="flex items-start justify-between mb-1.5">
              <div className={`w-7 h-7 rounded ${mod.iconBg} ${mod.iconColor} flex items-center justify-center`}>
                {mod.icon}
              </div>
              <svg
                className="w-3 h-3 text-gray-300 group-hover:text-gray-500 transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
            <div className="font-semibold text-gray-900 text-[11px]">{mod.title}</div>
            <div className="text-gray-500 mt-0.5">{mod.subtitle}</div>
            {mod.extra}
          </motion.div>
        ))}
      </div>

      {/* View Reports link */}
      <div className="flex justify-end">
        <div className="text-indigo-600 font-semibold flex items-center gap-1 cursor-pointer hover:text-indigo-700 transition-colors">
          View Reports
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </div>
      </div>
    </div>
  )
}
