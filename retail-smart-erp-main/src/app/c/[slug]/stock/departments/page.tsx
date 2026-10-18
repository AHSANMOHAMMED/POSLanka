'use client'

import { useState, useCallback, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { LayoutGrid, Package, TrendingDown } from 'lucide-react'
import { useRealtimeData, useCurrency } from '@/hooks'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { formatCurrency } from '@/lib/utils/currency'

interface DeptItem {
  id: string
  name: string
  currentStock: string
  costPrice: string
  sellingPrice: string
  minStock: string
  categoryId: string | null
  category: { id: string; name: string } | null
}

interface Department {
  name: string
  categoryId: string | null
  itemCount: number
  totalStockValue: number
  lowStockCount: number
}

export default function DepartmentsPage() {
  const { currency } = useCurrency()
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string

  const [items, setItems] = useState<DeptItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/items?all=true')
      if (res.ok) {
        const data = await res.json()
        setItems(data)
      }
    } catch (error) {
      console.error('Error fetching items:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  useRealtimeData(fetchItems, { entityType: 'item', refreshOnMount: false })

  if (loading) {
    return <PageLoading text="Loading departments..." />
  }

  // Group items by category (department)
  const departments: Department[] = []
  const grouped = new Map<string, DeptItem[]>()

  items.forEach(item => {
    const key = item.categoryId || '__uncategorized'
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(item)
  })

  grouped.forEach((deptItems, key) => {
    const totalStockValue = Math.round(deptItems.reduce((sum, i) =>
      sum + Math.round(parseFloat(i.costPrice) * parseFloat(i.currentStock) * 100) / 100, 0) * 100) / 100
    const lowStockCount = deptItems.filter(i =>
      parseFloat(i.currentStock) <= parseFloat(i.minStock) && parseFloat(i.minStock) > 0).length

    departments.push({
      name: key === '__uncategorized' ? 'Uncategorized' : (deptItems[0].category?.name || 'Unknown'),
      categoryId: key === '__uncategorized' ? null : key,
      itemCount: deptItems.length,
      totalStockValue,
      lowStockCount,
    })
  })

  departments.sort((a, b) => a.name.localeCompare(b.name))

  const totalItems = items.length
  const totalValue = departments.reduce((sum, d) => sum + d.totalStockValue, 0)
  const _totalLowStock = departments.reduce((sum, d) => sum + d.lowStockCount, 0)

  return (
    <ListPageLayout
      module="Stock"
      moduleHref="/stock"
      title="Departments"
      onRefresh={fetchItems}
    >
      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 border rounded p-4 text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{departments.length}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Departments</div>
        </div>
        <div className="bg-white dark:bg-gray-800 border rounded p-4 text-center">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{totalItems}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Total Items</div>
        </div>
        <div className="bg-white dark:bg-gray-800 border rounded p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{formatCurrency(totalValue, currency)}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">Total Stock Value</div>
        </div>
      </div>

      {/* Department Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {departments.map(dept => (
          <button
            key={dept.categoryId || 'uncategorized'}
            onClick={() => {
              if (dept.categoryId) {
                router.push(`/c/${slug}/items?categoryId=${dept.categoryId}`)
              } else {
                router.push(`/c/${slug}/items`)
              }
            }}
            className="bg-white dark:bg-gray-800 border rounded p-5 text-left hover:border-blue-400 transition-colors hover:shadow-sm"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded">
                <LayoutGrid size={20} className="text-blue-600" />
              </div>
              <h3 className="font-semibold text-gray-900 dark:text-white">{dept.name}</h3>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <div className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                  <Package size={14} />
                  <span className="text-xs">Items</span>
                </div>
                <div className="text-lg font-bold text-gray-900 dark:text-white">{dept.itemCount}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 dark:text-gray-400">Value</div>
                <div className="text-lg font-bold text-blue-600">{formatCurrency(dept.totalStockValue, currency)}</div>
              </div>
              <div>
                {dept.lowStockCount > 0 ? (
                  <>
                    <div className="flex items-center gap-1 text-red-500">
                      <TrendingDown size={14} />
                      <span className="text-xs">Low Stock</span>
                    </div>
                    <div className="text-lg font-bold text-red-600">{dept.lowStockCount}</div>
                  </>
                ) : (
                  <>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Low Stock</div>
                    <div className="text-lg font-bold text-green-600">0</div>
                  </>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {departments.length === 0 && (
        <div className="text-center py-12">
          <LayoutGrid size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-medium text-gray-500">No departments yet</h3>
          <p className="text-sm text-gray-400 mt-1">Add categories to organize items into departments</p>
        </div>
      )}
    </ListPageLayout>
  )
}
