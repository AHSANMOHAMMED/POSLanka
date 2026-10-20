'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  Flame,
  Volume2,
  VolumeX,
  CheckCircle2,
  AlertTriangle,
  Timer,
  ChefHat,
  Loader2,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { useRealtimeData } from '@/hooks/useRealtimeData'

type KitchenStatus = 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled'
type OrderType = 'dine_in' | 'takeaway' | 'delivery'

interface KitchenOrderItem {
  id: string
  status: KitchenStatus
  restaurantOrderItemId: string
  itemName: string
  quantity: number
  modifiers: unknown[]
  notes: string | null
}

interface KitchenOrder {
  id: string
  status: KitchenStatus
  createdAt: string
  updatedAt: string
  restaurantOrderId: string
  orderNo: string
  orderType: OrderType
  tableName: string | null
  tableArea: string | null
  items: KitchenOrderItem[]
  totalItems: number
  pendingItems: number
  preparingItems: number
  readyItems: number
  servedItems: number
}

/** Target time (minutes) from order creation to ready */
const SLA_MINUTES = 14
const POLL_INTERVAL_MS = 10_000

const NEXT_ORDER_STATUS: Partial<Record<KitchenStatus, KitchenStatus>> = {
  pending: 'preparing',
  preparing: 'ready',
  ready: 'served',
}

const NEXT_ITEM_STATUS: Partial<Record<KitchenStatus, KitchenStatus>> = {
  pending: 'preparing',
  preparing: 'ready',
}

const BUMP_LABEL: Record<KitchenStatus, string> = {
  pending: 'Start Preparing',
  preparing: 'Mark Ready',
  ready: 'Bump Order',
  served: 'Served',
  cancelled: 'Cancelled',
}

function modifierLabels(modifiers: unknown[]): string[] {
  if (!Array.isArray(modifiers)) return []
  return modifiers
    .map((m) => {
      if (typeof m === 'string') return m
      if (m && typeof m === 'object') {
        const obj = m as Record<string, unknown>
        const name = obj.name ?? obj.modifierName ?? obj.label
        return typeof name === 'string' ? name : null
      }
      return null
    })
    .filter((m): m is string => !!m)
}

function orderTypeLabel(type: OrderType): string {
  if (type === 'dine_in') return 'Dine-In'
  if (type === 'takeaway') return 'Takeaway'
  return 'Delivery'
}

export default function KitchenDisplaySystemPage() {
  const [stationFocus, setStationFocus] = useState('curry_wok')
  const [filterType, setFilterType] = useState<'all' | OrderType>('all')
  const [isRushMode, setIsRushMode] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(false)

  const [orders, setOrders] = useState<KitchenOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [now, setNow] = useState<number>(() => Date.now())

  const knownIdsRef = useRef<Set<string> | null>(null)
  const soundRef = useRef(soundEnabled)
  useEffect(() => {
    soundRef.current = soundEnabled
  }, [soundEnabled])

  const playChime = useCallback(() => {
    if (!soundRef.current) return
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, ctx.currentTime)
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15)
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.3)
    } catch {
      // Audio not permitted
    }
  }, [])

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/kitchen-orders?activeOnly=true&sortBy=createdAt&sortOrder=asc', {
        cache: 'no-store',
      })
      if (res.status === 401) {
        setError('Session expired. Please sign in again.')
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to load kitchen orders')
        return
      }
      const data: KitchenOrder[] = await res.json()
      const list = Array.isArray(data) ? data : []

      // Chime on newly arrived tickets (skip the very first load)
      if (knownIdsRef.current) {
        const hasNew = list.some((o) => !knownIdsRef.current!.has(o.id))
        if (hasNew) playChime()
      }
      knownIdsRef.current = new Set(list.map((o) => o.id))

      setOrders(list)
      setError(null)
    } catch {
      setError('Network error while loading kitchen orders')
    } finally {
      setLoading(false)
    }
  }, [playChime])

  // Realtime: refresh on kitchen-order / restaurant-order data-change events.
  // Polling fallback disabled here because we always poll below.
  const { refresh, isConnected } = useRealtimeData(fetchOrders, {
    entityType: ['kitchen-order', 'restaurant-order'],
    pollingInterval: 0,
  })

  // Always-on polling every 10s (in addition to realtime events)
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) fetchOrders()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [fetchOrders])

  // Elapsed-time clock
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const markBusy = (id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const handleBumpTicket = async (order: KitchenOrder) => {
    const nextStatus = NEXT_ORDER_STATUS[order.status]
    if (!nextStatus || busyIds.has(order.id)) return
    markBusy(order.id, true)
    try {
      const res = await fetch(`/api/kitchen-orders/${order.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to update order status')
      } else if (nextStatus === 'served') {
        // Served orders leave the active board immediately
        setOrders((prev) => prev.filter((o) => o.id !== order.id))
      } else {
        setOrders((prev) =>
          prev.map((o) => (o.id === order.id ? { ...o, status: nextStatus } : o))
        )
      }
    } catch {
      setError('Network error while updating order')
    } finally {
      markBusy(order.id, false)
      refresh()
    }
  }

  const handleAdvanceItem = async (order: KitchenOrder, item: KitchenOrderItem) => {
    const nextStatus = NEXT_ITEM_STATUS[item.status]
    if (!nextStatus || busyIds.has(item.id)) return
    markBusy(item.id, true)
    try {
      const res = await fetch(`/api/kitchen-orders/${order.id}/items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to update item status')
      } else {
        const data = await res.json().catch(() => ({}))
        const newOrderStatus: KitchenStatus | undefined = data?.kitchenOrderStatus
        setOrders((prev) =>
          prev.map((o) =>
            o.id === order.id
              ? {
                  ...o,
                  status: newOrderStatus || o.status,
                  items: o.items.map((it) =>
                    it.id === item.id ? { ...it, status: nextStatus } : it
                  ),
                }
              : o
          )
        )
      }
    } catch {
      setError('Network error while updating item')
    } finally {
      markBusy(item.id, false)
      refresh()
    }
  }

  const elapsedFor = (createdAt: string) => {
    const ms = Math.max(0, now - Date.parse(createdAt))
    const totalSeconds = Math.floor(ms / 1000)
    return {
      minutes: Math.floor(totalSeconds / 60),
      seconds: totalSeconds % 60,
      totalMinutes: ms / 60000,
    }
  }

  const activeOrders = orders.filter((o) => o.status !== 'served' && o.status !== 'cancelled')
  const filteredTickets = activeOrders.filter((t) => filterType === 'all' || t.orderType === filterType)

  const breachedCount = activeOrders.filter((o) => elapsedFor(o.createdAt).totalMinutes > SLA_MINUTES).length
  const avgMinutes =
    activeOrders.length > 0
      ? activeOrders.reduce((s, o) => s + elapsedFor(o.createdAt).totalMinutes, 0) / activeOrders.length
      : 0
  const backlogPortions = activeOrders.reduce(
    (s, o) =>
      s +
      o.items
        .filter((i) => i.status === 'pending' || i.status === 'preparing')
        .reduce((a, i) => a + (Number(i.quantity) || 0), 0),
    0
  )

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none overflow-x-hidden">
      {/* KDS Industrial Top Header */}
      <header className="h-20 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <ChefHat className="w-8 h-8 text-teal-400" />
            <div>
              <h1 className="font-mono text-base font-bold tracking-tight text-white uppercase">
                POSLanka KDS
              </h1>
              <span className="text-[11px] font-mono text-slate-400">
                Kitchen Expedite & Line Routing
              </span>
            </div>
          </div>

          <div className="h-8 w-[1px] bg-slate-800 mx-2 hidden md:block" />

          {/* Station Selection */}
          <div className="hidden lg:flex items-center gap-1.5 bg-slate-800 p-1 rounded-xl">
            {[
              { id: 'curry_wok', label: 'Curry & Wok Line' },
              { id: 'seafood', label: 'Seafood Grill' },
              { id: 'tandoor', label: 'Tandoor & Roti' },
              { id: 'bar', label: 'Bar & Dispense' },
            ].map((st) => (
              <button
                key={st.id}
                onClick={() => setStationFocus(st.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  stationFocus === st.id
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>

        {/* Telemetry Pills & Action Controls */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono">
            <div className="px-3 py-1 rounded-lg bg-slate-800 border border-slate-700">
              <span className="text-slate-400">Active: </span>
              <span className="text-white font-bold">{activeOrders.length}</span>
            </div>
            <div className="px-3 py-1 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-400">
              <span>On Time: </span>
              <span className="font-bold">{activeOrders.length - breachedCount}</span>
            </div>
            <div className="px-3 py-1 rounded-lg bg-red-950/60 border border-red-800 text-red-400">
              <span>Delayed: </span>
              <span className="font-bold">{breachedCount}</span>
            </div>
            <div
              className={`px-3 py-1 rounded-lg border flex items-center gap-1.5 ${
                isConnected
                  ? 'bg-teal-950/60 border-teal-800 text-teal-400'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
              title={isConnected ? 'Realtime connected' : 'Polling every 10s'}
            >
              {isConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              <span>{isConnected ? 'LIVE' : 'POLL'}</span>
            </div>
          </div>

          <button
            onClick={() => setIsRushMode((prev) => !prev)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold font-mono uppercase flex items-center gap-1.5 transition-all ${
              isRushMode
                ? 'bg-red-600 text-white animate-pulse'
                : 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Flame className="w-4 h-4 text-amber-400" />
            <span>Rush</span>
          </button>

          <button
            onClick={() => setSoundEnabled((prev) => !prev)}
            title={soundEnabled ? 'Mute new-ticket chime' : 'Enable new-ticket chime'}
            className={`p-2 rounded-xl border ${
              soundEnabled
                ? 'bg-teal-900/40 border-teal-700 text-teal-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>

          <button
            onClick={() => refresh()}
            title="Refresh now"
            className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-teal-400 hover:bg-slate-700"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* SLA Telemetry & Fast Filtering Strip */}
      <div className="bg-slate-900/60 border-b border-slate-800/80 px-6 py-2.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6 text-xs font-mono">
          <div>
            <span className="text-slate-400">Target SLA: </span>
            <span className="text-teal-400 font-bold">{SLA_MINUTES.toFixed(1)}m</span>
          </div>
          <div>
            <span className="text-slate-400">Avg Wait: </span>
            <span className={`font-bold ${avgMinutes > SLA_MINUTES ? 'text-red-400' : 'text-emerald-400'}`}>
              {avgMinutes.toFixed(1)}m
            </span>
          </div>
          <div>
            <span className="text-slate-400">Line Backlog: </span>
            <span className="text-amber-400 font-bold">{backlogPortions} Portions</span>
          </div>
        </div>

        {/* Filter Channels */}
        <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl text-xs font-semibold">
          {[
            { id: 'all', label: 'All Tickets' },
            { id: 'dine_in', label: 'Dine-In' },
            { id: 'takeaway', label: 'Takeaway' },
            { id: 'delivery', label: 'Delivery' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterType(f.id as typeof filterType)}
              className={`px-3 py-1 rounded-lg transition-all ${
                filterType === f.id ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 px-4 py-2.5 rounded-xl bg-red-950/60 border border-red-800 text-red-300 text-xs font-mono flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {error}
          </span>
          <button onClick={() => refresh()} className="underline hover:text-white">
            Retry
          </button>
        </div>
      )}

      {/* Main KDS Board */}
      <main className="flex-1 p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start overflow-y-auto">
        {loading ? (
          <div className="col-span-full flex items-center justify-center py-24 text-slate-400 font-mono text-sm gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
            Loading kitchen tickets...
          </div>
        ) : filteredTickets.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center py-24 text-slate-500 font-mono text-sm gap-2">
            <ChefHat className="w-10 h-10 text-slate-700" />
            <span>No active tickets{filterType !== 'all' ? ` for ${orderTypeLabel(filterType)}` : ''}.</span>
            <span className="text-[11px] text-slate-600">New orders will appear here automatically.</span>
          </div>
        ) : (
          filteredTickets.map((ticket) => {
            const elapsed = elapsedFor(ticket.createdAt)
            const isBreached = elapsed.totalMinutes > SLA_MINUTES
            const overBy = Math.max(0, Math.floor(elapsed.totalMinutes - SLA_MINUTES))
            const nextStatus = NEXT_ORDER_STATUS[ticket.status]
            const isBusy = busyIds.has(ticket.id)
            const headerColor = isBreached
              ? 'bg-red-600 text-white'
              : ticket.status === 'ready'
                ? 'bg-emerald-700 text-white'
                : ticket.status === 'preparing'
                  ? 'bg-amber-600 text-white'
                  : 'bg-teal-700 text-white'

            return (
              <div
                key={ticket.id}
                className={`rounded-2xl shadow-xl overflow-hidden border flex flex-col transition-all ${
                  isBreached
                    ? 'bg-slate-900 border-red-500/80 ring-2 ring-red-500/20'
                    : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Ticket Header */}
                <div className={`p-4 flex items-center justify-between ${headerColor}`}>
                  <div className="min-w-0">
                    <span className="font-mono text-2xl font-black tracking-tight block truncate">
                      {ticket.orderNo}
                    </span>
                    <span className="text-xs opacity-90 font-medium block truncate">
                      {orderTypeLabel(ticket.orderType)}
                      {ticket.tableName ? ` • ${ticket.tableName}` : ''}
                      {ticket.tableArea ? ` (${ticket.tableArea})` : ''}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 bg-black/25 px-3 py-1.5 rounded-xl font-mono text-sm font-bold shrink-0">
                    <Timer className="w-4 h-4 animate-pulse" />
                    <span>
                      {elapsed.minutes}:{elapsed.seconds < 10 ? `0${elapsed.seconds}` : elapsed.seconds}
                    </span>
                  </div>
                </div>

                {/* Status / SLA strip */}
                {isBreached ? (
                  <div className="bg-red-500/20 text-red-300 px-4 py-1.5 text-xs font-mono font-bold flex items-center justify-between border-b border-red-500/30">
                    <span className="flex items-center gap-1.5 uppercase">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      SLA Breached (+{overBy}m)
                    </span>
                    <span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-[10px]">EXPEDITE</span>
                  </div>
                ) : (
                  <div className="bg-slate-950/40 text-slate-400 px-4 py-1.5 text-[10px] font-mono font-bold uppercase flex items-center justify-between border-b border-slate-800/60">
                    <span>{ticket.status}</span>
                    <span>
                      {ticket.readyItems}/{ticket.totalItems} ready
                    </span>
                  </div>
                )}

                {/* Items List */}
                <div className="p-4 flex flex-col gap-2.5 flex-1">
                  {ticket.items.map((item) => {
                    const done = item.status === 'ready' || item.status === 'served'
                    const cancelled = item.status === 'cancelled'
                    const mods = modifierLabels(item.modifiers)
                    const itemBusy = busyIds.has(item.id)
                    const canAdvance = !!NEXT_ITEM_STATUS[item.status]
                    return (
                      <div
                        key={item.id}
                        onClick={() => canAdvance && handleAdvanceItem(ticket, item)}
                        className={`p-3 rounded-xl border select-none transition-all ${
                          canAdvance ? 'cursor-pointer' : 'cursor-default'
                        } ${
                          cancelled
                            ? 'bg-slate-950/40 border-slate-800/40 opacity-40 line-through'
                            : done
                              ? 'bg-slate-950/40 border-slate-800/40 opacity-50 line-through'
                              : item.status === 'preparing'
                                ? 'bg-amber-950/30 border-amber-800/60 hover:bg-amber-950/50'
                                : 'bg-slate-800/80 border-slate-700/80 hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 min-w-0">
                            <span className="font-mono font-extrabold text-teal-400 text-base">
                              {item.quantity}×
                            </span>
                            <div className="min-w-0">
                              <span className="text-sm font-bold text-white block">{item.itemName}</span>
                              {(mods.length > 0 || item.notes) && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {mods.map((m, i) => (
                                    <span
                                      key={`${m}-${i}`}
                                      className="text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded"
                                    >
                                      {m}
                                    </span>
                                  ))}
                                  {item.notes && (
                                    <span className="text-[10px] font-mono font-bold bg-sky-500/20 text-sky-300 px-1.5 py-0.5 rounded">
                                      {item.notes}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {itemBusy ? (
                            <Loader2 className="w-4 h-4 animate-spin text-slate-400 shrink-0 mt-0.5" />
                          ) : done ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                          ) : item.status === 'preparing' ? (
                            <Flame className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Ticket Footer Action: Bump */}
                <div className="p-3 bg-slate-950/80 border-t border-slate-800/80 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!nextStatus || isBusy}
                    onClick={() => handleBumpTicket(ticket)}
                    className={`flex-1 py-2.5 rounded-xl text-white font-bold text-xs uppercase tracking-wider font-mono flex items-center justify-center gap-2 shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100 ${
                      ticket.status === 'ready'
                        ? 'bg-emerald-600 hover:bg-emerald-700'
                        : ticket.status === 'preparing'
                          ? 'bg-amber-600 hover:bg-amber-700'
                          : 'bg-teal-600 hover:bg-teal-700'
                    }`}
                  >
                    {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    <span>{BUMP_LABEL[ticket.status]}</span>
                  </button>
                </div>
              </div>
            )
          })
        )}
      </main>
    </div>
  )
}
