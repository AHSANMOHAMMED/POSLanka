'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ScanLine, Loader2, Trash2, PackageCheck, AlertTriangle } from 'lucide-react'
import { FormInput, FormSelect } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'

type GRN = {
  id: string
  receiptNo: string
  purchaseOrderId: string | null
  status: string
  receivedAt: string | null
  createdAt: string
}

type PurchaseOrderSummary = {
  id: string
  orderNo: string
  status: string
  supplierName?: string | null
  warehouseId?: string | null
}

type PurchaseOrderItem = {
  id: string
  itemId: string
  itemName: string
  itemSku?: string | null
  itemBarcode?: string | null
  quantity: string
  receivedQuantity: string | null
}

/** Barcode lookup response (the server adds `scan` for GS1-128 / GS1 DataMatrix codes). */
type BarcodeLookupResponse = {
  id: string
  name: string
  sku?: string | null
  scan?: {
    batchNo?: string | null
    expiryDate?: string | null
    quantity?: number | string | null
    gtin?: string | null
    serial?: string | null
  } | null
}

type ReceiveLine = {
  key: string
  itemId: string
  itemName: string
  ordered: number
  alreadyReceived: number
  qty: number
  batchNo: string
  expiryDate: string
}

export default function GRNListPage() {
  const params = useParams()
  const slug = params.slug as string
  const [rows, setRows] = useState<GRN[]>([])
  const [loading, setLoading] = useState(true)

  // Scan-to-receive state
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>([])
  const [orderId, setOrderId] = useState('')
  const [order, setOrder] = useState<(PurchaseOrderSummary & { items: PurchaseOrderItem[] }) | null>(null)
  const [orderLoading, setOrderLoading] = useState(false)
  const [scan, setScan] = useState('')
  const [scanning, setScanning] = useState(false)
  const [lines, setLines] = useState<ReceiveLine[]>([])
  const [updateStock, setUpdateStock] = useState(true)
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const scanRef = useRef<HTMLInputElement>(null)

  const loadReceipts = useCallback(async () => {
    const res = await fetch('/api/purchase-receipts')
    if (res.ok) {
      const data = await res.json()
      setRows(data.receipts || data.purchaseReceipts || data.data || data || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadReceipts()
  }, [loadReceipts])

  useEffect(() => {
    ;(async () => {
      try {
        const results = await Promise.all(
          ['confirmed', 'partially_received'].map(async (status) => {
            const res = await fetch(`/api/purchase-orders?status=${status}&all=true`)
            if (!res.ok) return [] as PurchaseOrderSummary[]
            const data = await res.json()
            return (Array.isArray(data) ? data : data.data || []) as PurchaseOrderSummary[]
          })
        )
        setOrders(results.flat())
      } catch {
        /* ignore */
      }
    })()
  }, [])

  useEffect(() => {
    if (!orderId) {
      setOrder(null)
      setLines([])
      return
    }
    let cancelled = false
    setOrderLoading(true)
    fetch(`/api/purchase-orders/${orderId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled) return
        setOrder(data)
        setLines([])
        setTimeout(() => scanRef.current?.focus(), 50)
      })
      .catch(() => {})
      .finally(() => !cancelled && setOrderLoading(false))
    return () => {
      cancelled = true
    }
  }, [orderId])

  const addOrPrefillLine = useCallback(
    (poItem: PurchaseOrderItem, scanInfo?: BarcodeLookupResponse['scan']) => {
      const qty = Math.max(0, Number(scanInfo?.quantity) || 1)
      const batchNo = scanInfo?.batchNo || ''
      const expiryDate = scanInfo?.expiryDate || ''
      setLines(prev => {
        const existing = prev.find(l => l.itemId === poItem.itemId && l.batchNo === batchNo && l.expiryDate === expiryDate)
        if (existing) {
          return prev.map(l => (l === existing ? { ...l, qty: l.qty + qty } : l))
        }
        return [
          ...prev,
          {
            key: `${poItem.itemId}-${batchNo}-${expiryDate}-${Date.now()}`,
            itemId: poItem.itemId,
            itemName: poItem.itemName,
            ordered: parseFloat(poItem.quantity) || 0,
            alreadyReceived: parseFloat(poItem.receivedQuantity || '0') || 0,
            qty,
            batchNo,
            expiryDate,
          },
        ]
      })
    },
    []
  )

  async function handleScan(code: string) {
    const trimmed = code.trim()
    if (!trimmed || !order) return
    setScanning(true)
    try {
      const url = `/api/items/barcode-lookup?barcode=${encodeURIComponent(trimmed)}${
        order.warehouseId ? `&warehouseId=${order.warehouseId}` : ''
      }`
      const res = await fetch(url)
      if (!res.ok) {
        // Fall back to matching the PO lines directly by barcode / SKU
        const local = order.items.find(i => i.itemBarcode === trimmed || i.itemSku === trimmed)
        if (local) {
          addOrPrefillLine(local)
          return
        }
        toast.error(`No item found for "${trimmed}"`)
        return
      }
      const item: BarcodeLookupResponse = await res.json()
      const poItem = order.items.find(i => i.itemId === item.id)
      if (!poItem) {
        toast.warning(`${item.name} is not on ${order.orderNo}`)
        return
      }
      addOrPrefillLine(poItem, item.scan)
      if (item.scan?.batchNo || item.scan?.expiryDate) {
        toast.success(`${item.name}: batch ${item.scan.batchNo || '-'}, exp ${item.scan.expiryDate || '-'}`)
      }
    } catch {
      toast.error('Barcode lookup failed')
    } finally {
      setScanning(false)
      setScan('')
      scanRef.current?.focus()
    }
  }

  function updateLine(key: string, patch: Partial<ReceiveLine>) {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))
  }

  async function submitReceive() {
    if (!order || lines.length === 0) return
    // The receive API takes one quantity per item; batch / expiry go into the line notes.
    const byItem = new Map<string, { receivedQuantity: number; notes: string[] }>()
    for (const l of lines) {
      if (l.qty <= 0) continue
      const entry = byItem.get(l.itemId) || { receivedQuantity: 0, notes: [] }
      entry.receivedQuantity += l.qty
      const parts = [l.batchNo && `Batch ${l.batchNo}`, l.expiryDate && `Exp ${l.expiryDate}`].filter(Boolean)
      if (parts.length) entry.notes.push(`${l.qty} x ${parts.join(', ')}`)
      byItem.set(l.itemId, entry)
    }
    if (byItem.size === 0) {
      toast.error('Enter a quantity for at least one line')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/purchase-orders/${order.id}/receive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: Array.from(byItem.entries()).map(([itemId, v]) => ({
            itemId,
            receivedQuantity: v.receivedQuantity,
            notes: v.notes.join('; ').slice(0, 500) || undefined,
          })),
          updateStock,
          supplierInvoiceNo: supplierInvoiceNo.trim() || undefined,
          notes: 'Received via GRN scan',
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error || 'Failed to receive items')
        return
      }
      toast.success(`Items received against ${order.orderNo}`)
      setLines([])
      setSupplierInvoiceNo('')
      setOrderId('')
      await loadReceipts()
    } catch {
      toast.error('Failed to receive items')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Goods Received Notes (GRN)</h1>
        <p className="text-sm text-gray-500">
          Receipts created when purchase orders are received
        </p>
      </div>

      {/* Scan to receive */}
      <div className="bg-white border rounded-lg p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ScanLine className="w-4 h-4 text-teal-600" />
          <h2 className="font-semibold text-sm">Scan to receive</h2>
          <span className="text-xs text-gray-500">GS1-128 / GS1 DataMatrix labels prefill batch, expiry and quantity</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <FormSelect value={orderId} onChange={(e) => setOrderId(e.target.value)} selectSize="md">
            <option value="">Select a purchase order to receive…</option>
            {orders.map(o => (
              <option key={o.id} value={o.id}>
                {o.orderNo}{o.supplierName ? ` — ${o.supplierName}` : ''} ({o.status.replace('_', ' ')})
              </option>
            ))}
          </FormSelect>
          <form
            className="md:col-span-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void handleScan(scan)
            }}
          >
            <FormInput
              ref={scanRef}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              placeholder={order ? 'Scan or type a barcode, then Enter' : 'Choose a purchase order first'}
              disabled={!order || orderLoading}
              leftIcon={scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={!order || !scan.trim() || scanning}
              className="px-3 rounded-md bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold shrink-0"
            >
              Add
            </button>
          </form>
        </div>

        {orderLoading && <p className="text-xs text-gray-500">Loading purchase order…</p>}

        {order && lines.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-2 py-1.5">Item</th>
                  <th className="px-2 py-1.5 text-right">Ordered</th>
                  <th className="px-2 py-1.5 text-right">Prev. recv.</th>
                  <th className="px-2 py-1.5 w-28">Qty</th>
                  <th className="px-2 py-1.5 w-36">Batch</th>
                  <th className="px-2 py-1.5 w-40">Expiry</th>
                  <th className="px-2 py-1.5 w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map(l => {
                  const over = l.alreadyReceived + l.qty > l.ordered
                  return (
                    <tr key={l.key} className="border-t">
                      <td className="px-2 py-1.5 font-medium">{l.itemName}</td>
                      <td className="px-2 py-1.5 text-right">{l.ordered}</td>
                      <td className="px-2 py-1.5 text-right">{l.alreadyReceived}</td>
                      <td className="px-2 py-1.5">
                        <FormInput
                          type="number" min={0} step="any" inputSize="sm" value={l.qty}
                          onChange={(e) => updateLine(l.key, { qty: Math.max(0, Number(e.target.value) || 0) })}
                          className={over ? 'border-amber-400' : ''}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <FormInput inputSize="sm" value={l.batchNo} placeholder="Batch / lot"
                          onChange={(e) => updateLine(l.key, { batchNo: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <FormInput type="date" inputSize="sm" value={l.expiryDate}
                          onChange={(e) => updateLine(l.key, { expiryDate: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button type="button" onClick={() => setLines(prev => prev.filter(x => x.key !== l.key))}
                          className="p-1 rounded text-gray-400 hover:text-red-600" title="Remove">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {lines.some(l => l.alreadyReceived + l.qty > l.ordered) && (
              <p className="mt-2 text-xs text-amber-600 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Some lines exceed the ordered quantity.
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-3 justify-between">
              <div className="flex flex-wrap items-center gap-3">
                <FormInput
                  inputSize="sm" value={supplierInvoiceNo} placeholder="Supplier invoice no. (optional)"
                  onChange={(e) => setSupplierInvoiceNo(e.target.value)} className="w-56"
                />
                <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={updateStock} onChange={(e) => setUpdateStock(e.target.checked)} className="rounded" />
                  Update stock now
                </label>
              </div>
              <button
                type="button"
                onClick={submitReceive}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
                Receive {lines.length} line{lines.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}
        {order && lines.length === 0 && !orderLoading && (
          <p className="text-xs text-gray-500">
            {order.items.length} line{order.items.length === 1 ? '' : 's'} on {order.orderNo}. Scan item labels to add them here.
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2">GRN No</th>
                <th className="px-3 py-2">PO</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Received</th>
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(rows) ? rows : []).map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.receiptNo || r.id.slice(0, 8)}</td>
                  <td className="px-3 py-2">
                    {r.purchaseOrderId ? (
                      <Link
                        href={`/c/${slug}/purchase-orders/${r.purchaseOrderId}`}
                        className="text-teal-700 hover:underline"
                      >
                        View PO
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 capitalize">{r.status}</td>
                  <td className="px-3 py-2">
                    {r.receivedAt || r.createdAt
                      ? new Date(r.receivedAt || r.createdAt).toLocaleString()
                      : '—'}
                  </td>
                </tr>
              ))}
              {(!rows || rows.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-gray-500">
                    No GRNs yet — receive a purchase order to create one
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
