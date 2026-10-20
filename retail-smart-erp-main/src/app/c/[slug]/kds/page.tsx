'use client'

import React, { useState } from 'react'
import {
  Flame,
  Volume2,
  CheckCircle2,
  AlertTriangle,
  Timer,
  ChefHat,
} from 'lucide-react'

interface KDSTicketItem {
  id: string
  name: string
  quantity: number
  modifiers?: string[]
  completed?: boolean
}

interface KDSTicket {
  id: string
  ticketNo: string
  orderType: 'dine_in' | 'takeaway' | 'delivery'
  tableNo?: string
  server: string
  elapsedMinutes: number
  elapsedSeconds: number
  isUrgent?: boolean
  isBreached?: boolean
  items: KDSTicketItem[]
}

const INITIAL_TICKETS: KDSTicket[] = [
  {
    id: '1',
    ticketNo: '#108',
    orderType: 'dine_in',
    tableNo: 'T-09 (4 Pax)',
    server: 'Shantha B.',
    elapsedMinutes: 28,
    elapsedSeconds: 15,
    isUrgent: true,
    isBreached: true,
    items: [
      { id: '1a', name: 'Jaffna Crab Curry (Spicy)', quantity: 1, modifiers: ['Extra Pol Sambol', 'Medium Heat'], completed: false },
      { id: '1b', name: 'Roast Paan with Katta Sambol', quantity: 2, completed: true },
      { id: '1c', name: 'Mutton Kothu Roti Special', quantity: 1, modifiers: ['No Onions'], completed: false },
    ],
  },
  {
    id: '2',
    ticketNo: '#109',
    orderType: 'dine_in',
    tableNo: 'T-04 (2 Pax)',
    server: 'Kamal R.',
    elapsedMinutes: 12,
    elapsedSeconds: 40,
    isUrgent: false,
    items: [
      { id: '2a', name: 'Negombo Prawn Theldhala', quantity: 1, completed: false },
      { id: '2b', name: 'Steamed Basmati Rice', quantity: 2, completed: false },
      { id: '2c', name: 'Dhal Curry Claypot', quantity: 1, completed: false },
    ],
  },
  {
    id: '3',
    ticketNo: '#110',
    orderType: 'delivery',
    tableNo: 'PickMe Food • Order #P-992',
    server: 'Dispatch Desk',
    elapsedMinutes: 6,
    elapsedSeconds: 10,
    isUrgent: false,
    items: [
      { id: '3a', name: 'Chicken Fried Rice (Family Pack)', quantity: 1, modifiers: ['Chilli Paste Separate'], completed: false },
      { id: '3b', name: 'Hot Butter Cuttlefish (HBC)', quantity: 1, completed: false },
      { id: '3c', name: 'Devilled Chicken (Dry)', quantity: 1, completed: false },
    ],
  },
  {
    id: '4',
    ticketNo: '#111',
    orderType: 'takeaway',
    tableNo: 'Takeaway Counter #01',
    server: 'Dilshan P.',
    elapsedMinutes: 3,
    elapsedSeconds: 22,
    isUrgent: false,
    items: [
      { id: '4a', name: 'String Hopper Pilau (15 pcs)', quantity: 2, modifiers: ['Pol Roti Addon'], completed: false },
      { id: '4b', name: 'Fish Sothi Gravy', quantity: 1, completed: false },
    ],
  },
]

export default function KitchenDisplaySystemPage() {
  const [stationFocus, setStationFocus] = useState('curry_wok')
  const [filterType, setFilterType] = useState<'all' | 'dine_in' | 'takeaway' | 'delivery'>('all')
  const [isRushMode, setIsRushMode] = useState(false)
  const [tickets, setTickets] = useState<KDSTicket[]>(INITIAL_TICKETS)

  const handleToggleItem = (ticketId: string, itemId: string) => {
    setTickets(prev =>
      prev.map(t => {
        if (t.id === ticketId) {
          return {
            ...t,
            items: t.items.map(item =>
              item.id === itemId ? { ...item, completed: !item.completed } : item
            ),
          }
        }
        return t
      })
    )
  }

  const handleBumpTicket = (ticketId: string) => {
    setTickets(prev => prev.filter(t => t.id !== ticketId))
  }

  const filteredTickets = tickets.filter(t => {
    if (filterType === 'all') return true
    return t.orderType === filterType
  })

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans select-none overflow-x-hidden">
      {/* KDS Industrial Top Header */}
      <header className="h-20 bg-slate-900 border-b border-slate-800 px-6 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <ChefHat className="w-8 h-8 text-teal-400" />
            <div>
              <h1 className="font-mono text-base font-bold tracking-tight text-white uppercase">
                POSLanka KDS Tablet (G3)
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
            ].map(st => (
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
              <span className="text-white font-bold">{tickets.length}</span>
            </div>
            <div className="px-3 py-1 rounded-lg bg-emerald-950/60 border border-emerald-800 text-emerald-400">
              <span>On Time: </span>
              <span className="font-bold">
                {tickets.filter(t => !t.isBreached).length}
              </span>
            </div>
            <div className="px-3 py-1 rounded-lg bg-red-950/60 border border-red-800 text-red-400">
              <span>Delayed: </span>
              <span className="font-bold">
                {tickets.filter(t => t.isBreached).length}
              </span>
            </div>
          </div>

          <button
            onClick={() => setIsRushMode(prev => !prev)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold font-mono uppercase flex items-center gap-1.5 transition-all ${
              isRushMode
                ? 'bg-red-600 text-white animate-pulse'
                : 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700'
            }`}
          >
            <Flame className="w-4 h-4 text-amber-400" />
            <span>Rush</span>
          </button>

          <button className="p-2 rounded-xl bg-slate-800 border border-slate-700 text-teal-400 hover:bg-slate-700">
            <Volume2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* SLA Telemetry & Fast Filtering Strip */}
      <div className="bg-slate-900/60 border-b border-slate-800/80 px-6 py-2.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-6 text-xs font-mono">
          <div>
            <span className="text-slate-400">Target SLA: </span>
            <span className="text-teal-400 font-bold">14.0m</span>
          </div>
          <div>
            <span className="text-slate-400">Avg Speed: </span>
            <span className="text-emerald-400 font-bold">13.5m</span>
          </div>
          <div>
            <span className="text-slate-400">Line Backlog: </span>
            <span className="text-amber-400 font-bold">18 Portions</span>
          </div>
        </div>

        {/* Filter Channels */}
        <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl text-xs font-semibold">
          {[
            { id: 'all', label: 'All Tickets' },
            { id: 'dine_in', label: 'Dine-In' },
            { id: 'takeaway', label: 'Takeaway' },
            { id: 'delivery', label: 'Delivery / PickMe' },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFilterType(f.id as typeof filterType)}
              className={`px-3 py-1 rounded-lg transition-all ${
                filterType === f.id
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main KDS Commercial Board: 4 Columns Grid */}
      <main className="flex-1 p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start overflow-y-auto">
        {filteredTickets.map(ticket => (
          <div
            key={ticket.id}
            className={`rounded-2xl shadow-xl overflow-hidden border flex flex-col transition-all ${
              ticket.isBreached
                ? 'bg-slate-900 border-red-500/80 ring-2 ring-red-500/20'
                : 'bg-slate-900 border-slate-800 hover:border-slate-700'
            }`}
          >
            {/* Ticket Header */}
            <div
              className={`p-4 flex items-center justify-between ${
                ticket.isBreached
                  ? 'bg-red-600 text-white'
                  : 'bg-teal-700 text-white'
              }`}
            >
              <div>
                <span className="font-mono text-2xl font-black tracking-tight block">
                  {ticket.ticketNo}
                </span>
                <span className="text-xs opacity-90 font-medium">
                  {ticket.tableNo}
                </span>
              </div>

              <div className="flex items-center gap-1.5 bg-black/25 px-3 py-1.5 rounded-xl font-mono text-sm font-bold">
                <Timer className="w-4 h-4 animate-pulse" />
                <span>
                  {ticket.elapsedMinutes}:{ticket.elapsedSeconds < 10 ? `0${ticket.elapsedSeconds}` : ticket.elapsedSeconds}
                </span>
              </div>
            </div>

            {/* SLA Alert Strip */}
            {ticket.isBreached && (
              <div className="bg-red-500/20 text-red-300 px-4 py-1.5 text-xs font-mono font-bold flex items-center justify-between border-b border-red-500/30">
                <span className="flex items-center gap-1.5 uppercase">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  SLA Breached (+8m)
                </span>
                <span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-[10px]">
                  EXPEDITE
                </span>
              </div>
            )}

            {/* Items List */}
            <div className="p-4 flex flex-col gap-2.5 flex-1">
              {ticket.items.map(item => (
                <div
                  key={item.id}
                  onClick={() => handleToggleItem(ticket.id, item.id)}
                  className={`p-3 rounded-xl border cursor-pointer select-none transition-all ${
                    item.completed
                      ? 'bg-slate-950/40 border-slate-800/40 opacity-40 line-through'
                      : 'bg-slate-800/80 border-slate-700/80 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <span className="font-mono font-extrabold text-teal-400 text-base">
                        {item.quantity}×
                      </span>
                      <div>
                        <span className="text-sm font-bold text-white block">
                          {item.name}
                        </span>
                        {item.modifiers && item.modifiers.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {item.modifiers.map(m => (
                              <span
                                key={m}
                                className="text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded"
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {item.completed && (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Ticket Footer Action: Bump */}
            <div className="p-3 bg-slate-950/80 border-t border-slate-800/80 flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleBumpTicket(ticket.id)}
                className="flex-1 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs uppercase tracking-wider font-mono flex items-center justify-center gap-2 shadow-md transition-all active:scale-95"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Bump Order</span>
              </button>
            </div>
          </div>
        ))}
      </main>
    </div>
  )
}
