'use client'

import { Users, Plus, Trash2, SkipForward } from 'lucide-react'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'
import { useStepSuggestions } from './useStepSuggestions'
import { AISuggestionTip } from './AISuggestionChip'

interface StepInviteTeamProps {
  data: SetupWizardData
  businessType: string
  companySlug: string
  onChange: (updates: Partial<SetupWizardData>) => void
  onNext: () => void
  onBack: () => void
}

function getRolesForBusinessType(businessType: string) {
  switch (businessType) {
    case 'restaurant':
      return [
        { value: 'manager', label: 'Manager' },
        { value: 'cashier', label: 'Cashier' },
        { value: 'chef', label: 'Chef' },
        { value: 'waiter', label: 'Waiter' },
      ]
    case 'auto_service':
      return [
        { value: 'manager', label: 'Manager' },
        { value: 'cashier', label: 'Cashier' },
        { value: 'technician', label: 'Technician' },
      ]
    default:
      return [
        { value: 'manager', label: 'Manager' },
        { value: 'cashier', label: 'Cashier' },
      ]
  }
}

export function StepInviteTeam({ data, businessType, companySlug, onChange, onNext, onBack }: StepInviteTeamProps) {
  const roles = getRolesForBusinessType(businessType)
  const invites = data.teamInvites || []

  const { suggestions, loading } = useStepSuggestions<{ suggestedRoles: string[]; tip: string }>({
    step: 'team',
    context: { businessType },
    companySlug,
  })

  const addInvite = () => {
    if (invites.length >= 5) return
    onChange({
      teamInvites: [...invites, { email: '', role: roles[0].value }],
    })
  }

  const updateInvite = (index: number, field: 'email' | 'role', value: string) => {
    const updated = [...invites]
    updated[index] = { ...updated[index], [field]: value }
    onChange({ teamInvites: updated })
  }

  const removeInvite = (index: number) => {
    onChange({ teamInvites: invites.filter((_, i) => i !== index) })
  }

  const hasValidInvites = invites.some(inv => inv.email.trim() && inv.email.includes('@'))

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Users size={24} className="text-blue-600" />
          Invite Your Team
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Add team members to get started together. You can always invite more later.
        </p>
      </div>

      {/* AI tip */}
      <AISuggestionTip tip={suggestions?.tip || ''} loading={loading} />

      <div className="space-y-3">
        {invites.map((invite, index) => (
          <div key={index} className="flex items-center gap-3">
            <input
              type="email"
              value={invite.email}
              onChange={(e) => updateInvite(index, 'email', e.target.value)}
              placeholder="team@example.com"
              className="flex-1 px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <select
              value={invite.role}
              onChange={(e) => updateInvite(index, 'role', e.target.value)}
              className="px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {roles.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => removeInvite(index)}
              className="p-2 text-gray-400 hover:text-red-500 transition-colors"
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}

        {invites.length < 5 && (
          <button
            onClick={addInvite}
            className="flex items-center gap-2 px-4 py-2.5 border border-dashed border-gray-300 dark:border-gray-600 rounded text-sm text-gray-600 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors w-full justify-center"
          >
            <Plus size={18} />
            Add team member
          </button>
        )}

        {invites.length === 0 && (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <Users size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No team members added yet.</p>
            <p className="text-xs mt-1">You can skip this step and invite people later.</p>
          </div>
        )}
      </div>

      <div className="mt-8 flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors font-medium"
        >
          Back
        </button>
        <div className="flex gap-3">
          {!hasValidInvites && (
            <button
              onClick={onNext}
              className="px-6 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors font-medium flex items-center gap-2"
            >
              <SkipForward size={18} />
              Skip
            </button>
          )}
          <button
            onClick={onNext}
            className="px-6 py-2.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium"
          >
            {hasValidInvites ? 'Complete Setup' : 'Skip & Complete'}
          </button>
        </div>
      </div>
    </div>
  )
}
