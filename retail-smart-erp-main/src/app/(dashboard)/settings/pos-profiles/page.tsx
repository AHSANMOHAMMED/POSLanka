'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRealtimeData } from '@/hooks/useRealtimeData'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { toast } from '@/components/ui/toast'
import {
  Store,
  Plus,
  Edit2,
  Eye,
  EyeOff,
  Loader2,
  Users,
  Star,
  CreditCard,
  Warehouse,
} from 'lucide-react'
import { Breadcrumb } from '@/components/ui/page-header'
import { POSProfileFormModal } from '@/components/modals/POSProfileFormModal'

interface PaymentMethod {
  id: string
  paymentMethod: string
  isDefault: boolean
  allowInReturns: boolean
  sortOrder: number
}

interface ProfileUser {
  id: string
  userId: string
  isDefault: boolean
  user: {
    id: string
    fullName: string
    email: string
  }
}

interface POSProfile {
  id: string
  name: string
  code: string | null
  isDefault: boolean
  warehouseId: string | null
  defaultCustomerId: string | null
  applyDiscountOn: string
  allowRateChange: boolean
  allowDiscountChange: boolean
  maxDiscountPercent: string
  allowNegativeStock: boolean
  validateStockOnSave: boolean
  hideUnavailableItems: boolean
  autoAddItemToCart: boolean
  printReceiptOnComplete: boolean
  skipPrintPreview: boolean
  receiptPrintFormat: string
  showLogoOnReceipt: boolean
  receiptHeader: string | null
  receiptFooter: string | null
  defaultPaymentMethod: string
  allowCreditSale: boolean
  costCenterId: string | null
  status: string
  createdAt: string
  updatedAt: string
  warehouse?: {
    id: string
    name: string
  } | null
  paymentMethods: PaymentMethod[]
  users: ProfileUser[]
}

export default function POSProfilesPage() {
  const [profiles, setProfiles] = useState<POSProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingProfile, setEditingProfile] = useState<POSProfile | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const fetchProfiles = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      params.set('all', 'true')
      if (!showInactive) params.set('activeOnly', 'true')
      const res = await fetch(`/api/pos-profiles?${params}`)
      if (res.ok) {
        const data = await res.json()
        // API returns array when all=true and user has profiles,
        // but returns { profiles: [...] } when user has no profile assignments
        setProfiles(Array.isArray(data) ? data : (data?.profiles || []))
      } else {
        toast.error('Failed to load POS profiles')
      }
    } catch (err) {
      console.error('Error fetching profiles:', err)
      toast.error('Failed to load POS profiles')
    } finally {
      setLoading(false)
    }
  }, [showInactive])

  useRealtimeData(fetchProfiles, { entityType: 'pos-profile', refreshOnMount: false })

  useEffect(() => {
    fetchProfiles()
  }, [fetchProfiles])

  function handleEdit(profile: POSProfile) {
    setEditingProfile(profile)
    setShowModal(true)
  }

  function handleCloseModal() {
    setShowModal(false)
    setEditingProfile(null)
  }

  async function handleToggleActive(profile: POSProfile) {
    try {
      const newStatus = profile.status === 'active' ? 'inactive' : 'active'
      const res = await fetch(`/api/pos-profiles/${profile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
        }),
      })

      if (res.ok) {
        toast.success(profile.status === 'active' ? 'Profile deactivated' : 'Profile activated')
        fetchProfiles()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update profile')
      }
    } catch {
      toast.error('Error updating profile')
    }
  }

  async function handleDelete() {
    if (!deletingId) return

    setShowDeleteConfirm(false)
    try {
      const res = await fetch(`/api/pos-profiles/${deletingId}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        toast.success('Profile deleted')
        fetchProfiles()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete profile')
      }
    } catch {
      toast.error('Error deleting profile')
    } finally {
      setDeletingId(null)
    }
  }

  const profileToDelete = profiles.find(p => p.id === deletingId)

  return (
    <div className="max-w-4xl mx-auto">
      <Breadcrumb
        items={[
          { label: 'Settings', href: '/settings' },
          { label: 'POS Profiles' }
        ]}
        className="mb-4"
      />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold dark:text-white">POS Profiles</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Configure point of sale terminals</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm dark:text-gray-300">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded dark:border-gray-600"
            />
            Show inactive
          </label>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            <Plus size={16} />
            Add Profile
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : profiles.length === 0 ? (
        <div className="bg-gray-50 dark:bg-gray-800 border dark:border-gray-700 border-dashed rounded-md p-8 text-center">
          <Store size={32} className="mx-auto mb-3 text-gray-400" />
          <p className="text-gray-500 dark:text-gray-400">No POS profiles yet</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
            Create your first POS profile to configure point of sale settings
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Create Profile
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className={`bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-md p-4 ${
                profile.status !== 'active' ? 'opacity-50' : ''
              }`}
            >
              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 rounded flex items-center justify-center ${
                  profile.isDefault ? 'bg-blue-100 dark:bg-blue-900' : 'bg-gray-100 dark:bg-gray-700'
                }`}>
                  <Store size={24} className={profile.isDefault ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold dark:text-white">{profile.name}</span>
                    {profile.code && (
                      <span className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded font-mono dark:text-gray-300">
                        {profile.code}
                      </span>
                    )}
                    {profile.isDefault && (
                      <span className="flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                        <Star size={12} />
                        Default
                      </span>
                    )}
                    {profile.status !== 'active' && (
                      <span className="text-xs bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 px-2 py-0.5 rounded">
                        Inactive
                      </span>
                    )}
                  </div>
                  {profile.warehouse && (
                    <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 mt-1">
                      <Warehouse size={14} />
                      <span className="truncate">{profile.warehouse.name}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-1">
                      <Users size={12} />
                      {profile.users?.length || 0} users
                    </span>
                    <span className="flex items-center gap-1">
                      <CreditCard size={12} />
                      {profile.paymentMethods?.length || 0} payment methods
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleEdit(profile)}
                    className="p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                    title="Edit"
                  >
                    <Edit2 size={18} />
                  </button>
                  <button
                    onClick={() => handleToggleActive(profile)}
                    className={`p-2 rounded ${
                      profile.status === 'active'
                        ? 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
                        : 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/50'
                    }`}
                    title={profile.status === 'active' ? 'Deactivate' : 'Activate'}
                  >
                    {profile.status === 'active' ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* POS Profile Form Modal */}
      <POSProfileFormModal
        isOpen={showModal}
        onClose={handleCloseModal}
        onSaved={() => {
          fetchProfiles()
          handleCloseModal()
        }}
        editProfile={editingProfile}
      />

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false)
          setDeletingId(null)
        }}
        onConfirm={handleDelete}
        title="Delete POS Profile"
        message={`Are you sure you want to delete "${profileToDelete?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  )
}
