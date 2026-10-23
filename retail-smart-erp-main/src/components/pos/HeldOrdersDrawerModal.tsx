'use client'

import React from 'react'
import { Clock, X, Play, Trash2, ShoppingBag, User } from 'lucide-react'
import { useEscapeKey } from '@/hooks/useEscapeKey'

export interface HeldOrder {
  id: string
  ticketNumber: string
  customerName?: string
  tableOrCounter?: string
  heldAt: string
  itemsCount: number
  totalAmount: number
  reason?: string
}

interface HeldOrdersDrawerModalProps {
  isOpen: boolean
  onClose: () => void
  orders: HeldOrder[]
  onResumeOrder: (orderId: string) => void
  onVoidOrder: (orderId: string) => void
}

export function HeldOrdersDrawerModal({
  isOpen,
  onClose,
  orders = [],
  onResumeOrder,
  onVoidOrder,
}: HeldOrdersDrawerModalProps) {
  useEscapeKey(isOpen, onClose)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg h-full bg-white dark:bg-slate-900 shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800 animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="px-6 py-5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-sm">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono uppercase tracking-wider font-bold bg-amber-500/20 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded">
                  Parked Carts
                </span>
                <span className="text-xs font-mono font-bold text-slate-500">
                  {orders.length} Active
                </span>
              </div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
                Held Orders Drawer
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Orders List */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-3">
          {orders.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-slate-400">
              <ShoppingBag className="w-12 h-12 mb-3 stroke-[1.5]" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                No orders currently on hold
              </p>
              <p className="text-xs mt-1">
                Cashiers can hold transactions to attend to waiting customers.
              </p>
            </div>
          ) : (
            orders.map(order => (
              <div
                key={order.id}
                className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 shadow-sm flex flex-col gap-3 transition-all hover:border-amber-400/50"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold font-mono text-slate-900 dark:text-white">
                        Ticket #{order.ticketNumber}
                      </span>
                      {order.tableOrCounter && (
                        <span className="text-[12px] font-mono bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded">
                          {order.tableOrCounter}
                        </span>
                      )}
                    </div>
                    {order.customerName && (
                      <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 mt-1">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span>{order.customerName}</span>
                      </div>
                    )}
                  </div>

                  <div className="text-right font-mono">
                    <span className="text-sm font-bold text-teal-700 dark:text-teal-400 block">
                      LKR {order.totalAmount.toFixed(2)}
                    </span>
                    <span className="text-[12px] text-slate-400">
                      {order.itemsCount} items
                    </span>
                  </div>
                </div>

                {order.reason && (
                  <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-900/40">
                    Reason: {order.reason}
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700/80">
                  <div className="text-[12px] font-mono text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>Held {order.heldAt}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onVoidOrder(order.id)}
                      className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/60 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-1 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Void</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onResumeOrder(order.id)}
                      className="px-4 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all active:scale-95"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Resume Sale</span>
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
