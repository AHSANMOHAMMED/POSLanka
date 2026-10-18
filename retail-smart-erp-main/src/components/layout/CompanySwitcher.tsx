'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Building2, ChevronDown, Check, Settings } from 'lucide-react'

interface Company {
  id: string
  name: string
  slug: string
  businessType: string
  status: string
  role: string
  isOwner: boolean
  subscription: {
    status: string
    tierName: string
  } | null
}

interface CompanySwitcherProps {
  currentSlug?: string
}

export function CompanySwitcher({ currentSlug }: CompanySwitcherProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const fetchedRef = useRef(false)

  const fetchCompanies = useCallback(async () => {
    if (!session?.user?.accountId) return
    if (fetchedRef.current) return
    fetchedRef.current = true

    try {
      const res = await fetch('/api/my-companies')
      if (res.ok) {
        const data = await res.json()
        setCompanies(data)
      } else {
        // Allow retry on next mount, but don't retry on every render
        fetchedRef.current = false
      }
    } catch {
      fetchedRef.current = false
    }
  }, [session?.user?.accountId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCompanies()
  }, [fetchCompanies])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSwitchCompany = async (company: Company) => {
    if (company.slug === currentSlug) {
      setOpen(false)
      return
    }

    setSwitching(company.id)
    setOpen(false)
    // Navigate to the company's dashboard
    router.push(`/c/${company.slug}/dashboard`)
  }

  const handleGoToAccount = () => {
    router.push('/account')
    setOpen(false)
  }

  // Don't render if no accountId (legacy users)
  if (!session?.user?.accountId) {
    return null
  }

  // Don't render if only one company
  if (companies.length <= 1) {
    return null
  }

  const currentCompany = companies.find((c) => c.slug === currentSlug)

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-white/10 transition-colors"
      >
        <div className="w-6 h-6 bg-white/15 rounded flex items-center justify-center">
          <Building2 className="w-3.5 h-3.5 text-white/80" />
        </div>
        <span className="text-sm font-medium text-white/90 max-w-[120px] truncate">
          {currentCompany?.name || session?.user?.tenantName}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-white/50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-gray-800 rounded shadow-lg border border-[#dee2e6] dark:border-gray-700 z-50">
          <div className="p-2">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 px-2 py-1">
              Switch Company
            </div>
            <div className="max-h-64 overflow-y-auto">
              {companies.map((company) => {
                const isCurrent = company.slug === currentSlug
                const isDisabled = company.status !== 'active'

                return (
                  <button
                    key={company.id}
                    onClick={() => !isDisabled && handleSwitchCompany(company)}
                    disabled={isDisabled || switching === company.id}
                    className={`w-full flex items-center gap-3 px-2 py-2 rounded text-left transition-colors ${
                      isCurrent
                        ? 'bg-[#e8f0fe] dark:bg-blue-900/30'
                        : isDisabled
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:bg-[#f8f9fa] dark:hover:bg-gray-700'
                    }`}
                  >
                    <div className="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {company.name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 capitalize">
                        {company.role}
                      </div>
                    </div>
                    {isCurrent && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
                    {switching === company.id && (
                      <div className="w-4 h-4 border-2 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full animate-spin" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="border-t border-gray-200 dark:border-gray-700 p-2">
            <button
              onClick={handleGoToAccount}
              className="w-full flex items-center gap-2 px-2 py-2 rounded text-left hover:bg-[#f8f9fa] dark:hover:bg-gray-700 transition-colors"
            >
              <Settings className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <span className="text-sm text-gray-700 dark:text-gray-300">Manage Companies</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
