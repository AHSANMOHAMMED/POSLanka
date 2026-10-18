'use client'

import { motion } from 'framer-motion'

type TableStatus = 'available' | 'occupied' | 'reserved' | 'cleaning'

interface RestaurantTable {
  id: number
  seats: number
  status: TableStatus
  timer?: string
  shape: 'circle' | 'square' | 'rectangle'
}

const statusConfig: Record<TableStatus, { bg: string; border: string; text: string; label: string; dot: string }> = {
  available: { bg: 'bg-green-50', border: 'border-green-400', text: 'text-green-700', label: 'Available', dot: 'bg-green-500' },
  occupied: { bg: 'bg-red-50', border: 'border-red-400', text: 'text-red-700', label: 'Occupied', dot: 'bg-red-500' },
  reserved: { bg: 'bg-amber-50', border: 'border-amber-400', text: 'text-amber-700', label: 'Reserved', dot: 'bg-amber-500' },
  cleaning: { bg: 'bg-gray-100', border: 'border-gray-400', text: 'text-gray-600', label: 'Cleaning', dot: 'bg-gray-400' },
}

const tables: RestaurantTable[] = [
  { id: 1, seats: 2, status: 'occupied', timer: '45m', shape: 'circle' },
  { id: 2, seats: 4, status: 'available', shape: 'square' },
  { id: 3, seats: 2, status: 'reserved', shape: 'circle' },
  { id: 4, seats: 6, status: 'occupied', timer: '1h 12m', shape: 'rectangle' },
  { id: 5, seats: 4, status: 'available', shape: 'square' },
  { id: 6, seats: 2, status: 'cleaning', shape: 'circle' },
  { id: 7, seats: 4, status: 'occupied', timer: '28m', shape: 'square' },
  { id: 8, seats: 8, status: 'reserved', shape: 'rectangle' },
  { id: 9, seats: 2, status: 'occupied', timer: '15m', shape: 'circle' },
  { id: 10, seats: 4, status: 'available', shape: 'square' },
  { id: 11, seats: 2, status: 'available', shape: 'circle' },
  { id: 12, seats: 6, status: 'occupied', timer: '52m', shape: 'rectangle' },
]

function TableElement({ table }: { table: RestaurantTable }) {
  const config = statusConfig[table.status]
  const isOccupied = table.status === 'occupied'
  const shapeClass =
    table.shape === 'circle'
      ? 'rounded-full aspect-square'
      : table.shape === 'rectangle'
        ? 'rounded-md'
        : 'rounded-md aspect-square'

  return (
    <motion.div
      className={`
        ${config.bg} border-2 ${config.border} ${shapeClass}
        flex flex-col items-center justify-center p-2 cursor-pointer
        hover:shadow-md transition-shadow relative min-h-[56px]
      `}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: table.id * 0.04 }}
      whileHover={{ scale: 1.05 }}
    >
      <div className={`font-bold ${config.text} text-[11px]`}>T{table.id}</div>
      <div className="text-[8px] text-gray-500">{table.seats} seats</div>
      {isOccupied && table.timer && (
        <motion.div
          className="text-[8px] font-mono text-red-600 font-bold mt-0.5"
          animate={{ opacity: [1, 0.5, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        >
          {table.timer}
        </motion.div>
      )}
    </motion.div>
  )
}

export function MockTables() {
  return (
    <div className="bg-gray-50 p-3 min-h-[300px] text-[10px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-gray-900 text-[13px]">Floor Plan</h3>
          <span className="text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            Ground Floor
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="bg-white text-gray-600 px-2 py-1.5 rounded-md border border-gray-200 font-medium flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
            Fullscreen
          </div>
          <div className="bg-indigo-600 text-white px-2.5 py-1.5 rounded-md font-semibold flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Table
          </div>
        </div>
      </div>

      {/* Floor plan */}
      <div className="bg-white rounded border border-gray-200 p-4 shadow-sm">
        <div className="grid grid-cols-5 gap-2.5">
          {tables.map((table) => (
            <div
              key={table.id}
              className={table.shape === 'rectangle' ? 'col-span-2' : 'col-span-1'}
            >
              <TableElement table={table} />
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-2 flex items-center justify-center gap-4">
        {Object.entries(statusConfig).map(([key, config]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-full ${config.dot}`} />
            <span className="text-gray-600 font-medium">{config.label}</span>
          </div>
        ))}
      </div>

      {/* Stats bar */}
      <div className="mt-2 bg-white rounded border border-gray-200 p-2 shadow-sm flex items-center justify-center gap-6">
        <div className="text-center">
          <div className="font-bold text-green-600 text-[12px]">4</div>
          <div className="text-gray-500">Available</div>
        </div>
        <div className="w-px h-5 bg-gray-200" />
        <div className="text-center">
          <div className="font-bold text-red-600 text-[12px]">5</div>
          <div className="text-gray-500">Occupied</div>
        </div>
        <div className="w-px h-5 bg-gray-200" />
        <div className="text-center">
          <div className="font-bold text-amber-600 text-[12px]">2</div>
          <div className="text-gray-500">Reserved</div>
        </div>
        <div className="w-px h-5 bg-gray-200" />
        <div className="text-center">
          <div className="font-bold text-gray-500 text-[12px]">1</div>
          <div className="text-gray-500">Cleaning</div>
        </div>
      </div>
    </div>
  )
}
