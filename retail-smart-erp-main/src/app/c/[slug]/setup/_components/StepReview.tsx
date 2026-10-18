'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { AlertCircle, FolderOpen, Users, Warehouse, Banknote, Calendar, FileText, Tag, Landmark, Info } from 'lucide-react'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'

interface StepReviewProps {
  data: SetupWizardData
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  companyInfo: any
}

export function StepReview({ data, companyInfo }: StepReviewProps) {
  const [showDetails, setShowDetails] = useState<Record<string, boolean>>({})

  const toggleDetails = (section: string) => {
    setShowDetails(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const businessType = companyInfo?.businessType || 'retail'
  const categoryCount = data.selectedCategories?.length || 0
  const costCenters = data.costCenters || []
  const defaultCostCenter = data.defaultCostCenter || costCenters[0] || ''

  // Build categories summary based on business type
  const categorySummary = (() => {
    const parts: string[] = [`${categoryCount} categor${categoryCount !== 1 ? 'ies' : 'y'}`]
    if (businessType === 'restaurant') {
      parts.push(`${data.numberOfTables || 10} tables`)
      if (data.tableAreas?.length) parts.push(`${data.tableAreas.length} area${data.tableAreas.length !== 1 ? 's' : ''}`)
    }
    if ((businessType === 'auto_service' || businessType === 'dealership') && data.selectedServiceGroups?.length) {
      parts.push(`${data.selectedServiceGroups.length} service group${data.selectedServiceGroups.length !== 1 ? 's' : ''}`)
    }
    return parts.join(' • ')
  })()

  // Format sections for review
  const sections = [
    {
      key: 'company',
      title: 'Company Information',
      icon: <FolderOpen size={18} />,
      summary: `${companyInfo?.name || 'Company'} • ${businessType.replace('_', ' ')} • ${data.logoUrl ? 'Logo uploaded' : 'No logo'}`,
      details: (
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="text-gray-500">Company Name:</div>
            <div className="font-medium">{companyInfo?.name}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-gray-500">Business Type:</div>
            <div className="font-medium capitalize">{businessType.replace('_', ' ')}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-gray-500">COA Template:</div>
            <div className="font-medium">{data.coaTemplate === 'numbered' ? 'Numbered' : 'Unnumbered'}</div>
          </div>
          {data.timezone && (
            <div className="grid grid-cols-2 gap-2">
              <div className="text-gray-500">Timezone:</div>
              <div className="font-medium">{data.timezone}</div>
            </div>
          )}
        </div>
      )
    },
    {
      key: 'categories',
      title: 'Categories & Services',
      icon: <Tag size={18} />,
      summary: categorySummary,
      details: (
        <div className="space-y-3 text-sm">
          {/* Selected categories */}
          {categoryCount > 0 ? (
            <div>
              <div className="text-gray-500 mb-2">Selected Categories:</div>
              <div className="flex flex-wrap gap-1.5">
                {data.selectedCategories.map((cat) => (
                  <span key={cat} className="px-2 py-1 bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 text-xs rounded border border-blue-200 dark:border-blue-800">
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-gray-500">No categories selected</p>
          )}

          {/* Restaurant-specific */}
          {businessType === 'restaurant' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="text-gray-500">Number of Tables:</div>
                <div className="font-medium">{data.numberOfTables || 10}</div>
              </div>
              {data.tableAreas && data.tableAreas.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-gray-500">Table Areas:</div>
                  <div className="font-medium">{data.tableAreas.join(', ')}</div>
                </div>
              )}
            </>
          )}

          {/* Auto service / dealership */}
          {(businessType === 'auto_service' || businessType === 'dealership') && (
            <>
              {data.selectedServiceGroups && data.selectedServiceGroups.length > 0 && (
                <div>
                  <div className="text-gray-500 mb-1">Service Groups:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {data.selectedServiceGroups.map((g) => (
                      <span key={g.name} className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded">
                        {g.name} ({g.services.length})
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {data.defaultLaborRate !== undefined && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-gray-500">Default Labor Rate:</div>
                  <div className="font-medium">{data.defaultLaborRate}/hr</div>
                </div>
              )}
            </>
          )}
        </div>
      )
    },
    {
      key: 'fiscal',
      title: 'Fiscal Year',
      icon: <Calendar size={18} />,
      summary: `${data.fiscalYearName || 'FY'} • ${data.fiscalYearStart ? new Date(data.fiscalYearStart).toLocaleDateString() : 'Not set'} to ${data.fiscalYearEnd ? new Date(data.fiscalYearEnd).toLocaleDateString() : 'Not set'}`,
      details: data.fiscalYearStart && data.fiscalYearEnd ? (
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="text-gray-500">Fiscal Year:</div>
            <div className="font-medium">{data.fiscalYearName || `FY ${new Date(data.fiscalYearStart).getFullYear()}`}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-gray-500">Start Date:</div>
            <div className="font-medium">{new Date(data.fiscalYearStart).toLocaleDateString()}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-gray-500">End Date:</div>
            <div className="font-medium">{new Date(data.fiscalYearEnd).toLocaleDateString()}</div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-500">Not configured</p>
      )
    },
    {
      key: 'warehouses',
      title: 'Warehouses',
      icon: <Warehouse size={18} />,
      summary: `${data.warehouses?.length || 1} warehouse${(data.warehouses?.length || 1) !== 1 ? 's' : ''} • ${data.warehouses?.find(w => w.isDefault) ? 'Default set' : 'No default'}`,
      details: data.warehouses && data.warehouses.length > 0 ? (
        <div className="space-y-3">
          {data.warehouses.map((warehouse, index) => (
            <div key={index} className={`p-3 rounded border ${warehouse.isDefault ? 'border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800' : 'border-gray-200 dark:border-gray-700'}`}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium">{warehouse.name}</div>
                  <div className="text-sm text-gray-500">Code: {warehouse.code}</div>
                  {warehouse.address && <div className="text-sm text-gray-500 mt-1">{warehouse.address}</div>}
                </div>
                {warehouse.isDefault && (
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 text-xs rounded-full">
                    Default
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-3 rounded border border-gray-200 dark:border-gray-700">
          <div className="font-medium">Main Warehouse</div>
          <div className="text-sm text-gray-500">Default warehouse created during setup</div>
        </div>
      )
    },
    {
      key: 'cost-centers',
      title: 'Cost Centers',
      icon: <Landmark size={18} />,
      summary: `${costCenters.length || 1} cost center${(costCenters.length || 1) !== 1 ? 's' : ''} • Default: ${defaultCostCenter || 'Main'}`,
      details: costCenters.length > 0 ? (
        <div className="space-y-1.5">
          {costCenters.filter(Boolean).map((cc) => (
            <div key={cc} className={`px-3 py-2 rounded border text-sm ${cc === defaultCostCenter ? 'border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800' : 'border-gray-200 dark:border-gray-700'}`}>
              <div className="flex justify-between items-center">
                <span className="font-medium">{cc}</span>
                {cc === defaultCostCenter && (
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 text-xs rounded-full">
                    Default
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-3 rounded border border-gray-200 dark:border-gray-700">
          <div className="font-medium">Main</div>
          <div className="text-sm text-gray-500">Default cost center created during setup</div>
        </div>
      )
    },
    {
      key: 'bank',
      title: 'Bank Accounts',
      icon: <Banknote size={18} />,
      summary: `${data.bankAccounts?.length || 0} account${data.bankAccounts?.length !== 1 ? 's' : ''} • ${data.bankAccounts?.find(b => b.isDefault) ? 'Default set' : 'No default'}`,
      details: data.bankAccounts && data.bankAccounts.length > 0 ? (
        <div className="space-y-3">
          {data.bankAccounts.map((account, index) => (
            <div key={index} className={`p-3 rounded border ${account.isDefault ? 'border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800' : 'border-gray-200 dark:border-gray-700'}`}>
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium">{account.accountName}</div>
                  {account.bankName && <div className="text-sm text-gray-500">{account.bankName}</div>}
                  {account.accountNumber && <div className="text-sm text-gray-500">Account: {account.accountNumber}</div>}
                  {account.branchCode && <div className="text-sm text-gray-500">Branch: {account.branchCode}</div>}
                </div>
                {account.isDefault && (
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 text-xs rounded-full">
                    Default
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500">No bank accounts configured</p>
      )
    },
    {
      key: 'users',
      title: 'Users & Permissions',
      icon: <Users size={18} />,
      summary: `${(data.users?.length || 0) + 1} user${(data.users?.length || 0) + 1 !== 1 ? 's' : ''} (including you)${data.users?.some(u => u.sendInvite) ? ' • Invites to send' : ''}`,
      details: (
        <div className="space-y-3">
          {/* Owner (always present) */}
          <div className="p-3 rounded border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800">
            <div className="flex justify-between items-center">
              <div>
                <div className="font-medium text-sm">You (Owner)</div>
                <div className="text-sm text-gray-500 capitalize">Role: Owner</div>
              </div>
            </div>
          </div>
          {data.users && data.users.length > 0 ? (
            data.users.map((user, index) => (
              <div key={index} className="p-3 rounded border border-gray-200 dark:border-gray-700">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium text-sm">{user.email}</div>
                    <div className="text-sm text-gray-500 capitalize mt-0.5">Role: {user.role.replace('_', ' ')}</div>
                  </div>
                  {user.sendInvite && (
                    <span className="px-2 py-1 bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 text-xs rounded-full">
                      Invite
                    </span>
                  )}
                </div>
              </div>
            ))
          ) : null}
        </div>
      )
    },
    {
      key: 'pos',
      title: 'POS & Payments',
      icon: <FileText size={18} />,
      summary: `${data.paymentMethods?.length || 1} POS method${(data.paymentMethods?.length || 1) !== 1 ? 's' : ''} • ${data.posProfileName || 'Default POS'}`,
      details: (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="text-gray-500">POS Profile:</div>
            <div className="font-medium">{data.posProfileName || 'Default POS'}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-gray-500">Receipt Format:</div>
            <div className="font-medium">{data.receiptFormat || '80mm'}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-gray-500">POS Payment Methods:</div>
            <div className="font-medium">
              {(data.paymentMethods || ['cash']).map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(', ')}
            </div>
          </div>
          <div className="mt-2 p-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded flex items-start gap-2">
            <Info size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-blue-700 dark:text-blue-300">
              4 standard modes of payment (Cash, Bank Transfer, Credit Card, Cheque) will be created automatically, linked to your Chart of Accounts.
            </span>
          </div>
        </div>
      )
    }
  ]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">
          Review & Complete
        </h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
          Review your configuration before completing setup.
        </p>
      </div>

      {/* Configuration Review */}
      <div className="space-y-2">
        {sections.map((section, index) => (
          <motion.div
            key={section.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.06 }}
            className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white dark:bg-slate-800/40 overflow-hidden"
          >
            <button
              type="button"
              onClick={() => toggleDetails(section.key)}
              className="w-full px-4 py-3.5 text-left hover:bg-gray-50/50 dark:hover:bg-slate-800/60 transition-colors flex items-center justify-between group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-gray-100/80 dark:bg-gray-800/60 flex items-center justify-center flex-shrink-0 text-gray-500 dark:text-gray-400 group-hover:text-blue-500 transition-colors">
                  {section.icon}
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                    {section.title}
                  </h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                    {section.summary}
                  </p>
                </div>
              </div>
              <div className={`text-gray-300 dark:text-gray-600 transition-transform duration-200 flex-shrink-0 ml-2 ${showDetails[section.key] ? 'rotate-180' : ''}`}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
            </button>

            {showDetails[section.key] && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700/40 pt-3"
              >
                {section.details}
              </motion.div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Important Notes */}
      <div className="rounded-xl border border-amber-200/60 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-900/15 p-4">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex-shrink-0">
            <AlertCircle size={14} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Before you complete</p>
            <ul className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-1.5 space-y-1 leading-relaxed">
              <li>Once completed, you cannot modify settings through the wizard</li>
              <li>Most settings can be changed later from the settings pages</li>
              <li>Setup may take a few moments to create all data</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}