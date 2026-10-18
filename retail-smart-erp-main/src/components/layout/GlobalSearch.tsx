'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X, User, Car, Wrench, FileText, ShoppingCart, Package, Loader2, Truck, FolderOpen, ClipboardList, Navigation } from 'lucide-react'

interface SearchResult {
  id: string
  type: 'customer' | 'vehicle' | 'work_order' | 'estimate' | 'sale' | 'item' | 'supplier' | 'category' | 'purchase_order' | 'page'
  title: string
  subtitle?: string
  url: string
}

interface SearchResponse {
  query: string
  totalCount: number
  results: {
    customers: SearchResult[]
    vehicles: SearchResult[]
    workOrders: SearchResult[]
    estimates: SearchResult[]
    sales: SearchResult[]
    items: SearchResult[]
    suppliers: SearchResult[]
    categories: SearchResult[]
    purchaseOrders: SearchResult[]
    pages: SearchResult[]
  }
}

const typeIcons: Record<string, React.ReactNode> = {
  customer: <User size={16} className="text-purple-500" />,
  vehicle: <Car size={16} className="text-blue-500" />,
  work_order: <Wrench size={16} className="text-green-500" />,
  estimate: <FileText size={16} className="text-orange-500" />,
  sale: <ShoppingCart size={16} className="text-teal-500" />,
  item: <Package size={16} className="text-gray-500" />,
  supplier: <Truck size={16} className="text-indigo-500" />,
  category: <FolderOpen size={16} className="text-amber-500" />,
  purchase_order: <ClipboardList size={16} className="text-cyan-500" />,
  page: <Navigation size={16} className="text-rose-500" />,
}

const typeLabels: Record<string, string> = {
  customer: 'Customer',
  vehicle: 'Vehicle',
  work_order: 'Work Order',
  estimate: 'Estimate',
  sale: 'Invoice',
  item: 'Item',
  supplier: 'Supplier',
  category: 'Category',
  purchase_order: 'Purchase Order',
  page: 'Page',
}

export function GlobalSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SearchResponse | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Keyboard shortcut (Cmd/Ctrl + K)
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
        setIsOpen(true)
      }
      if (event.key === 'Escape') {
        setIsOpen(false)
        inputRef.current?.blur()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Debounced search
  useEffect(() => {
    if (query.length < 2) {
      setResults(null)
      return
    }

    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        if (res.ok) {
          const data = await res.json()
          setResults(data)
        } else {
          console.error(`Search failed (${res.status}):`, await res.text().catch(() => ''))
        }
      } catch (error) {
        console.error('Search error:', error)
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query])

  function handleSelect(result: SearchResult) {
    if (!result.url.startsWith('/')) return
    setIsOpen(false)
    setQuery('')
    router.push(result.url)
  }

  // Flatten results for display - pages first for quick navigation
  const allResults: SearchResult[] = results ? [
    ...(results.results.pages || []),
    ...results.results.customers,
    ...results.results.vehicles,
    ...results.results.workOrders,
    ...results.results.estimates,
    ...results.results.sales,
    ...results.results.items,
    ...(results.results.suppliers || []),
    ...(results.results.categories || []),
    ...(results.results.purchaseOrders || []),
  ] : []

  return (
    <div ref={containerRef} className="relative">
      {/* Search Input */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search... (⌘K)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsOpen(true)}
          className="w-full pl-9 pr-8 py-1.5 text-[13px] rounded bg-white/10 border border-white/10 focus:outline-none focus:ring-1 focus:ring-white/30 focus:bg-white/15 text-white placeholder-white/40 transition-colors"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('')
              setResults(null)
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Results Dropdown */}
      {isOpen && (query.length >= 2 || loading) && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-[#dee2e6] dark:border-gray-700 rounded shadow-lg max-h-96 overflow-y-auto z-50">
          {loading ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
              <Loader2 size={20} className="animate-spin mx-auto mb-2" />
              <p className="text-sm">Searching...</p>
            </div>
          ) : allResults.length === 0 ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400">
              <p className="text-sm">No results found for &quot;{query}&quot;</p>
            </div>
          ) : (
            <div className="py-2">
              <p className="px-3 py-1 text-xs text-gray-400 dark:text-gray-500 font-medium">
                {results?.totalCount} result{results?.totalCount !== 1 ? 's' : ''} found
              </p>
              {allResults.map((result) => (
                <button
                  key={`${result.type}-${result.id}`}
                  onClick={() => handleSelect(result)}
                  className="w-full px-3 py-2 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700 text-left"
                >
                  <span className="flex-shrink-0">{typeIcons[result.type]}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{result.title}</p>
                    {result.subtitle && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{result.subtitle}</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                    {typeLabels[result.type]}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
