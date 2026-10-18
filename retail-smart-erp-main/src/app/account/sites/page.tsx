'use client'

import { useState, useCallback } from 'react'
import { useRealtimeData } from '@/hooks'
// useSession removed — company switching now uses transfer tokens
import Link from 'next/link'
import {
  Building2,
  Plus,
  Search,
  MoreHorizontal,
  ExternalLink,
  Settings,
  Trash2,
  ArrowUpRight,
  Loader2,
  Crown,
  AlertTriangle,
  X,
} from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { getBusinessTypeLabel, getBusinessTypeIcon } from '@/lib/constants/business-types'

interface Site {
  id: string
  name: string
  slug: string
  businessType: string
  logoUrl: string | null
  status: string
  role: string
  isOwner: boolean
  createdAt: string
  subscription: {
    status: string
    tierName: string
    trialEndsAt: string | null
    currentPeriodEnd: string | null
  } | null
}

// getBusinessTypeLabel and getBusinessTypeIcon imported from @/lib/constants/business-types

function getStatusColor(status: string) {
  switch (status) {
    case 'active':
      return { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' }
    case 'trial':
      return { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' }
    case 'suspended':
      return { bg: 'bg-red-100', text: 'text-red-700', dot: 'bg-red-500' }
    case 'past_due':
      return { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' }
    default:
      return { bg: 'bg-gray-100 dark:bg-gray-700', text: 'text-gray-700 dark:text-gray-300', dot: 'bg-gray-500' }
  }
}

export default function SitesPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<string>('all')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; site: Site | null }>({ open: false, site: null })
  const [deletePassword, setDeletePassword] = useState('')
  const [deleting, setDeleting] = useState(false)

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch('/api/account/companies')
      if (res.ok) {
        const data = await res.json()
        setSites(data)
      }
    } catch (error) {
      console.error('Failed to fetch sites:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // Real-time updates via WebSocket
  useRealtimeData(fetchSites, { entityType: 'account-site' })

  const handleOpen = async (siteId: string) => {
    setSwitching(siteId)
    try {
      // Get transfer token from account auth
      const res = await fetch('/api/account-auth/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: siteId }),
      })

      if (!res.ok) {
        throw new Error('Failed to generate transfer token')
      }

      const { transferToken, slug } = await res.json()

      // Navigate to company subdomain with transfer token
      const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'retailsmarterp.com'
      const isProduction = window.location.hostname.includes(baseDomain)

      if (isProduction) {
        // Production: redirect to subdomain
        window.location.href = `https://${slug}.${baseDomain}/login?transfer=${encodeURIComponent(transferToken)}`
      } else {
        // Local dev: redirect to /c/slug/login with transfer token
        window.location.href = `/c/${slug}/login?transfer=${encodeURIComponent(transferToken)}`
      }
    } catch (error) {
      console.error('Failed to switch:', error)
      setSwitching(null)
    }
  }

  const handleDeleteSite = async () => {
    if (!deleteModal.site || !deletePassword) return

    setDeleting(true)

    try {
      const res = await fetch('/api/account/companies', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: deleteModal.site.id,
          password: deletePassword,
        }),
      })

      let data: { error?: string; code?: string } = {}
      const contentType = res.headers.get('content-type')
      if (contentType?.includes('application/json')) {
        try {
          data = await res.json()
        } catch {
          // ignore parse error, use generic message
        }
      }

      if (res.ok) {
        toast.success('Site deleted successfully')
        setDeleteModal({ open: false, site: null })
        setDeletePassword('')
    
        fetchSites()
      } else {
        const message = data.error || 'Failed to delete site'
        toast.error(message)
      }
    } catch (error) {
      console.error('Failed to delete site:', error)
      toast.error('Network error. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  const filteredSites = sites.filter((site) => {
    const matchesSearch =
      site.name.toLowerCase().includes(search.toLowerCase()) ||
      site.slug.toLowerCase().includes(search.toLowerCase())

    if (filter === 'all') return matchesSearch
    if (filter === 'active') return matchesSearch && site.subscription?.status === 'active'
    if (filter === 'free') return matchesSearch && site.subscription?.status === 'trial'
    if (filter === 'owned') return matchesSearch && site.isOwner

    return matchesSearch
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Sites</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Manage all your business sites</p>
        </div>
        <Link
          href="/account/sites/new"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors font-medium"
        >
          <Plus className="w-4 h-4" />
          New Site
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search sites..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
        </div>
        <div className="flex gap-2">
          {['all', 'active', 'free', 'owned'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all capitalize ${
                filter === f
                  ? 'bg-gray-900 text-white shadow-lg'
                  : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Sites Grid */}
      {filteredSites.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-12 text-center">
          <div className="w-20 h-20 bg-gradient-to-br from-gray-100 to-gray-200 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-10 h-10 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            {sites.length === 0 ? 'No sites yet' : 'No sites match your search'}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-sm mx-auto">
            {sites.length === 0
              ? 'Create your first site to start managing your business'
              : 'Try adjusting your search or filter'}
          </p>
          {sites.length === 0 && (
            <Link
              href="/account/sites/new"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors font-medium"
            >
              <Plus className="w-4 h-4" />
              Create Site
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredSites.map((site) => {
            const BusinessIcon = getBusinessTypeIcon(site.businessType) || Building2
            const statusColors = site.subscription ? getStatusColor(site.subscription.status) : getStatusColor('active')

            return (
              <div
                key={site.id}
                className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 hover:border-gray-300 hover:shadow-lg transition-all overflow-hidden group"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 bg-gradient-to-br from-gray-100 to-gray-200 rounded-md flex items-center justify-center group-hover:from-gray-200 group-hover:to-gray-300 transition-colors">
                        {site.logoUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={site.logoUrl} alt={site.name} className="w-12 h-12 rounded object-cover" />
                        ) : (
                          <BusinessIcon className="w-7 h-7 text-gray-500 dark:text-gray-400" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-900 dark:text-white">{site.name}</h3>
                          {site.isOwner && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded">
                              <Crown className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{site.slug}</p>
                      </div>
                    </div>
                    <div className="relative">
                      <button
                        onClick={() => setMenuOpen(menuOpen === site.id ? null : site.id)}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                      >
                        <MoreHorizontal className="w-5 h-5" />
                      </button>
                      {menuOpen === site.id && (
                        <>
                          <div
                            className="fixed inset-0 z-10"
                            onClick={() => setMenuOpen(null)}
                          />
                          <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-20">
                            <button
                              onClick={() => {
                                handleOpen(site.id)
                                setMenuOpen(null)
                              }}
                              className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                            >
                              <ExternalLink className="w-4 h-4" />
                              Open Dashboard
                            </button>
                            {site.isOwner && (
                              <>
                                <Link
                                  href={`/account/subscription/${site.id}`}
                                  onClick={() => setMenuOpen(null)}
                                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                                >
                                  <Settings className="w-4 h-4" />
                                  Manage Subscription
                                </Link>
                                <button
                                  onClick={() => {
                                    setDeleteModal({ open: true, site })
                                
                                    setMenuOpen(null)
                                  }}
                                  className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="w-4 h-4" />
                                  Delete Site
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    <span className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2.5 py-1 rounded">
                      <BusinessIcon className="w-3.5 h-3.5" />
                      {getBusinessTypeLabel(site.businessType)}
                    </span>
                    {site.subscription && (
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded ${statusColors.bg} ${statusColors.text}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${statusColors.dot}`}></span>
                        {site.subscription.status === 'trial' ? 'Free Plan' : site.subscription.tierName}
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                    <span className="capitalize">{site.role}</span>
                    <span className="mx-1.5">-</span>
                    <span>Created {new Date(site.createdAt).toLocaleDateString()}</span>
                  </div>

                  <button
                    onClick={() => handleOpen(site.id)}
                    disabled={switching === site.id}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors disabled:opacity-50 font-medium"
                  >
                    {switching === site.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        Open Dashboard
                        <ArrowUpRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal.open && deleteModal.site && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-6">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-14 h-14 bg-red-100 rounded-md flex items-center justify-center">
                  <AlertTriangle className="w-7 h-7 text-red-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Delete Site</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">This action cannot be undone</p>
                </div>
                <button
                  onClick={() => {
                    setDeleteModal({ open: false, site: null })
                    setDeletePassword('')
                
                  }}
                  className="ml-auto p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>

              {deleteModal.site?.subscription && ['trial', 'active', 'past_due'].includes(deleteModal.site.subscription.status) && (
                <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    Your remaining {deleteModal.site.subscription.status === 'trial' ? 'free plan' : 'plan'} time will be saved and applied to your next company.
                  </p>
                </div>
              )}

              <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
                <p className="text-sm text-red-800">
                  <strong>Warning:</strong> Deleting <strong>{deleteModal.site.name}</strong> will permanently remove:
                </p>
                <ul className="mt-2 text-sm text-red-700 list-disc list-inside space-y-1">
                  <li>All customers and their data</li>
                  <li>All sales and payment records</li>
                  <li>All inventory and stock history</li>
                  <li>All work orders and appointments</li>
                  <li>All staff accounts for this site</li>
                </ul>
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Enter your password to confirm
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Your account password"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-red-500 focus:border-red-500 dark:bg-gray-700 dark:text-white"
                  autoFocus
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setDeleteModal({ open: false, site: null })
                    setDeletePassword('')
                
                  }}
                  className="flex-1 px-5 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteSite}
                  disabled={!deletePassword || deleting}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-3 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors disabled:opacity-50 font-medium"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    'Delete Site'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
