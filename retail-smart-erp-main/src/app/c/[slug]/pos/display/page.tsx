'use client'

import React, { useState, useEffect, useCallback, useSyncExternalStore } from 'react'
import {
  Store,
  QrCode,
  ShoppingBag,
  Gift,
  Zap,
  CheckCircle2,
  CreditCard,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import {
  subscribePosDisplay,
  readPosDisplaySnapshot,
  type PosDisplayState,
} from '@/lib/pos/display-channel'

/** Consider the POS disconnected if nothing arrived for this long */
const STALE_AFTER_MS = 2 * 60 * 1000

// ---- External store bridge (BroadcastChannel + localStorage) ----
let cachedState: PosDisplayState | null | undefined
const listeners = new Set<() => void>()
let unsubscribeChannel: (() => void) | null = null

function subscribeStore(onStoreChange: () => void) {
  listeners.add(onStoreChange)
  if (!unsubscribeChannel) {
    unsubscribeChannel = subscribePosDisplay((state) => {
      cachedState = state
      listeners.forEach((l) => l())
    })
  }
  return () => {
    listeners.delete(onStoreChange)
    if (listeners.size === 0 && unsubscribeChannel) {
      unsubscribeChannel()
      unsubscribeChannel = null
    }
  }
}

function getSnapshot(): PosDisplayState | null {
  if (cachedState === undefined) cachedState = readPosDisplaySnapshot()
  return cachedState
}

function getServerSnapshot(): PosDisplayState | null {
  return null
}

function usePosDisplayState(): PosDisplayState | null {
  return useSyncExternalStore(subscribeStore, getSnapshot, getServerSnapshot)
}

export default function CustomerFacingDisplayPage() {
  const company = useCompanyOptional()
  const state = usePosDisplayState()

  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const currency = company?.currency || 'LKR'
  const money = useCallback(
    (value: number) =>
      `${currency} ${Number(value || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
    [currency]
  )

  const currentTime = new Date(now).toLocaleTimeString('en-LK', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  })

  const updatedAtMs = state ? Date.parse(state.updatedAt) : NaN
  const isStale = !state || Number.isNaN(updatedAtMs) || now - updatedAtMs > STALE_AFTER_MS
  const isIdle = !state || state.status === 'idle' || isStale

  const tenantName = state?.tenantName || company?.tenantName || 'POSLanka'
  const cashierName = state?.cashierName || ''
  const items = state?.items ?? []
  const totalUnits = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0)

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
                {tenantName}
              </h1>
              {!isStale && state ? (
                <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-mono text-[11px] font-bold uppercase tracking-wider flex items-center gap-1">
                  <Wifi className="w-3 h-3" />
                  Live
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono text-[11px] font-bold uppercase tracking-wider flex items-center gap-1">
                  <WifiOff className="w-3 h-3" />
                  Waiting for POS
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {cashierName ? `Cashier: ${cashierName}` : 'Customer display'}
              {state?.invoiceNo ? ` • Invoice ${state.invoiceNo}` : ''}
            </p>
          </div>
        </div>

        <div className="text-right font-mono">
          <div className="text-base font-bold text-slate-800 dark:text-slate-200">{currentTime}</div>
          <div className="text-[11px] text-slate-400">Sri Lanka Standard Time</div>
        </div>
      </header>

      {isIdle ? (
        /* Idle / Welcome Screen */
        <main className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-6">
          <div className="w-24 h-24 rounded-3xl bg-teal-600 text-white flex items-center justify-center shadow-xl shadow-teal-600/20">
            <ShoppingBag className="w-12 h-12" />
          </div>
          <div>
            <h2 className="text-4xl font-extrabold tracking-tight text-teal-800 dark:text-teal-300">
              Welcome to {tenantName}
            </h2>
            <p className="mt-2 text-base text-slate-500 dark:text-slate-400">
              {state && isStale
                ? 'The register is idle. Your items will appear here once scanning starts.'
                : 'Your items will appear here as they are scanned.'}
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm text-teal-800 dark:text-teal-300 font-semibold bg-teal-50/80 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-900/50 rounded-xl px-6 py-3">
            <span>සාදරයෙන් පිළිගනිමු</span>
            <span>•</span>
            <span>வரவேற்கிறோம்</span>
            <span>•</span>
            <span>Welcome</span>
          </div>
        </main>
      ) : (
        /* Main Dual-Screen Layout Canvas */
        <main className="flex-1 p-8 grid grid-cols-12 gap-8 max-w-[1600px] mx-auto w-full">
          {/* Left Column (60%): Live Cart Item Stream */}
          <div className="col-span-7 flex flex-col gap-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-950/40 text-teal-600 dark:text-teal-400 flex items-center justify-center">
                  <ShoppingBag className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">Scanned Items</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {items.length} Distinct Products • {totalUnits} Total Units
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-xs font-mono font-bold tracking-wider uppercase">
                  {state?.status === 'paying'
                    ? 'Awaiting Payment'
                    : state?.status === 'paid'
                      ? 'Payment Complete'
                      : 'Live Scanning Stream'}
                </span>
              </div>
            </div>

            {/* Cart Items List */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
              {items.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-sm text-slate-400 font-mono">
                  No items yet
                </div>
              ) : (
                items.map((item, idx) => (
                  <div
                    key={item.id || idx}
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
                          <span>
                            {money(item.unitPrice)} ea{item.unit ? ` / ${item.unit}` : ''}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 shrink-0">
                      <div className="px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-mono font-bold text-slate-800 dark:text-slate-200 text-sm">
                        Qty: {item.quantity}
                      </div>
                      <div className="text-right font-mono min-w-[110px]">
                        <div className="text-base font-bold text-slate-900 dark:text-white">
                          {money(item.total)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Multilingual Welcome Ticker */}
            <div className="bg-teal-50/80 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-900/50 rounded-xl p-3 flex items-center justify-between text-xs text-teal-800 dark:text-teal-300 font-semibold">
              <span>සාදරයෙන් පිළිගනිමු (Sinhala)</span>
              <span>•</span>
              <span>வரவேற்கிறோம் (Tamil)</span>
              <span>•</span>
              <span>Thank you for shopping at {tenantName}</span>
            </div>
          </div>

          {/* Right Column (40%): Live Ledger Totals */}
          <div className="col-span-5 flex flex-col gap-6">
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border-2 border-teal-600/30 dark:border-teal-500/40 shadow-xl flex flex-col gap-5">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold">
                  Payment Summary
                </span>
                <span className="px-2.5 py-1 rounded-full bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 text-xs font-mono font-bold">
                  {state?.status === 'paid' ? 'Paid' : state?.status === 'paying' ? 'Paying' : 'In Progress'}
                </span>
              </div>

              {/* Calculations Breakdown */}
              <div className="flex flex-col gap-2 font-mono text-sm">
                <div className="flex justify-between text-slate-600 dark:text-slate-400">
                  <span>Subtotal ({totalUnits} items)</span>
                  <span>{money(state?.subtotal ?? 0)}</span>
                </div>
                {(state?.discount ?? 0) > 0 && (
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                    <span>Discounts</span>
                    <span>-{money(state?.discount ?? 0)}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-500 dark:text-slate-400 text-xs">
                  <span>Tax</span>
                  <span>{money(state?.tax ?? 0)}</span>
                </div>
              </div>

              {/* Grand Total Display */}
              <div className="bg-slate-50 dark:bg-slate-800/80 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 flex flex-col items-center text-center">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold">
                  {state?.status === 'paid' ? 'Total Paid' : 'Total Due'}
                </span>
                <div className="font-mono text-4xl font-extrabold text-teal-700 dark:text-teal-300 mt-1 tracking-tight">
                  {money(state?.total ?? 0)}
                </div>
                {state?.status === 'paid' && state.changeDue !== undefined && state.changeDue > 0 && (
                  <div className="mt-2 font-mono text-sm text-emerald-600 dark:text-emerald-400 font-bold">
                    Change Due: {money(state.changeDue)}
                  </div>
                )}
              </div>

              {state?.status === 'paid' ? (
                <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-5 flex items-center gap-4">
                  <CheckCircle2 className="w-10 h-10 text-emerald-600 shrink-0" />
                  <div>
                    <div className="text-base font-bold text-emerald-900 dark:text-emerald-200">
                      Thank you for your purchase
                    </div>
                    <div className="text-xs text-emerald-700 dark:text-emerald-300">
                      {state.invoiceNo ? `Receipt ${state.invoiceNo}` : 'Your receipt is being printed'}
                    </div>
                  </div>
                </div>
              ) : state?.status === 'paying' ? (
                <div className="bg-slate-900 text-white rounded-2xl p-5 flex items-center justify-between gap-4 shadow-lg">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-mono font-bold uppercase tracking-wider">
                      <CreditCard className="w-3.5 h-3.5" />
                      Please complete payment
                    </div>
                    <div className="text-sm font-bold">Tap card, scan QR or pay cash at the counter</div>
                  </div>
                  <div className="w-20 h-20 bg-white rounded-xl p-2 flex items-center justify-center shrink-0 shadow-md">
                    <QrCode className="w-full h-full text-slate-900" />
                  </div>
                </div>
              ) : (
                <div className="bg-slate-900 text-white rounded-2xl p-5 flex items-center justify-between gap-4 shadow-lg">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-mono font-bold uppercase tracking-wider">
                      <Zap className="w-3.5 h-3.5" />
                      Instant QR Settlement
                    </div>
                    <div className="text-sm font-bold">Scan to Pay with Any Bank App</div>
                    <div className="text-[11px] text-slate-400">Available once your cashier starts payment</div>
                  </div>
                  <div className="w-20 h-20 bg-white rounded-xl p-2 flex items-center justify-center shrink-0 shadow-md">
                    <QrCode className="w-full h-full text-slate-900" />
                  </div>
                </div>
              )}
            </div>

            {/* Promotional Card */}
            <div className="bg-gradient-to-r from-teal-700 to-teal-900 text-white rounded-3xl p-6 shadow-md flex items-center justify-between relative overflow-hidden">
              <div className="flex flex-col gap-1 z-10">
                <span className="text-[10px] font-mono uppercase tracking-widest font-bold bg-white/20 text-white px-2 py-0.5 rounded-full w-fit">
                  Thank you
                </span>
                <h3 className="text-base font-bold leading-snug">We appreciate your visit to {tenantName}</h3>
                <p className="text-xs text-teal-200 mt-0.5">Please check your receipt before leaving the counter.</p>
              </div>
              <Gift className="w-14 h-14 text-teal-300/40 shrink-0 z-10" />
            </div>
          </div>
        </main>
      )}
    </div>
  )
}
