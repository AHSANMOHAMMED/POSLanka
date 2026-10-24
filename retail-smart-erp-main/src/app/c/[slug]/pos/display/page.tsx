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
    <div className="h-screen bg-[#F6F8FB] dark:bg-[#0B1220] text-slate-900 dark:text-slate-100 flex flex-col font-sans select-none overflow-hidden">
      {/* Header */}
      <header className="shrink-0 h-[clamp(64px,9vh,120px)] bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-[clamp(16px,3vw,56px)] flex items-center justify-between gap-4">
        <div className="flex items-center gap-[clamp(10px,1.2vw,24px)] min-w-0">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-[clamp(40px,6vh,88px)] w-auto max-w-[30vw] object-contain" />
          ) : (
            <div className="h-[clamp(40px,6vh,88px)] aspect-square rounded-2xl bg-teal-600 flex items-center justify-center text-white">
              <Store className="w-1/2 h-1/2" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-[clamp(20px,2.4vw,48px)] font-extrabold tracking-tight text-teal-800 dark:text-teal-300 truncate leading-tight">{shopName}</h1>
            <p className="text-[clamp(12px,1vw,20px)] text-slate-500 dark:text-slate-400 truncate">
              {cashierName ? `Served by ${cashierName}` : 'Customer display'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-[clamp(8px,1vw,20px)] shrink-0">
          {!isStale ? (
            <span className="px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 text-[clamp(10px,0.8vw,15px)] font-bold uppercase tracking-wider flex items-center gap-1">
              <Wifi className="w-3.5 h-3.5" /> Live
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 text-[clamp(10px,0.8vw,15px)] font-bold uppercase tracking-wider flex items-center gap-1" title="Open the POS in this browser and keep it running">
              <WifiOff className="w-3.5 h-3.5" /> Waiting for POS
            </span>
          )}
          <span className="font-mono font-bold text-[clamp(16px,1.6vw,32px)] text-slate-700 dark:text-slate-200">{clock}</span>
          {!isFullscreen && (
            <button
              type="button"
              onClick={goFullscreen}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Full screen (or press F11)"
              aria-label="Full screen"
            >
              <Maximize2 className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      {view === 'idle' && <IdleSlides shopName={shopName} logoUrl={logoUrl} brand={brand} now={now} />}

      {view === 'paid' && shown && (
        <main className="flex-1 min-h-0 flex flex-col items-center justify-center text-center gap-[clamp(16px,3vh,48px)] p-8">
          <CheckCircle2 className="w-[clamp(72px,12vh,180px)] h-[clamp(72px,12vh,180px)] text-emerald-500" />
          <h2 className="text-[clamp(32px,5vw,96px)] font-extrabold tracking-tight text-emerald-700 dark:text-emerald-400 leading-tight">Thank you!</h2>
          <div className="flex flex-wrap items-stretch justify-center gap-[clamp(12px,2vw,40px)]">
            <Stat label="Total" value={money(shown.total)} />
            {shown.amountPaid !== undefined && shown.amountPaid > 0 && <Stat label="Cash received" value={money(shown.amountPaid)} />}
            {shown.changeDue !== undefined && shown.changeDue > 0 && <Stat label="Your change" value={money(shown.changeDue)} highlight />}
          </div>
          <p className="text-[clamp(16px,1.6vw,32px)] text-slate-500 dark:text-slate-400">
            {shown.invoiceNo ? `Receipt ${shown.invoiceNo} · ` : ''}Please come again
          </p>
          <p className="text-[clamp(14px,1.3vw,26px)] text-teal-700 dark:text-teal-300 font-semibold">ස්තූතියි · நன்றி · Thank you</p>
        </main>
      )}

      {view === 'cart' && shown && (
        <main className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)] gap-[clamp(12px,2vw,40px)] p-[clamp(12px,2vw,40px)]">
          {/* Lines */}
          <section className="min-h-0 flex flex-col bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="shrink-0 px-[clamp(16px,1.6vw,32px)] py-[clamp(10px,1.4vh,24px)] border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-[clamp(18px,1.6vw,34px)] font-bold flex items-center gap-2">
                <ShoppingBag className="w-[1em] h-[1em] text-teal-600" /> Your items
              </h2>
              <span className="text-[clamp(13px,1.1vw,22px)] text-slate-500 font-mono">{items.length} lines · {totalUnits} items</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {items.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-400 text-[clamp(16px,1.4vw,28px)]">No items yet</div>
              ) : items.map((item, idx) => (
                <div
                  key={item.id || idx}
                  className={`px-[clamp(16px,1.6vw,32px)] py-[clamp(10px,1.6vh,26px)] flex items-center justify-between gap-4 ${idx === items.length - 1 ? 'bg-teal-50/70 dark:bg-teal-950/30' : ''}`}
                >
                  <div className="min-w-0">
                    <div className="text-[clamp(17px,1.5vw,34px)] font-semibold leading-snug truncate">{item.name}</div>
                    <div className="text-[clamp(13px,1.05vw,22px)] text-slate-500 font-mono">
                      {item.unit
                        ? `${Number(item.quantity).toLocaleString('en-US', { maximumFractionDigits: 3 })} ${item.unit} × ${money(item.unitPrice)}`
                        : `${item.quantity} × ${money(item.unitPrice)}`}
                    </div>
                  </div>
                  <div className="text-[clamp(18px,1.6vw,36px)] font-bold font-mono shrink-0">{money(item.total)}</div>
                </div>
              ))}
              <div ref={listEndRef} />
            </div>
          </section>

          {/* Totals */}
          <section className="min-h-0 flex flex-col gap-[clamp(12px,2vh,32px)]">
            <div className="bg-white dark:bg-slate-900 rounded-3xl border-2 border-teal-600/30 shadow-xl p-[clamp(16px,2vw,40px)] flex flex-col gap-[clamp(8px,1.4vh,20px)] text-[clamp(16px,1.4vw,30px)]">
              <Row label="Subtotal" value={money(shown.subtotal)} />
              {shown.discount > 0 && <Row label="Discount" value={`− ${money(shown.discount)}`} className="text-emerald-600 dark:text-emerald-400 font-semibold" />}
              {shown.tax > 0 && <Row label="Tax" value={money(shown.tax)} className="text-slate-500" />}
              <div className="mt-2 pt-[clamp(10px,1.6vh,24px)] border-t-2 border-dashed border-slate-200 dark:border-slate-700 flex flex-col items-end">
                <span className="text-[clamp(13px,1.1vw,24px)] uppercase tracking-widest font-bold text-slate-500">Total</span>
                <span className="font-mono font-extrabold text-teal-700 dark:text-teal-300 leading-none text-[clamp(40px,5vw,110px)] break-all text-right">{money(shown.total)}</span>
              </div>
              {shown.status === 'paying' && shown.amountPaid !== undefined && shown.amountPaid > 0 && (
                <>
                  <Row label="Cash received" value={money(shown.amountPaid)} />
                  {shown.amountPaid >= shown.total && (
                    <Row label="Change" value={money(shown.amountPaid - shown.total)} className="text-emerald-700 dark:text-emerald-400 font-bold" />
                  )}
                </>
              )}
            </div>
            {shown.status === 'paying' ? (
              <div className="rounded-3xl bg-slate-900 text-white p-[clamp(16px,2vw,40px)] flex items-center gap-4 shadow-lg">
                <CreditCard className="w-[clamp(32px,3vw,64px)] h-[clamp(32px,3vw,64px)] text-emerald-400 shrink-0" />
                <div>
                  <div className="text-[clamp(18px,1.6vw,34px)] font-bold">Please complete your payment</div>
                  <div className="text-[clamp(13px,1.1vw,22px)] text-slate-300">Cash, card or bank transfer at the counter</div>
                </div>
              </div>
            ) : (
              <div className="rounded-3xl bg-gradient-to-r from-teal-700 to-teal-900 text-white p-[clamp(16px,2vw,40px)] flex items-center gap-4 shadow-md">
                <HeartHandshake className="w-[clamp(32px,3vw,64px)] h-[clamp(32px,3vw,64px)] text-teal-200 shrink-0" />
                <div className="text-[clamp(15px,1.3vw,28px)] font-semibold leading-snug">
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
    <div className={`flex items-baseline justify-between gap-4 ${className}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-3xl px-[clamp(20px,2.4vw,56px)] py-[clamp(12px,2vh,32px)] border-2 ${highlight
      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-400 text-emerald-800 dark:text-emerald-300'
      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'}`}>
      <div className="text-[clamp(13px,1.1vw,24px)] uppercase tracking-widest font-bold opacity-70">{label}</div>
      <div className="font-mono font-extrabold text-[clamp(28px,3.6vw,80px)] leading-tight">{value}</div>
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
    <main className="flex-1 min-h-0 flex flex-col items-center justify-center text-center gap-[clamp(16px,3vh,48px)] p-8 bg-gradient-to-br from-teal-50 via-white to-sky-50 dark:from-slate-950 dark:via-slate-900 dark:to-teal-950">
      <div key={slide.key} className="flex flex-col items-center gap-[clamp(16px,3vh,48px)] animate-in fade-in duration-700">
        {slide.icon === 'logo' && logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="max-h-[28vh] max-w-[60vw] object-contain" />
        ) : (
          <div className="w-[clamp(96px,16vh,220px)] aspect-square rounded-[2rem] bg-teal-600 text-white flex items-center justify-center shadow-xl shadow-teal-600/20">
            {slide.icon === 'spark' ? <Sparkles className="w-1/2 h-1/2" /> : slide.icon === 'bag' ? <ShoppingBag className="w-1/2 h-1/2" /> : <Store className="w-1/2 h-1/2" />}
          </div>
        )}
        <h2 className="text-[clamp(30px,4.2vw,96px)] font-extrabold tracking-tight text-teal-800 dark:text-teal-300 leading-tight max-w-[90vw]">{slide.title}</h2>
        <p className="text-[clamp(16px,1.8vw,40px)] text-slate-500 dark:text-slate-400 max-w-[85vw]">{slide.sub}</p>
      </div>
      <div className="flex gap-2" aria-hidden>
        {slides.map((s, i) => (
          <span key={s.key} className={`h-2 rounded-full transition-all ${i === index ? 'w-8 bg-teal-600' : 'w-2 bg-slate-300 dark:bg-slate-700'}`} />
        ))}
      </div>
    </main>
  )
}
