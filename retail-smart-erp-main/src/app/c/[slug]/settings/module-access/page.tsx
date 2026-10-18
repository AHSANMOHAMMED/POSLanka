'use client'

import { useState, useCallback, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { useRealtimeData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { Loader2, Shield, Save } from 'lucide-react'
import { getRolesForBusinessType, ROLE_HIERARCHY, type UserRole } from '@/lib/auth/roles'

interface ModuleAccessRow {
  moduleKey: string
  role: string
  isEnabled: boolean
}

const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  stock: 'Stock',
  selling: 'Selling',
  buying: 'Buying',
  'auto-service': 'Auto Service',
  restaurant: 'Restaurant',
  hr: 'HR',
  accounting: 'Accounting',
  reports: 'Reports',
  my: 'My Portal',
  settings: 'Settings',
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  manager: 'Manager',
  system_manager: 'Sys Manager',
  accounts_manager: 'Accounts Mgr',
  sales_manager: 'Sales Mgr',
  purchase_manager: 'Purchase Mgr',
  hr_manager: 'HR Manager',
  stock_manager: 'Stock Mgr',
  cashier: 'Cashier',
  technician: 'Technician',
  chef: 'Chef',
  waiter: 'Waiter',
  pos_user: 'POS User',
  report_user: 'Report User',
  dealer_sales: 'Dealer Sales',
}

// Modules specific to certain business types
const BUSINESS_TYPE_MODULES: Record<string, string[]> = {
  auto_service: ['auto-service'],
  dealership: ['auto-service'],
  restaurant: ['restaurant'],
}

export default function ModuleAccessPage() {
  const { data: session } = useSession()
  const businessType = session?.user?.businessType || 'retail'
  const [rows, setRows] = useState<ModuleAccessRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Filter roles and modules by business type
  const visibleRoles = useMemo(() => getRolesForBusinessType(businessType), [businessType])
  const visibleModuleKeys = useMemo(() => {
    const allSpecificModules = new Set<string>()
    for (const mods of Object.values(BUSINESS_TYPE_MODULES)) {
      for (const m of mods) allSpecificModules.add(m)
    }
    const allowedSpecific = new Set(BUSINESS_TYPE_MODULES[businessType] || [])
    return Object.keys(MODULE_LABELS).filter(
      key => !allSpecificModules.has(key) || allowedSpecific.has(key)
    )
  }, [businessType])

  const fetchAccess = useCallback(async () => {
    try {
      const res = await fetch('/api/module-access')
      if (res.ok) {
        const data = await res.json()
        setRows(Array.isArray(data) ? data : data.data || [])
      }
    } catch {
      toast.error('Failed to load module access')
    } finally {
      setLoading(false)
    }
  }, [])

  useRealtimeData(fetchAccess, { entityType: 'module-access' })

  function isEnabled(moduleKey: string, role: string): boolean {
    const row = rows.find((r) => r.moduleKey === moduleKey && r.role === role)
    return row ? row.isEnabled : true // default enabled
  }

  function toggle(moduleKey: string, role: string) {
    setDirty(true)
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.moduleKey === moduleKey && r.role === role)
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = { ...updated[idx], isEnabled: !updated[idx].isEnabled }
        return updated
      }
      return [...prev, { moduleKey, role, isEnabled: false }]
    })
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/module-access', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: rows }),
      })
      if (res.ok) {
        toast.success('Module access updated')
        setDirty(false)
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to save')
      }
    } catch {
      toast.error('Failed to save module access')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <PermissionGuard permission="manageModuleAccess">
      <div className="p-6 space-y-6">
        <Breadcrumb items={[{ label: 'Settings' }, { label: 'Module Access' }]} />

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Module Access Control</h2>
            <p className="text-sm text-gray-500 mt-1">
              Control which modules each role can access. Unchecked modules will be hidden from the sidebar.
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
        </div>

        <div className="bg-white rounded border overflow-x-auto">
          <table className="w-full">
            <thead className="table-sticky-header">
              <tr className="border-b text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <th className="px-4 py-3 min-w-[160px]">Module</th>
                {visibleRoles.map((role) => (
                  <th key={role} className="px-4 py-3 text-center">
                    <div className="text-[11px] leading-tight">{ROLE_LABELS[role] || role}</div>
                    <div className="text-[9px] text-gray-400 font-normal">L{ROLE_HIERARCHY[role as UserRole] || 0}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {visibleModuleKeys.map((moduleKey) => (
                <tr key={moduleKey} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-sm font-medium flex items-center gap-2">
                    <Shield className="w-4 h-4 text-gray-400" />
                    {MODULE_LABELS[moduleKey]}
                  </td>
                  {visibleRoles.map((role) => (
                    <td key={role} className="px-4 py-3 text-center">
                      <label className="inline-flex items-center">
                        <input
                          type="checkbox"
                          checked={isEnabled(moduleKey, role)}
                          onChange={() => toggle(moduleKey, role)}
                          className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                        />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-sm text-gray-500 bg-amber-50 border border-amber-200 rounded p-3">
          <strong>Note:</strong> Module access controls visibility only. Permission checks still apply at the API level.
          Modules with no row default to enabled for all roles.
        </div>
      </div>
    </PermissionGuard>
  )
}
