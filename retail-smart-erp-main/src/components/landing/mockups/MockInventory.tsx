'use client'

import { motion } from 'framer-motion'

interface InventoryItem {
  name: string
  sku: string
  category: string
  categoryColor: string
  categoryBg: string
  stock: number
  maxStock: number
  qty: number
  cost: string
  status: string
  statusColor: string
  statusBg: string
}

interface StatCard {
  label: string
  value: string
  color: string
  bgColor: string
  iconColor: string
}

const stats: StatCard[] = [
  {
    label: 'Total Items',
    value: '1,248',
    color: 'text-gray-900',
    bgColor: 'bg-blue-50',
    iconColor: 'text-blue-500',
  },
  {
    label: 'In Stock',
    value: '1,042',
    color: 'text-green-700',
    bgColor: 'bg-green-50',
    iconColor: 'text-green-500',
  },
  {
    label: 'Low Stock',
    value: '156',
    color: 'text-amber-700',
    bgColor: 'bg-amber-50',
    iconColor: 'text-amber-500',
  },
  {
    label: 'Out of Stock',
    value: '50',
    color: 'text-red-700',
    bgColor: 'bg-red-50',
    iconColor: 'text-red-500',
  },
]

const items: InventoryItem[] = [
  {
    name: 'iPhone 15 Pro Max',
    sku: 'ELEC-0042',
    category: 'Electronics',
    categoryColor: 'text-blue-700',
    categoryBg: 'bg-blue-100',
    stock: 85,
    maxStock: 100,
    qty: 85,
    cost: '$999.00',
    status: 'In Stock',
    statusColor: 'text-green-700',
    statusBg: 'bg-green-100',
  },
  {
    name: 'Nike Air Max 90',
    sku: 'CLO-0118',
    category: 'Clothing',
    categoryColor: 'text-purple-700',
    categoryBg: 'bg-purple-100',
    stock: 42,
    maxStock: 100,
    qty: 42,
    cost: '$129.99',
    status: 'In Stock',
    statusColor: 'text-green-700',
    statusBg: 'bg-green-100',
  },
  {
    name: 'Organic Coffee Beans',
    sku: 'FOOD-0305',
    category: 'Food',
    categoryColor: 'text-green-700',
    categoryBg: 'bg-green-100',
    stock: 18,
    maxStock: 100,
    qty: 18,
    cost: '$24.99',
    status: 'Low Stock',
    statusColor: 'text-amber-700',
    statusBg: 'bg-amber-100',
  },
  {
    name: 'Samsung Galaxy Watch',
    sku: 'ELEC-0089',
    category: 'Electronics',
    categoryColor: 'text-blue-700',
    categoryBg: 'bg-blue-100',
    stock: 7,
    maxStock: 100,
    qty: 7,
    cost: '$349.00',
    status: 'Critical',
    statusColor: 'text-red-700',
    statusBg: 'bg-red-100',
  },
  {
    name: 'Adidas Ultraboost',
    sku: 'CLO-0156',
    category: 'Clothing',
    categoryColor: 'text-purple-700',
    categoryBg: 'bg-purple-100',
    stock: 63,
    maxStock: 100,
    qty: 63,
    cost: '$189.00',
    status: 'In Stock',
    statusColor: 'text-green-700',
    statusBg: 'bg-green-100',
  },
  {
    name: 'Vitamin C Supplements',
    sku: 'HLTH-0201',
    category: 'Health',
    categoryColor: 'text-teal-700',
    categoryBg: 'bg-teal-100',
    stock: 12,
    maxStock: 100,
    qty: 12,
    cost: '$19.99',
    status: 'Low Stock',
    statusColor: 'text-amber-700',
    statusBg: 'bg-amber-100',
  },
]

function StockBar({ stock }: { stock: number }) {
  const barColor =
    stock >= 70 ? 'bg-green-500' : stock >= 30 ? 'bg-amber-400' : 'bg-red-500'
  const trackColor =
    stock >= 70 ? 'bg-green-100' : stock >= 30 ? 'bg-amber-100' : 'bg-red-100'

  return (
    <div className={`w-full h-1.5 rounded-full ${trackColor}`}>
      <motion.div
        className={`h-full rounded-full ${barColor}`}
        initial={{ width: 0 }}
        animate={{ width: `${stock}%` }}
        transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
      />
    </div>
  )
}

function StatIcon({ type }: { type: string }) {
  if (type === 'Total Items') {
    return (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
      </svg>
    )
  }
  if (type === 'In Stock') {
    return (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  }
  if (type === 'Low Stock') {
    return (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    )
  }
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
  )
}

export function MockInventory() {
  return (
    <div className="bg-gray-50 p-3 min-h-[300px] text-[10px]">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-gray-900 text-[13px]">Inventory</h3>
          <span className="text-gray-500 text-[10px] bg-gray-100 px-2 py-0.5 rounded-full font-medium">
            1,248 items
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 bg-white rounded-md px-2 py-1.5 border border-gray-200">
            <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-gray-400">Search inventory...</span>
          </div>
          <div className="bg-white text-gray-600 px-2 py-1.5 rounded-md border border-gray-200 font-medium flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
          </div>
          <div className="bg-white text-gray-600 px-2 py-1.5 rounded-md border border-gray-200 font-medium flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export
          </div>
        </div>
      </div>

      {/* Summary Stats Row */}
      <div className="grid grid-cols-4 gap-2 mb-2.5">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            className="bg-white rounded border border-gray-200 px-2.5 py-2 shadow-sm"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-gray-500 font-medium text-[9px]">{stat.label}</span>
              <div className={`${stat.bgColor} ${stat.iconColor} p-1 rounded`}>
                <StatIcon type={stat.label} />
              </div>
            </div>
            <div className={`font-bold text-[14px] leading-tight ${stat.color}`}>
              {stat.value}
            </div>
          </motion.div>
        ))}
      </div>

      {/* Inventory Table */}
      <div className="bg-white rounded border border-gray-200 overflow-hidden shadow-sm">
        {/* Table header */}
        <div className="grid grid-cols-[2.5fr_1.5fr_1.5fr_2fr_0.8fr_1.2fr_1.3fr] gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200 font-semibold text-gray-500 uppercase tracking-wider text-[9px]">
          <div>Product</div>
          <div>SKU</div>
          <div>Category</div>
          <div>Stock Level</div>
          <div>Qty</div>
          <div>Cost</div>
          <div>Status</div>
        </div>

        {/* Table rows */}
        {items.map((item, i) => (
          <motion.div
            key={item.sku}
            className="grid grid-cols-[2.5fr_1.5fr_1.5fr_2fr_0.8fr_1.2fr_1.3fr] gap-2 px-3 py-2 border-b border-gray-100 hover:bg-gray-50/60 items-center"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 + i * 0.06, duration: 0.35 }}
          >
            <div className="font-medium text-gray-900 truncate">{item.name}</div>
            <div className="font-mono text-gray-500">{item.sku}</div>
            <div>
              <span className={`inline-flex px-1.5 py-0.5 rounded-full font-semibold text-[9px] ${item.categoryBg} ${item.categoryColor}`}>
                {item.category}
              </span>
            </div>
            <div className="pr-2">
              <StockBar stock={item.stock} />
            </div>
            <div className="font-bold text-gray-800">{item.qty}</div>
            <div className="font-medium text-gray-700">{item.cost}</div>
            <div>
              <span className={`inline-flex px-1.5 py-0.5 rounded-full font-semibold text-[9px] ${item.statusBg} ${item.statusColor}`}>
                {item.status}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
