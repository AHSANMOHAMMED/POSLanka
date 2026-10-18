'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { Loader2, DollarSign, CreditCard, Banknote, Settings } from 'lucide-react'

interface POSProfile {
  id: string
  name: string
  code: string | null
  warehouse?: {
    id: string
    name: string
  } | null
  paymentMethods?: {
    id: string
    paymentMethod: string
    isDefault: boolean
  }[]
}

interface OpeningBalance {
  paymentMethod: string
  amount: number
}

interface ShiftOpenModalProps {
  isOpen: boolean
  onClose: () => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onShiftOpened: (shift: any) => void
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
  credit: 'Store Credit',
  gift_card: 'Gift Card',
  mobile_payment: 'Mobile Payment',
}

const PAYMENT_METHOD_ICONS: Record<string, React.ReactNode> = {
  cash: <Banknote size={18} />,
  card: <CreditCard size={18} />,
  bank_transfer: <DollarSign size={18} />,
  credit: <DollarSign size={18} />,
  gift_card: <CreditCard size={18} />,
  mobile_payment: <CreditCard size={18} />,
}

export function ShiftOpenModal({ isOpen, onClose, onShiftOpened }: ShiftOpenModalProps) {
  const { data: session } = useSession()
  const params = useParams()
  const basePath = params.slug ? `/c/${params.slug}` : ''
  const isAdmin = ['owner', 'manager'].includes(session?.user?.role || '')
  const [loading, setLoading] = useState(false)
  const [loadingProfiles, setLoadingProfiles] = useState(true)
  const [profiles, setProfiles] = useState<POSProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [openingBalances, setOpeningBalances] = useState<OpeningBalance[]>([])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  // Fetch available profiles
  useEffect(() => {
    if (isOpen) {
      setLoadingProfiles(true)
      fetch('/api/pos-profiles')
        .then(res => res.json())
        .then(data => {
          // API returns { profile, profiles, needsSetup } object, not an array
          const profileList: POSProfile[] = Array.isArray(data) ? data : (data?.profiles || [])
          // Filter to only active profiles
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const activeProfiles = profileList.filter((p: any) => p.status !== 'inactive')
          setProfiles(activeProfiles)
          // Auto-select if only one profile or select default
          if (activeProfiles.length === 1) {
            setSelectedProfileId(activeProfiles[0].id)
          } else {
            // Prefer user's default, then profile marked as default, then first
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const userDefault = activeProfiles.find((p: any) => p.isUserDefault)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const defaultProfile = userDefault || activeProfiles.find((p: any) => p.isDefault) || activeProfiles[0]
            if (defaultProfile) {
              setSelectedProfileId(defaultProfile.id)
            }
          }
        })
        .catch(err => {
          console.error('Failed to load profiles:', err)
          toast.error('Failed to load POS profiles')
        })
        .finally(() => setLoadingProfiles(false))
    }
  }, [isOpen])

  // Update balances when profile changes
  useEffect(() => {
    if (selectedProfileId) {
      const profile = profiles.find(p => p.id === selectedProfileId)
      if (profile?.paymentMethods) {
        setOpeningBalances(
          profile.paymentMethods.map(pm => ({
            paymentMethod: pm.paymentMethod,
            amount: 0,
          }))
        )
      } else {
        // Default to cash only if no payment methods configured
        setOpeningBalances([{ paymentMethod: 'cash', amount: 0 }])
      }
    }
  }, [selectedProfileId, profiles])

  function handleClose() {
    setSelectedProfileId('')
    setOpeningBalances([])
    setNotes('')
    setError('')
    onClose()
  }

  function updateBalance(index: number, amount: number) {
    const newBalances = [...openingBalances]
    newBalances[index] = { ...newBalances[index], amount: Math.max(0, amount) }
    setOpeningBalances(newBalances)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!selectedProfileId) {
      setError('Please select a POS profile')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/pos-opening-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          posProfileId: selectedProfileId,
          openingBalances: openingBalances.filter(b => b.amount > 0),
          notes: notes || null,
        }),
      })

      if (res.ok) {
        const shift = await res.json()
        toast.success('Shift opened successfully')
        onShiftOpened(shift)
        handleClose()
      } else {
        const data = await res.json()
        if (data.existingShiftId) {
          setError('You already have an open shift. Please close it first.')
        } else {
          setError(data.error || 'Failed to open shift')
        }
      }
    } catch {
      setError('Failed to open shift')
    } finally {
      setLoading(false)
    }
  }

  const selectedProfile = profiles.find(p => p.id === selectedProfileId)

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Open Shift"
      size="lg"
    >
      {loadingProfiles ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : profiles.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500 dark:text-gray-400 mb-2">
            {isAdmin ? 'No POS profiles available' : 'You are not assigned to any POS profile'}
          </p>
          {isAdmin ? (
            <div>
              <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">
                You need to create a POS profile and assign yourself before opening a shift
              </p>
              <Link
                href={`${basePath}/settings/pos-profiles`}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                <Settings size={16} />
                Set Up POS Profile
              </Link>
            </div>
          ) : (
            <p className="text-sm text-gray-400 dark:text-gray-500">
              Ask an administrator to assign you to a POS profile
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 text-red-600 rounded text-sm dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">POS Profile *</label>
            <select
              value={selectedProfileId}
              onChange={(e) => setSelectedProfileId(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              required
            >
              <option value="">Select profile...</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} {profile.warehouse ? `(${profile.warehouse.name})` : ''}
                </option>
              ))}
            </select>
          </div>

          {selectedProfile && (
            <>
              <div>
                <label className="block text-sm font-medium mb-2 dark:text-gray-300">Opening Balances</label>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  Enter the cash and other payment method amounts in the drawer
                </p>
                <div className="space-y-2">
                  {openingBalances.map((balance, index) => (
                    <div
                      key={balance.paymentMethod}
                      className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded"
                    >
                      <div className="flex items-center gap-2 w-40">
                        <span className="text-gray-500 dark:text-gray-400">
                          {PAYMENT_METHOD_ICONS[balance.paymentMethod] || <DollarSign size={18} />}
                        </span>
                        <span className="text-sm font-medium dark:text-gray-300">
                          {PAYMENT_METHOD_LABELS[balance.paymentMethod] || balance.paymentMethod}
                        </span>
                      </div>
                      <div className="flex-1 relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                        <input
                          type="number"
                          value={balance.amount || ''}
                          onChange={(e) => updateBalance(index, parseFloat(e.target.value) || 0)}
                          className="w-full pl-7 pr-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                          placeholder="0.00"
                          min="0"
                          step="0.01"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  rows={2}
                  placeholder="Any notes for this shift..."
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t dark:border-gray-700">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border rounded hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800 dark:text-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !selectedProfileId}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              Open Shift
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
