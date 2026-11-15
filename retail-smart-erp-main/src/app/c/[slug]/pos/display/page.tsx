'use client'

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react'
import { useParams } from 'next/navigation'
import { Store, ShoppingBag, CheckCircle2, CreditCard, Wifi, WifiOff, Maximize2, Sparkles, HeartHandshake } from 'lucide-react'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import { useFeatureFlags } from '@/hooks/useFeatureFlag'
import {
  subscribePosDisplay,
  readPosDisplaySnapshot,
  POS_DISPLAY_HEARTBEAT_MS,
  type PosDisplayState,
} from '@/lib/pos/display-channel'

/** No message (heartbeat) for this long → "Waiting for POS" + idle screen */
const STALE_AFTER_MS = POS_DISPLAY_HEARTBEAT_MS * 4
/** The thank-you screen stays at least this long, even when the cashier starts the next sale at once */
const THANK_YOU_MIN_MS = 8_000
/** …and at most this long */
const THANK_YOU_MAX_MS = 45_000
const SLIDE_MS = 7_000

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

interface ShopBrand { name: string; logoUrl: string | null; phone: string | null; address: string | null }

/**
 * Customer-facing display (second monitor). Opened from the POS (Customer Display button / Alt+D),
 * mirrors the POS of the same browser over BroadcastChannel (+ localStorage fallback).
 */
export default function CustomerFacingDisplayPage() {
  const company = useCompanyOptional()
  const params = useParams()
  const slug = String(params?.slug || '')
  const { flags, loading: flagsLoading } = useFeatureFlags()
  const raw = usePosDisplayState()
  // A POS of another shop open in the same browser is ignored
  const state = raw && (!raw.tenantSlug || !slug || raw.tenantSlug === slug) ? raw : null

  const [now, setNow] = useState<number>(() => Date.now())
  const [brand, setBrand] = useState<ShopBrand | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  /** The latest payment, so the thank-you screen survives an immediate "new sale" on the POS */
  const [lastPaid, setLastPaid] = useState<PosDisplayState | null>(null)
  if (state?.status === 'paid' && lastPaid?.updatedAt !== state.updatedAt) setLastPaid(state)
  const listEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Shop name / logo for the header and the idle slides
  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant')
      .then((r) => (r.ok ? r.json() : null))
      .then((t) => {
        if (cancelled || !t) return
        setBrand({ name: t.name || '', logoUrl: t.logoUrl || null, phone: t.phone || null, address: t.address || null })
      })
      .catch(() => { /* offline: name from the POS messages */ })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const goFullscreen = useCallback(() => {
    document.documentElement.requestFullscreen?.().catch(() => { /* not allowed */ })
  }, [])

  // Newest line in view
  const itemCount = state?.items.length ?? 0
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [itemCount])

  const currency = company?.currency || 'LKR'
  const money = useCallback(
    (value: number) => `${currency} ${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    [currency],
  )

  if (!flagsLoading && flags.customer_display === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 p-8 text-center">
        The customer display is turned off for this shop (Super admin → Vendor → Features).
      </div>
    )
  }

  const lastSeen = state ? Date.parse(state.sentAt || state.updatedAt) : NaN
  const isStale = !state || Number.isNaN(lastSeen) || now - lastSeen > STALE_AFTER_MS

  const paidAge = lastPaid ? now - Date.parse(lastPaid.updatedAt) : Infinity
  let view: 'idle' | 'cart' | 'paid' = 'idle'
  let shown: PosDisplayState | null = state
  if (!isStale && state) {
    if (state.status === 'paid') view = paidAge < THANK_YOU_MAX_MS ? 'paid' : 'idle'
    else if (state.status === 'idle') view = paidAge < THANK_YOU_MIN_MS ? 'paid' : 'idle'
    else view = 'cart'
    if (view === 'paid' && lastPaid) shown = lastPaid
  }

  const shopName = brand?.name || shown?.tenantName || company?.tenantName || 'Welcome'
  const logoUrl = brand?.logoUrl || null
  const cashierName = shown?.cashierName || ''
  const items = shown?.items ?? []
  const totalUnits = items.reduce((s, i) => s + (i.unit ? 1 : Number(i.quantity) || 0), 0)
  const clock = new Date(now).toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit', hour12: true })

  return (
    <div className="min-h-screen h-[100dvh] bg-[#F6F8FB] dark:bg-[#0B1220] text-slate-900 dark:text-slate-100 flex flex-col font-sans select-none overflow-hidden">
      {/* Header */}
      <header className="shrink-0 h-14 sm:h-16 md:h-20 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 sm:px-6 md:px-8 flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-2 sm:gap-3 md:gap-4 min-w-0">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-8 sm:h-10 md:h-12 w-auto max-w-[22vw] object-contain rounded" />
          ) : (
            <div className="h-8 sm:h-10 md:h-12 aspect-square rounded-xl sm:rounded-2xl bg-teal-600 flex items-center justify-center text-white shrink-0">
              <Store className="w-1/2 h-1/2" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-sm sm:text-lg md:text-2xl font-extrabold tracking-tight text-teal-800 dark:text-teal-300 truncate leading-tight">
              {shopName}
            </h1>
            <p className="text-[10px] sm:text-xs md:text-sm text-slate-500 dark:text-slate-400 truncate">
              {cashierName ? `Served by ${cashierName}` : 'Customer display'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {!isStale ? (
            <span className="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 text-[10px] sm:text-xs font-bold uppercase tracking-wider flex items-center gap-1">
              <span className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="hidden xs:inline sm:inline">Live</span>
            </span>
          ) : (
            <span className="px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] sm:text-xs font-bold uppercase tracking-wider flex items-center gap-1" title="Open the POS in this browser and keep it running">
              <WifiOff className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span className="hidden xs:inline sm:inline">Waiting</span>
            </span>
          )}
          <span className="font-mono font-bold text-xs sm:text-base md:text-xl text-slate-700 dark:text-slate-200 tabular-nums">{clock}</span>
          {!isFullscreen && (
            <button
              type="button"
              onClick={goFullscreen}
              className="p-1.5 sm:p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Full screen (or press F11)"
              aria-label="Full screen"
            >
              <Maximize2 className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          )}
        </div>
      </header>

      {view === 'idle' && <IdleSlides shopName={shopName} logoUrl={logoUrl} brand={brand} now={now} />}

      {view === 'paid' && shown && (
        <main className="flex-1 min-h-0 flex flex-col items-center justify-center text-center gap-4 sm:gap-6 md:gap-8 p-4 sm:p-8 overflow-y-auto">
          <div className="w-14 h-14 sm:w-20 sm:h-20 md:w-28 md:h-28 rounded-full bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600 dark:text-emerald-400 animate-in zoom-in duration-300">
            <CheckCircle2 className="w-10 h-10 sm:w-14 sm:h-14 md:w-20 md:h-20" />
          </div>
          <h2 className="text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-emerald-700 dark:text-emerald-400 leading-tight">Thank you!</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 md:gap-6 w-full max-w-3xl">
            <Stat label="Total" value={money(shown.total)} />
            {shown.amountPaid !== undefined && shown.amountPaid > 0 && <Stat label="Cash received" value={money(shown.amountPaid)} />}
            {shown.changeDue !== undefined && shown.changeDue > 0 && <Stat label="Your change" value={money(shown.changeDue)} highlight />}
          </div>
          <div className="space-y-1">
            <p className="text-sm sm:text-lg md:text-2xl text-slate-500 dark:text-slate-400">
              {shown.invoiceNo ? `Receipt ${shown.invoiceNo} · ` : ''}Please come again
            </p>
            <p className="text-xs sm:text-base md:text-xl text-teal-700 dark:text-teal-300 font-semibold">
              ස්තූතියි · நன்றி · Thank you
            </p>
          </div>
        </main>
      )}

      {view === 'cart' && shown && (
        <main className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(300px,1fr)] lg:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)] gap-3 sm:gap-4 md:gap-6 p-3 sm:p-4 md:p-6 overflow-hidden">
          {/* Left Column (Desktop) / Bottom Section (Mobile): Items List */}
          <section className="flex-1 min-h-0 flex flex-col bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden order-2 md:order-1">
            <div className="shrink-0 px-4 py-2.5 sm:px-6 sm:py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-sm sm:text-base md:text-xl font-bold flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 sm:w-5 sm:h-5 text-teal-600 shrink-0" />
                <span>Your items</span>
              </h2>
              <span className="text-xs sm:text-sm text-slate-500 font-mono">
                {items.length} {items.length === 1 ? 'line' : 'lines'} · {totalUnits} items
              </span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {items.length === 0 ? (
                <div className="h-full min-h-[140px] flex flex-col items-center justify-center text-slate-400 p-6 text-center gap-2">
                  <ShoppingBag className="w-10 h-10 stroke-1 text-slate-300 dark:text-slate-600" />
                  <p className="text-sm sm:text-base">No items scanned yet</p>
                </div>
              ) : (
                items.map((item, idx) => {
                  const isLatest = idx === items.length - 1
                  return (
                    <div
                      key={item.id || idx}
                      className={`px-3 py-2.5 sm:px-5 sm:py-3 md:px-6 md:py-4 flex items-center justify-between gap-3 sm:gap-4 transition-colors ${
                        isLatest
                          ? 'bg-teal-50/80 dark:bg-teal-950/40 border-l-4 border-teal-500'
                          : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm sm:text-base md:text-lg font-semibold leading-snug line-clamp-2 text-slate-900 dark:text-slate-100">
                            {item.name}
                          </span>
                          {isLatest && items.length > 1 && (
                            <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300">
                              Latest
                            </span>
                          )}
                        </div>
                        <div className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                          {item.unit
                            ? `${Number(item.quantity).toLocaleString('en-US', { maximumFractionDigits: 3 })} ${item.unit} × ${money(item.unitPrice)}`
                            : `${item.quantity} × ${money(item.unitPrice)}`}
                        </div>
                        {!!item.discount && item.discount > 0 && (
                          <div className="text-[11px] sm:text-xs text-emerald-600 dark:text-emerald-400 font-mono font-semibold mt-0.5">
                            Discount{item.discountType === 'percentage' && item.discountValue ? ` (${item.discountValue}%)` : ''}: −{money(item.discount)}
                          </div>
                        )}
                      </div>
                      <div className="text-base sm:text-lg md:text-xl font-bold font-mono shrink-0 tabular-nums text-right text-slate-900 dark:text-slate-100">
                        {money(item.total)}
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={listEndRef} />
            </div>
          </section>

          {/* Right Column (Desktop) / Top Section (Mobile): Totals & Status */}
          <section className="shrink-0 md:min-h-0 flex flex-col gap-2.5 sm:gap-4 order-1 md:order-2">
            {/* Totals Box */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl border-2 border-teal-600/30 shadow-lg p-3 sm:p-5 md:p-6 flex flex-col gap-2 sm:gap-3">
              {/* Compact breakdown when discount or tax present */}
              {(shown.discount > 0 || shown.tax > 0) && (
                <div className="flex flex-col gap-1 text-xs sm:text-sm md:text-base border-b border-slate-100 dark:border-slate-800 pb-2">
                  <Row label="Subtotal" value={money(shown.subtotal)} />
                  {shown.discount > 0 && (
                    <Row
                      label="Discount"
                      value={`− ${money(shown.discount)}`}
                      className="text-emerald-600 dark:text-emerald-400 font-semibold"
                    />
                  )}
                  {shown.tax > 0 && (
                    <Row label="Tax" value={money(shown.tax)} className="text-slate-500" />
                  )}
                </div>
              )}

              {/* The Main Total Display */}
              <div className="flex items-baseline justify-between gap-2 pt-1">
                <div className="flex flex-col">
                  <span className="text-xs sm:text-sm uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">
                    Total Due
                  </span>
                  <span className="text-[11px] sm:text-xs text-slate-400 dark:text-slate-500 font-mono">
                    {items.length} {items.length === 1 ? 'item' : 'items'}
                  </span>
                </div>
                <span className="font-mono font-extrabold text-teal-700 dark:text-teal-300 leading-none text-2xl sm:text-3xl md:text-4xl lg:text-5xl tracking-tight tabular-nums text-right whitespace-nowrap">
                  {money(shown.total)}
                </span>
              </div>

              {/* Payment tender info when paying */}
              {shown.status === 'paying' && shown.amountPaid !== undefined && shown.amountPaid > 0 && (
                <div className="mt-1 pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-1 text-xs sm:text-sm md:text-base">
                  <Row label="Cash received" value={money(shown.amountPaid)} />
                  {shown.amountPaid >= shown.total && (
                    <Row
                      label="Change"
                      value={money(shown.amountPaid - shown.total)}
                      className="text-emerald-700 dark:text-emerald-400 font-bold text-sm sm:text-base md:text-lg"
                    />
                  )}
                </div>
              )}
            </div>

            {/* Status Prompt Banner */}
            {shown.status === 'paying' ? (
              <div className="rounded-2xl sm:rounded-3xl bg-slate-900 text-white p-3 sm:p-4 md:p-5 flex items-center gap-3 sm:gap-4 shadow-md">
                <CreditCard className="w-6 h-6 sm:w-8 sm:h-8 md:w-10 md:h-10 text-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm md:text-base font-bold truncate">
                    Please complete your payment
                  </div>
                  <div className="text-[11px] sm:text-xs text-slate-300 truncate">
                    Cash, card, or transfer at the counter
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl sm:rounded-3xl bg-gradient-to-r from-teal-700 to-teal-900 text-white p-2.5 sm:p-3.5 md:p-4 flex items-center gap-2.5 sm:gap-3.5 shadow-sm">
                <HeartHandshake className="w-5 h-5 sm:w-6 sm:h-6 md:w-8 md:h-8 text-teal-200 shrink-0" />
                <div className="text-[11px] sm:text-xs md:text-sm font-semibold leading-snug line-clamp-2">
                  Please check your items and prices as they are scanned.
                </div>
              </div>
            )}
          </section>
        </main>
      )}
    </div>
  )
}

function Row({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-2 ${className}`}>
      <span className="truncate">{label}</span>
      <span className="font-mono tabular-nums shrink-0">{value}</span>
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-2xl sm:rounded-3xl px-3 py-2.5 sm:px-5 sm:py-4 md:px-6 md:py-5 border-2 flex flex-col items-center justify-center text-center shadow-sm ${
      highlight
        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 text-emerald-800 dark:text-emerald-300'
        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
    }`}>
      <div className="text-[10px] sm:text-xs uppercase tracking-widest font-bold opacity-70 mb-0.5 sm:mb-1">{label}</div>
      <div className="font-mono font-extrabold text-lg sm:text-2xl md:text-3xl lg:text-4xl leading-tight truncate tabular-nums max-w-full">{value}</div>
    </div>
  )
}

/** Idle: rotating branding slides */
function IdleSlides({ shopName, logoUrl, brand, now }: { shopName: string; logoUrl: string | null; brand: ShopBrand | null; now: number }) {
  const slides = [
    { key: 'welcome', title: `Welcome to ${shopName}`, sub: 'සාදරයෙන් පිළිගනිමු · வரவேற்கிறோம் · Welcome', icon: 'logo' as const },
    { key: 'scan', title: 'Your items appear here as they are scanned', sub: 'Please check each price on this screen', icon: 'bag' as const },
    { key: 'thanks', title: 'Thank you for shopping with us', sub: [brand?.address, brand?.phone].filter(Boolean).join(' · ') || 'We look forward to seeing you again', icon: 'spark' as const },
  ]
  const index = Math.floor(now / SLIDE_MS) % slides.length
  const slide = slides[index]
  return (
    <main className="flex-1 min-h-0 flex flex-col items-center justify-center text-center gap-4 sm:gap-6 md:gap-8 p-4 sm:p-8 overflow-y-auto bg-gradient-to-br from-teal-50 via-white to-sky-50 dark:from-slate-950 dark:via-slate-900 dark:to-teal-950">
      <div key={slide.key} className="flex flex-col items-center gap-3 sm:gap-5 md:gap-6 animate-in fade-in duration-700 max-w-4xl px-2">
        {slide.icon === 'logo' && logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="max-h-[18vh] sm:max-h-[25vh] md:max-h-[30vh] max-w-[75vw] sm:max-w-[50vw] object-contain rounded-xl shadow-sm" />
        ) : (
          <div className="w-16 h-16 sm:w-24 sm:h-24 md:w-36 md:h-36 aspect-square rounded-2xl sm:rounded-[2rem] bg-teal-600 text-white flex items-center justify-center shadow-lg sm:shadow-xl shadow-teal-600/20">
            {slide.icon === 'spark' ? <Sparkles className="w-1/2 h-1/2" /> : slide.icon === 'bag' ? <ShoppingBag className="w-1/2 h-1/2" /> : <Store className="w-1/2 h-1/2" />}
          </div>
        )}
        <h2 className="text-xl sm:text-3xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-teal-800 dark:text-teal-300 leading-tight">
          {slide.title}
        </h2>
        <p className="text-xs sm:text-base md:text-xl lg:text-2xl text-slate-500 dark:text-slate-400">
          {slide.sub}
        </p>
      </div>
      <div className="flex gap-1.5 sm:gap-2 mt-2" aria-hidden>
        {slides.map((s, i) => (
          <span key={s.key} className={`h-1.5 sm:h-2 rounded-full transition-all ${i === index ? 'w-6 sm:w-8 bg-teal-600' : 'w-1.5 sm:w-2 bg-slate-300 dark:bg-slate-700'}`} />
        ))}
      </div>
    </main>
  )
}
