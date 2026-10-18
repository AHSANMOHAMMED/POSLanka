'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Home, ChevronRight, Loader2 } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { formatCurrency } from '@/lib/utils/currency'

interface QuotationHeader {
  id: string
  quotationNo: string
  supplierName: string | null
  status: string
  validUntil: string | null
  deliveryDays: number | null
  subtotal: string
  taxAmount: string
  total: string
}

interface ComparisonItem {
  itemName: string
  itemId: string | null
  bestPrice: string
  quotations: Record<string, {
    quotationId: string
    unitPrice: string
    quantity: string
    tax: string
    total: string
    deliveryDays: number | null
  }>
}

export default function QuotationComparePage() {
  const { tenantSlug, currency } = useCompany()
  const searchParams = useSearchParams()
  const ids = searchParams.get('ids') || ''
  const requisitionId = searchParams.get('requisitionId') || ''

  const [loading, setLoading] = useState(true)
  const [quotations, setQuotations] = useState<QuotationHeader[]>([])
  const [comparison, setComparison] = useState<ComparisonItem[]>([])

  useEffect(() => {
    async function fetchComparison() {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (ids) params.set('ids', ids)
        if (requisitionId) params.set('requisitionId', requisitionId)

        const res = await fetch(`/api/supplier-quotations/compare?${params}`)
        if (!res.ok) throw new Error('Failed')
        const data = await res.json()
        setQuotations(data.quotations || [])
        setComparison(data.comparison || [])
      } catch {
        // Failed to load
      } finally {
        setLoading(false)
      }
    }
    if (ids || requisitionId) fetchComparison()
    else setLoading(false)
  }, [ids, requisitionId])

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-foreground"><Home className="h-4 w-4" /></Link>
        <ChevronRight className="h-3 w-3" />
        <Link href={`/c/${tenantSlug}/supplier-quotations`} className="hover:text-foreground">Supplier Quotations</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">Compare</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Compare Quotations</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Side-by-side comparison of {quotations.length} quotation{quotations.length !== 1 ? 's' : ''}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : quotations.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p>No quotations to compare. Add quotation IDs to the URL.</p>
        </div>
      ) : (
        <>
          {/* Quotation headers */}
          <div className="bg-card rounded border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="table-sticky-header">
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground min-w-[200px]">Item</th>
                  {quotations.map(q => (
                    <th key={q.id} className="text-center px-4 py-3 font-medium text-muted-foreground min-w-[160px]">
                      <Link href={`/c/${tenantSlug}/supplier-quotations/${q.id}`} className="text-primary hover:underline">
                        {q.quotationNo}
                      </Link>
                      <div className="text-xs font-normal mt-1">{q.supplierName}</div>
                      {q.deliveryDays && (
                        <div className="text-xs font-normal text-muted-foreground">{q.deliveryDays} days</div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.map((item, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="px-4 py-3 font-medium text-foreground">{item.itemName}</td>
                    {quotations.map(q => {
                      const data = item.quotations[q.id]
                      if (!data) return <td key={q.id} className="px-4 py-3 text-center text-muted-foreground">-</td>

                      const isBest = data.unitPrice === item.bestPrice
                      return (
                        <td key={q.id} className="px-4 py-3 text-center">
                          <span className={`font-medium ${isBest ? 'text-green-600 dark:text-green-400' : 'text-foreground'}`}>
                            {formatCurrency(parseFloat(data.unitPrice), currency)}
                          </span>
                          <div className="text-xs text-muted-foreground">
                            x {parseFloat(data.quantity)} = {formatCurrency(parseFloat(data.total), currency)}
                          </div>
                          {isBest && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 mt-1">
                              Best Price
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/30 border-t-2">
                  <td className="px-4 py-3 font-medium text-foreground">Total</td>
                  {quotations.map(q => {
                    const totals = quotations.map(qq => parseFloat(qq.total))
                    const minTotal = Math.min(...totals)
                    const isBestTotal = parseFloat(q.total) === minTotal
                    return (
                      <td key={q.id} className="px-4 py-3 text-center">
                        <span className={`text-lg font-bold ${isBestTotal ? 'text-green-600 dark:text-green-400' : 'text-foreground'}`}>
                          {formatCurrency(parseFloat(q.total), currency)}
                        </span>
                        {isBestTotal && quotations.length > 1 && (
                          <div className="text-xs text-green-600 dark:text-green-400 mt-1">Lowest Total</div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
