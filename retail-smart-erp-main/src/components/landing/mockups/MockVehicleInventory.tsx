'use client'

import { motion } from 'framer-motion'

interface Vehicle {
  stock: string
  year: number
  make: string
  model: string
  trim: string
  price: string
  mileage: string
  status: string
  statusColor: string
  statusBg: string
  color: string
  colorDot: string
}

const vehicles: Vehicle[] = [
  {
    stock: 'V-2401',
    year: 2024,
    make: 'Toyota',
    model: 'Camry',
    trim: 'XSE V6',
    price: '$34,990',
    mileage: '12 mi',
    status: 'Available',
    statusColor: 'text-green-700',
    statusBg: 'bg-green-100',
    color: 'Pearl White',
    colorDot: 'bg-gray-100 border border-gray-300',
  },
  {
    stock: 'V-2398',
    year: 2023,
    make: 'Honda',
    model: 'CR-V',
    trim: 'EX-L AWD',
    price: '$36,450',
    mileage: '8,240 mi',
    status: 'Reserved',
    statusColor: 'text-blue-700',
    statusBg: 'bg-blue-100',
    color: 'Sonic Gray',
    colorDot: 'bg-gray-400',
  },
  {
    stock: 'V-2395',
    year: 2024,
    make: 'BMW',
    model: 'X3',
    trim: 'xDrive30i',
    price: '$49,800',
    mileage: '3 mi',
    status: 'Available',
    statusColor: 'text-green-700',
    statusBg: 'bg-green-100',
    color: 'Alpine White',
    colorDot: 'bg-white border border-gray-300',
  },
  {
    stock: 'V-2390',
    year: 2022,
    make: 'Ford',
    model: 'F-150',
    trim: 'Lariat 4x4',
    price: '$42,500',
    mileage: '18,600 mi',
    status: 'In Prep',
    statusColor: 'text-amber-700',
    statusBg: 'bg-amber-100',
    color: 'Iconic Silver',
    colorDot: 'bg-gray-300',
  },
  {
    stock: 'V-2387',
    year: 2024,
    make: 'Mercedes',
    model: 'C300',
    trim: '4MATIC',
    price: '$47,200',
    mileage: '5 mi',
    status: 'Test Drive',
    statusColor: 'text-purple-700',
    statusBg: 'bg-purple-100',
    color: 'Obsidian Black',
    colorDot: 'bg-gray-900',
  },
]

export function MockVehicleInventory() {
  return (
    <div className="bg-gray-50 p-3 min-h-[300px] text-[10px]">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <h3 className="font-bold text-gray-900 text-[13px]">Vehicle Inventory</h3>
          <span className="text-gray-400 text-[10px] bg-gray-100 px-2 py-0.5 rounded-full">
            48 vehicles
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 bg-white rounded-md px-2 py-1.5 border border-gray-200">
            <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-gray-400">Search by VIN, make, model...</span>
          </div>
          <div className="bg-cyan-600 text-white px-2.5 py-1.5 rounded-md font-semibold flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Vehicle
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-2 mb-2.5">
        {[
          { label: 'Total Stock', value: '48', color: 'text-gray-900' },
          { label: 'Available', value: '31', color: 'text-green-600' },
          { label: 'Reserved', value: '8', color: 'text-blue-600' },
          { label: 'In Prep', value: '9', color: 'text-amber-600' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded border border-gray-200 p-2 text-center">
            <div className={`text-[14px] font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-[8px] text-gray-500 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded border border-gray-200 overflow-hidden shadow-sm">
        <div className="grid grid-cols-12 gap-1 px-3 py-2 bg-gray-50 border-b border-gray-200 font-semibold text-gray-500 uppercase tracking-wider text-[9px]">
          <div className="col-span-1">Stock #</div>
          <div className="col-span-3">Vehicle</div>
          <div className="col-span-2">Color</div>
          <div className="col-span-2">Price</div>
          <div className="col-span-2">Mileage</div>
          <div className="col-span-2">Status</div>
        </div>

        {vehicles.map((v, i) => (
          <motion.div
            key={v.stock}
            className="grid grid-cols-12 gap-1 px-3 py-2 border-b border-gray-50 hover:bg-gray-50 items-center"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06 }}
          >
            <div className="col-span-1 font-mono font-bold text-cyan-600">{v.stock}</div>
            <div className="col-span-3">
              <div className="text-gray-900 font-medium">{v.year} {v.make} {v.model}</div>
              <div className="text-gray-400 text-[9px]">{v.trim}</div>
            </div>
            <div className="col-span-2 flex items-center gap-1.5">
              <div className={`w-2.5 h-2.5 rounded-full ${v.colorDot}`} />
              <span className="text-gray-600">{v.color}</span>
            </div>
            <div className="col-span-2 font-semibold text-gray-900">{v.price}</div>
            <div className="col-span-2 text-gray-500">{v.mileage}</div>
            <div className="col-span-2">
              <span className={`inline-flex px-2 py-0.5 rounded-full font-semibold ${v.statusBg} ${v.statusColor}`}>
                {v.status}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
