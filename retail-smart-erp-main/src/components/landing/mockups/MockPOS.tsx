'use client'

import { motion } from 'framer-motion'

const categories = ['All', 'Food', 'Drinks', 'Desserts', 'Snacks']

const products = [
  { name: 'Chicken Burger', price: '$12.99', bg: 'bg-orange-100', icon: 'bg-orange-400' },
  { name: 'French Fries', price: '$4.99', bg: 'bg-yellow-100', icon: 'bg-yellow-400' },
  { name: 'Cola', price: '$2.99', bg: 'bg-red-100', icon: 'bg-red-400' },
  { name: 'Caesar Salad', price: '$8.99', bg: 'bg-green-100', icon: 'bg-green-400' },
  { name: 'Margherita Pizza', price: '$14.99', bg: 'bg-rose-100', icon: 'bg-rose-400' },
  { name: 'Fish & Chips', price: '$11.99', bg: 'bg-blue-100', icon: 'bg-blue-400' },
  { name: 'Latte', price: '$5.49', bg: 'bg-amber-100', icon: 'bg-amber-400' },
  { name: 'Brownie', price: '$6.99', bg: 'bg-purple-100', icon: 'bg-purple-400' },
  { name: 'Iced Tea', price: '$3.49', bg: 'bg-teal-100', icon: 'bg-teal-400' },
  { name: 'Pasta Carbonara', price: '$13.49', bg: 'bg-pink-100', icon: 'bg-pink-400' },
  { name: 'Chicken Wrap', price: '$9.99', bg: 'bg-indigo-100', icon: 'bg-indigo-400' },
  { name: 'Berry Smoothie', price: '$7.49', bg: 'bg-emerald-100', icon: 'bg-emerald-400' },
]

const cartItems = [
  { name: 'Chicken Burger', qty: 2, price: '$25.98' },
  { name: 'Cola', qty: 1, price: '$2.99' },
  { name: 'French Fries', qty: 1, price: '$4.99' },
  { name: 'Margherita Pizza', qty: 1, price: '$14.99' },
]

export function MockPOS() {
  return (
    <div className="flex h-[320px] text-[10px] bg-gray-50">
      {/* Left side - Products */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Search bar + Ready indicator */}
        <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200">
          <div className="flex-1 flex items-center gap-1.5 bg-gray-100 rounded-md px-2 py-1.5">
            <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="text-gray-400">Search products...</span>
          </div>
          <motion.div
            className="flex items-center gap-1 px-2 py-1 rounded-full bg-green-50 border border-green-200"
            animate={{ opacity: [1, 0.6, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-green-700 font-medium">Ready</span>
          </motion.div>
        </div>

        {/* Category tabs */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white border-b border-gray-100">
          {categories.map((cat, i) => (
            <div
              key={cat}
              className={`px-2.5 py-1 rounded-full font-medium ${
                i === 0
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {cat}
            </div>
          ))}
        </div>

        {/* Product grid */}
        <div className="flex-1 overflow-hidden p-2">
          <div className="grid grid-cols-4 gap-1.5">
            {products.map((product, i) => (
              <motion.div
                key={product.name}
                className={`${product.bg} rounded p-1.5 flex flex-col items-center justify-center cursor-pointer border border-transparent hover:border-indigo-300`}
                whileHover={{ scale: 1.05 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
                {...({ transition: { delay: i * 0.03 } } as any)}
              >
                <div className={`w-5 h-5 rounded-full ${product.icon} mb-1 opacity-60`} />
                <span className="font-medium text-gray-800 text-center leading-tight truncate w-full">
                  {product.name}
                </span>
                <span className="text-gray-500 font-medium">{product.price}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* Right side - Cart */}
      <div className="w-[160px] flex flex-col bg-white border-l border-gray-200">
        <div className="px-2.5 py-2 border-b border-gray-100">
          <div className="font-semibold text-gray-900 text-[11px]">Current Order</div>
          <div className="text-gray-400 text-[9px]">Table 5 - Dine In</div>
        </div>

        {/* Cart items */}
        <div className="flex-1 overflow-hidden">
          {cartItems.map((item) => (
            <div key={item.name} className="px-2.5 py-1.5 border-b border-gray-50">
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-800 truncate">{item.name}</span>
              </div>
              <div className="flex items-center justify-between text-gray-400">
                <span>x{item.qty}</span>
                <span className="font-medium text-gray-700">{item.price}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="border-t border-gray-200 px-2.5 py-1.5 space-y-0.5">
          <div className="flex justify-between text-gray-500">
            <span>Subtotal</span>
            <span>$48.95</span>
          </div>
          <div className="flex justify-between text-gray-500">
            <span>Discount (10%)</span>
            <span className="text-red-500">-$4.90</span>
          </div>
          <div className="flex justify-between text-gray-500">
            <span>Tax (8%)</span>
            <span>$3.52</span>
          </div>
          <div className="flex justify-between font-bold text-gray-900 text-[11px] pt-0.5 border-t border-dashed border-gray-200">
            <span>Total</span>
            <span>$47.57</span>
          </div>
        </div>

        {/* Payment buttons */}
        <div className="px-2 py-1.5 space-y-1">
          <div className="flex gap-1">
            <div className="flex-1 bg-indigo-600 text-white text-center py-1.5 rounded-md font-semibold cursor-pointer">
              Cash
            </div>
            <div className="flex-1 bg-indigo-100 text-indigo-700 text-center py-1.5 rounded-md font-semibold cursor-pointer">
              Card
            </div>
            <div className="flex-1 bg-gray-100 text-gray-600 text-center py-1.5 rounded-md font-semibold cursor-pointer">
              Split
            </div>
          </div>
          <div className="border border-amber-400 text-amber-600 text-center py-1 rounded-md font-semibold cursor-pointer bg-amber-50">
            Hold Order
          </div>
        </div>
      </div>
    </div>
  )
}
