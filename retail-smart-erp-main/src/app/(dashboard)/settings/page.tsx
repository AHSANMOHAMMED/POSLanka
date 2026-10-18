'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { toast } from '@/components/ui/toast'
import { Store, Wrench, Printer, ChevronDown, ChevronUp, Car, ClipboardList, ChevronRight, Users } from 'lucide-react'
import Link from 'next/link'
import { DocumentType, PaperSize, PrintSettings, DocumentPrintSettings, DEFAULT_PRINT_SETTINGS, PAPER_SIZES } from '@/lib/print/types'
import { useDebounce } from '@/hooks/useDebounce'
import { hasPermission } from '@/lib/auth/roles'
import { broadcastAuthEvent } from '@/lib/auth/events'

const documentTypes: { key: DocumentType; label: string; description: string }[] = [
  { key: 'receipt', label: 'Receipt', description: 'POS sales receipts' },
  { key: 'work_order', label: 'Work Order', description: 'Service work orders' },
  { key: 'estimate', label: 'Estimate', description: 'Insurance/direct estimates' },
  { key: 'invoice', label: 'Invoice', description: 'Customer invoices' },
]

export default function SettingsPage() {
  const { data: session, update } = useSession()
  const tenantSlug = session?.user?.tenantSlug || ''
  // Print settings state
  const [printSettings, setPrintSettings] = useState<DocumentPrintSettings>(DEFAULT_PRINT_SETTINGS)
  const [loadingPrintSettings, setLoadingPrintSettings] = useState(true)
  const [savingPrintSettings, setSavingPrintSettings] = useState(false)
  const [expandedDoc, setExpandedDoc] = useState<DocumentType | null>(null)

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

  // Track pending settings to save
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

  // Debounce save to prevent race conditions
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

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="grid gap-6 max-w-2xl">
        {/* Service Configuration - Auto Service and Dealership */}
        {(session?.user?.businessType === 'auto_service' || session?.user?.businessType === 'dealership') && (
          <div className="bg-white rounded-md border p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-blue-100 rounded flex items-center justify-center">
                <Wrench size={20} className="text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Service Configuration</h2>
                <p className="text-sm text-gray-500">Configure vehicle types and inspection templates</p>
              </div>
            </div>
            <div className="space-y-2">
              <Link
                href={`/c/${tenantSlug}/settings/vehicle-types`}
                className="flex items-center justify-between p-4 border rounded hover:bg-gray-50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                    <Car size={20} className="text-gray-600 group-hover:text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium">Vehicle Types</p>
                    <p className="text-sm text-gray-500">Manage vehicle body types and diagram views</p>
                  </div>
                </div>
                <ChevronRight size={20} className="text-gray-400 group-hover:text-blue-600" />
              </Link>
              <Link
                href={`/c/${tenantSlug}/settings/inspection-templates`}
                className="flex items-center justify-between p-4 border rounded hover:bg-gray-50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                    <ClipboardList size={20} className="text-gray-600 group-hover:text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium">Inspection Templates</p>
                    <p className="text-sm text-gray-500">Configure checklists for vehicle inspections</p>
                  </div>
                </div>
                <ChevronRight size={20} className="text-gray-400 group-hover:text-blue-600" />
              </Link>
            </div>
          </div>
        )}

        {/* POS Configuration - show to owner/manager only */}
        {hasPermission(session?.user?.role || '', 'manageUsers') && (
          <div className="bg-white rounded-md border p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-green-100 rounded flex items-center justify-center">
                <Store size={20} className="text-green-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">POS Configuration</h2>
                <p className="text-sm text-gray-500">Configure point of sale terminals and profiles</p>
              </div>
            </div>
            <Link
              href={`/c/${tenantSlug}/settings/pos-profiles`}
              className="flex items-center justify-between p-4 border rounded hover:bg-gray-50 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center group-hover:bg-green-100 transition-colors">
                  <Store size={20} className="text-gray-600 group-hover:text-green-600" />
                </div>
                <div>
                  <p className="font-medium">POS Profiles</p>
                  <p className="text-sm text-gray-500">Manage POS terminals, payment methods, and settings</p>
                </div>
              </div>
              <ChevronRight size={20} className="text-gray-400 group-hover:text-green-600" />
            </Link>
          </div>
        )}

        {/* Staff Management - show to owner/manager only */}
        {hasPermission(session?.user?.role || '', 'manageUsers') && (
          <div className="bg-white rounded-md border p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-purple-100 rounded flex items-center justify-center">
                <Users size={20} className="text-purple-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Staff Management</h2>
                <p className="text-sm text-gray-500">Manage users and their roles</p>
              </div>
            </div>
            <Link
              href={`/c/${tenantSlug}/settings/staff`}
              className="flex items-center justify-between p-4 border rounded hover:bg-gray-50 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center group-hover:bg-purple-100 transition-colors">
                  <Users size={20} className="text-gray-600 group-hover:text-purple-600" />
                </div>
                <div>
                  <p className="font-medium">Staff Members</p>
                  <p className="text-sm text-gray-500">Add, edit, and manage staff accounts</p>
                </div>
              </div>
              <ChevronRight size={20} className="text-gray-400 group-hover:text-purple-600" />
            </Link>
          </div>
        )}

        {/* Account Info */}
        <div className="bg-white rounded-md border p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Account Information</h2>
          <div className="space-y-3">
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-600">Business Name</span>
              <span className="font-medium">{session?.user?.tenantName}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-600">Business Code</span>
              <span className="font-mono bg-gray-100 px-2 py-0.5 rounded">{session?.user?.tenantSlug}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-600">Your Name</span>
              <span>{session?.user?.name}</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="text-gray-600">Email</span>
              <span>{session?.user?.email}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-gray-600">Role</span>
              <span className="capitalize bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-sm">
                {session?.user?.role}
              </span>
            </div>
          </div>
        </div>

        {/* Subscription */}
        <div className="bg-white rounded-md border p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Subscription</h2>
          <div className="flex items-center justify-between">
            <div>
              <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                Free
              </span>
              <p className="text-sm text-gray-500 mt-2">
                free forever
              </p>
            </div>
            <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
              Upgrade
            </button>
          </div>
        </div>

        {/* Print Settings */}
        <div className="bg-white rounded-md border p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-gray-100 rounded flex items-center justify-center">
              <Printer size={20} className="text-gray-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Print Settings</h2>
              <p className="text-sm text-gray-500">Configure default print settings for each document type</p>
            </div>
          </div>

          {loadingPrintSettings ? (
            <div className="py-8 text-center text-gray-500">Loading print settings...</div>
          ) : (
            <div className="space-y-3">
              {documentTypes.map((doc) => {
                const settings = printSettings[doc.key]
                const isExpanded = expandedDoc === doc.key

                return (
                  <div key={doc.key} className="border rounded">
                    <button
                      onClick={() => setExpandedDoc(isExpanded ? null : doc.key)}
                      className="w-full flex items-center justify-between p-4 hover:bg-gray-50"
                    >
                      <div className="text-left">
                        <p className="font-medium">{doc.label}</p>
                        <p className="text-sm text-gray-500">{doc.description}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-400">
                          {PAPER_SIZES[settings.paperSize].label}
                        </span>
                        {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="p-4 pt-0 border-t bg-gray-50 space-y-4">
                        {/* Paper Size */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Paper Size</label>
                          <select
                            value={settings.paperSize}
                            onChange={(e) => updateDocumentSettings(doc.key, { paperSize: e.target.value as PaperSize })}
                            disabled={savingPrintSettings}
                            className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500"
                          >
                            {Object.entries(PAPER_SIZES).map(([key, { label }]) => (
                              <option key={key} value={key}>{label}</option>
                            ))}
                          </select>
                        </div>

                        {/* Orientation */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Orientation</label>
                          <div className="flex gap-2">
                            <button
                              onClick={() => updateDocumentSettings(doc.key, { orientation: 'portrait' })}
                              disabled={savingPrintSettings}
                              className={`flex-1 px-3 py-2 border rounded text-sm font-medium transition-colors ${
                                settings.orientation === 'portrait'
                                  ? 'bg-blue-50 border-blue-500 text-blue-700'
                                  : 'hover:bg-gray-50'
                              }`}
                            >
                              Portrait
                            </button>
                            <button
                              onClick={() => updateDocumentSettings(doc.key, { orientation: 'landscape' })}
                              disabled={savingPrintSettings}
                              className={`flex-1 px-3 py-2 border rounded text-sm font-medium transition-colors ${
                                settings.orientation === 'landscape'
                                  ? 'bg-blue-50 border-blue-500 text-blue-700'
                                  : 'hover:bg-gray-50'
                              }`}
                            >
                              Landscape
                            </button>
                          </div>
                        </div>

                        {/* Copies */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Default Copies</label>
                          <input
                            type="number"
                            value={settings.copies}
                            onChange={(e) => updateDocumentSettings(doc.key, { copies: Math.max(1, parseInt(e.target.value) || 1) })}
                            disabled={savingPrintSettings}
                            min={1}
                            className="w-24 px-3 py-2 border rounded"
                          />
                        </div>

                        {/* Margins */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Margins (mm)</label>
                          <div className="grid grid-cols-4 gap-2">
                            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                              <div key={side}>
                                <label className="block text-xs text-gray-500 mb-1 capitalize">{side}</label>
                                <input
                                  type="number"
                                  value={settings.margins[side]}
                                  onChange={(e) => updateMargin(doc.key, side, parseInt(e.target.value) || 0)}
                                  disabled={savingPrintSettings}
                                  min={0}
                                  className="w-full px-2 py-1.5 border rounded text-sm"
                                />
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Display Options */}
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Display Options</label>
                          <div className="space-y-2">
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={settings.showHeader}
                                onChange={(e) => updateDocumentSettings(doc.key, { showHeader: e.target.checked })}
                                disabled={savingPrintSettings}
                                className="rounded border-gray-300"
                              />
                              <span className="text-sm">Show Header</span>
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={settings.showFooter}
                                onChange={(e) => updateDocumentSettings(doc.key, { showFooter: e.target.checked })}
                                disabled={savingPrintSettings}
                                className="rounded border-gray-300"
                              />
                              <span className="text-sm">Show Footer</span>
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={settings.showLogo}
                                onChange={(e) => updateDocumentSettings(doc.key, { showLogo: e.target.checked })}
                                disabled={savingPrintSettings}
                                className="rounded border-gray-300"
                              />
                              <span className="text-sm">Show Logo</span>
                            </label>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Logout */}
        <div className="bg-white rounded-md border p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">Session</h2>
          <button
            onClick={() => {
              broadcastAuthEvent('logout', 'company')
              signOut({ callbackUrl: '/login' })
            }}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  )
}
