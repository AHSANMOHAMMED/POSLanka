'use client'

import React, { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import {
  Store,
  QrCode,
  ShoppingBag,
  Gift,
  Zap,
} from 'lucide-react'

interface CartItem {
  id: string
  name: string
  sku: string
  price: number
  quantity: number
  discount?: number
  category?: string
}

export default function CustomerFacingDisplayPage() {
  const params = useParams()
  const _slug = (params?.slug as string) || 'colombo-flagship'

  // Mock live state synced from cashier terminal
  const [items] = useState<CartItem[]>([
    {
      id: '1',
      name: 'Munchee Super Cream Cracker 490g',
      sku: 'BISK-0021',
      price: 450.0,
      quantity: 2,
      discount: 20.0,
      category: 'Biscuits & Bakery',
    },
    {
      id: '2',
      name: 'Anchor Full Cream Milk Powder 400g',
      sku: 'DAIR-1049',
      price: 1150.0,
      quantity: 1,
      category: 'Dairy',
    },
    {
      id: '3',
      name: 'Highland Processed Cheese 200g',
      sku: 'DAIR-0832',
      price: 680.0,
      quantity: 2,
      category: 'Dairy',
    },
    {
      id: '4',
      name: 'Dilmah Premium Ceylon Tea 100 Tea Bags',
      sku: 'BEV-4410',
      price: 920.0,
      quantity: 1,
      category: 'Beverages',
    },
  ])

  const [customer] = useState({
    name: 'Nimal Gunasekara',
    tier: 'Gold Member ⭐',
    points: 1420,
    savedToday: 200.0,
  })

  const [currentTime, setCurrentTime] = useState('')

  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setCurrentTime(
        now.toLocaleTimeString('en-LK', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      )
    }
    updateTime()
    const timer = setInterval(updateTime, 1000)
    return () => clearInterval(timer)
  }, [])

  const subtotal = items.reduce((acc, item) => acc + item.price * item.quantity, 0)
  const discountTotal = items.reduce(
    (acc, item) => acc + (item.discount || 0) * item.quantity,
    0
  )
  const ssclTax = (subtotal - discountTotal) * 0.025
  const grandTotal = subtotal - discountTotal + ssclTax

  return (
    <div className="min-h-screen bg-[#FAF8FF] dark:bg-[#0F172A] text-slate-900 dark:text-slate-100 flex flex-col font-sans select-none overflow-hidden">
      {/* Top Operational Status Bar */}
      <header className="h-20 bg-white/95 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-800 px-8 flex items-center justify-between backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-teal-600 flex items-center justify-center text-white shadow-md shadow-teal-600/20">
            <Store className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-teal-800 dark:text-teal-300">
                POSLanka Super Center
              </h1>
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-mono text-[11px] font-bold uppercase tracking-wider">
                Lane 02 • Active
              </span>
              <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 font-mono text-[11px] font-bold uppercase tracking-wider">
                RAMIS IRD-LK Connected
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Colombo Flagship (Kollupitiya) • Counter #02 • Cashier: Dilshan P.
            </p>
          </div>
        </div>

        {/* Customer Loyalty & Clock */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 px-4 py-2 rounded-xl">
            <div className="w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center font-bold text-xs shadow-sm">
              ★
            </div>
            <div className="flex flex-col text-right">
              <div className="flex items-center gap-1.5 justify-end">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  {customer.name}
                </span>
                <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 font-mono">
                  {customer.tier}
                </span>
              </div>
              <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 font-bold">
                Saved LKR {customer.savedToday.toFixed(2)} today!
              </span>
            </div>
          </div>

          <div className="text-right font-mono">
            <div className="text-base font-bold text-slate-800 dark:text-slate-200">
              {currentTime}
            </div>
            <div className="text-[11px] text-slate-400">Sri Lanka Standard Time</div>
          </div>
        </div>
      </header>

      {/* Main Dual-Screen Layout Canvas */}
      <main className="flex-1 p-8 grid grid-cols-12 gap-8 max-w-[1600px] mx-auto w-full">
        {/* Left Column (60%): Live Cart Item Stream */}
        <div className="col-span-7 flex flex-col gap-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400 flex items-center justify-center">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  Scanned Items
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                  {items.length} Distinct Products • {items.reduce((s, i) => s + i.quantity, 0)} Total Units
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-xs font-mono font-bold tracking-wider uppercase">
                Live Scanning Stream
              </span>
            </div>
          </div>

          {/* Cart Items List */}
          <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
            {items.map((item, idx) => (
              <div
                key={item.id}
                className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-800/80 shadow-sm flex items-center justify-between transition-all hover:border-teal-500/40"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 dark:text-slate-500 font-mono font-bold text-sm shrink-0">
                    {idx + 1}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {item.name}
                    </span>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
                      <span>{item.sku}</span>
                      <span>•</span>
                      <span>LKR {item.price.toFixed(2)} ea</span>
                      {item.discount ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          (-LKR {item.discount.toFixed(2)} promo)
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6 shrink-0">
                  <div className="px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-mono font-bold text-slate-800 dark:text-slate-200 text-sm">
                    Qty: {item.quantity}
                  </div>
                  <div className="text-right font-mono min-w-[110px]">
                    <div className="text-base font-bold text-slate-900 dark:text-white">
                      LKR {((item.price - (item.discount || 0)) * item.quantity).toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Multilingual Welcome Ticker */}
          <div className="bg-teal-50/80 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-900/50 rounded-xl p-3 flex items-center justify-between text-xs text-teal-800 dark:text-teal-300 font-semibold">
            <span>සාදරයෙන් පිළිගනිමු (Sinhala)</span>
            <span>•</span>
            <span>வரவேற்கிறோம் (Tamil)</span>
            <span>•</span>
            <span>Thank you for shopping at POSLanka</span>
          </div>
        </div>

        {/* Right Column (40%): Live Ledger Totals & LankaQR Code */}
        <div className="col-span-5 flex flex-col gap-6">
          {/* Main Due Card */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border-2 border-teal-600/30 dark:border-teal-500/40 shadow-xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <span className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold">
                Payment Summary
              </span>
              <span className="px-2.5 py-1 rounded-full bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 text-xs font-mono font-bold">
                Tax Inclusive
              </span>
            </div>

            {/* Calculations Breakdown */}
            <div className="flex flex-col gap-2 font-mono text-sm">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Subtotal ({items.reduce((s, i) => s + i.quantity, 0)} items)</span>
                <span>LKR {subtotal.toFixed(2)}</span>
              </div>
              {discountTotal > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                  <span>Promotional Discounts</span>
                  <span>-LKR {discountTotal.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-500 dark:text-slate-400 text-xs">
                <span>SSCL Tax (2.5%)</span>
                <span>LKR {ssclTax.toFixed(2)}</span>
              </div>
            </div>

            {/* Grand Total Display */}
            <div className="bg-slate-50 dark:bg-slate-800/80 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 flex flex-col items-center text-center">
              <span className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold">
                Total Due
              </span>
              <div className="font-mono text-4xl font-extrabold text-teal-700 dark:text-teal-300 mt-1 tracking-tight">
                LKR {grandTotal.toFixed(2)}
              </div>
            </div>

            {/* LankaQR Instant Settlement Box */}
            <div className="bg-slate-900 text-white rounded-2xl p-5 flex items-center justify-between gap-4 shadow-lg">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-mono font-bold uppercase tracking-wider">
                  <Zap className="w-3.5 h-3.5" />
                  Instant LankaQR Settlement
                </div>
                <div className="text-sm font-bold">
                  Scan to Pay with Any Bank App
                </div>
                <div className="text-[11px] text-slate-400">
                  FriMi • Genie • ComBank • BOC • Commercial Bank
                </div>
              </div>

              {/* LankaQR Mock Graphic */}
              <div className="w-24 h-24 bg-white rounded-xl p-2 flex items-center justify-center shrink-0 shadow-md">
                <QrCode className="w-full h-full text-slate-900" />
              </div>
            </div>
          </div>

          {/* Promotional Marketing Carousel Card */}
          <div className="bg-gradient-to-r from-teal-700 to-teal-900 text-white rounded-3xl p-6 shadow-md flex items-center justify-between relative overflow-hidden">
            <div className="flex flex-col gap-1 z-10">
              <span className="text-[10px] font-mono uppercase tracking-widest font-bold bg-white/20 text-white px-2 py-0.5 rounded-full w-fit">
                Weekend Special Offer
              </span>
              <h3 className="text-base font-bold leading-snug">
                Earn 2X Loyalty Points on all Ceylon Fresh Dairy items
              </h3>
              <p className="text-xs text-teal-200 mt-0.5">
                Valid until Sunday across all Colombo branches.
              </p>
            </div>
            <Gift className="w-14 h-14 text-teal-300/40 shrink-0 z-10" />
          </div>
        </div>
      </main>
    </div>
  )
}
