'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { toast } from '@/components/ui/toast'
import {
  Printer, Search,
  ChevronDown, ChevronUp, ChevronRight, Users, Car, ClipboardList,
  Bell, FolderTree, Home, User, CreditCard, Warehouse, Monitor, Gift,
  Loader2, LogOut, DollarSign, ArrowLeftRight, Sparkles,
  FileText, Bookmark, ShieldCheck, Image, Bot,
} from 'lucide-react'
import Link from 'next/link'
import { DocumentType, PaperSize, PrintSettings, DocumentPrintSettings, DEFAULT_PRINT_SETTINGS, PAPER_SIZES } from '@/lib/print/types'
import { useDebounce } from '@/hooks/useDebounce'
import { hasPermission } from '@/lib/auth/roles'
import { broadcastAuthEvent } from '@/lib/auth/events'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { AIConsentModal } from '@/components/modals'
import { SectionCard, Field, FieldGrid } from '@/components/ui/section-card'
import { LogoUpload } from '@/components/ui/logo-upload'
import { Button } from '@/components/ui/button'
import { FormInput, FormField, FormSelect, FormCheckbox } from '@/components/ui/form-elements'

const documentTypes: { key: DocumentType; label: string; description: string }[] = [
  { key: 'receipt', label: 'Receipt', description: 'POS sales receipts' },
  { key: 'work_order', label: 'Work Order', description: 'Service work orders' },
  { key: 'estimate', label: 'Estimate', description: 'Insurance/direct estimates' },
  { key: 'invoice', label: 'Invoice', description: 'Customer invoices' },
]

interface NavCardProps {
  href: string
  icon: React.ReactNode
  iconBg: string
  title: string
  description: string
}

function SettingsNavCard({ href, icon, iconBg, title, description }: NavCardProps) {
  return (
    <Link href={href}>
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-4 hover:border-blue-500 dark:hover:border-blue-400 transition-colors group flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 ${iconBg} rounded`}>{icon}</div>
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white">{title}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
          </div>
        </div>
        <ChevronRight size={18} className="text-gray-400 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors flex-shrink-0" />
      </div>
    </Link>
  )
}

export default function SettingsPage() {
  const { data: session, update } = useSession()
  const { tenantSlug } = useCompany()
  const [settingsSearch, setSettingsSearch] = useState('')

  // AI toggle state
  const [aiEnabled, setAiEnabled] = useState(session?.user?.aiEnabled ?? false)
  const [aiConsentAcceptedAt, setAiConsentAcceptedAt] = useState<string | null>(null)
  const [showAIConsent, setShowAIConsent] = useState(false)
  const [togglingAI, setTogglingAI] = useState(false)

  // Print settings state
  const [printSettings, setPrintSettings] = useState<DocumentPrintSettings>(DEFAULT_PRINT_SETTINGS)
  const [loadingPrintSettings, setLoadingPrintSettings] = useState(true)
  const [savingPrintSettings, setSavingPrintSettings] = useState(false)
  const [expandedDoc, setExpandedDoc] = useState<DocumentType | null>(null)



  // Fetch tenant settings (AI + Tax)
  useEffect(() => {
    async function fetchTenantSettings() {
      try {
        const res = await fetch('/api/tenant')
        if (res.ok) {
          const data = await res.json()
          setAiEnabled(data.aiEnabled ?? false)
          setAiConsentAcceptedAt(data.aiConsentAcceptedAt ?? null)
        }
      } catch { /* silent */ }
    }
    fetchTenantSettings()
  }, [])

  useEffect(() => {
    loadPrintSettings()
  }, [])

  async function loadPrintSettings() {
    setLoadingPrintSettings(true)
    try {
      const res = await fetch('/api/print-settings')
      if (res.ok) {
        const data = await res.json()
        setPrintSettings(data)
      }
    } catch (err) {
      console.error('Failed to load print settings:', err)
    } finally {
      setLoadingPrintSettings(false)
    }
  }

  const pendingSettingsRef = useRef<DocumentPrintSettings | null>(null)

  const savePrintSettingsToServer = useCallback(async () => {
    const settings = pendingSettingsRef.current
    if (!settings) return

    setSavingPrintSettings(true)
    try {
      const res = await fetch('/api/print-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (res.ok) {
        toast.success('Print settings saved')
      } else {
        toast.error('Failed to save print settings')
      }
    } catch {
      toast.error('Error saving print settings')
    } finally {
      setSavingPrintSettings(false)
    }
  }, [])

  const debouncedSave = useDebounce(savePrintSettingsToServer, 800)

  function updateDocumentSettings(docType: DocumentType, updates: Partial<PrintSettings>) {
    const newSettings = {
      ...printSettings,
      [docType]: { ...printSettings[docType], ...updates },
    }
    setPrintSettings(newSettings)
    pendingSettingsRef.current = newSettings
    debouncedSave()
  }

  function updateMargin(docType: DocumentType, side: 'top' | 'right' | 'bottom' | 'left', value: number) {
    const newSettings = {
      ...printSettings,
      [docType]: {
        ...printSettings[docType],
        margins: { ...printSettings[docType].margins, [side]: Math.max(0, value) },
      },
    }
    setPrintSettings(newSettings)
    pendingSettingsRef.current = newSettings
    debouncedSave()
  }

  async function handleAIToggle(enable: boolean) {
    if (enable && !aiConsentAcceptedAt) {
      // First time enabling — show consent modal
      setShowAIConsent(true)
      return
    }

    setTogglingAI(true)
    try {
      const res = await fetch('/api/tenant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiEnabled: enable }),
      })

      if (res.ok) {
        setAiEnabled(enable)
        await update({ aiEnabled: enable })
        toast.success(enable ? 'AI features enabled' : 'AI features disabled')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update AI settings')
      }
    } catch {
      toast.error('Error updating AI settings')
    } finally {
      setTogglingAI(false)
    }
  }

  async function handleAIConsent() {
    setTogglingAI(true)
    try {
      const res = await fetch('/api/tenant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiEnabled: true }),
      })

      if (res.ok) {
        setAiEnabled(true)
        setAiConsentAcceptedAt(new Date().toISOString())
        setShowAIConsent(false)
        await update({ aiEnabled: true })
        toast.success('AI features enabled')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to enable AI')
      }
    } catch {
      toast.error('Error enabling AI features')
    } finally {
      setTogglingAI(false)
    }
  }

  const isAutoService = session?.user?.businessType === 'auto_service'
  const isDealership = session?.user?.businessType === 'dealership'
  const isVehicleBusiness = isAutoService || isDealership

  // Build nav cards data for filtering
  const allNavCards = useMemo(() => {
    const role = session?.user?.role || ''
    const cards: (NavCardProps & { visible: boolean })[] = [
      { href: `/c/${tenantSlug}/settings/staff`, icon: <Users size={20} className="text-purple-600 dark:text-purple-400" />, iconBg: 'bg-purple-100 dark:bg-purple-900/30', title: 'Staff', description: 'Manage users and roles', visible: hasPermission(role, 'manageUsers') },
      { href: `/c/${tenantSlug}/settings/role-permissions`, icon: <ShieldCheck size={20} className="text-red-600 dark:text-red-400" />, iconBg: 'bg-red-100 dark:bg-red-900/30', title: 'Role Permissions', description: 'Customize permissions per role', visible: role === 'owner' },
      { href: `/c/${tenantSlug}/settings/commissions`, icon: <DollarSign size={20} className="text-green-600 dark:text-green-400" />, iconBg: 'bg-green-100 dark:bg-green-900/30', title: 'Commissions', description: 'Rates, payouts and tracking', visible: hasPermission(role, 'manageCommissions') },
      { href: `/c/${tenantSlug}/settings/notifications`, icon: <Bell size={20} className="text-blue-600 dark:text-blue-400" />, iconBg: 'bg-blue-100 dark:bg-blue-900/30', title: 'Notifications', description: 'Email, SMS and alerts', visible: true },
      { href: `/c/${tenantSlug}/settings/files`, icon: <FolderTree size={20} className="text-amber-600 dark:text-amber-400" />, iconBg: 'bg-amber-100 dark:bg-amber-900/30', title: 'File Manager', description: 'Upload and manage files', visible: true },
      { href: `/c/${tenantSlug}/settings/import-export`, icon: <ArrowLeftRight size={20} className="text-sky-600 dark:text-sky-400" />, iconBg: 'bg-sky-100 dark:bg-sky-900/30', title: 'Import / Export', description: 'Bulk data import and export', visible: true },
      { href: `/c/${tenantSlug}/settings/warehouses`, icon: <Warehouse size={20} className="text-emerald-600 dark:text-emerald-400" />, iconBg: 'bg-emerald-100 dark:bg-emerald-900/30', title: 'Warehouses', description: 'Manage inventory locations', visible: true },
      { href: `/c/${tenantSlug}/settings/pos-profiles`, icon: <Monitor size={20} className="text-indigo-600 dark:text-indigo-400" />, iconBg: 'bg-indigo-100 dark:bg-indigo-900/30', title: 'POS Profiles', description: 'Configure POS terminals', visible: true },
      { href: `/c/${tenantSlug}/settings/loyalty`, icon: <Gift size={20} className="text-pink-600 dark:text-pink-400" />, iconBg: 'bg-pink-100 dark:bg-pink-900/30', title: 'Loyalty Program', description: 'Points and rewards tiers', visible: true },
      { href: `/c/${tenantSlug}/settings/gift-cards`, icon: <CreditCard size={20} className="text-rose-600 dark:text-rose-400" />, iconBg: 'bg-rose-100 dark:bg-rose-900/30', title: 'Gift Cards', description: 'Manage gift cards and balances', visible: true },
      { href: `/c/${tenantSlug}/settings/vehicle-types`, icon: <Car size={20} className="text-cyan-600 dark:text-cyan-400" />, iconBg: 'bg-cyan-100 dark:bg-cyan-900/30', title: 'Vehicle Types', description: 'Body types and diagrams', visible: isVehicleBusiness },
      { href: `/c/${tenantSlug}/settings/inspection-templates`, icon: <ClipboardList size={20} className="text-teal-600 dark:text-teal-400" />, iconBg: 'bg-teal-100 dark:bg-teal-900/30', title: 'Inspections', description: 'Vehicle inspection checklists', visible: isVehicleBusiness },
      { href: `/c/${tenantSlug}/settings/ai-logs`, icon: <Sparkles size={20} className="text-purple-500 dark:text-purple-400" />, iconBg: 'bg-purple-100 dark:bg-purple-900/30', title: 'AI Intelligence', description: 'Error logs and AI analysis', visible: hasPermission(role, 'manageUsers') },
      { href: `/c/${tenantSlug}/settings/letter-heads`, icon: <FileText size={20} className="text-orange-600 dark:text-orange-400" />, iconBg: 'bg-orange-100 dark:bg-orange-900/30', title: 'Letter Heads', description: 'Company branding for prints', visible: true },
      { href: `/c/${tenantSlug}/settings/print-templates`, icon: <Bookmark size={20} className="text-violet-600 dark:text-violet-400" />, iconBg: 'bg-violet-100 dark:bg-violet-900/30', title: 'Print Templates', description: 'Configure print layouts', visible: true },
      { href: `/c/${tenantSlug}/settings/system-audit`, icon: <ShieldCheck size={20} className="text-blue-600 dark:text-blue-400" />, iconBg: 'bg-blue-100 dark:bg-blue-900/30', title: 'System Audit', description: 'Integrity checks and diagnostics', visible: hasPermission(role, 'manageSettings') },
    ]
    return cards.filter(c => c.visible)
  }, [tenantSlug, session?.user?.role, isVehicleBusiness])

  const filteredNavCards = useMemo(() => {
    if (!settingsSearch.trim()) return allNavCards
    const q = settingsSearch.toLowerCase()
    return allNavCards.filter(c => c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
  }, [allNavCards, settingsSearch])

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
        <Link href={`/c/${tenantSlug}`} className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
          <Home size={14} />
        </Link>
        <ChevronRight size={14} />
        <span className="text-gray-900 dark:text-white font-medium">Settings</span>
      </nav>

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Configure your business settings and preferences</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search settings..."
            value={settingsSearch}
            onChange={(e) => setSettingsSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
          />
        </div>
      </div>

      {/* Navigation Cards Grid */}
      <nav aria-label="Settings sections" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredNavCards.map((card) => (
          <SettingsNavCard key={card.href} {...card} />
        ))}
        {filteredNavCards.length === 0 && (
          <div className="col-span-full py-8 text-center text-gray-500 dark:text-gray-400">
            <Search size={24} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No settings match &quot;{settingsSearch}&quot;</p>
          </div>
        )}
      </nav>

      {/* Settings Sections - Two Column */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Account Info */}
        <SectionCard title="Account Information" icon={<User size={16} />}>
          <FieldGrid columns={1}>
            <Field label="Business Name" value={session?.user?.tenantName || '-'} />
            <Field label="Business Code" value={session?.user?.tenantSlug || '-'} copyable />
            <Field label="Your Name" value={session?.user?.name || '-'} />
            <Field label="Email" value={session?.user?.email || '-'} />
            <Field
              label="Role"
              value={
                <span className="capitalize bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded text-sm">
                  {session?.user?.role}
                </span>
              }
            />
          </FieldGrid>
        </SectionCard>

        {/* Right column: AI Features + Subscription */}
        <div className="space-y-6">
          {/* AI Features Toggle */}
          {hasPermission(session?.user?.role || '', 'manageSettings') && (
            <SectionCard title="AI Features" icon={<Bot size={16} />}>
              <div className="space-y-3">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Enable AI-powered chat assistant, business insights, smart suggestions, and error analysis.
                </p>
                <FormCheckbox
                  label="Enable AI Features"
                  description={
                    aiEnabled
                      ? 'AI features are active for this company'
                      : aiConsentAcceptedAt
                      ? 'Previously enabled — no new consent required to re-enable'
                      : 'You will need to accept the AI data processing terms'
                  }
                  checked={aiEnabled}
                  onChange={() => handleAIToggle(!aiEnabled)}
                  disabled={togglingAI}
                />
                {togglingAI && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    <Loader2 size={12} className="animate-spin" />
                    Updating...
                  </p>
                )}
              </div>
            </SectionCard>
          )}

          <SectionCard title="Subscription" icon={<CreditCard size={16} />}>
            <div className="flex items-center justify-between">
              <div>
                <span className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded-full text-sm font-medium">
                  Free
                </span>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  free forever
                </p>
              </div>
              <Button variant="default" size="sm">
                Upgrade
              </Button>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Print Settings - Full Width, Collapsible */}
      <SectionCard
        title="Print Settings"
        icon={<Printer size={16} />}
        collapsible
        defaultCollapsed
        actions={
          savingPrintSettings ? (
            <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
              <Loader2 size={12} className="animate-spin" />
              Saving...
            </span>
          ) : null
        }
      >
        {loadingPrintSettings ? (
          <div className="py-4 space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-12 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {documentTypes.map((doc) => {
              const settings = printSettings[doc.key]
              const isExpanded = expandedDoc === doc.key

              return (
                <div key={doc.key} className="border border-gray-200 dark:border-gray-600 rounded">
                  <button
                    onClick={() => setExpandedDoc(isExpanded ? null : doc.key)}
                    className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <div className="text-left">
                      <p className="font-medium text-gray-900 dark:text-white">{doc.label}</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{doc.description}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-400 dark:text-gray-500">
                        {PAPER_SIZES[settings.paperSize].label}
                      </span>
                      {isExpanded ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="p-4 pt-0 border-t border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-900/30 space-y-4">
                      <FormField label="Paper Size">
                        <FormSelect
                          value={settings.paperSize}
                          onChange={(e) => updateDocumentSettings(doc.key, { paperSize: e.target.value as PaperSize })}
                          disabled={savingPrintSettings}
                        >
                          {Object.entries(PAPER_SIZES).map(([key, { label }]) => (
                            <option key={key} value={key}>{label}</option>
                          ))}
                        </FormSelect>
                      </FormField>

                      <div>
                        <FormField label="Orientation">
                          <div className="flex gap-2">
                            <button
                              onClick={() => updateDocumentSettings(doc.key, { orientation: 'portrait' })}
                              disabled={savingPrintSettings}
                              className={`flex-1 px-3 py-2 border rounded text-sm font-medium transition-colors ${
                                settings.orientation === 'portrait'
                                  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-400 text-blue-700 dark:text-blue-300'
                                  : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300'
                              }`}
                            >
                              Portrait
                            </button>
                            <button
                              onClick={() => updateDocumentSettings(doc.key, { orientation: 'landscape' })}
                              disabled={savingPrintSettings}
                              className={`flex-1 px-3 py-2 border rounded text-sm font-medium transition-colors ${
                                settings.orientation === 'landscape'
                                  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-400 text-blue-700 dark:text-blue-300'
                                  : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300'
                              }`}
                            >
                              Landscape
                            </button>
                          </div>
                        </FormField>
                      </div>

                      <FormField label="Default Copies">
                        <FormInput
                          type="number"
                          value={settings.copies}
                          onChange={(e) => updateDocumentSettings(doc.key, { copies: Math.max(1, parseInt(e.target.value) || 1) })}
                          disabled={savingPrintSettings}
                          min={1}
                          inputSize="sm"
                          className="w-24"
                        />
                      </FormField>

                      <FormField label="Margins (mm)">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                            <FormField key={side} label={side} labelClassName="text-xs capitalize">
                              <FormInput
                                type="number"
                                value={settings.margins[side]}
                                onChange={(e) => updateMargin(doc.key, side, parseInt(e.target.value) || 0)}
                                disabled={savingPrintSettings}
                                min={0}
                                inputSize="sm"
                              />
                            </FormField>
                          ))}
                        </div>
                      </FormField>

                      <FormField label="Display Options">
                        <div className="space-y-2">
                          <FormCheckbox
                            label="Show Header"
                            checked={settings.showHeader}
                            onChange={(e) => updateDocumentSettings(doc.key, { showHeader: e.target.checked })}
                            disabled={savingPrintSettings}
                          />
                          <FormCheckbox
                            label="Show Footer"
                            checked={settings.showFooter}
                            onChange={(e) => updateDocumentSettings(doc.key, { showFooter: e.target.checked })}
                            disabled={savingPrintSettings}
                          />
                          <FormCheckbox
                            label="Show Logo"
                            checked={settings.showLogo}
                            onChange={(e) => updateDocumentSettings(doc.key, { showLogo: e.target.checked })}
                            disabled={savingPrintSettings}
                          />
                        </div>
                      </FormField>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* Company Logo */}
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <SectionCard title="Company Logo" icon={<Image size={16} />}>
        <LogoUpload
          currentLogoUrl={session?.user?.logoUrl}
          onLogoUploaded={() => {
            toast.success('Logo uploaded successfully!')
            // Refresh session to update logo URL
            update()
          }}
          onLogoRemoved={() => {
            toast.success('Logo removed successfully!')
            // Refresh session to update logo URL
            update()
          }}
          maxSizeMB={2}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
          Your logo will appear on invoices, receipts, reports, and other printed documents.
          Recommended: Square image, transparent background, at least 200×200 pixels.
        </p>
      </SectionCard>

      {/* Danger Zone - Session */}
      <div className="border border-red-200 dark:border-red-900/50 rounded p-6 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white">Session</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Log out of your current session on this device</p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            leftIcon={<LogOut size={16} />}
            onClick={async () => {
              broadcastAuthEvent('logout', 'company')
              await signOut({ redirect: false })
              window.location.href = `/c/${tenantSlug}/login?logout=true`
            }}
          >
            Logout
          </Button>
        </div>
      </div>

      {/* AI Consent Modal */}
      <AIConsentModal
        isOpen={showAIConsent}
        onClose={() => setShowAIConsent(false)}
        onAgree={handleAIConsent}
        processing={togglingAI}
      />
    </div>
  )
}
