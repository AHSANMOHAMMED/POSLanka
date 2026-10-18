'use client'

import { motion } from 'framer-motion'

interface TestDrive {
  time: string
  customer: string
  phone: string
  vehicle: string
  salesRep: string
  repInitials: string
  repColor: string
  status: string
  statusColor: string
  statusBg: string
}

const testDrives: TestDrive[] = [
  {
    time: '9:30 AM',
    customer: 'James Wilson',
    phone: '(555) 234-8901',
    vehicle: '2024 BMW X3 xDrive30i',
    salesRep: 'Mike T.',
    repInitials: 'MT',
    repColor: 'bg-blue-500',
    status: 'Confirmed',
    statusColor: 'text-green-700',
    statusBg: 'bg-green-100',
  },
  {
    time: '10:15 AM',
    customer: 'Sarah Chen',
    phone: '(555) 456-1234',
    vehicle: '2024 Mercedes C300 4MATIC',
    salesRep: 'Lisa R.',
    repInitials: 'LR',
    repColor: 'bg-purple-500',
    status: 'In Progress',
    statusColor: 'text-blue-700',
    statusBg: 'bg-blue-100',
  },
  {
    time: '11:00 AM',
    customer: 'Robert Davis',
    phone: '(555) 789-4567',
    vehicle: '2024 Toyota Camry XSE',
    salesRep: 'Mike T.',
    repInitials: 'MT',
    repColor: 'bg-blue-500',
    status: 'Scheduled',
    statusColor: 'text-amber-700',
    statusBg: 'bg-amber-100',
  },
  {
    time: '1:30 PM',
    customer: 'Emily Park',
    phone: '(555) 321-6543',
    vehicle: '2023 Honda CR-V EX-L',
    salesRep: 'David K.',
    repInitials: 'DK',
    repColor: 'bg-teal-500',
    status: 'Scheduled',
    statusColor: 'text-amber-700',
    statusBg: 'bg-amber-100',
  },
  {
    time: '3:00 PM',
    customer: 'Mark Thompson',
    phone: '(555) 654-9876',
    vehicle: '2022 Ford F-150 Lariat',
    salesRep: 'Lisa R.',
    repInitials: 'LR',
    repColor: 'bg-purple-500',
    status: 'Completed',
    statusColor: 'text-gray-600',
    statusBg: 'bg-gray-100',
  },
]

export function MockTestDrives() {
  return (
    <div className="bg-gray-50 p-3 min-h-[300px] text-[10px]">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-gray-900 text-[13px]">Test Drives — Today</h3>
          <span className="text-gray-400 text-[10px] bg-gray-100 px-2 py-0.5 rounded-full">
            5 scheduled
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex bg-white rounded-md border border-gray-200 overflow-hidden">
            <button className="px-2 py-1.5 text-[10px] font-medium bg-cyan-50 text-cyan-700 border-r border-gray-200">Today</button>
            <button className="px-2 py-1.5 text-[10px] font-medium text-gray-500">Week</button>
            <button className="px-2 py-1.5 text-[10px] font-medium text-gray-500">Month</button>
          </div>
          <div className="bg-cyan-600 text-white px-2.5 py-1.5 rounded-md font-semibold flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Schedule
          </div>
        </div>
      </div>

      {/* Timeline list */}
      <div className="bg-white rounded border border-gray-200 overflow-hidden shadow-sm divide-y divide-gray-100">
        {testDrives.map((td, i) => (
          <motion.div
            key={td.time}
            className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
          >
            {/* Time */}
            <div className="w-14 text-center flex-shrink-0">
              <div className="text-[11px] font-bold text-gray-900">{td.time}</div>
            </div>

            {/* Connector */}
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={`w-2.5 h-2.5 rounded-full ${td.status === 'In Progress' ? 'bg-cyan-500 ring-2 ring-cyan-200' : td.status === 'Completed' ? 'bg-gray-300' : 'bg-cyan-400'}`} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">{td.customer}</span>
                <span className="text-gray-400">{td.phone}</span>
              </div>
              <div className="text-gray-500 mt-0.5">{td.vehicle}</div>
            </div>

            {/* Sales rep */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div className={`w-5 h-5 rounded-full ${td.repColor} text-white text-[7px] font-bold flex items-center justify-center`}>
                {td.repInitials}
              </div>
              <span className="text-gray-500">{td.salesRep}</span>
            </div>

            {/* Status */}
            <div className="flex-shrink-0">
              <span className={`inline-flex px-2 py-0.5 rounded-full font-semibold ${td.statusBg} ${td.statusColor}`}>
                {td.status}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
