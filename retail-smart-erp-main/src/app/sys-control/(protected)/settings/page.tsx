'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Loader2, Save, CreditCard, Bell, Settings, Zap, Lock, Percent,
  Phone, Sparkles, Plus, Trash2, Tag, Copy, ToggleLeft, X, Check
} from 'lucide-react'

// ==================== TYPES ====================

interface BankDetails {
  bankName: string
  accountNumber: string
  accountName: string
  branchName: string
  swiftCode?: string
  notes?: string
}

interface SystemAnnouncement {
  enabled: boolean
  message: string
  type: 'info' | 'warning' | 'error'
}

interface BillingConfig {
  lockoutGraceDays: number
  autoDeletionDays: number
  storageWarningPercent: number
  storageCriticalPercent: number
}

interface VolumeTier {
  min: number
  max: number | null
  percent: number
}

interface ContactInfo {
  email: string
  phone: string
  whatsapp: string
  address: string
  companyName: string
  businessHours: string
}

interface SeasonalOffer {
  enabled: boolean
  title: string
  description: string
  discountPercent: number
  validUntil: string
  badgeText: string
  applicableTiers: string[]
  showOnLanding: boolean
  showOnPricing: boolean
}

interface Coupon {
  id: string
  code: string
  description: string | null
  discountType: string
  discountValue: string
  applicableTiers: string[] | null
  minBillingCycle: string | null
  maxUses: number | null
  usedCount: number
  maxUsesPerAccount: number
  validFrom: string | null
  validUntil: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface CouponFormData {
  code: string
  description: string
  discountType: 'percentage' | 'fixed_amount'
  discountValue: string
  maxUses: string
  maxUsesPerAccount: string
  validFrom: string
  validUntil: string
  applicableTiers: string[]
  minBillingCycle: string
}

type TabId = 'general' | 'billing' | 'discounts' | 'contact' | 'promotions'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Settings className="w-4 h-4" /> },
  { id: 'billing', label: 'Billing', icon: <Lock className="w-4 h-4" /> },
  { id: 'discounts', label: 'Discounts', icon: <Percent className="w-4 h-4" /> },
  { id: 'contact', label: 'Contact & Branding', icon: <Phone className="w-4 h-4" /> },
  { id: 'promotions', label: 'Promotions', icon: <Sparkles className="w-4 h-4" /> },
]

const INPUT_CLASS = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white'
const CARD_CLASS = 'bg-white dark:bg-gray-800 rounded-md shadow-sm border border-gray-200 dark:border-gray-700'

const emptyCouponForm: CouponFormData = {
  code: '',
  description: '',
  discountType: 'percentage',
  discountValue: '',
  maxUses: '',
  maxUsesPerAccount: '1',
  validFrom: '',
  validUntil: '',
  applicableTiers: [],
  minBillingCycle: '',
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Auto-dismiss toast after 3s
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000)
      return () => clearTimeout(t)
    }
  }, [toast])

  // Bank details
  const [bankDetails, setBankDetails] = useState<BankDetails>({
    bankName: '',
    accountNumber: '',
    accountName: '',
    branchName: '',
    swiftCode: '',
    notes: '',
  })

  // System announcement
  const [announcement, setAnnouncement] = useState<SystemAnnouncement>({
    enabled: false,
    message: '',
    type: 'info',
  })

  // Billing config
  const [billingConfig, setBillingConfig] = useState<BillingConfig>({
    lockoutGraceDays: 3,
    autoDeletionDays: 7,
    storageWarningPercent: 80,
    storageCriticalPercent: 95,
  })

  // PayHere config status
  const [payhereConfigured, setPayhereConfigured] = useState(false)
  const [payhereSandbox, setPayhereSandbox] = useState(false)

  // Volume discounts
  const [volumeTiers, setVolumeTiers] = useState<VolumeTier[]>([
    { min: 2, max: 5, percent: 15 },
    { min: 6, max: 10, percent: 25 },
    { min: 11, max: null, percent: 30 },
  ])

  // Coupons
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [couponsLoading, setCouponsLoading] = useState(false)
  const [showCouponForm, setShowCouponForm] = useState(false)
  const [couponForm, setCouponForm] = useState<CouponFormData>(emptyCouponForm)
  const [couponSaving, setCouponSaving] = useState(false)
  const [deletingCouponId, setDeletingCouponId] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [pricingTiers, setPricingTiers] = useState<{ id: string; name: string }[]>([])

  // Contact info
  const [contactInfo, setContactInfo] = useState<ContactInfo>({
    email: '',
    phone: '',
    whatsapp: '',
    address: '',
    companyName: '',
    businessHours: '',
  })

  // Seasonal offer
  const [seasonalOffer, setSeasonalOffer] = useState<SeasonalOffer>({
    enabled: false,
    title: '',
    description: '',
    discountPercent: 0,
    validUntil: '',
    badgeText: '',
    applicableTiers: [],
    showOnLanding: false,
    showOnPricing: false,
  })

  const fetchSettings = useCallback(async () => {
    try {
      // Fetch bank details
      const bankRes = await fetch('/api/sys-control/settings?key=bank_details')
      if (bankRes.ok) {
        const data = await bankRes.json()
        if (data.value) setBankDetails(data.value)
      }

      // Fetch announcement
      const annRes = await fetch('/api/sys-control/settings?key=system_announcement')
      if (annRes.ok) {
        const data = await annRes.json()
        if (data.value) setAnnouncement(data.value)
      }

      // Fetch billing config
      const billingRes = await fetch('/api/sys-control/settings?key=billing_config')
      if (billingRes.ok) {
        const data = await billingRes.json()
        if (data.value) setBillingConfig(data.value)
      }

      // Fetch PayHere status
      const phRes = await fetch('/api/sys-control/settings?key=payhere_status')
      if (phRes.ok) {
        const data = await phRes.json()
        if (data.value) {
          setPayhereConfigured(data.value.configured)
          setPayhereSandbox(data.value.sandbox)
        }
      }

      // Fetch volume discounts
      const volRes = await fetch('/api/sys-control/settings?key=volume_discounts')
      if (volRes.ok) {
        const data = await volRes.json()
        if (data.value?.tiers) setVolumeTiers(data.value.tiers)
      }

      // Fetch contact info
      const contactRes = await fetch('/api/sys-control/settings?key=contact_info')
      if (contactRes.ok) {
        const data = await contactRes.json()
        if (data.value) setContactInfo(data.value)
      }

      // Fetch seasonal offer
      const seasonRes = await fetch('/api/sys-control/settings?key=seasonal_offer')
      if (seasonRes.ok) {
        const data = await seasonRes.json()
        if (data.value) setSeasonalOffer(data.value)
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchCoupons = useCallback(async () => {
    setCouponsLoading(true)
    try {
      const res = await fetch('/api/sys-control/coupons')
      if (res.ok) {
        const data = await res.json()
        setCoupons(data)
      }
    } catch (error) {
      console.error('Failed to fetch coupons:', error)
    } finally {
      setCouponsLoading(false)
    }
  }, [])

  const fetchPricingTiers = useCallback(async () => {
    try {
      const res = await fetch('/api/sys-control/pricing-tiers')
      if (res.ok) {
        const data = await res.json()
        setPricingTiers(data.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })))
      }
    } catch (error) {
      console.error('Failed to fetch pricing tiers:', error)
    }
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  // Fetch coupons & tiers when Discounts tab is active
  useEffect(() => {
    if (activeTab === 'discounts') {
      fetchCoupons()
      fetchPricingTiers()
    }
  }, [activeTab, fetchCoupons, fetchPricingTiers])

  const saveSetting = async (key: string, value: unknown, description: string) => {
    setSaving(key)
    try {
      const res = await fetch('/api/sys-control/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, description }),
      })

      if (!res.ok) {
        throw new Error('Failed to save')
      }

      setToast({ type: 'success', message: 'Settings saved successfully!' })
    } catch (error) {
      console.error('Failed to save setting:', error)
      setToast({ type: 'error', message: 'Failed to save settings' })
    } finally {
      setSaving(null)
    }
  }

  // ==================== COUPON HANDLERS ====================

  const handleCreateCoupon = async () => {
    if (!couponForm.code.trim()) {
      setToast({ type: 'error', message: 'Coupon code is required' })
      return
    }
    if (!couponForm.discountValue || Number(couponForm.discountValue) <= 0) {
      setToast({ type: 'error', message: 'Discount value must be greater than 0' })
      return
    }

    setCouponSaving(true)
    try {
      const res = await fetch('/api/sys-control/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: couponForm.code,
          description: couponForm.description || null,
          discountType: couponForm.discountType,
          discountValue: couponForm.discountValue,
          maxUses: couponForm.maxUses ? parseInt(couponForm.maxUses) : null,
          maxUsesPerAccount: couponForm.maxUsesPerAccount ? parseInt(couponForm.maxUsesPerAccount) : 1,
          validFrom: couponForm.validFrom || null,
          validUntil: couponForm.validUntil || null,
          applicableTiers: couponForm.applicableTiers.length > 0 ? couponForm.applicableTiers : null,
          minBillingCycle: couponForm.minBillingCycle || null,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create coupon')
      }

      setToast({ type: 'success', message: 'Coupon created successfully!' })
      setCouponForm(emptyCouponForm)
      setShowCouponForm(false)
      fetchCoupons()
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : 'Failed to create coupon' })
    } finally {
      setCouponSaving(false)
    }
  }

  const handleToggleCoupon = async (coupon: Coupon) => {
    try {
      const res = await fetch(`/api/sys-control/coupons/${coupon.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !coupon.isActive }),
      })

      if (!res.ok) throw new Error('Failed to update coupon')

      setToast({ type: 'success', message: `Coupon ${coupon.isActive ? 'deactivated' : 'activated'}` })
      fetchCoupons()
    } catch (error) {
      console.error('Failed to toggle coupon:', error)
      setToast({ type: 'error', message: 'Failed to update coupon' })
    }
  }

  const handleDeleteCoupon = async (id: string) => {
    if (!confirm('Are you sure you want to delete this coupon? This cannot be undone.')) return

    setDeletingCouponId(id)
    try {
      const res = await fetch(`/api/sys-control/coupons/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete coupon')

      setToast({ type: 'success', message: 'Coupon deleted' })
      fetchCoupons()
    } catch (error) {
      console.error('Failed to delete coupon:', error)
      setToast({ type: 'error', message: 'Failed to delete coupon' })
    } finally {
      setDeletingCouponId(null)
    }
  }

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopiedCode(code)
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const handleTierCheckbox = (tierId: string, checked: boolean) => {
    setCouponForm(prev => ({
      ...prev,
      applicableTiers: checked
        ? [...prev.applicableTiers, tierId]
        : prev.applicableTiers.filter(id => id !== tierId),
    }))
  }

  // ==================== LOADING STATE ====================

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  // ==================== RENDER ====================

  return (
    <div className="space-y-6">
      {/* Toast notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded shadow-lg text-sm font-medium transition-all animate-in fade-in slide-in-from-top-2 ${
            toast.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200 dark:bg-green-900/50 dark:text-green-200 dark:border-green-800'
              : 'bg-red-50 text-red-800 border border-red-200 dark:bg-red-900/50 dark:text-red-200 dark:border-red-800'
          }`}
        >
          {toast.type === 'success' ? (
            <Check className="w-4 h-4" />
          ) : (
            <X className="w-4 h-4" />
          )}
          {toast.message}
          <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Settings className="w-6 h-6" />
          System Settings
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Configure global system settings</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 mb-6 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ==================== TAB 1: GENERAL ==================== */}
      {activeTab === 'general' && (
        <div className="space-y-8">
          {/* System Announcement */}
          <div className={CARD_CLASS}>
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Bell className="w-5 h-5" />
                System Announcement
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Display a banner message to all users
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="announcement-enabled"
                  checked={announcement.enabled}
                  onChange={(e) => setAnnouncement({ ...announcement, enabled: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                />
                <label htmlFor="announcement-enabled" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Enable announcement
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Announcement Type
                </label>
                <select
                  value={announcement.type}
                  onChange={(e) => setAnnouncement({ ...announcement, type: e.target.value as 'info' | 'warning' | 'error' })}
                  className={INPUT_CLASS}
                >
                  <option value="info">Info (Blue)</option>
                  <option value="warning">Warning (Yellow)</option>
                  <option value="error">Critical (Red)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Message
                </label>
                <textarea
                  value={announcement.message}
                  onChange={(e) => setAnnouncement({ ...announcement, message: e.target.value })}
                  rows={3}
                  placeholder="Enter the announcement message..."
                  className={INPUT_CLASS}
                />
              </div>
            </div>
          </div>

          {/* Bank Details */}
          <div className={CARD_CLASS}>
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <CreditCard className="w-5 h-5" />
                Bank Details for Payments
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                These details will be shown to users when they submit bank deposits
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Bank Name
                  </label>
                  <input
                    type="text"
                    value={bankDetails.bankName}
                    onChange={(e) => setBankDetails({ ...bankDetails, bankName: e.target.value })}
                    placeholder="e.g., Commercial Bank of Ceylon"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Account Number
                  </label>
                  <input
                    type="text"
                    value={bankDetails.accountNumber}
                    onChange={(e) => setBankDetails({ ...bankDetails, accountNumber: e.target.value })}
                    placeholder="e.g., 8012345678"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Account Name
                  </label>
                  <input
                    type="text"
                    value={bankDetails.accountName}
                    onChange={(e) => setBankDetails({ ...bankDetails, accountName: e.target.value })}
                    placeholder="e.g., Smart POS Solutions (Pvt) Ltd"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Branch Name
                  </label>
                  <input
                    type="text"
                    value={bankDetails.branchName}
                    onChange={(e) => setBankDetails({ ...bankDetails, branchName: e.target.value })}
                    placeholder="e.g., Colombo Main Branch"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    SWIFT Code (Optional)
                  </label>
                  <input
                    type="text"
                    value={bankDetails.swiftCode || ''}
                    onChange={(e) => setBankDetails({ ...bankDetails, swiftCode: e.target.value })}
                    placeholder="e.g., CABORLX"
                    className={INPUT_CLASS}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Additional Notes (Optional)
                </label>
                <textarea
                  value={bankDetails.notes || ''}
                  onChange={(e) => setBankDetails({ ...bankDetails, notes: e.target.value })}
                  rows={2}
                  placeholder="e.g., Please include your company name as reference"
                  className={INPUT_CLASS}
                />
              </div>
            </div>
          </div>

          {/* PayHere Configuration Status */}
          <div className={CARD_CLASS}>
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Zap className="w-5 h-5" />
                PayHere Payment Gateway
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Status of PayHere payment integration
              </p>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${payhereConfigured ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="font-medium text-gray-900 dark:text-white">
                  {payhereConfigured ? 'PayHere is configured and active' : 'PayHere is not configured'}
                </span>
              </div>
              {!payhereConfigured && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-3">
                  Set the following environment variables to enable PayHere payments:
                  <code className="block mt-2 bg-gray-50 dark:bg-gray-700/50 rounded p-3 text-xs font-mono">
                    PAYHERE_MERCHANT_ID=&quot;...&quot;<br />
                    PAYHERE_MERCHANT_SECRET=&quot;...&quot;<br />
                    PAYHERE_SANDBOX=&quot;true&quot; (for testing)<br />
                    NEXT_PUBLIC_APP_URL=&quot;https://your-app.com&quot;
                  </code>
                </p>
              )}
              {payhereConfigured && (
                <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Mode</p>
                    <p className="font-medium text-gray-900 dark:text-white">
                      {payhereSandbox ? 'Sandbox (Testing)' : 'Live (Production)'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500 dark:text-gray-400">Merchant ID</p>
                    <p className="font-medium text-gray-900 dark:text-white font-mono">***configured***</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Save button for General tab */}
          <div className="flex gap-3">
            <button
              onClick={() => saveSetting('system_announcement', announcement, 'System-wide announcement banner')}
              disabled={saving === 'system_announcement'}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 transition-colors disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
            >
              {saving === 'system_announcement' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Announcement
            </button>
            <button
              onClick={() => saveSetting('bank_details', bankDetails, 'Bank details for payment deposits')}
              disabled={saving === 'bank_details'}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 transition-colors disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
            >
              {saving === 'bank_details' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Bank Details
            </button>
          </div>
        </div>
      )}

      {/* ==================== TAB 2: BILLING ==================== */}
      {activeTab === 'billing' && (
        <div className="space-y-8">
          <div className={CARD_CLASS}>
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Lock className="w-5 h-5" />
                Billing & Lockout Configuration
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Control lockout grace periods and storage thresholds
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Lockout Grace Period (days)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="14"
                    value={billingConfig.lockoutGraceDays}
                    onChange={(e) => setBillingConfig({ ...billingConfig, lockoutGraceDays: parseInt(e.target.value) || 3 })}
                    className={INPUT_CLASS}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Days after subscription expires before locking</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Auto-Deletion (days after lock)
                  </label>
                  <input
                    type="number"
                    min="3"
                    max="30"
                    value={billingConfig.autoDeletionDays}
                    onChange={(e) => setBillingConfig({ ...billingConfig, autoDeletionDays: parseInt(e.target.value) || 7 })}
                    className={INPUT_CLASS}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Days after lockout before data is permanently deleted</p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Storage Warning Threshold (%)
                  </label>
                  <input
                    type="number"
                    min="50"
                    max="99"
                    value={billingConfig.storageWarningPercent}
                    onChange={(e) => setBillingConfig({ ...billingConfig, storageWarningPercent: parseInt(e.target.value) || 80 })}
                    className={INPUT_CLASS}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Send warning when storage usage reaches this %</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Storage Critical Threshold (%)
                  </label>
                  <input
                    type="number"
                    min="80"
                    max="100"
                    value={billingConfig.storageCriticalPercent}
                    onChange={(e) => setBillingConfig({ ...billingConfig, storageCriticalPercent: parseInt(e.target.value) || 95 })}
                    className={INPUT_CLASS}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Send critical alert when storage reaches this %</p>
                </div>
              </div>
              <div className="pt-4">
                <button
                  onClick={() => saveSetting('billing_config', billingConfig, 'Billing and lockout configuration')}
                  disabled={saving === 'billing_config'}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 transition-colors disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                >
                  {saving === 'billing_config' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save Billing Config
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 3: DISCOUNTS ==================== */}
      {activeTab === 'discounts' && (
        <div className="space-y-8">
          {/* Volume Discount Tiers */}
          <div className={CARD_CLASS}>
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Percent className="w-5 h-5" />
                Volume Discount Tiers
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Discounts applied when an account has multiple active companies
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-3">
                {volumeTiers.map((tier, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="number"
                        min="1"
                        value={tier.min}
                        onChange={(e) => {
                          const updated = [...volumeTiers]
                          updated[index] = { ...tier, min: parseInt(e.target.value) || 1 }
                          setVolumeTiers(updated)
                        }}
                        className="w-20 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white text-center"
                      />
                      <span className="text-gray-500 dark:text-gray-400 text-sm">to</span>
                      <input
                        type="number"
                        min="1"
                        value={tier.max ?? ''}
                        onChange={(e) => {
                          const updated = [...volumeTiers]
                          updated[index] = { ...tier, max: e.target.value ? parseInt(e.target.value) : null }
                          setVolumeTiers(updated)
                        }}
                        placeholder="No limit"
                        className="w-20 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white text-center"
                      />
                      <span className="text-gray-500 dark:text-gray-400 text-sm">companies</span>
                      <span className="text-gray-500 dark:text-gray-400 mx-1">=</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={tier.percent}
                        onChange={(e) => {
                          const updated = [...volumeTiers]
                          updated[index] = { ...tier, percent: parseInt(e.target.value) || 0 }
                          setVolumeTiers(updated)
                        }}
                        className="w-20 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white text-center"
                      />
                      <span className="text-gray-500 dark:text-gray-400 text-sm">% off</span>
                    </div>
                    <button
                      onClick={() => setVolumeTiers(volumeTiers.filter((_, i) => i !== index))}
                      className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setVolumeTiers([...volumeTiers, { min: 1, max: null, percent: 0 }])}
                className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400"
              >
                <Plus className="w-4 h-4" />
                Add tier
              </button>
              <div className="pt-4">
                <button
                  onClick={() => saveSetting('volume_discounts', { tiers: volumeTiers }, 'Volume discount tiers')}
                  disabled={saving === 'volume_discounts'}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 transition-colors disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                >
                  {saving === 'volume_discounts' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Volume Discounts
                </button>
              </div>
            </div>
          </div>

          {/* Coupon Codes */}
          <div className={CARD_CLASS}>
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Tag className="w-5 h-5" />
                  Coupon Codes
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Manage discount coupon codes for subscriptions
                </p>
              </div>
              <button
                onClick={() => {
                  setCouponForm(emptyCouponForm)
                  setShowCouponForm(!showCouponForm)
                }}
                className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm"
              >
                {showCouponForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {showCouponForm ? 'Cancel' : 'Create Coupon'}
              </button>
            </div>

            {/* Create coupon form */}
            {showCouponForm && (
              <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">New Coupon</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Code *
                    </label>
                    <input
                      type="text"
                      value={couponForm.code}
                      onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value.toUpperCase() })}
                      placeholder="e.g., WELCOME20"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Description
                    </label>
                    <input
                      type="text"
                      value={couponForm.description}
                      onChange={(e) => setCouponForm({ ...couponForm, description: e.target.value })}
                      placeholder="e.g., Welcome discount for new users"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Discount Type
                    </label>
                    <select
                      value={couponForm.discountType}
                      onChange={(e) => setCouponForm({ ...couponForm, discountType: e.target.value as 'percentage' | 'fixed_amount' })}
                      className={INPUT_CLASS}
                    >
                      <option value="percentage">Percentage (%)</option>
                      <option value="fixed_amount">Fixed Amount</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Discount Value *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={couponForm.discountValue}
                      onChange={(e) => setCouponForm({ ...couponForm, discountValue: e.target.value })}
                      placeholder={couponForm.discountType === 'percentage' ? 'e.g., 20' : 'e.g., 500'}
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Max Uses (total)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={couponForm.maxUses}
                      onChange={(e) => setCouponForm({ ...couponForm, maxUses: e.target.value })}
                      placeholder="Unlimited"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Max Uses Per Account
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={couponForm.maxUsesPerAccount}
                      onChange={(e) => setCouponForm({ ...couponForm, maxUsesPerAccount: e.target.value })}
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Valid From
                    </label>
                    <input
                      type="date"
                      value={couponForm.validFrom}
                      onChange={(e) => setCouponForm({ ...couponForm, validFrom: e.target.value })}
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Valid Until
                    </label>
                    <input
                      type="date"
                      value={couponForm.validUntil}
                      onChange={(e) => setCouponForm({ ...couponForm, validUntil: e.target.value })}
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Min Billing Cycle
                    </label>
                    <select
                      value={couponForm.minBillingCycle}
                      onChange={(e) => setCouponForm({ ...couponForm, minBillingCycle: e.target.value })}
                      className={INPUT_CLASS}
                    >
                      <option value="">Any</option>
                      <option value="monthly">Monthly</option>
                      <option value="annual">Annual</option>
                    </select>
                  </div>
                </div>

                {/* Applicable Tiers checkboxes */}
                {pricingTiers.length > 0 && (
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Applicable Tiers (leave empty for all)
                    </label>
                    <div className="flex flex-wrap gap-3">
                      {pricingTiers.map(tier => (
                        <label key={tier.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                          <input
                            type="checkbox"
                            checked={couponForm.applicableTiers.includes(tier.id)}
                            onChange={(e) => handleTierCheckbox(tier.id, e.target.checked)}
                            className="w-4 h-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 dark:bg-gray-700"
                          />
                          {tier.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-4 flex gap-3">
                  <button
                    onClick={handleCreateCoupon}
                    disabled={couponSaving}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 text-sm"
                  >
                    {couponSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Create Coupon
                  </button>
                  <button
                    onClick={() => setShowCouponForm(false)}
                    className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Coupons table */}
            <div className="p-6">
              {couponsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : coupons.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <Tag className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No coupon codes yet. Create one to get started.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Code</th>
                        <th className="text-left py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Type</th>
                        <th className="text-left py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Value</th>
                        <th className="text-left py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Max Uses</th>
                        <th className="text-left py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Used</th>
                        <th className="text-left py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Valid Until</th>
                        <th className="text-left py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Active</th>
                        <th className="text-right py-3 px-2 font-medium text-gray-500 dark:text-gray-400">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coupons.map(coupon => (
                        <tr key={coupon.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                          <td className="py-3 px-2">
                            <code className="text-xs font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-gray-900 dark:text-gray-100">
                              {coupon.code}
                            </code>
                          </td>
                          <td className="py-3 px-2 text-gray-700 dark:text-gray-300 capitalize">
                            {coupon.discountType === 'fixed_amount' ? 'Fixed' : 'Percentage'}
                          </td>
                          <td className="py-3 px-2 text-gray-900 dark:text-white font-medium">
                            {coupon.discountType === 'percentage'
                              ? `${coupon.discountValue}%`
                              : `$${coupon.discountValue}`
                            }
                          </td>
                          <td className="py-3 px-2 text-gray-700 dark:text-gray-300">
                            {coupon.maxUses ?? 'Unlimited'}
                          </td>
                          <td className="py-3 px-2 text-gray-700 dark:text-gray-300">
                            {coupon.usedCount}
                          </td>
                          <td className="py-3 px-2 text-gray-700 dark:text-gray-300">
                            {coupon.validUntil
                              ? new Date(coupon.validUntil).toLocaleDateString()
                              : 'No expiry'
                            }
                          </td>
                          <td className="py-3 px-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              coupon.isActive
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                            }`}>
                              {coupon.isActive ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="py-3 px-2">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleCopyCode(coupon.code)}
                                className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
                                title="Copy code"
                              >
                                {copiedCode === coupon.code ? (
                                  <Check className="w-4 h-4 text-green-500" />
                                ) : (
                                  <Copy className="w-4 h-4" />
                                )}
                              </button>
                              <button
                                onClick={() => handleToggleCoupon(coupon)}
                                className={`p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 ${
                                  coupon.isActive
                                    ? 'text-green-500 hover:text-orange-500'
                                    : 'text-gray-400 hover:text-green-500'
                                }`}
                                title={coupon.isActive ? 'Deactivate' : 'Activate'}
                              >
                                <ToggleLeft className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteCoupon(coupon.id)}
                                disabled={deletingCouponId === coupon.id}
                                className="p-1.5 text-gray-400 hover:text-red-500 rounded hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                                title="Delete"
                              >
                                {deletingCouponId === coupon.id ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 4: CONTACT & BRANDING ==================== */}
      {activeTab === 'contact' && (
        <div className="space-y-8">
          <div className={CARD_CLASS}>
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Phone className="w-5 h-5" />
                Contact Information
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Shown on landing page, support page, and footer
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Company Name</label>
                  <input
                    type="text"
                    value={contactInfo.companyName}
                    onChange={(e) => setContactInfo({ ...contactInfo, companyName: e.target.value })}
                    placeholder="Retail Smart ERP"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                  <input
                    type="email"
                    value={contactInfo.email}
                    onChange={(e) => setContactInfo({ ...contactInfo, email: e.target.value })}
                    placeholder="support@retailsmarterp.com"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label>
                  <input
                    type="text"
                    value={contactInfo.phone}
                    onChange={(e) => setContactInfo({ ...contactInfo, phone: e.target.value })}
                    placeholder="+94 11 234 5678"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">WhatsApp</label>
                  <input
                    type="text"
                    value={contactInfo.whatsapp}
                    onChange={(e) => setContactInfo({ ...contactInfo, whatsapp: e.target.value })}
                    placeholder="+94 77 123 4567"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Address</label>
                  <input
                    type="text"
                    value={contactInfo.address}
                    onChange={(e) => setContactInfo({ ...contactInfo, address: e.target.value })}
                    placeholder="Colombo, Sri Lanka"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Business Hours</label>
                  <input
                    type="text"
                    value={contactInfo.businessHours}
                    onChange={(e) => setContactInfo({ ...contactInfo, businessHours: e.target.value })}
                    placeholder="Mon-Fri 9:00 AM - 6:00 PM (IST)"
                    className={INPUT_CLASS}
                  />
                </div>
              </div>
              <div className="pt-4">
                <button
                  onClick={() => saveSetting('contact_info', contactInfo, 'Public contact information')}
                  disabled={saving === 'contact_info'}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 transition-colors disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                >
                  {saving === 'contact_info' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Contact Info
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== TAB 5: PROMOTIONS ==================== */}
      {activeTab === 'promotions' && (
        <div className="space-y-8">
          <div className={CARD_CLASS}>
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                Seasonal Offer / Promotion
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Display a promotional banner on landing and pricing pages
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="seasonal-enabled"
                  checked={seasonalOffer.enabled}
                  onChange={(e) => setSeasonalOffer({ ...seasonalOffer, enabled: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 dark:bg-gray-700"
                />
                <label htmlFor="seasonal-enabled" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Enable seasonal offer
                </label>
              </div>
              {seasonalOffer.enabled && (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
                      <input
                        type="text"
                        value={seasonalOffer.title}
                        onChange={(e) => setSeasonalOffer({ ...seasonalOffer, title: e.target.value })}
                        placeholder="New Year Special!"
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Badge Text</label>
                      <input
                        type="text"
                        value={seasonalOffer.badgeText}
                        onChange={(e) => setSeasonalOffer({ ...seasonalOffer, badgeText: e.target.value })}
                        placeholder="LIMITED TIME"
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Discount %</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={seasonalOffer.discountPercent}
                        onChange={(e) => setSeasonalOffer({ ...seasonalOffer, discountPercent: parseInt(e.target.value) || 0 })}
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valid Until</label>
                      <input
                        type="date"
                        value={seasonalOffer.validUntil}
                        onChange={(e) => setSeasonalOffer({ ...seasonalOffer, validUntil: e.target.value })}
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
                    <textarea
                      value={seasonalOffer.description}
                      onChange={(e) => setSeasonalOffer({ ...seasonalOffer, description: e.target.value })}
                      rows={2}
                      placeholder="Get started with our special pricing..."
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={seasonalOffer.showOnLanding}
                        onChange={(e) => setSeasonalOffer({ ...seasonalOffer, showOnLanding: e.target.checked })}
                        className="w-4 h-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded"
                      />
                      Show on landing page
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        type="checkbox"
                        checked={seasonalOffer.showOnPricing}
                        onChange={(e) => setSeasonalOffer({ ...seasonalOffer, showOnPricing: e.target.checked })}
                        className="w-4 h-4 text-blue-600 border-gray-300 dark:border-gray-600 rounded"
                      />
                      Show on pricing page
                    </label>
                  </div>
                </>
              )}
              <div className="pt-4">
                <button
                  onClick={() => saveSetting('seasonal_offer', seasonalOffer, 'Seasonal promotional offer')}
                  disabled={saving === 'seasonal_offer'}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded hover:bg-gray-800 transition-colors disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200"
                >
                  {saving === 'seasonal_offer' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Seasonal Offer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
