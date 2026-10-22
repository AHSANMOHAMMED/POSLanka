'use client'

import { useState, useCallback, useEffect } from 'react'
import { Save, Loader2 } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { useRealtimeData, useUnsavedChangesWarning } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ADJUSTMENT_REASON_CODES, ADJUSTMENT_REASON_LABELS } from '@/lib/inventory/adjustment-reasons'

interface PurchasingSettings {
  matchPriceTolerancePct: number
  matchQtyTolerancePct: number
  matchAction: 'warn' | 'block'
  autoReorder: boolean
}
const defaultPurchasing: PurchasingSettings = { matchPriceTolerancePct: 0, matchQtyTolerancePct: 0, matchAction: 'warn', autoReorder: false }

interface Account {
  id: string
  accountNumber: string
  name: string
  rootType: string
  accountType: string
  isGroup: boolean
}

interface CostCenter {
  id: string
  name: string
  parentId: string | null
  isGroup: boolean
  isActive: boolean
}

interface FiscalYear {
  id: string
  name: string
  startDate: string
  endDate: string
  isClosed: boolean
}

interface TaxTemplate {
  id: string
  name: string
  isActive: boolean
}

interface AccountingSettings {
  id?: string
  defaultReceivableAccountId: string | null
  defaultPayableAccountId: string | null
  defaultIncomeAccountId: string | null
  defaultExpenseAccountId: string | null
  defaultCashAccountId: string | null
  defaultBankAccountId: string | null
  defaultTaxAccountId: string | null
  defaultCOGSAccountId: string | null
  defaultRoundOffAccountId: string | null
  defaultStockAccountId: string | null
  defaultWriteOffAccountId: string | null
  defaultAdvanceReceivedAccountId: string | null
  defaultAdvancePaidAccountId: string | null
  defaultSalaryPayableAccountId: string | null
  defaultStatutoryPayableAccountId: string | null
  defaultSalaryExpenseAccountId: string | null
  defaultEmployerContributionAccountId: string | null
  defaultEmployeeAdvanceAccountId: string | null
  defaultGiftCardLiabilityAccountId: string | null
  defaultCashOverShortAccountId: string | null
  defaultTaxTemplateId: string | null
  defaultPurchaseTaxTemplateId: string | null
  defaultCostCenterId: string | null
  defaultStockAdjustmentAccountId: string | null
  defaultSrbnbAccountId: string | null
  defaultPriceVarianceAccountId: string | null
  stockAdjustmentReasonAccounts: Record<string, string> | null
  currentFiscalYearId: string | null
  autoPostSales: boolean
  autoPostPurchases: boolean
}

const defaultSettings: AccountingSettings = {
  defaultReceivableAccountId: null,
  defaultPayableAccountId: null,
  defaultIncomeAccountId: null,
  defaultExpenseAccountId: null,
  defaultCashAccountId: null,
  defaultBankAccountId: null,
  defaultTaxAccountId: null,
  defaultCOGSAccountId: null,
  defaultRoundOffAccountId: null,
  defaultStockAccountId: null,
  defaultWriteOffAccountId: null,
  defaultAdvanceReceivedAccountId: null,
  defaultAdvancePaidAccountId: null,
  defaultSalaryPayableAccountId: null,
  defaultStatutoryPayableAccountId: null,
  defaultSalaryExpenseAccountId: null,
  defaultEmployerContributionAccountId: null,
  defaultEmployeeAdvanceAccountId: null,
  defaultGiftCardLiabilityAccountId: null,
  defaultCashOverShortAccountId: null,
  defaultTaxTemplateId: null,
  defaultPurchaseTaxTemplateId: null,
  defaultCostCenterId: null,
  defaultStockAdjustmentAccountId: null,
  defaultSrbnbAccountId: null,
  defaultPriceVarianceAccountId: null,
  stockAdjustmentReasonAccounts: null,
  currentFiscalYearId: null,
  autoPostSales: false,
  autoPostPurchases: false,
}

export default function AccountingSettingsPage() {
  const [settings, setSettings] = useState<AccountingSettings>(defaultSettings)
  const [savedSettings, setSavedSettings] = useState<AccountingSettings>(defaultSettings)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [taxTemplates, setTaxTemplates] = useState<TaxTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [purchasing, setPurchasing] = useState<PurchasingSettings>(defaultPurchasing)
  const [savedPurchasing, setSavedPurchasing] = useState<PurchasingSettings>(defaultPurchasing)

  const fetchPurchasing = useCallback(async () => {
    try {
      const res = await fetch('/api/purchasing/settings')
      if (res.ok) {
        const data = await res.json()
        setPurchasing(data)
        setSavedPurchasing(data)
      }
    } catch { /* section stays at defaults */ }
  }, [])
  useEffect(() => { fetchPurchasing() }, [fetchPurchasing])

  const hasUnsavedChanges = JSON.stringify(settings) !== JSON.stringify(savedSettings)
    || JSON.stringify(purchasing) !== JSON.stringify(savedPurchasing)
  useUnsavedChangesWarning(hasUnsavedChanges)

  const fetchData = useCallback(async () => {
    try {
      const [settingsRes, accountsRes, fyRes, ccRes, ttRes] = await Promise.all([
        fetch('/api/accounting/settings'),
        fetch('/api/accounting/accounts?all=true'),
        fetch('/api/accounting/fiscal-years?all=true'),
        fetch('/api/accounting/cost-centers?all=true'),
        fetch('/api/accounting/tax-templates?all=true'),
      ])

      if (settingsRes.ok) {
        const data = await settingsRes.json()
        if (data && data.id) {
          setSettings(data)
          setSavedSettings(data)
        }
      }

      if (accountsRes.ok) {
        const data = await accountsRes.json()
        const list = Array.isArray(data) ? data : data.data || []
        setAccounts(list.filter((a: Account) => !a.isGroup))
      }

      if (fyRes.ok) {
        const data = await fyRes.json()
        setFiscalYears(Array.isArray(data) ? data : data.data || [])
      }

      if (ccRes.ok) {
        const data = await ccRes.json()
        const list = Array.isArray(data) ? data : data.data || []
        setCostCenters(list.filter((cc: CostCenter) => !cc.isGroup && cc.isActive))
      }

      if (ttRes.ok) {
        const data = await ttRes.json()
        const list = Array.isArray(data) ? data : data.data || []
        setTaxTemplates(list.filter((tt: TaxTemplate) => tt.isActive))
      }
    } catch {
      toast.error('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  const { refresh } = useRealtimeData(fetchData, {
    entityType: ['account', 'fiscal-year', 'cost-center', 'tax-template'],
  })

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/accounting/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })

      if (res.ok && JSON.stringify(purchasing) !== JSON.stringify(savedPurchasing)) {
        const pRes = await fetch('/api/purchasing/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(purchasing),
        })
        if (pRes.ok) {
          const p = await pRes.json()
          setPurchasing(p)
          setSavedPurchasing(p)
        } else {
          const p = await pRes.json().catch(() => ({}))
          toast.error(p.error || 'Failed to save purchasing settings')
        }
      }
      if (res.ok) {
        const data = await res.json()
        setSettings(data)
        setSavedSettings(data)
        toast.success('Settings saved successfully')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save settings')
      }
    } catch {
      toast.error('Error saving settings')
    } finally {
      setSaving(false)
    }
  }

  function updateSetting(key: keyof AccountingSettings, value: string | boolean | null) {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  function accountsByType(rootType?: string, accountType?: string) {
    return accounts.filter((a) => {
      if (rootType && a.rootType !== rootType) return false
      if (accountType && a.accountType !== accountType) return false
      return true
    })
  }

  if (loading) {
    return <PageLoading text="Loading settings..." />
  }

  const selectClass =
    'w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'

  const accountSelect = (
    label: string,
    key: keyof AccountingSettings,
    filterFn?: () => Account[]
  ) => {
    const options = filterFn ? filterFn() : accounts
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {label}
        </label>
        <select
          value={(settings[key] as string) || ''}
          onChange={(e) => updateSetting(key, e.target.value || null)}
          className={selectClass}
        >
          <option value="">-- Not Set --</option>
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.accountNumber} - {a.name}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <ListPageLayout
      module="Accounting"
      moduleHref="/accounting"
      title="Settings"
      onRefresh={refresh}
      actionContent={
        <div className="flex items-center gap-2">
          {hasUnsavedChanges && (
            <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save Settings
          </button>
        </div>
      }
    >
      <div className="p-4 space-y-6 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 12rem)' }}>
        {/* Fiscal Year Section */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider mb-1">
            Fiscal Year
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Select the active fiscal year for all new transactions
          </p>
          <div className="max-w-md">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Current Fiscal Year
            </label>
            <select
              value={settings.currentFiscalYearId || ''}
              onChange={(e) => updateSetting('currentFiscalYearId', e.target.value || null)}
              className={selectClass}
            >
              <option value="">-- Not Set --</option>
              {fiscalYears
                .filter((fy) => !fy.isClosed)
                .map((fy) => (
                  <option key={fy.id} value={fy.id}>
                    {fy.name} ({new Date(fy.startDate).toLocaleDateString()} - {new Date(fy.endDate).toLocaleDateString()})
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* Default Accounts Section */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider mb-1">
            Default Accounts
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            These accounts are used as defaults when creating transactions
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {accountSelect('Default Receivable Account', 'defaultReceivableAccountId', () =>
              accountsByType('asset', 'receivable')
            )}
            {accountSelect('Default Payable Account', 'defaultPayableAccountId', () =>
              accountsByType('liability', 'payable')
            )}
            {accountSelect('Default Income Account', 'defaultIncomeAccountId', () =>
              accountsByType('income')
            )}
            {accountSelect('Default Expense Account', 'defaultExpenseAccountId', () =>
              accountsByType('expense')
            )}
            {accountSelect('Default Cash Account', 'defaultCashAccountId', () =>
              accountsByType('asset', 'cash')
            )}
            {accountSelect('Default Bank Account', 'defaultBankAccountId', () =>
              accountsByType('asset', 'bank')
            )}
            {accountSelect('Default Tax Account', 'defaultTaxAccountId', () =>
              accountsByType('liability', 'tax')
            )}
            {accountSelect('Default COGS Account', 'defaultCOGSAccountId', () =>
              accountsByType('expense', 'cost_of_goods_sold')
            )}
            {accountSelect('Default Round Off Account', 'defaultRoundOffAccountId', () =>
              accountsByType(undefined, 'round_off')
            )}
            {accountSelect('Default Stock Account', 'defaultStockAccountId', () =>
              accountsByType('asset', 'stock')
            )}
            {accountSelect('Default Write-off Account', 'defaultWriteOffAccountId', () =>
              accountsByType('expense')
            )}
            {accountSelect('Default Advance Received Account', 'defaultAdvanceReceivedAccountId', () =>
              accountsByType('liability')
            )}
            {accountSelect('Default Advance Paid Account', 'defaultAdvancePaidAccountId', () =>
              accountsByType('asset')
            )}
            {accountSelect('Gift Card Liability Account', 'defaultGiftCardLiabilityAccountId', () =>
              accountsByType('liability', 'current_liability')
            )}
          </div>
        </div>

        {/* Default Tax Template Section */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider mb-1">
            Tax Template
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Default tax template applied to items that don&apos;t have their own template assigned
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Default Sales Tax Template
              </label>
              <select
                value={settings.defaultTaxTemplateId || ''}
                onChange={(e) => updateSetting('defaultTaxTemplateId', e.target.value || null)}
                className={selectClass}
              >
                <option value="">-- No Default (Zero Tax) --</option>
                {taxTemplates.map((tt) => (
                  <option key={tt.id} value={tt.id}>
                    {tt.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Default Purchase Tax Template
              </label>
              <select
                value={settings.defaultPurchaseTaxTemplateId || ''}
                onChange={(e) => updateSetting('defaultPurchaseTaxTemplateId', e.target.value || null)}
                className={selectClass}
              >
                <option value="">-- No Default (Zero Tax) --</option>
                {taxTemplates.map((tt) => (
                  <option key={tt.id} value={tt.id}>
                    {tt.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Cost Center & Stock Adjustment Section */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider mb-1">
            Cost Center & Stock Adjustment
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Default cost center and stock adjustment account for transactions
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Default Cost Center
              </label>
              <select
                value={settings.defaultCostCenterId || ''}
                onChange={(e) => updateSetting('defaultCostCenterId', e.target.value || null)}
                className={selectClass}
              >
                <option value="">-- None --</option>
                {costCenters.map((cc) => (
                  <option key={cc.id} value={cc.id}>
                    {cc.name}
                  </option>
                ))}
              </select>
            </div>
            {accountSelect('Stock Adjustment Account', 'defaultStockAdjustmentAccountId', () =>
              accountsByType('expense')
            )}
            {accountSelect('Cash Over/Short Account', 'defaultCashOverShortAccountId', () =>
              accountsByType('expense')
            )}
          </div>
        </div>

        {/* H3: Purchasing & Inventory Section */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider mb-1">
            Purchasing & Inventory
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Goods receipts post Dr Stock / Cr Stock Received But Not Billed; the supplier invoice clears it. Without a price
            variance account, invoice-vs-GRN price differences go into the cost of stock on hand (COGS for goods already sold).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {accountSelect('Stock Received But Not Billed', 'defaultSrbnbAccountId', () => accountsByType('liability'))}
            {accountSelect('Purchase Price Variance Account (optional)', 'defaultPriceVarianceAccountId', () => accountsByType('expense'))}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">3-way match: price tolerance (%)</label>
              <input type="number" min={0} step="0.1" className={selectClass} value={purchasing.matchPriceTolerancePct}
                onChange={(e) => setPurchasing((p) => ({ ...p, matchPriceTolerancePct: Number(e.target.value) || 0 }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">3-way match: quantity tolerance (%)</label>
              <input type="number" min={0} step="0.1" className={selectClass} value={purchasing.matchQtyTolerancePct}
                onChange={(e) => setPurchasing((p) => ({ ...p, matchQtyTolerancePct: Number(e.target.value) || 0 }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">On 3-way mismatch</label>
              <select className={selectClass} value={purchasing.matchAction}
                onChange={(e) => setPurchasing((p) => ({ ...p, matchAction: e.target.value === 'block' ? 'block' : 'warn' }))}>
                <option value="warn">Warn (submit and flag the invoice)</option>
                <option value="block">Block submitting the invoice</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 mt-6">
              <input type="checkbox" checked={purchasing.autoReorder}
                onChange={(e) => setPurchasing((p) => ({ ...p, autoReorder: e.target.checked }))} />
              Auto reorder: create draft purchase requisitions daily for items at or below minimum stock
            </label>
          </div>
          <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider mt-5 mb-2">
            Stock adjustment account per reason (optional — falls back to the Stock Adjustment account)
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {ADJUSTMENT_REASON_CODES.map((code) => (
              <div key={code}>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{ADJUSTMENT_REASON_LABELS[code]}</label>
                <select
                  className={selectClass}
                  value={settings.stockAdjustmentReasonAccounts?.[code] || ''}
                  onChange={(e) => setSettings((prev) => {
                    const next = { ...(prev.stockAdjustmentReasonAccounts || {}) }
                    if (e.target.value) next[code] = e.target.value
                    else delete next[code]
                    return { ...prev, stockAdjustmentReasonAccounts: Object.keys(next).length ? next : null }
                  })}
                >
                  <option value="">-- Default --</option>
                  {accountsByType('expense').map((a) => (
                    <option key={a.id} value={a.id}>{a.accountNumber} - {a.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* Payroll Accounts Section */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider mb-1">
            Payroll Accounts
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Default accounts used when processing salary slips and employee advances
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {accountSelect('Salary Expense Account', 'defaultSalaryExpenseAccountId', () =>
              accountsByType('expense')
            )}
            {accountSelect('Salary Payable Account', 'defaultSalaryPayableAccountId', () =>
              accountsByType('liability')
            )}
            {accountSelect('Statutory Payable Account', 'defaultStatutoryPayableAccountId', () =>
              accountsByType('liability')
            )}
            {accountSelect('Employer Contribution Account', 'defaultEmployerContributionAccountId', () =>
              accountsByType('expense')
            )}
            {accountSelect('Employee Advance Account', 'defaultEmployeeAdvanceAccountId', () =>
              accountsByType('asset')
            )}
          </div>
        </div>

        {/* Auto-Posting Section */}
        <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider mb-1">
            Auto-Posting
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Automatically create GL entries when documents are submitted
          </p>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoPostSales}
                onChange={(e) => updateSetting('autoPostSales', e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  Auto-post sales to General Ledger
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Automatically create GL entries when sales are completed
                </p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoPostPurchases}
                onChange={(e) => updateSetting('autoPostPurchases', e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  Auto-post purchases to General Ledger
                </span>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Automatically create GL entries when purchases are recorded
                </p>
              </div>
            </label>
          </div>
        </div>
      </div>
    </ListPageLayout>
  )
}
