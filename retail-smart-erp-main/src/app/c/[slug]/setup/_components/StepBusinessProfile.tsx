'use client'

import { useEffect, useMemo, useState } from 'react'
import { Building2, DollarSign, BookOpen, Calendar, ChevronRight, ChevronDown, Folder, FolderOpen, FileText } from 'lucide-react'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'
import { getChartOfAccountsForBusinessType, type AccountTemplate } from '@/lib/accounting/default-coa'
import { useStepSuggestions } from './useStepSuggestions'
// AI suggestions are used for fiscal year pre-fill only (tax moved to settings)
import { LogoUpload } from '@/components/ui/logo-upload'
import { FormInput, FormField, FormSelect } from '@/components/ui/form-elements'

interface StepBusinessProfileProps {
  data: SetupWizardData
  currency: string
  country: string
  countryName: string
  businessType: string
  companySlug: string
  aiEnabled?: boolean
  onChange: (updates: Partial<SetupWizardData>) => void
}

interface AISuggestion {
  fiscalYearStart?: string
  fiscalYearEnd?: string
  fiscalYearName?: string
}

function countAccounts(templates: AccountTemplate[]): number {
  let count = 0
  for (const t of templates) {
    if (!t.isGroup) count++
    if (t.children) count += countAccounts(t.children)
  }
  return count
}

function CoATreeNode({ account, numbered, depth = 0 }: { account: AccountTemplate; numbered: boolean; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 1)
  const hasChildren = account.isGroup && account.children && account.children.length > 0

  const label = numbered && account.accountNumber
    ? `${account.accountNumber} - ${account.name}`
    : account.name

  if (!hasChildren) {
    return (
      <div className="flex items-center gap-1.5 py-0.5" style={{ paddingLeft: `${depth * 16}px` }}>
        <FileText size={12} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
        <span className="text-xs text-gray-700 dark:text-gray-300 truncate">{label}</span>
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 py-0.5 w-full text-left hover:bg-gray-100 dark:hover:bg-slate-700/50 rounded transition-colors"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        {expanded
          ? <ChevronDown size={12} className="text-gray-400 flex-shrink-0" />
          : <ChevronRight size={12} className="text-gray-400 flex-shrink-0" />
        }
        {expanded
          ? <FolderOpen size={12} className="text-blue-500 flex-shrink-0" />
          : <Folder size={12} className="text-blue-500 flex-shrink-0" />
        }
        <span className="text-xs font-medium text-gray-900 dark:text-white truncate">{label}</span>
      </button>
      {expanded && account.children?.map((child) => (
        <CoATreeNode key={child.accountNumber} account={child} numbered={numbered} depth={depth + 1} />
      ))}
    </div>
  )
}

const COMMON_TIMEZONES = [
  { value: 'Pacific/Midway', label: '(UTC-11:00) Midway Island' },
  { value: 'Pacific/Honolulu', label: '(UTC-10:00) Hawaii' },
  { value: 'America/Anchorage', label: '(UTC-09:00) Alaska' },
  { value: 'America/Los_Angeles', label: '(UTC-08:00) Pacific Time (US)' },
  { value: 'America/Denver', label: '(UTC-07:00) Mountain Time (US)' },
  { value: 'America/Chicago', label: '(UTC-06:00) Central Time (US)' },
  { value: 'America/New_York', label: '(UTC-05:00) Eastern Time (US)' },
  { value: 'America/Sao_Paulo', label: '(UTC-03:00) Brasilia' },
  { value: 'Atlantic/Azores', label: '(UTC-01:00) Azores' },
  { value: 'Europe/London', label: '(UTC+00:00) London, Dublin' },
  { value: 'Europe/Paris', label: '(UTC+01:00) Paris, Berlin, Rome' },
  { value: 'Europe/Istanbul', label: '(UTC+03:00) Istanbul' },
  { value: 'Asia/Dubai', label: '(UTC+04:00) Dubai, Abu Dhabi' },
  { value: 'Asia/Karachi', label: '(UTC+05:00) Karachi' },
  { value: 'Asia/Colombo', label: '(UTC+05:30) Sri Lanka' },
  { value: 'Asia/Kolkata', label: '(UTC+05:30) India' },
  { value: 'Asia/Dhaka', label: '(UTC+06:00) Dhaka' },
  { value: 'Asia/Bangkok', label: '(UTC+07:00) Bangkok, Jakarta' },
  { value: 'Asia/Singapore', label: '(UTC+08:00) Singapore, Kuala Lumpur' },
  { value: 'Asia/Shanghai', label: '(UTC+08:00) Beijing, Shanghai' },
  { value: 'Asia/Tokyo', label: '(UTC+09:00) Tokyo, Seoul' },
  { value: 'Australia/Sydney', label: '(UTC+10:00) Sydney, Melbourne' },
  { value: 'Pacific/Auckland', label: '(UTC+12:00) Auckland' },
]

function computeFiscalYearEnd(startDate: string): string {
  if (!startDate) return ''
  const start = new Date(startDate)
  if (isNaN(start.getTime())) return ''
  // End = start + 1 year - 1 day
  const end = new Date(start)
  end.setFullYear(end.getFullYear() + 1)
  end.setDate(end.getDate() - 1)
  return end.toISOString().split('T')[0]
}

function computeFiscalYearName(startDate: string, endDate: string): string {
  if (!startDate || !endDate) return ''
  const startYear = new Date(startDate).getFullYear()
  const endYear = new Date(endDate).getFullYear()
  if (isNaN(startYear) || isNaN(endYear)) return ''
  if (startYear === endYear) return `FY ${startYear}`
  return `FY ${startYear}-${endYear}`
}

export function StepBusinessProfile({
  data,
  currency,
  country,
  countryName,
  businessType,
  companySlug,
  aiEnabled,
  onChange,
}: StepBusinessProfileProps) {
  const coaTemplate = data.coaTemplate || 'numbered'
  const coaTree = useMemo(() => getChartOfAccountsForBusinessType(businessType), [businessType])
  const totalAccounts = useMemo(() => countAccounts(coaTree), [coaTree])

  const { suggestions } = useStepSuggestions<AISuggestion>({
    step: 'business_profile',
    context: { businessType, country, countryName, currency },
    companySlug,
    enabled: aiEnabled,
  })

  // Auto-detect timezone from browser if not already set
  useEffect(() => {
    if (!data.timezone) {
      try {
        const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
        if (detected) {
          onChange({ timezone: detected })
        }
      } catch {
        // Fallback handled by server default
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Default fiscal year start to Jan 1 of current year if not set
  useEffect(() => {
    if (!data.fiscalYearStart) {
      const defaultStart = `${new Date().getFullYear()}-01-01`
      const defaultEnd = computeFiscalYearEnd(defaultStart)
      onChange({
        fiscalYearStart: defaultStart,
        fiscalYearEnd: defaultEnd,
        fiscalYearName: computeFiscalYearName(defaultStart, defaultEnd),
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pre-fill fiscal year start from AI if not already changed by user
  useEffect(() => {
    if (!suggestions?.fiscalYearStart) return
    if (data.fiscalYearStart && data.fiscalYearStart !== `${new Date().getFullYear()}-01-01`) return // User already changed it
    const start = suggestions.fiscalYearStart
    const end = computeFiscalYearEnd(start)
    onChange({
      fiscalYearStart: start,
      fiscalYearEnd: end,
      fiscalYearName: computeFiscalYearName(start, end),
    })
  }, [suggestions, data.fiscalYearStart, onChange])

  // Auto-compute end date + name when start changes
  const fiscalYearEnd = useMemo(() => computeFiscalYearEnd(data.fiscalYearStart || ''), [data.fiscalYearStart])
  const fiscalYearName = useMemo(() => computeFiscalYearName(data.fiscalYearStart || '', fiscalYearEnd), [data.fiscalYearStart, fiscalYearEnd])

  // Keep end date and name in sync with wizard data
  useEffect(() => {
    if (!fiscalYearEnd || !fiscalYearName) return
    if (fiscalYearEnd !== data.fiscalYearEnd || fiscalYearName !== data.fiscalYearName) {
      onChange({ fiscalYearEnd, fiscalYearName })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fiscalYearEnd, fiscalYearName])

  return (
    <div className="space-y-5">
      {/* Step Header */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">
          Business Profile
        </h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
          Configure the core settings for your business.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Company Branding Section */}
        <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white dark:bg-slate-800/40 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-900/30">
              <Building2 size={16} className="text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Company Branding</h3>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">Logo for invoices, receipts, and reports</p>
            </div>
          </div>
          <LogoUpload
            currentLogoUrl={data.logoUrl}
            onLogoUploaded={(logoUrl) => onChange({ logoUrl })}
            onLogoRemoved={() => onChange({ logoUrl: undefined })}
            showRemoveButton={false}
            maxSizeMB={2}
            autoUpload
          />
        </div>

        {/* Fiscal Year Section */}
        <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white dark:bg-slate-800/40 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/30">
              <Calendar size={16} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Fiscal Year</h3>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">End date is auto-calculated (12 months)</p>
            </div>
          </div>
          <FormField label="Start Date" required>
            <FormInput
              type="date"
              value={data.fiscalYearStart || ''}
              onChange={(e) => onChange({ fiscalYearStart: e.target.value })}
              leftIcon={<Calendar size={16} />}
              required
            />
          </FormField>
          {data.fiscalYearStart && fiscalYearEnd && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="px-3 py-2.5 bg-gray-50 dark:bg-slate-800/60 rounded-lg">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium">Period</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">{fiscalYearName}</div>
              </div>
              <div className="px-3 py-2.5 bg-gray-50 dark:bg-slate-800/60 rounded-lg">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium">Ends</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white mt-0.5">
                  {new Date(fiscalYearEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Accounting Settings Section */}
      <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white dark:bg-slate-800/40 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30">
            <DollarSign size={16} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Accounting Settings</h3>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Currency and chart of accounts configuration</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Currency" hint="Set during company creation">
            <FormInput
              type="text"
              value={currency || 'LKR'}
              disabled
              leftIcon={<DollarSign size={16} />}
            />
          </FormField>
          <FormField label="Timezone">
            <FormSelect
              value={data.timezone || 'Asia/Colombo'}
              onChange={(e) => onChange({ timezone: e.target.value })}
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
              {/* Include detected timezone if not in the common list */}
              {data.timezone && !COMMON_TIMEZONES.some(tz => tz.value === data.timezone) && (
                <option value={data.timezone}>{data.timezone}</option>
              )}
            </FormSelect>
          </FormField>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <FormField label="Chart of Accounts Template">
            <FormSelect
              value={coaTemplate}
              onChange={(e) => onChange({ coaTemplate: e.target.value as 'numbered' | 'unnumbered' })}
            >
              <option value="numbered">Numbered (Recommended)</option>
              <option value="unnumbered">Unnumbered</option>
            </FormSelect>
          </FormField>
        </div>
      </div>

      {/* Chart of Accounts Preview */}
      <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white dark:bg-slate-800/40 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/30">
              <BookOpen size={16} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Chart of Accounts Preview</h3>
          </div>
          <span className="text-xs text-gray-400 dark:text-gray-500 font-medium bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">
            {totalAccounts} accounts
          </span>
        </div>
        <div className="bg-gray-50/80 dark:bg-slate-800/60 rounded-lg border border-gray-100 dark:border-gray-700/40 p-3 max-h-56 overflow-y-auto">
          {coaTree.map((root) => (
            <CoATreeNode key={root.accountNumber} account={root} numbered={coaTemplate === 'numbered'} />
          ))}
        </div>
      </div>
    </div>
  )
}