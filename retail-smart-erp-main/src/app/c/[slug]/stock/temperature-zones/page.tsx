'use client'

import { useState, useCallback, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Snowflake, Sun, Wind, AlertTriangle, Package } from 'lucide-react'
import { useRealtimeData } from '@/hooks'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'

interface ZoneItem {
  id: string
  name: string
  sku: string | null
  currentStock: string
  minStock: string
  expiryDate: string | null
  shelfLifeDays: number | null
  storageTemp: string | null
  category: { name: string } | null
}

interface ZoneSummary {
  itemCount: number
  lowStockCount: number
  expiringCount: number
}

const ZONES = [
  {
    key: 'ambient',
    label: 'Ambient',
    icon: Sun,
    color: 'bg-amber-50 dark:bg-amber-900/20',
    borderColor: 'border-amber-200 dark:border-amber-800',
    selectedBorder: 'ring-2 ring-amber-400 dark:ring-amber-500',
    iconColor: 'text-amber-600',
    badgeColor: 'bg-amber-100 text-amber-800',
    description: 'Room temperature storage',
  },
  {
    key: 'chilled',
    label: 'Chilled',
    icon: Wind,
    color: 'bg-cyan-50 dark:bg-cyan-900/20',
    borderColor: 'border-cyan-200 dark:border-cyan-800',
    selectedBorder: 'ring-2 ring-cyan-400 dark:ring-cyan-500',
    iconColor: 'text-cyan-600',
    badgeColor: 'bg-cyan-100 text-cyan-800',
    description: '0-5\u00b0C refrigerated items',
  },
  {
    key: 'frozen',
    label: 'Frozen',
    icon: Snowflake,
    color: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
    selectedBorder: 'ring-2 ring-blue-400 dark:ring-blue-500',
    iconColor: 'text-blue-600',
    badgeColor: 'bg-blue-100 text-blue-800',
    description: 'Below -18\u00b0C frozen storage',
  },
]

function computeSummary(items: ZoneItem[]): ZoneSummary {
  let lowStockCount = 0
  let expiringCount = 0
  for (const item of items) {
    const stock = parseFloat(item.currentStock)
    const min = parseFloat(item.minStock)
    if (stock <= min && min > 0) lowStockCount++
    if (item.expiryDate) {
      const daysUntil = Math.ceil((new Date(item.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      if (daysUntil >= 0 && daysUntil <= 7) expiringCount++
    }
  }
  return { itemCount: items.length, lowStockCount, expiringCount }
}

export default function TemperatureZonesPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [loading, setLoading] = useState(true)
  const [summaries, setSummaries] = useState<Record<string, ZoneSummary>>({})
  const [selectedZone, setSelectedZone] = useState<string | null>(null)
  const [zoneItems, setZoneItems] = useState<ZoneItem[]>([])
  const [zoneLoading, setZoneLoading] = useState(false)

  // Fetch all items once for summary counts
  const fetchSummaries = useCallback(async () => {
    try {
      const results: Record<string, ZoneSummary> = {}
      const promises = ZONES.map(async (zone) => {
        const res = await fetch(`/api/items?storageTemp=${zone.key}&all=true`)
        if (res.ok) {
          const data = await res.json()
          results[zone.key] = computeSummary(data)
        }
      })
      await Promise.all(promises)
      setSummaries(results)
    } catch (error) {
      console.error('Error fetching zone summaries:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch items for the selected zone
  const fetchZoneItems = useCallback(async (zoneKey: string) => {
    setZoneLoading(true)
    try {
      const res = await fetch(`/api/items?storageTemp=${zoneKey}&all=true`)
      if (res.ok) {
        const data = await res.json()
        setZoneItems(data)
      }
    } catch (error) {
      console.error('Error fetching zone items:', error)
    } finally {
      setZoneLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSummaries()
  }, [fetchSummaries])

  // When a zone is selected, fetch its items
  useEffect(() => {
    if (selectedZone) {
      fetchZoneItems(selectedZone)
    } else {
      setZoneItems([])
    }
  }, [selectedZone, fetchZoneItems])

  // Realtime refresh
  const handleRealtimeRefresh = useCallback(async () => {
    await fetchSummaries()
    if (selectedZone) {
      await fetchZoneItems(selectedZone)
    }
  }, [fetchSummaries, fetchZoneItems, selectedZone])

  useRealtimeData(handleRealtimeRefresh, { entityType: 'item', refreshOnMount: false })

  if (loading) {
    return <PageLoading text="Loading temperature zones..." />
  }

  function handleZoneClick(zoneKey: string) {
    setSelectedZone(prev => prev === zoneKey ? null : zoneKey)
  }

  return (
    <ListPageLayout
      module="Stock"
      moduleHref="/stock"
      title="Temperature Zones"
      onRefresh={() => {
        fetchSummaries()
        if (selectedZone) fetchZoneItems(selectedZone)
      }}
    >
      {/* Zone Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
        {ZONES.map(zone => {
          const summary = summaries[zone.key] || { itemCount: 0, lowStockCount: 0, expiringCount: 0 }
          const ZoneIcon = zone.icon
          const isSelected = selectedZone === zone.key

          return (
            <button
              key={zone.key}
              onClick={() => handleZoneClick(zone.key)}
              className={`${zone.color} border ${zone.borderColor} rounded p-5 text-left transition-all hover:shadow-md ${isSelected ? zone.selectedBorder : ''}`}
            >
              <div className="flex items-center gap-3 mb-3">
                <ZoneIcon size={28} className={zone.iconColor} />
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{zone.label}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{zone.description}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{summary.itemCount}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Items</div>
                </div>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${summary.lowStockCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {summary.lowStockCount}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Low Stock</div>
                </div>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${summary.expiringCount > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                    {summary.expiringCount}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Expiring</div>
                </div>
              </div>

              {(summary.lowStockCount > 0 || summary.expiringCount > 0) && (
                <div className="mt-3 flex gap-2">
                  {summary.lowStockCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-red-600 bg-red-50 dark:bg-red-900/30 px-2 py-1 rounded-full">
                      <AlertTriangle size={12} /> {summary.lowStockCount} low stock
                    </span>
                  )}
                  {summary.expiringCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/30 px-2 py-1 rounded-full">
                      <AlertTriangle size={12} /> {summary.expiringCount} expiring
                    </span>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Selected Zone Item List */}
      {selectedZone && (
        <div className="px-4 pb-4">
          <div className="bg-white dark:bg-gray-800 border rounded list-container-xl overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50 dark:bg-gray-700 list-header flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-white">
                {ZONES.find(z => z.key === selectedZone)?.label} Zone Items
              </h3>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {zoneItems.length} items
              </span>
            </div>

            {zoneLoading ? (
              <div className="p-8 text-center text-sm text-gray-400">Loading items...</div>
            ) : zoneItems.length === 0 ? (
              <div className="p-8 text-center">
                <Package size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">No items in this zone</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="table-sticky-header bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-300">Item</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-300">Category</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-600 dark:text-gray-300">Stock</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-300">Expiry</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-300">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {zoneItems.map(item => {
                    const stock = parseFloat(item.currentStock)
                    const min = parseFloat(item.minStock)
                    const isLow = stock <= min && min > 0
                    const daysUntil = item.expiryDate
                      ? Math.ceil((new Date(item.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                      : null

                    const alerts: string[] = []
                    if (isLow) alerts.push('low-stock')
                    if (daysUntil !== null && daysUntil < 0) alerts.push('expired')
                    else if (daysUntil !== null && daysUntil <= 3) alerts.push('expiring-urgent')
                    else if (daysUntil !== null && daysUntil <= 7) alerts.push('expiring-soon')

                    return (
                      <tr
                        key={item.id}
                        className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                        onClick={() => router.push(`/c/${slug}/items`)}
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-sm text-gray-900 dark:text-white">{item.name}</div>
                          {item.sku && <div className="text-xs text-gray-400">{item.sku}</div>}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400">
                          {item.category?.name || '-'}
                        </td>
                        <td className={`px-4 py-2.5 text-right text-sm font-medium ${isLow ? 'text-red-600' : 'text-gray-700 dark:text-gray-300'}`}>
                          {stock.toFixed(0)}
                        </td>
                        <td className="px-4 py-2.5 text-sm">
                          {item.expiryDate ? (
                            <span className={
                              daysUntil !== null && daysUntil < 0 ? 'text-red-700 font-semibold' :
                              daysUntil !== null && daysUntil <= 3 ? 'text-red-600 font-medium' :
                              daysUntil !== null && daysUntil <= 7 ? 'text-amber-600' :
                              'text-gray-600 dark:text-gray-400'
                            }>
                              {new Date(item.expiryDate).toLocaleDateString()}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex gap-1.5">
                            {alerts.includes('low-stock') && (
                              <span className="inline-flex items-center text-xs text-red-600 bg-red-50 dark:bg-red-900/30 px-1.5 py-0.5 rounded-full">
                                Low Stock
                              </span>
                            )}
                            {alerts.includes('expired') && (
                              <span className="inline-flex items-center text-xs text-red-700 bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 rounded-full font-medium">
                                Expired
                              </span>
                            )}
                            {alerts.includes('expiring-urgent') && (
                              <span className="inline-flex items-center text-xs text-red-600 bg-red-50 dark:bg-red-900/30 px-1.5 py-0.5 rounded-full">
                                Expiring
                              </span>
                            )}
                            {alerts.includes('expiring-soon') && (
                              <span className="inline-flex items-center text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded-full">
                                Expiring
                              </span>
                            )}
                            {alerts.length === 0 && (
                              <span className="text-xs text-green-600">OK</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </ListPageLayout>
  )
}
