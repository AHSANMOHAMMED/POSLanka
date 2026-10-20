'use client'

import React, { useState, useEffect } from 'react'
import {
  ScanLine,
  Scale,
  CreditCard,
  QrCode,
  BellRing,
  CheckCircle2,
  Plus,
  Minus,
  Trash2,
  ShoppingBag,
} from 'lucide-react'

interface KioskItem {
  id: string
  name: string
  sku: string
  price: number
  quantity: number
  weightKg: number
}

export default function SelfCheckoutKioskPage() {
  const [language, setLanguage] = useState<'en' | 'si' | 'ta'>('en')
  const [items, setItems] = useState<KioskItem[]>([
    {
      id: '1',
      name: 'Munchee Super Cream Cracker 490g',
      sku: '84920192831',
      price: 450.0,
      quantity: 1,
      weightKg: 0.51,
    },
    {
      id: '2',
      name: 'Highland Fresh Pasteurized Milk 1L',
      sku: '89012398214',
      price: 520.0,
      quantity: 2,
      weightKg: 1.05,
    },
    {
      id: '3',
      name: 'MD Tomato Sauce Glass Bottle 400g',
      sku: '84912093812',
      price: 380.0,
      quantity: 1,
      weightKg: 0.65,
    },
  ])

  const [assistanceRequested, setAssistanceRequested] = useState(false)
  const [paymentStep, setPaymentStep] = useState<'scanning' | 'paying' | 'success'>('scanning')
  const [currentTime, setCurrentTime] = useState('')

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date()
      setCurrentTime(
        now.toLocaleTimeString('en-LK', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const handleUpdateQty = (id: string, delta: number) => {
    setItems(prev =>
      prev
        .map(i => {
          if (i.id === id) {
            const newQty = i.quantity + delta
            return newQty > 0 ? { ...i, quantity: newQty } : null
          }
          return i
        })
        .filter(Boolean) as KioskItem[]
    )
  }

  const handleRemove = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const subtotal = items.reduce((acc, i) => acc + i.price * i.quantity, 0)
  const totalWeight = items.reduce((acc, i) => acc + i.weightKg * i.quantity, 0)
  const ssclTax = subtotal * 0.025
  const grandTotal = subtotal + ssclTax

  return (
    <div className="min-h-screen bg-[#FAF8FF] dark:bg-[#0F172A] text-slate-900 dark:text-slate-100 flex flex-col font-sans select-none overflow-x-hidden">
      {/* Kiosk Hardware & Telemetry Top Bar */}
      <header className="h-16 bg-white/95 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-800 px-8 flex items-center justify-between backdrop-blur-md shadow-sm">
        {/* Left: Terminal ID */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-teal-700 text-white px-3.5 py-1 rounded-xl shadow-sm">
            <ScanLine className="w-4 h-4 text-teal-300" />
            <span className="font-mono font-bold text-sm">SCO-01</span>
            <span className="text-[10px] font-mono opacity-80 pl-1 uppercase border-l border-white/20">
              Colombo Flagship
            </span>
          </div>

          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-slate-700 dark:text-slate-300 font-semibold uppercase tracking-wider text-[11px]">
              Express Mode (&lt; 15 Items)
            </span>
          </div>
        </div>

        {/* Center: Hardware Health Sensors */}
        <div className="hidden xl:flex items-center gap-2 text-[10px] font-mono">
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
            <ScanLine className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-slate-400">SCANNER:</span>
            <span className="text-emerald-600 font-bold">READY (Honeywell)</span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
            <Scale className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-slate-400">SCALE:</span>
            <span className="text-emerald-600 font-bold">CALIBRATED (±0.00)</span>
          </div>
          <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
            <CreditCard className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-slate-400">LANKAPAY:</span>
            <span className="text-emerald-600 font-bold">ONLINE</span>
          </div>
        </div>

        {/* Right: Language, Assistance & Clock */}
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            {(['en', 'si', 'ta'] as const).map(l => (
              <button
                key={l}
                onClick={() => setLanguage(l)}
                className={`px-2.5 py-1 rounded-lg font-mono text-xs font-bold transition-all ${
                  language === l
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                {l === 'en' ? 'ENG' : l === 'si' ? 'සිංහල' : 'தமிழ்'}
              </button>
            ))}
          </div>

          <button
            onClick={() => setAssistanceRequested(prev => !prev)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 ${
              assistanceRequested
                ? 'bg-amber-500 text-white animate-bounce'
                : 'bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/60 text-amber-700 dark:text-amber-400 hover:bg-amber-100'
            }`}
          >
            <BellRing className="w-4 h-4" />
            <span>{assistanceRequested ? 'ATTENDANT CALLED' : 'ASSISTANCE'}</span>
          </button>

          <span className="font-mono text-xs font-bold text-slate-500 hidden sm:block">
            {currentTime}
          </span>
        </div>
      </header>

      {/* Main 60/40 Kiosk Workspace */}
      <main className="flex-1 p-8 grid grid-cols-12 gap-8 max-w-[1500px] mx-auto w-full">
        {/* Left Column (60%): Scanned Cart & Platter Scale Weight */}
        <div className="col-span-12 lg:col-span-7 flex flex-col gap-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                  Your Scanned Bag
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 font-mono text-xs font-bold">
                  {items.length} Items
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5">
                <Scale className="w-3.5 h-3.5 text-teal-600" />
                <span>Verified Bag Platter Weight: <strong>{totalWeight.toFixed(3)} kg</strong></span>
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 px-3 py-1.5 rounded-xl">
              <CheckCircle2 className="w-4 h-4" />
              <span>Weight Matched</span>
            </div>
          </div>

          {/* Cart Items Stream */}
          <div className="flex-1 overflow-y-auto flex flex-col gap-3 min-h-[350px]">
            {items.map(item => (
              <div
                key={item.id}
                className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between transition-all"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-12 h-12 rounded-xl bg-teal-50 dark:bg-teal-950/50 flex items-center justify-center text-teal-700 dark:text-teal-300 font-mono font-bold text-sm shrink-0">
                    <ShoppingBag className="w-6 h-6" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-base font-bold text-slate-900 dark:text-white truncate">
                      {item.name}
                    </span>
                    <span className="text-xs font-mono text-slate-500">
                      LKR {item.price.toFixed(2)} ea • {(item.weightKg * item.quantity).toFixed(2)} kg
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
                    <button
                      onClick={() => handleUpdateQty(item.id, -1)}
                      className="w-8 h-8 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 flex items-center justify-center shadow-sm"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-6 text-center font-mono font-bold text-sm">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => handleUpdateQty(item.id, 1)}
                      className="w-8 h-8 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 flex items-center justify-center shadow-sm"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="text-right font-mono min-w-[90px]">
                    <span className="text-base font-bold text-slate-900 dark:text-white">
                      LKR {(item.price * item.quantity).toFixed(2)}
                    </span>
                  </div>

                  <button
                    onClick={() => handleRemove(item.id)}
                    className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Barcode Scanner Viewfinder Prompt */}
          <div className="bg-teal-900/10 dark:bg-teal-950/40 border-2 border-dashed border-teal-600/40 rounded-2xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ScanLine className="w-6 h-6 text-teal-600 animate-pulse" />
              <div>
                <span className="text-sm font-bold text-teal-900 dark:text-teal-200 block">
                  Scan Next Barcode Across Viewfinder
                </span>
                <span className="text-xs text-teal-700/80 dark:text-teal-400">
                  Or place item directly on the right bagging scale platter.
                </span>
              </div>
            </div>
            <span className="text-xs font-mono font-bold bg-teal-600 text-white px-3 py-1 rounded-lg">
              SCANNER READY
            </span>
          </div>
        </div>

        {/* Right Column (40%): Settlement & Instant LankaPay / LankaQR */}
        <div className="col-span-12 lg:col-span-5 flex flex-col gap-6">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border-2 border-teal-600/30 dark:border-teal-500/40 shadow-xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <span className="text-xs font-mono uppercase tracking-wider text-slate-500 font-bold">
                Express Checkout
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 text-xs font-mono font-bold">
                RAMIS IRD Synced
              </span>
            </div>

            <div className="flex flex-col gap-2 font-mono text-sm">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Subtotal ({items.reduce((s, i) => s + i.quantity, 0)} items)</span>
                <span>LKR {subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-500 text-xs">
                <span>SSCL Tax (2.5%)</span>
                <span>LKR {ssclTax.toFixed(2)}</span>
              </div>
            </div>

            {/* Total Card */}
            <div className="bg-slate-50 dark:bg-slate-800/80 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 flex flex-col items-center text-center">
              <span className="text-xs font-mono uppercase tracking-wider text-slate-500 font-bold">
                Total Payable
              </span>
              <div className="font-mono text-4xl font-extrabold text-teal-700 dark:text-teal-300 mt-1">
                LKR {grandTotal.toFixed(2)}
              </div>
            </div>

            {/* Pay Options */}
            {paymentStep === 'scanning' ? (
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => setPaymentStep('paying')}
                  className="w-full h-14 rounded-2xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-base flex items-center justify-center gap-3 shadow-lg shadow-teal-600/20 transition-all active:scale-98"
                >
                  <CreditCard className="w-5 h-5" />
                  <span>Tap Card / LankaPay</span>
                </button>

                <button
                  onClick={() => setPaymentStep('paying')}
                  className="w-full h-14 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-base flex items-center justify-center gap-3 shadow-md transition-all active:scale-98"
                >
                  <QrCode className="w-5 h-5 text-emerald-400" />
                  <span>Pay with LankaQR (Bank App)</span>
                </button>
              </div>
            ) : paymentStep === 'paying' ? (
              <div className="p-6 bg-slate-50 dark:bg-slate-800 rounded-2xl flex flex-col items-center text-center gap-4 animate-in fade-in">
                <div className="w-16 h-16 rounded-full bg-teal-100 dark:bg-teal-950/60 text-teal-600 flex items-center justify-center animate-pulse">
                  <CreditCard className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Present Card or Scan QR</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Hold credit/debit card against the contactless pinpad or scan with FriMi / Genie.
                  </p>
                </div>
                <button
                  onClick={() => setPaymentStep('success')}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm shadow-md"
                >
                  Simulate Payment Approval
                </button>
              </div>
            ) : (
              <div className="p-6 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-800 flex flex-col items-center text-center gap-3 animate-in fade-in">
                <CheckCircle2 className="w-12 h-12 text-emerald-600" />
                <div>
                  <h3 className="font-bold text-lg text-emerald-900 dark:text-emerald-200">
                    Payment Approved!
                  </h3>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                    Receipt printed. Please take all your bagged items.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setPaymentStep('scanning')
                    setItems([])
                  }}
                  className="w-full py-2.5 rounded-xl bg-teal-600 text-white font-semibold text-sm"
                >
                  Start New Customer Session
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
