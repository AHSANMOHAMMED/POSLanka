'use client'

import { motion } from 'framer-motion'

interface WorkOrder {
  id: string
  vehicle: string
  customer: string
  service: string
  estCost: string
  technician: string
  techInitials: string
  techColor: string
  status: string
  statusColor: string
  statusBg: string
  priority: string
  priorityDot: string
  priorityText: string
}

interface StatCard {
  label: string
  value: number
  color: string
  bgColor: string
  borderColor: string
}

const statCards: StatCard[] = [
  { label: 'Open', value: 6, color: 'text-blue-700', bgColor: 'bg-blue-50', borderColor: 'border-blue-200' },
  { label: 'In Progress', value: 8, color: 'text-amber-700', bgColor: 'bg-amber-50', borderColor: 'border-amber-200' },
  { label: 'Completed Today', value: 7, color: 'text-green-700', bgColor: 'bg-green-50', borderColor: 'border-green-200' },
  { label: 'Invoiced', value: 3, color: 'text-purple-700', bgColor: 'bg-purple-50', borderColor: 'border-purple-200' },
]

const workOrders: WorkOrder[] = [
  {
    id: 'WO-1024',
    vehicle: 'Toyota Camry 2022',
    customer: 'John Smith',
    service: 'Full Service',
    estCost: '$450',
    technician: 'Alex Torres',
    techInitials: 'AT',
    techColor: 'bg-blue-500',
    status: 'In Progress',
    statusColor: 'text-blue-700',
    statusBg: 'bg-blue-100',
    priority: 'High',
    priorityDot: 'bg-red-500',
    priorityText: 'text-red-700',
  },
  {
    id: 'WO-1023',
    vehicle: 'Honda Civic 2021',
    customer: 'Sarah Johnson',
    service: 'Brake Replacement',
    estCost: '$680',
    technician: 'Mike Rivera',
    techInitials: 'MR',
    techColor: 'bg-green-500',
    status: 'Completed',
    statusColor: 'text-green-700',
    statusBg: 'bg-green-100',
    priority: 'Medium',
    priorityDot: 'bg-amber-500',
    priorityText: 'text-amber-700',
  },
  {
    id: 'WO-1022',
    vehicle: 'BMW X5 2023',
    customer: 'Michael Chen',
    service: 'Diagnostics',
    estCost: '$120',
    technician: 'Alex Torres',
    techInitials: 'AT',
    techColor: 'bg-blue-500',
    status: 'Pending',
    statusColor: 'text-amber-700',
    statusBg: 'bg-amber-100',
    priority: 'Low',
    priorityDot: 'bg-green-500',
    priorityText: 'text-green-700',
  },
  {
    id: 'WO-1021',
    vehicle: 'Ford F-150 2020',
    customer: 'Emma Williams',
    service: 'Engine Repair',
    estCost: '$1,250',
    technician: 'Kevin Park',
    techInitials: 'KP',
    techColor: 'bg-purple-500',
    status: 'Invoiced',
    statusColor: 'text-purple-700',
    statusBg: 'bg-purple-100',
    priority: 'High',
    priorityDot: 'bg-red-500',
    priorityText: 'text-red-700',
  },
  {
    id: 'WO-1020',
    vehicle: 'Nissan Altima 2022',
    customer: 'David Brown',
    service: 'Oil Change',
    estCost: '$85',
    technician: 'Mike Rivera',
    techInitials: 'MR',
    techColor: 'bg-green-500',
    status: 'In Progress',
    statusColor: 'text-blue-700',
    statusBg: 'bg-blue-100',
    priority: 'Medium',
    priorityDot: 'bg-amber-500',
    priorityText: 'text-amber-700',
  },
]

export function MockWorkOrders() {
  return (
    <div className="bg-gray-50 p-3 min-h-[300px] text-[10px]">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-gray-900 text-[13px]">Work Orders</h3>
          <span className="text-gray-400 text-[10px] bg-gray-100 px-2 py-0.5 rounded-full">
            24 total
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 bg-white rounded-md px-2 py-1.5 border border-gray-200">
            <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-gray-400">Search work orders...</span>
          </div>
          <div className="bg-indigo-600 text-white px-2.5 py-1.5 rounded-md font-semibold flex items-center gap-1 cursor-default">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Work Order
          </div>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-4 gap-2 mb-2.5">
        {statCards.map((card, i) => (
          <motion.div
            key={card.label}
            className={`${card.bgColor} border ${card.borderColor} rounded px-2.5 py-2`}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <div className={`text-[16px] font-bold ${card.color}`}>{card.value}</div>
            <div className="text-gray-500 text-[9px] font-medium">{card.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded border border-gray-200 overflow-hidden shadow-sm">
        {/* Table header */}
        <div className="grid grid-cols-12 gap-1 px-3 py-2 bg-gray-50 border-b border-gray-200 font-semibold text-gray-500 uppercase tracking-wider text-[9px]">
          <div className="col-span-1">WO #</div>
          <div className="col-span-2">Vehicle</div>
          <div className="col-span-2">Customer</div>
          <div className="col-span-2">Service</div>
          <div className="col-span-1 text-right">Est. Cost</div>
          <div className="col-span-1 text-center">Tech</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-1">Priority</div>
        </div>

        {/* Table rows */}
        {workOrders.map((wo, i) => (
          <motion.div
            key={wo.id}
            className="grid grid-cols-12 gap-1 px-3 py-2 border-b border-gray-50 hover:bg-gray-50 items-center"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06 }}
          >
            <div className="col-span-1 font-mono font-bold text-indigo-600">{wo.id}</div>
            <div className="col-span-2 text-gray-800 font-medium truncate">{wo.vehicle}</div>
            <div className="col-span-2 text-gray-600 truncate">{wo.customer}</div>
            <div className="col-span-2 text-gray-600 truncate">{wo.service}</div>
            <div className="col-span-1 text-right font-semibold text-gray-800">{wo.estCost}</div>
            <div className="col-span-1 flex justify-center">
              <div className={`w-5 h-5 rounded-full ${wo.techColor} flex items-center justify-center text-white text-[7px] font-bold`}>
                {wo.techInitials}
              </div>
            </div>
            <div className="col-span-2">
              <span className={`inline-flex px-2 py-0.5 rounded-full font-semibold ${wo.statusBg} ${wo.statusColor}`}>
                {wo.status}
              </span>
            </div>
            <div className="col-span-1 flex items-center gap-1">
              <div className={`w-1.5 h-1.5 rounded-full ${wo.priorityDot}`} />
              <span className={`font-medium ${wo.priorityText}`}>{wo.priority}</span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
