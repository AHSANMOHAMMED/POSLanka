'use client'

import { motion } from 'framer-motion'

interface Deal {
  customer: string
  vehicle: string
  value: string
  daysOpen: number
  rep: string
  repInitials: string
  repColor: string
}

interface Stage {
  name: string
  color: string
  bgColor: string
  borderColor: string
  count: number
  total: string
  deals: Deal[]
}

const stages: Stage[] = [
  {
    name: 'Inquiry',
    color: 'text-gray-700',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-300',
    count: 6,
    total: '$186K',
    deals: [
      { customer: 'Alex Morgan', vehicle: '2024 Audi Q5', value: '$48,900', daysOpen: 1, rep: 'Mike T.', repInitials: 'MT', repColor: 'bg-blue-500' },
      { customer: 'Kim Lee', vehicle: '2024 BMW 330i', value: '$43,500', daysOpen: 2, rep: 'Lisa R.', repInitials: 'LR', repColor: 'bg-purple-500' },
    ],
  },
  {
    name: 'Test Drive',
    color: 'text-cyan-700',
    bgColor: 'bg-cyan-50',
    borderColor: 'border-cyan-300',
    count: 4,
    total: '$158K',
    deals: [
      { customer: 'James Wilson', vehicle: '2024 BMW X3', value: '$49,800', daysOpen: 3, rep: 'Mike T.', repInitials: 'MT', repColor: 'bg-blue-500' },
      { customer: 'Sarah Chen', vehicle: '2024 Mercedes C300', value: '$47,200', daysOpen: 5, rep: 'Lisa R.', repInitials: 'LR', repColor: 'bg-purple-500' },
    ],
  },
  {
    name: 'Negotiation',
    color: 'text-amber-700',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-300',
    count: 3,
    total: '$124K',
    deals: [
      { customer: 'Emily Park', vehicle: '2023 Honda CR-V', value: '$36,450', daysOpen: 7, rep: 'David K.', repInitials: 'DK', repColor: 'bg-teal-500' },
      { customer: 'Robert Davis', vehicle: '2024 Toyota Camry', value: '$34,990', daysOpen: 4, rep: 'Mike T.', repInitials: 'MT', repColor: 'bg-blue-500' },
    ],
  },
  {
    name: 'Closed Won',
    color: 'text-green-700',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-300',
    count: 8,
    total: '$342K',
    deals: [
      { customer: 'Mark Thompson', vehicle: '2022 Ford F-150', value: '$42,500', daysOpen: 12, rep: 'Lisa R.', repInitials: 'LR', repColor: 'bg-purple-500' },
      { customer: 'Linda Garcia', vehicle: '2024 Hyundai Tucson', value: '$32,800', daysOpen: 9, rep: 'David K.', repInitials: 'DK', repColor: 'bg-teal-500' },
    ],
  },
]

export function MockDealPipeline() {
  return (
    <div className="bg-gray-50 p-3 min-h-[300px] text-[10px]">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-gray-900 text-[13px]">Sales Pipeline</h3>
          <span className="text-gray-400 text-[10px] bg-gray-100 px-2 py-0.5 rounded-full">
            21 active deals
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="text-[10px] text-gray-500 bg-white border border-gray-200 rounded-md px-2 py-1.5">
            This Month
          </div>
          <div className="bg-cyan-600 text-white px-2.5 py-1.5 rounded-md font-semibold flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Deal
          </div>
        </div>
      </div>

      {/* Kanban columns */}
      <div className="grid grid-cols-4 gap-2">
        {stages.map((stage, si) => (
          <motion.div
            key={stage.name}
            className="flex flex-col"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: si * 0.08 }}
          >
            {/* Column header */}
            <div className={`rounded-t-lg ${stage.bgColor} border ${stage.borderColor} border-b-0 px-2.5 py-2`}>
              <div className="flex items-center justify-between">
                <span className={`font-bold ${stage.color}`}>{stage.name}</span>
                <span className="text-gray-400 bg-white px-1.5 py-0.5 rounded text-[9px] font-mono">
                  {stage.count}
                </span>
              </div>
              <div className="text-[9px] text-gray-500 mt-0.5">Total: {stage.total}</div>
            </div>

            {/* Cards */}
            <div className={`flex-1 border ${stage.borderColor} border-t-0 rounded-b-lg bg-white p-1.5 space-y-1.5`}>
              {stage.deals.map((deal, di) => (
                <motion.div
                  key={deal.customer}
                  className="bg-white rounded-md border border-gray-200 p-2 hover:shadow-sm transition-shadow"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: si * 0.08 + di * 0.05 }}
                >
                  <div className="font-semibold text-gray-900">{deal.customer}</div>
                  <div className="text-gray-500 mt-0.5">{deal.vehicle}</div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="font-bold text-gray-900">{deal.value}</span>
                    <div className="flex items-center gap-1">
                      <div className={`w-4 h-4 rounded-full ${deal.repColor} text-white text-[6px] font-bold flex items-center justify-center`}>
                        {deal.repInitials}
                      </div>
                      <span className="text-gray-400">{deal.daysOpen}d</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
