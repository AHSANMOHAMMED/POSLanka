'use client'

import { useState } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import type { PendingSale } from '@/lib/offline/pos-queue'

interface OfflineFailedSalesProps {
  isOpen: boolean
  onClose: () => void
  sales: PendingSale[]
  syncing: boolean
  onRetry: (clientSaleId: string) => Promise<unknown>
  onDiscard: (clientSaleId: string) => Promise<void>
  onSyncAll: () => Promise<unknown>
}

function saleRef(s: PendingSale) {
  return s.offlineRef || s.clientSaleId.slice(0, 8).toUpperCase()
}

function saleTotal(s: PendingSale) {
  const n = Number(s.payload.total)
  return Number.isFinite(n) ? n.toFixed(2) : '—'
}

/** H4: offline sales that are still queued, backing off, or were rejected by the server. */
export function OfflineFailedSales({ isOpen, onClose, sales, syncing, onRetry, onDiscard, onSyncAll }: OfflineFailedSalesProps) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [discardTarget, setDiscardTarget] = useState<PendingSale | null>(null)

  async function retry(s: PendingSale) {
    setBusyId(s.clientSaleId)
    try {
      await onRetry(s.clientSaleId)
    } catch {
      toast.error('Retry failed')
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDiscard() {
    if (!discardTarget) return
    setBusyId(discardTarget.clientSaleId)
    try {
      await onDiscard(discardTarget.clientSaleId)
      toast.success(`Offline sale ${saleRef(discardTarget)} discarded`)
    } catch {
      toast.error('Failed to discard sale')
    } finally {
      setBusyId(null)
      setDiscardTarget(null)
    }
  }

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Offline sales"
        size="3xl"
        footer={
          <div className="flex justify-between w-full">
            <button
              type="button"
              onClick={() => void onSyncAll()}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50"
            >
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded border hover:bg-gray-50">
              Close
            </button>
          </div>
        }
      >
        {sales.length === 0 ? (
          <p className="text-sm text-gray-500">No offline sales waiting on this device.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600">Sale</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600">Queued</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">Total</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={s.clientSaleId} className="border-t align-top">
                    <td className="px-3 py-2 font-mono">{saleRef(s)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(s.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono">{saleTotal(s)}</td>
                    <td className="px-3 py-2">
                      {s.rejected ? (
                        <span className="inline-block px-1.5 py-0.5 rounded bg-red-100 text-red-800 text-xs font-medium">Rejected</span>
                      ) : s.nextAttemptAt ? (
                        <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-medium">
                          Retrying ({s.attempts})
                        </span>
                      ) : (
                        <span className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-medium">Waiting</span>
                      )}
                      {s.lastError && <div className="mt-1 text-xs text-red-700 break-words max-w-xs">{s.lastError}</div>}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => void retry(s)}
                        disabled={busyId === s.clientSaleId || syncing}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border hover:bg-gray-50 disabled:opacity-50"
                      >
                        <RefreshCw size={12} /> Retry
                      </button>
                      <button
                        type="button"
                        onClick={() => setDiscardTarget(s)}
                        disabled={busyId === s.clientSaleId}
                        className="ml-2 inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        <Trash2 size={12} /> Discard
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        isOpen={!!discardTarget}
        onClose={() => setDiscardTarget(null)}
        onConfirm={() => void confirmDiscard()}
        title="Discard offline sale?"
        message={
          discardTarget
            ? `Sale ${saleRef(discardTarget)} (${saleTotal(discardTarget)}) will be removed from this device and will NOT be recorded on the server. The customer was already charged — record it again manually if needed.`
            : ''
        }
        confirmText="Discard sale"
        variant="danger"
        processing={!!discardTarget && busyId === discardTarget.clientSaleId}
      />
    </>
  )
}
