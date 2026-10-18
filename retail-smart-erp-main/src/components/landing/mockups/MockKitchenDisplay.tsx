'use client'

import { motion } from 'framer-motion'

interface OrderCard {
  order: string
  table: string
  items: string[]
  time: string
}

const newOrders: OrderCard[] = [
  { order: '#1042', table: 'Table 3', items: ['1x Chicken Burger', '2x Cola', '1x Fries'], time: '2m ago' },
  { order: '#1043', table: 'Table 7', items: ['1x Margherita', '1x Caesar Salad'], time: '1m ago' },
  { order: '#1044', table: 'Takeaway', items: ['2x Fish & Chips', '1x Iced Tea'], time: 'Just now' },
]

const cookingOrders: OrderCard[] = [
  { order: '#1040', table: 'Table 1', items: ['1x Pasta', '1x Latte'], time: '8m' },
  { order: '#1041', table: 'Table 5', items: ['2x Wrap', '1x Smoothie', '1x Brownie'], time: '5m' },
]

const readyOrders: OrderCard[] = [
  { order: '#1038', table: 'Table 2', items: ['1x Caesar Salad', '1x Iced Tea'], time: '12m' },
  { order: '#1039', table: 'Table 8', items: ['1x Chicken Burger', '1x Fries'], time: '10m' },
]

function OrderCardComponent({
  card,
  borderColor,
  variant,
}: {
  card: OrderCard
  borderColor: string
  variant: 'new' | 'cooking' | 'ready'
}) {
  return (
    <motion.div
      className={`bg-white rounded border border-gray-100 p-2 shadow-sm border-l-[3px] ${borderColor}`}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={
        variant === 'cooking'
          ? {
              opacity: 1,
              scale: 1,
              boxShadow: [
                '0 1px 2px rgba(0,0,0,0.05)',
                '0 1px 8px rgba(245,158,11,0.15)',
                '0 1px 2px rgba(0,0,0,0.05)',
              ],
            }
          : { opacity: 1, scale: 1 }
      }
      transition={
        variant === 'cooking'
          ? { boxShadow: { duration: 2, repeat: Infinity, ease: 'easeInOut' }, opacity: { duration: 0.3 }, scale: { duration: 0.3 } }
          : { duration: 0.3 }
      }
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-bold text-gray-900">{card.order}</span>
        <span className="text-gray-400">{card.time}</span>
      </div>
      <div className="text-[9px] text-gray-500 font-medium mb-1">{card.table}</div>
      <div className="space-y-0.5">
        {card.items.map((item) => (
          <div key={item} className="flex items-center gap-1">
            {variant === 'ready' && (
              <svg className="w-2.5 h-2.5 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
            <span className={`text-gray-600 ${variant === 'ready' ? 'line-through text-gray-400' : ''}`}>
              {item}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

export function MockKitchenDisplay() {
  return (
    <div className="bg-gray-900 p-2.5 min-h-[300px] text-[10px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-white font-bold text-[12px]">Kitchen Display</span>
        <div className="flex items-center gap-2">
          <span className="text-gray-400">Active Orders: 7</span>
          <motion.div
            className="w-2 h-2 rounded-full bg-green-500"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
        </div>
      </div>

      {/* Three columns */}
      <div className="grid grid-cols-3 gap-2">
        {/* New Orders */}
        <div>
          <div className="bg-red-600 text-white text-center py-1.5 rounded-t-lg font-bold text-[11px] mb-1.5">
            New Orders ({newOrders.length})
          </div>
          <div className="space-y-1.5">
            {newOrders.map((card) => (
              <OrderCardComponent key={card.order} card={card} borderColor="border-l-red-500" variant="new" />
            ))}
          </div>
        </div>

        {/* Cooking */}
        <div>
          <div className="bg-amber-500 text-white text-center py-1.5 rounded-t-lg font-bold text-[11px] mb-1.5">
            Cooking ({cookingOrders.length})
          </div>
          <div className="space-y-1.5">
            {cookingOrders.map((card) => (
              <OrderCardComponent key={card.order} card={card} borderColor="border-l-amber-500" variant="cooking" />
            ))}
          </div>
        </div>

        {/* Ready */}
        <div>
          <div className="bg-green-600 text-white text-center py-1.5 rounded-t-lg font-bold text-[11px] mb-1.5">
            Ready ({readyOrders.length})
          </div>
          <div className="space-y-1.5">
            {readyOrders.map((card) => (
              <OrderCardComponent key={card.order} card={card} borderColor="border-l-green-500" variant="ready" />
            ))}
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="mt-2.5 bg-gray-800 rounded px-3 py-2 flex items-center justify-center gap-4">
        <div className="flex items-center gap-1.5">
          <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-gray-400">Avg Prep Time:</span>
          <span className="text-white font-bold">8.5 min</span>
        </div>
        <div className="w-px h-4 bg-gray-700" />
        <div className="flex items-center gap-1.5">
          <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <span className="text-gray-400">Orders Today:</span>
          <span className="text-white font-bold">47</span>
        </div>
        <div className="w-px h-4 bg-gray-700" />
        <div className="flex items-center gap-1.5">
          <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          <span className="text-gray-400">Peak Hour:</span>
          <span className="text-white font-bold">12-1 PM</span>
        </div>
      </div>
    </div>
  )
}
