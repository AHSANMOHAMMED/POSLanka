'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Landmark, Plus, X, Star, Building2, Info, CreditCard } from 'lucide-react'
import type { SetupWizardData, BankAccountInput } from '@/lib/setup/create-seed-data'
import { useStepSuggestions } from './useStepSuggestions'
import { AISuggestionBanner } from './AISuggestionChip'
import { FormInput } from '@/components/ui/form-elements'

interface StepAccountingProps {
  data: SetupWizardData
  companySlug: string
  businessType: string
  country: string
  countryName: string
  currency: string
  companyName: string
  aiEnabled?: boolean
  onChange: (updates: Partial<SetupWizardData>) => void
}

const TABS = [
  { id: 'cost-centers', label: 'Cost Centers', icon: Landmark },
  { id: 'bank-accounts', label: 'Bank Accounts', icon: Building2 },
] as const

type TabId = typeof TABS[number]['id']

export function StepAccounting({ data, companySlug, businessType, country, countryName, currency, companyName, aiEnabled, onChange }: StepAccountingProps) {
  const [activeTab, setActiveTab] = useState<TabId>('cost-centers')
  const [visitedTabs, setVisitedTabs] = useState<Set<TabId>>(new Set(['cost-centers']))

  const handleTabClick = (tabId: TabId) => {
    setActiveTab(tabId)
    setVisitedTabs(prev => {
      const next = new Set(prev)
      next.add(tabId)
      return next
    })
  }

  const costCenters = data.costCenters || ['Main']
  const defaultCostCenter = data.defaultCostCenter || costCenters[0] || ''
  const bankAccounts: BankAccountInput[] = data.bankAccounts || []

  const { suggestions, loading, dismissed, dismiss } = useStepSuggestions<{ suggestedCenters: string[] }>({
    step: 'cost_centers',
    context: { businessType, country, countryName, currency, companyName },
    companySlug,
    enabled: aiEnabled,
  })

  // Cost Center Handlers
  const updateCostCenter = (index: number, value: string) => {
    const updated = [...costCenters]
    const oldName = updated[index]
    updated[index] = value
    const updates: Partial<SetupWizardData> = { costCenters: updated }
    if (defaultCostCenter === oldName) {
      updates.defaultCostCenter = value
    }
    onChange(updates)
  }

  const addCostCenter = () => {
    if (costCenters.length >= 10) return
    onChange({ costCenters: [...costCenters, ''] })
  }

  const removeCostCenter = (index: number) => {
    if (costCenters.length <= 1) return
    const removedName = costCenters[index]
    const updated = costCenters.filter((_, i) => i !== index)
    const updates: Partial<SetupWizardData> = { costCenters: updated }
    if (defaultCostCenter === removedName) {
      updates.defaultCostCenter = updated[0] || ''
    }
    onChange(updates)
  }

  const setDefaultCostCenter = (name: string) => {
    onChange({ defaultCostCenter: name })
  }

  // Bank Account Handlers
  const addBankAccount = () => {
    if (bankAccounts.length >= 5) return
    const newAccount: BankAccountInput = {
      accountName: '',
      bankName: '',
      accountNumber: '',
      isDefault: bankAccounts.length === 0,
    }
    onChange({ bankAccounts: [...bankAccounts, newAccount] })
  }

  const updateBankAccount = (index: number, updates: Partial<BankAccountInput>) => {
    const updated = [...bankAccounts]
    updated[index] = { ...updated[index], ...updates }
    onChange({ bankAccounts: updated })
  }

  const removeBankAccount = (index: number) => {
    const wasDefault = bankAccounts[index].isDefault
    const updated = bankAccounts.filter((_, i) => i !== index)
    if (wasDefault && updated.length > 0) {
      updated[0] = { ...updated[0], isDefault: true }
    }
    onChange({ bankAccounts: updated })
  }

  const setBankAccountDefault = (index: number) => {
    const updated = bankAccounts.map((acc, i) => ({
      ...acc,
      isDefault: i === index,
    }))
    onChange({ bankAccounts: updated })
  }

  const tabBadges: Record<TabId, number> = {
    'cost-centers': costCenters.length,
    'bank-accounts': bankAccounts.length,
  }

  return (
    <div className="space-y-5">
      {/* Step Header */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">
          Accounting Setup
        </h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
          Configure cost centers and bank accounts for your business.
        </p>
      </div>

      {/* Tab Bar — Pill Style */}
      <div className="inline-flex p-1 bg-gray-100/80 dark:bg-gray-800/60 rounded-xl gap-1">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          const isUnvisited = !visitedTabs.has(tab.id)
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabClick(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 relative ${
                isActive
                  ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
              {tabBadges[tab.id] > 0 && (
                <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-md text-[10px] font-bold ${
                  isActive
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                    : 'bg-gray-200/80 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                }`}>
                  {tabBadges[tab.id]}
                </span>
              )}
              {isUnvisited && !isActive && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              )}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'cost-centers' && (
            <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white dark:bg-slate-800/40 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/30">
                  <Landmark size={16} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Cost Centers</h3>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">Organize expenses by department or location</p>
                </div>
              </div>

              {/* AI suggestion banner */}
              {!dismissed.has('costCenters') && (
                <AISuggestionBanner
                  items={suggestions?.suggestedCenters || []}
                  loading={loading}
                  itemLabel="cost centers"
                  onApplyAll={() => {
                    if (suggestions?.suggestedCenters) {
                      onChange({
                        costCenters: suggestions.suggestedCenters,
                        defaultCostCenter: suggestions.suggestedCenters[0] || '',
                      })
                    }
                  }}
                  onDismiss={() => dismiss('costCenters')}
                />
              )}

              <div className="space-y-2">
                {costCenters.map((name, index) => (
                  <div key={index} className="flex items-center gap-2 group">
                    <button
                      type="button"
                      onClick={() => setDefaultCostCenter(name)}
                      className={`p-1.5 rounded-lg transition-all ${
                        defaultCostCenter === name && name.trim()
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-gray-300 dark:text-gray-600 hover:text-blue-400'
                      }`}
                      title={defaultCostCenter === name ? 'Default' : 'Set as default'}
                    >
                      <Star size={14} fill={defaultCostCenter === name && name.trim() ? 'currentColor' : 'none'} />
                    </button>
                    <FormInput
                      value={name}
                      onChange={(e) => updateCostCenter(index, e.target.value)}
                      className="flex-1"
                      placeholder="Cost center name"
                    />
                    <button
                      type="button"
                      onClick={() => removeCostCenter(index)}
                      disabled={costCenters.length <= 1}
                      className="p-2 rounded-lg text-gray-300 group-hover:text-gray-400 hover:!text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
                      title="Remove"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addCostCenter}
                  disabled={costCenters.length >= 10}
                  className="w-full py-2.5 border-2 border-dashed border-gray-200 dark:border-gray-700/50 rounded-xl text-sm text-gray-400 dark:text-gray-500 hover:border-blue-300 hover:text-blue-600 dark:hover:border-blue-700 dark:hover:text-blue-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                  <Plus size={14} />
                  Add Cost Center
                </button>
              </div>

              {/* Reminder to check other tab */}
              {!visitedTabs.has('bank-accounts') && (
                <div className="mt-4 p-3 bg-blue-50/60 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/50 rounded-lg text-sm text-blue-600 dark:text-blue-300 flex items-center gap-2.5">
                  <Info size={15} className="flex-shrink-0" />
                  <span>
                    Remember to configure your <strong>Bank Accounts</strong> in the tab above.
                  </span>
                </div>
              )}
            </div>
          )}

          {activeTab === 'bank-accounts' && (
            <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white dark:bg-slate-800/40 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-900/30">
                  <Building2 size={16} className="text-teal-600 dark:text-teal-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Bank Accounts</h3>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">Connect your business bank accounts</p>
                </div>
              </div>

              <div className="space-y-3">
                {bankAccounts.map((account, index) => (
                  <div
                    key={index}
                    className={`rounded-xl border p-4 transition-all duration-200 ${
                      account.isDefault
                        ? 'border-blue-200 dark:border-blue-800/60 bg-gradient-to-r from-blue-50/60 to-transparent dark:from-blue-950/20 dark:to-transparent'
                        : 'border-gray-200/60 dark:border-gray-700/40 bg-gray-50/40 dark:bg-slate-800/30'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 space-y-2.5">
                        <FormInput
                          value={account.accountName}
                          onChange={(e) => updateBankAccount(index, { accountName: e.target.value })}
                          placeholder="Account name *"
                        />
                        <div className="grid grid-cols-3 gap-2.5">
                          <FormInput
                            value={account.bankName || ''}
                            onChange={(e) => updateBankAccount(index, { bankName: e.target.value })}
                            placeholder="Bank name"
                          />
                          <FormInput
                            value={account.accountNumber || ''}
                            onChange={(e) => updateBankAccount(index, { accountNumber: e.target.value })}
                            placeholder="Account number"
                          />
                          <FormInput
                            value={account.branchCode || ''}
                            onChange={(e) => updateBankAccount(index, { branchCode: e.target.value })}
                            placeholder="Branch code"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-1 pt-1">
                        {account.isDefault ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                            <Star size={10} fill="currentColor" />
                            Default
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setBankAccountDefault(index)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-all"
                            title="Set as default"
                          >
                            <Star size={12} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeBankAccount(index)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all"
                          title="Remove"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addBankAccount}
                  disabled={bankAccounts.length >= 5}
                  className="w-full py-2.5 border-2 border-dashed border-gray-200 dark:border-gray-700/50 rounded-xl text-sm text-gray-400 dark:text-gray-500 hover:border-blue-300 hover:text-blue-600 dark:hover:border-blue-700 dark:hover:text-blue-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                >
                  <Plus size={14} />
                  Add Bank Account
                </button>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Modes of Payment info */}
      <div className="flex items-start gap-3 px-4 py-3 bg-blue-50/60 dark:bg-blue-900/15 border border-blue-100 dark:border-blue-800/40 rounded-xl">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex-shrink-0">
          <CreditCard size={14} className="text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Modes of Payment</p>
          <p className="text-xs text-blue-600/80 dark:text-blue-400/80 mt-0.5 leading-relaxed">
            4 standard modes (Cash, Bank Transfer, Credit Card, Cheque) will be created automatically during setup, linked to your Chart of Accounts.
          </p>
        </div>
      </div>
    </div>
  )
}
