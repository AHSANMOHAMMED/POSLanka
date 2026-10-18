'use client'

import { useState, useEffect } from 'react'
import { X, ArrowRight, Plus, Minus, Edit } from 'lucide-react'

// Item snapshot structure
interface ItemSnapshot {
  id: string
  itemType: 'service' | 'part'
  description?: string
  partName?: string
  originalAmount: number
  adjustedAmount?: number
  quantity?: number
  [key: string]: unknown
}

// Full revision data (fetched from API)
interface FullRevision {
  id: string
  revisionNumber: number
  estimateSnapshot: Record<string, unknown>
  itemsSnapshot: ItemSnapshot[]
  changeReason: string | null
  createdAt: string
  changedByUser?: { fullName: string } | null
}

// Basic revision info (passed from parent)
interface BasicRevision {
  id: string
  revisionNumber: number
  createdAt: string
  changeReason?: string | null
  changedByUser?: { fullName?: string; name?: string } | null
}

interface Props {
  isOpen: boolean
  onClose: () => void
  revisions: BasicRevision[]
  estimateId: string
}

export function RevisionComparisonModal({ isOpen, onClose, revisions, estimateId }: Props) {
  const [leftRevision, setLeftRevision] = useState<string>('')
  const [rightRevision, setRightRevision] = useState<string>('')
  const [leftData, setLeftData] = useState<FullRevision | null>(null)
  const [rightData, setRightData] = useState<FullRevision | null>(null)
  const [loading, setLoading] = useState(false)

  // Initialize with most recent two revisions
  useEffect(() => {
    if (revisions.length >= 2) {
      setLeftRevision(revisions[1].id)
      setRightRevision(revisions[0].id)
    } else if (revisions.length === 1) {
      setRightRevision(revisions[0].id)
    }
  }, [revisions])

  // Fetch revision details when selections change
  useEffect(() => {
    async function fetchRevisions() {
      if (!leftRevision && !rightRevision) return

      setLoading(true)
      try {
        const res = await fetch(`/api/insurance-estimates/${estimateId}/revisions`)
        if (res.ok) {
          const data = await res.json()
          setLeftData(data.find((r: FullRevision) => r.id === leftRevision) || null)
          setRightData(data.find((r: FullRevision) => r.id === rightRevision) || null)
        }
      } catch (error) {
        console.error('Error fetching revisions:', error)
      } finally {
        setLoading(false)
      }
    }

    if (isOpen) {
      fetchRevisions()
    }
  }, [leftRevision, rightRevision, estimateId, isOpen])

  if (!isOpen) return null

  const formatCurrency = (value: unknown) => {
    const num = parseFloat(String(value || 0))
    return `LKR ${num.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getValueClass = (oldVal: unknown, newVal: unknown) => {
    if (oldVal === newVal) return ''
    return 'bg-yellow-100'
  }

  const compareItems = (leftItems: ItemSnapshot[], rightItems: ItemSnapshot[]) => {
    const changes: Array<{
      type: 'added' | 'removed' | 'modified'
      leftItem?: ItemSnapshot
      rightItem?: ItemSnapshot
    }> = []

    // Create maps by item ID for comparison
    const leftMap = new Map(leftItems?.map(item => [item.id, item]) || [])
    const rightMap = new Map(rightItems?.map(item => [item.id, item]) || [])

    // Find removed items (in left but not in right)
    leftItems?.forEach(item => {
      if (!rightMap.has(item.id)) {
        changes.push({ type: 'removed', leftItem: item })
      }
    })

    // Find added and modified items
    rightItems?.forEach(item => {
      const leftItem = leftMap.get(item.id)
      if (!leftItem) {
        changes.push({ type: 'added', rightItem: item })
      } else {
        // Check if modified
        if (JSON.stringify(leftItem) !== JSON.stringify(item)) {
          changes.push({ type: 'modified', leftItem, rightItem: item })
        }
      }
    })

    return changes
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Compare Revisions</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded"
          >
            <X size={20} />
          </button>
        </div>

        {/* Revision selectors */}
        <div className="p-4 border-b bg-gray-50 flex items-center gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              From (older)
            </label>
            <select
              value={leftRevision}
              onChange={(e) => setLeftRevision(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select revision</option>
              {revisions.map((rev) => (
                <option key={rev.id} value={rev.id}>
                  Rev {rev.revisionNumber} - {formatDate(rev.createdAt)}
                </option>
              ))}
            </select>
          </div>
          <ArrowRight size={24} className="text-gray-400 mt-6" />
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              To (newer)
            </label>
            <select
              value={rightRevision}
              onChange={(e) => setRightRevision(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select revision</option>
              {revisions.map((rev) => (
                <option key={rev.id} value={rev.id}>
                  Rev {rev.revisionNumber} - {formatDate(rev.createdAt)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Comparison content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading...</div>
          ) : !leftData && !rightData ? (
            <div className="text-center py-8 text-gray-500">
              Select revisions to compare
            </div>
          ) : (
            <div className="space-y-6">
              {/* Summary comparison */}
              <div>
                <h3 className="font-medium mb-3">Estimate Summary</h3>
                <div className="grid grid-cols-2 gap-4">
                  {/* Left side */}
                  <div className="bg-gray-50 rounded p-4">
                    <h4 className="text-sm font-medium text-gray-500 mb-2">
                      Rev {leftData?.revisionNumber || '-'}
                    </h4>
                    {leftData?.estimateSnapshot && (
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Original Total:</span>
                          <span>{formatCurrency(leftData.estimateSnapshot.originalTotal)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Approved Total:</span>
                          <span>{formatCurrency(leftData.estimateSnapshot.approvedTotal)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Status:</span>
                          <span className="capitalize">{String(leftData.estimateSnapshot.status || '-').replace('_', ' ')}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right side */}
                  <div className="bg-blue-50 rounded p-4">
                    <h4 className="text-sm font-medium text-blue-600 mb-2">
                      Rev {rightData?.revisionNumber || '-'}
                    </h4>
                    {rightData?.estimateSnapshot && (
                      <div className="space-y-2 text-sm">
                        <div className={`flex justify-between ${getValueClass(leftData?.estimateSnapshot?.originalTotal, rightData.estimateSnapshot.originalTotal)}`}>
                          <span className="text-gray-600">Original Total:</span>
                          <span>{formatCurrency(rightData.estimateSnapshot.originalTotal)}</span>
                        </div>
                        <div className={`flex justify-between ${getValueClass(leftData?.estimateSnapshot?.approvedTotal, rightData.estimateSnapshot.approvedTotal)}`}>
                          <span className="text-gray-600">Approved Total:</span>
                          <span>{formatCurrency(rightData.estimateSnapshot.approvedTotal)}</span>
                        </div>
                        <div className={`flex justify-between ${getValueClass(leftData?.estimateSnapshot?.status, rightData.estimateSnapshot.status)}`}>
                          <span className="text-gray-600">Status:</span>
                          <span className="capitalize">{String(rightData.estimateSnapshot.status || '-').replace('_', ' ')}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Items comparison */}
              {leftData && rightData && (
                <div>
                  <h3 className="font-medium mb-3">Item Changes</h3>
                  {(() => {
                    const changes = compareItems(
                      leftData.itemsSnapshot,
                      rightData.itemsSnapshot
                    )

                    if (changes.length === 0) {
                      return (
                        <p className="text-sm text-gray-500 py-4 text-center">
                          No item changes between these revisions
                        </p>
                      )
                    }

                    return (
                      <div className="space-y-2">
                        {changes.map((change, idx) => (
                          <div
                            key={idx}
                            className={`p-3 rounded border ${
                              change.type === 'added'
                                ? 'bg-green-50 border-green-200'
                                : change.type === 'removed'
                                ? 'bg-red-50 border-red-200'
                                : 'bg-yellow-50 border-yellow-200'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-2">
                              {change.type === 'added' && (
                                <>
                                  <Plus size={16} className="text-green-600" />
                                  <span className="text-sm font-medium text-green-700">Added</span>
                                </>
                              )}
                              {change.type === 'removed' && (
                                <>
                                  <Minus size={16} className="text-red-600" />
                                  <span className="text-sm font-medium text-red-700">Removed</span>
                                </>
                              )}
                              {change.type === 'modified' && (
                                <>
                                  <Edit size={16} className="text-yellow-600" />
                                  <span className="text-sm font-medium text-yellow-700">Modified</span>
                                </>
                              )}
                            </div>
                            <div className="text-sm">
                              {change.rightItem && (
                                <div>
                                  <span className="font-medium">
                                    {change.rightItem.itemType === 'service'
                                      ? (change.rightItem.description || 'Service')
                                      : (change.rightItem.partName || 'Part')}
                                  </span>
                                  <span className="text-gray-500 ml-2">
                                    {formatCurrency(change.rightItem.originalAmount)}
                                  </span>
                                </div>
                              )}
                              {change.leftItem && !change.rightItem && (
                                <div className="line-through text-gray-500">
                                  <span className="font-medium">
                                    {change.leftItem.itemType === 'service'
                                      ? (change.leftItem.description || 'Service')
                                      : (change.leftItem.partName || 'Part')}
                                  </span>
                                  <span className="ml-2">
                                    {formatCurrency(change.leftItem.originalAmount)}
                                  </span>
                                </div>
                              )}
                              {change.type === 'modified' && change.leftItem && change.rightItem && (
                                <div className="mt-2 text-xs text-gray-600">
                                  {change.leftItem.status !== change.rightItem.status && (
                                    <div>
                                      Status: <span className="line-through">{String(change.leftItem.status)}</span>
                                      {' → '}<span className="font-medium">{String(change.rightItem.status)}</span>
                                    </div>
                                  )}
                                  {change.leftItem.approvedAmount !== change.rightItem.approvedAmount && (
                                    <div>
                                      Approved: <span className="line-through">{formatCurrency(change.leftItem.approvedAmount)}</span>
                                      {' → '}<span className="font-medium">{formatCurrency(change.rightItem.approvedAmount)}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Change reason */}
              {rightData?.changeReason && (
                <div>
                  <h3 className="font-medium mb-2">Change Reason</h3>
                  <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded">
                    {rightData.changeReason}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 border rounded hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
