'use client'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  ScanLine,
  BellRing,
  CheckCircle2,
  Plus,
  Minus,
  Trash2,
  ShoppingBag,
  Search,
  Loader2,
  AlertCircle,
  UtensilsCrossed,
  Package,
  LogIn,
} from 'lucide-react'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'

interface CatalogItem {
  id: string
  name: string
  sku: string | null
  barcode: string | null
  sellingPrice: string | number
  imageUrl: string | null
  unit: string | null
  categoryId: string | null
  availableStock?: string
  trackStock?: boolean
}

interface Category {
  id: string
  name: string
}

interface CartLine {
  item: CatalogItem
  quantity: number
}

type OrderStep = 'browsing' | 'placing' | 'success'

const SUCCESS_RESET_MS = 8000

function priceOf(item: CatalogItem): number {
  const n = typeof item.sellingPrice === 'number' ? item.sellingPrice : parseFloat(item.sellingPrice || '0')
  return Number.isFinite(n) ? n : 0
}

export default function SelfServiceKioskPage() {
  const params = useParams()
  const slug = (params?.slug as string) || ''
  const company = useCompanyOptional()
  const isRestaurant = company?.businessType === 'restaurant'
  const currency = company?.currency || 'LKR'

  const [language, setLanguage] = useState<'en' | 'si' | 'ta'>('en')
  const [assistanceRequested, setAssistanceRequested] = useState(false)
  const [currentTime, setCurrentTime] = useState('')

  const [items, setItems] = useState<CatalogItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)

  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')

  const [cart, setCart] = useState<CartLine[]>([])
  const [orderStep, setOrderStep] = useState<OrderStep>('browsing')
  const [orderError, setOrderError] = useState<string | null>(null)
  const [orderNo, setOrderNo] = useState<string | null>(null)
  const [orderType, setOrderType] = useState<'takeaway' | 'dine_in'>('takeaway')

  const money = useCallback(
    (value: number) =>
      `${currency} ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    [currency]
  )

  useEffect(() => {
    const tick = () =>
      setCurrentTime(
        new Date().toLocaleTimeString('en-LK', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
      )
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [])

  const loadCatalog = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [itemsRes, catsRes] = await Promise.all([
        fetch('/api/items?all=true&inStockOnly=true', { cache: 'no-store' }),
        fetch('/api/categories?all=true', { cache: 'no-store' }),
      ])

      if (itemsRes.status === 401 || catsRes.status === 401) {
        setSessionExpired(true)
        return
      }
      if (!itemsRes.ok) {
        const data = await itemsRes.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to load products')
      }

      const itemsJson = await itemsRes.json()
      const list: CatalogItem[] = Array.isArray(itemsJson) ? itemsJson : itemsJson?.data ?? []
      setItems(list)

      if (catsRes.ok) {
        const catsJson = await catsRes.json()
        const cats: Category[] = Array.isArray(catsJson) ? catsJson : catsJson?.data ?? []
        setCategories(cats)
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load products')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((it) => {
      if (activeCategory !== 'all' && it.categoryId !== activeCategory) return false
      if (!q) return true
      return (
        it.name.toLowerCase().includes(q) ||
        (it.sku || '').toLowerCase().includes(q) ||
        (it.barcode || '').toLowerCase().includes(q)
      )
    })
  }, [items, search, activeCategory])

  const addToCart = (item: CatalogItem) => {
    if (orderStep !== 'browsing') return
    setCart((prev) => {
      const existing = prev.find((l) => l.item.id === item.id)
      if (existing) {
        return prev.map((l) => (l.item.id === item.id ? { ...l, quantity: l.quantity + 1 } : l))
      }
      return [...prev, { item, quantity: 1 }]
    })
  }

  const handleUpdateQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.item.id === id ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    )
  }

  const handleRemove = (id: string) => {
    setCart((prev) => prev.filter((l) => l.item.id !== id))
  }

  // Barcode / search submit: exact barcode or SKU match adds directly
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = search.trim().toLowerCase()
    if (!q) return
    const match = items.find(
      (it) => (it.barcode || '').toLowerCase() === q || (it.sku || '').toLowerCase() === q
    )
    if (match) {
      addToCart(match)
      setSearch('')
    }
  }

  const subtotal = cart.reduce((acc, l) => acc + priceOf(l.item) * l.quantity, 0)
  const totalUnits = cart.reduce((acc, l) => acc + l.quantity, 0)

  const resetSession = useCallback(() => {
    setCart([])
    setOrderNo(null)
    setOrderError(null)
    setOrderStep('browsing')
    setSearch('')
  }, [])

  // Auto-reset after a successful order
  useEffect(() => {
    if (orderStep !== 'success') return
    const t = setTimeout(resetSession, SUCCESS_RESET_MS)
    return () => clearTimeout(t)
  }, [orderStep, resetSession])

  async function readError(res: Response, fallback: string): Promise<string> {
    const data = await res.json().catch(() => ({}))
    return (data && (data.error as string)) || fallback
  }

  const placeRestaurantOrder = async (): Promise<string> => {
    const createRes = await fetch('/api/restaurant-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderType, customerCount: 1 }),
    })
    if (createRes.status === 401) throw new Error('SESSION_EXPIRED')
    if (!createRes.ok) throw new Error(await readError(createRes, 'Failed to create order'))
    const order = await createRes.json()

    for (const line of cart) {
      const itemRes = await fetch(`/api/restaurant-orders/${order.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: line.item.id,
          itemName: line.item.name,
          quantity: line.quantity,
          unitPrice: priceOf(line.item),
        }),
      })
      if (itemRes.status === 401) throw new Error('SESSION_EXPIRED')
      if (!itemRes.ok) {
        throw new Error(await readError(itemRes, `Failed to add ${line.item.name} to order`))
      }
    }
    return order.orderNo as string
  }

  const placeSalesOrder = async (): Promise<string> => {
    const whRes = await fetch('/api/warehouses?all=true&activeOnly=true', { cache: 'no-store' })
    if (whRes.status === 401) throw new Error('SESSION_EXPIRED')
    if (!whRes.ok) throw new Error(await readError(whRes, 'Failed to resolve warehouse'))
    const whJson = await whRes.json()
    const warehouses: Array<{ id: string; isDefault?: boolean }> = Array.isArray(whJson)
      ? whJson
      : whJson?.data ?? []
    const warehouse = warehouses.find((w) => w.isDefault) || warehouses[0]
    if (!warehouse) throw new Error('No warehouse configured for this store')

    const res = await fetch('/api/sales-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouseId: warehouse.id,
        customerName: 'Kiosk Walk-in',
        notes: 'Self-service kiosk order',
        items: cart.map((line) => ({
          itemId: line.item.id,
          itemName: line.item.name,
          quantity: line.quantity,
          unitPrice: priceOf(line.item),
          discount: 0,
        })),
      }),
    })
    if (res.status === 401) throw new Error('SESSION_EXPIRED')
    if (!res.ok) throw new Error(await readError(res, 'Failed to create order'))
    const order = await res.json()
    return (order.orderNo as string) || (order.data?.orderNo as string) || ''
  }

  const handlePlaceOrder = async () => {
    if (cart.length === 0 || orderStep !== 'browsing') return
    setOrderStep('placing')
    setOrderError(null)
    try {
      const no = isRestaurant ? await placeRestaurantOrder() : await placeSalesOrder()
      setOrderNo(no || '—')
      setOrderStep('success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to place order'
      if (message === 'SESSION_EXPIRED') {
        setSessionExpired(true)
        setOrderStep('browsing')
        return
      }
      setOrderError(message)
      setOrderStep('browsing')
    }
  }

  if (sessionExpired) {
    return (
      <div className="min-h-screen bg-[#FAF8FF] dark:bg-[#0F172A] flex items-center justify-center p-8">
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-10 border border-slate-200 dark:border-slate-800 shadow-xl text-center max-w-md space-y-4">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto" />
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Session expired</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            This kiosk needs to be signed in again before it can take orders.
          </p>
          <Link
            href={`/c/${slug}/login`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm"
          >
            <LogIn className="w-4 h-4" />
            Go to login
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAF8FF] dark:bg-[#0F172A] text-slate-900 dark:text-slate-100 flex flex-col font-sans select-none overflow-x-hidden">
      {/* Kiosk Top Bar */}
      <header className="h-16 bg-white/95 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-800 px-8 flex items-center justify-between backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-teal-700 text-white px-3.5 py-1 rounded-xl shadow-sm">
            {isRestaurant ? <UtensilsCrossed className="w-4 h-4 text-teal-300" /> : <ScanLine className="w-4 h-4 text-teal-300" />}
            <span className="font-mono font-bold text-sm">KIOSK</span>
            <span className="text-[10px] font-mono opacity-80 pl-1 uppercase border-l border-white/20 truncate max-w-[200px]">
              {company?.tenantName || slug}
            </span>
          </div>

          <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-mono">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-slate-700 dark:text-slate-300 font-semibold uppercase tracking-wider text-[11px]">
              {isRestaurant ? 'Self-Service Ordering' : 'Self-Checkout'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            {(['en', 'si', 'ta'] as const).map((l) => (
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
            onClick={() => setAssistanceRequested((prev) => !prev)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all active:scale-95 ${
              assistanceRequested
                ? 'bg-amber-500 text-white animate-bounce'
                : 'bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/60 text-amber-700 dark:text-amber-400 hover:bg-amber-100'
            }`}
          >
            <BellRing className="w-4 h-4" />
            <span>{assistanceRequested ? 'ATTENDANT CALLED' : 'ASSISTANCE'}</span>
          </button>

          <span className="font-mono text-xs font-bold text-slate-500 hidden sm:block">{currentTime}</span>
        </div>
      </header>

      {/* Main Kiosk Workspace */}
      <main className="flex-1 p-6 lg:p-8 grid grid-cols-12 gap-6 lg:gap-8 max-w-[1500px] mx-auto w-full">
        {/* Left: Catalog */}
        <div className="col-span-12 lg:col-span-7 flex flex-col gap-4 min-h-0">
          {/* Search / Scan */}
          <form
            onSubmit={handleSearchSubmit}
            className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center gap-3"
          >
            <ScanLine className="w-5 h-5 text-teal-600 shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Scan a barcode or search products..."
              className="flex-1 bg-transparent outline-none text-sm font-medium placeholder:text-slate-400"
              autoFocus
            />
            <button
              type="submit"
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
              title="Search"
            >
              <Search className="w-4 h-4" />
            </button>
          </form>

          {/* Categories */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setActiveCategory('all')}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                activeCategory === 'all'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCategory(c.id)}
                className={`px-4 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                  activeCategory === c.id
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          {/* Product Grid */}
          <div className="flex-1 overflow-y-auto min-h-[350px]">
            {loading ? (
              <div className="h-full flex items-center justify-center gap-2 text-sm text-slate-500 py-20">
                <Loader2 className="w-5 h-5 animate-spin text-teal-600" />
                Loading menu...
              </div>
            ) : loadError ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-red-600 py-20">
                <AlertCircle className="w-8 h-8" />
                <span>{loadError}</span>
                <button
                  onClick={loadCatalog}
                  className="px-4 py-1.5 rounded-xl bg-teal-600 text-white text-xs font-semibold"
                >
                  Retry
                </button>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-slate-400 py-20">
                <Package className="w-8 h-8" />
                <span>No products found</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                {filteredItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => addToCart(item)}
                    disabled={orderStep !== 'browsing'}
                    className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm text-left overflow-hidden hover:border-teal-500/60 hover:shadow-md transition-all active:scale-[0.98] disabled:opacity-60"
                  >
                    <div className="aspect-square bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                      ) : (
                        <ShoppingBag className="w-10 h-10 text-slate-300 dark:text-slate-600" />
                      )}
                    </div>
                    <div className="p-3">
                      <div className="text-sm font-bold text-slate-900 dark:text-white line-clamp-2 min-h-[2.5rem]">
                        {item.name}
                      </div>
                      <div className="mt-1 font-mono text-sm font-bold text-teal-700 dark:text-teal-300">
                        {money(priceOf(item))}
                        {item.unit ? <span className="text-[10px] text-slate-400 font-normal"> / {item.unit}</span> : null}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Cart & Order */}
        <div className="col-span-12 lg:col-span-5 flex flex-col gap-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {isRestaurant ? 'Your Order' : 'Your Bag'}
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 font-mono text-xs font-bold">
                {totalUnits} Items
              </span>
            </div>
            {cart.length > 0 && orderStep === 'browsing' && (
              <button
                onClick={() => setCart([])}
                className="text-xs font-semibold text-slate-400 hover:text-red-500"
              >
                Clear
              </button>
            )}
          </div>

          {/* Cart Lines */}
          <div className="flex-1 overflow-y-auto flex flex-col gap-3 min-h-[200px] max-h-[40vh]">
            {cart.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-sm text-slate-400 gap-2 py-10 bg-white/50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                <ShoppingBag className="w-8 h-8" />
                <span>Tap a product to add it</span>
              </div>
            ) : (
              cart.map(({ item, quantity }) => (
                <div
                  key={item.id}
                  className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 rounded-xl bg-teal-50 dark:bg-teal-950/50 flex items-center justify-center text-teal-700 dark:text-teal-300 shrink-0 overflow-hidden">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                      ) : (
                        <ShoppingBag className="w-5 h-5" />
                      )}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{item.name}</span>
                      <span className="text-xs font-mono text-slate-500">{money(priceOf(item))} ea</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 rounded-xl p-1">
                      <button
                        onClick={() => handleUpdateQty(item.id, -1)}
                        disabled={orderStep !== 'browsing'}
                        className="w-8 h-8 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 flex items-center justify-center shadow-sm"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-6 text-center font-mono font-bold text-sm">{quantity}</span>
                      <button
                        onClick={() => handleUpdateQty(item.id, 1)}
                        disabled={orderStep !== 'browsing'}
                        className="w-8 h-8 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 flex items-center justify-center shadow-sm"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="text-right font-mono min-w-[90px] text-sm font-bold text-slate-900 dark:text-white">
                      {money(priceOf(item) * quantity)}
                    </div>
                    <button
                      onClick={() => handleRemove(item.id)}
                      disabled={orderStep !== 'browsing'}
                      className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Checkout Card */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border-2 border-teal-600/30 dark:border-teal-500/40 shadow-xl flex flex-col gap-4">
            {isRestaurant && orderStep === 'browsing' && (
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold">
                {(['takeaway', 'dine_in'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setOrderType(t)}
                    disabled={t === 'dine_in'}
                    title={t === 'dine_in' ? 'Please ask staff to seat you for dine-in' : undefined}
                    className={`flex-1 py-1.5 rounded-lg transition-all ${
                      orderType === t ? 'bg-teal-600 text-white shadow-sm' : 'text-slate-500'
                    } disabled:opacity-40`}
                  >
                    {t === 'takeaway' ? 'Takeaway' : 'Dine-In'}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2 font-mono text-sm">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Subtotal ({totalUnits} items)</span>
                <span>{money(subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-500 text-xs">
                <span>Taxes</span>
                <span>Calculated at checkout</span>
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800/80 rounded-2xl p-5 border border-slate-200 dark:border-slate-700 flex flex-col items-center text-center">
              <span className="text-xs font-mono uppercase tracking-wider text-slate-500 font-bold">Total</span>
              <div className="font-mono text-4xl font-extrabold text-teal-700 dark:text-teal-300 mt-1">
                {money(subtotal)}
              </div>
            </div>

            {orderError && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{orderError}</span>
              </div>
            )}

            {orderStep === 'success' ? (
              <div className="p-6 bg-emerald-50 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-800 flex flex-col items-center text-center gap-3 animate-in fade-in">
                <CheckCircle2 className="w-12 h-12 text-emerald-600" />
                <div>
                  <h3 className="font-bold text-lg text-emerald-900 dark:text-emerald-200">Order placed!</h3>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">Your order number is</p>
                  <div className="font-mono text-3xl font-extrabold text-emerald-800 dark:text-emerald-200 mt-1">
                    {orderNo}
                  </div>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-2">
                    {isRestaurant ? 'Please pay at the counter and wait for your number.' : 'Please proceed to the counter to pay.'}
                  </p>
                </div>
                <button
                  onClick={resetSession}
                  className="w-full py-2.5 rounded-xl bg-teal-600 text-white font-semibold text-sm"
                >
                  Start New Order
                </button>
              </div>
            ) : (
              <button
                onClick={handlePlaceOrder}
                disabled={cart.length === 0 || orderStep === 'placing'}
                className="w-full h-14 rounded-2xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-bold text-base flex items-center justify-center gap-3 shadow-lg shadow-teal-600/20 transition-all active:scale-[0.98]"
              >
                {orderStep === 'placing' ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Placing order...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    <span>Place order</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
