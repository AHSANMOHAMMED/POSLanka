'use client'

import { useState, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, Plus, Trash2, User, Mail, Shield, CheckCircle, XCircle } from 'lucide-react'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'
import { FormInput, FormSelect } from '@/components/ui/form-elements'

interface StepUsersProps {
  data: SetupWizardData
  onChange: (updates: Partial<SetupWizardData>) => void
}

const ROLES = [
  { value: 'system_manager', label: 'System Manager' },
  { value: 'accounts_manager', label: 'Accounts Manager' },
  { value: 'sales_manager', label: 'Sales Manager' },
  { value: 'purchase_manager', label: 'Purchase Manager' },
  { value: 'hr_manager', label: 'HR Manager' },
  { value: 'stock_manager', label: 'Stock Manager' },
  { value: 'pos_user', label: 'POS User' },
  { value: 'report_user', label: 'Report User' },
]

const DEFAULT_INVITED_USER = {
  email: '',
  role: 'pos_user',
  sendInvite: true
}

export function StepUsers({ data, onChange }: StepUsersProps) {
  const { data: session } = useSession()
  // Derive invited users from parent data (source of truth comes from wizardData)
  const invitedUsers = useMemo(() =>
    (data.users || []).map(user => ({
      email: user.email,
      role: user.role || 'pos_user',
      sendInvite: user.sendInvite !== false
    })),
    [data.users]
  )

  const [emailErrors, setEmailErrors] = useState<Record<number, string>>({})

  const handleUsersChange = (updatedUsers: typeof invitedUsers) => {
    onChange({ users: updatedUsers.map(user => ({
      email: user.email,
      role: user.role,
      sendInvite: user.sendInvite,
    })) })
  }

  const addUser = () => {
    if (invitedUsers.length >= 10) return
    handleUsersChange([...invitedUsers, { ...DEFAULT_INVITED_USER }])
  }

  const removeUser = (index: number) => {
    handleUsersChange(invitedUsers.filter((_, i) => i !== index))
  }

  const updateUser = (index: number, field: keyof typeof DEFAULT_INVITED_USER, value: string | boolean) => {
    const updated = [...invitedUsers]
    updated[index] = { ...updated[index], [field]: value }

    if (field === 'email') {
      const email = value as string
      if (email && !isValidEmail(email)) {
        setEmailErrors(prev => ({ ...prev, [index]: 'Invalid email' }))
      } else {
        setEmailErrors(prev => {
          const newErrors = { ...prev }
          delete newErrors[index]
          return newErrors
        })
      }
    }

    handleUsersChange(updated)
  }

  const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

  return (
    <div className="space-y-5">
      {/* Step Header */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white tracking-tight">
          Users & Permissions
        </h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
          Invite team members by email and assign roles.
        </p>
      </div>

      {/* Owner Card */}
      <div className="rounded-xl border border-emerald-200/60 dark:border-emerald-800/40 bg-gradient-to-r from-emerald-50/80 to-white dark:from-emerald-950/20 dark:to-slate-800/40 p-4 flex items-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-green-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm shadow-emerald-500/20">
          <User size={18} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">You (Owner)</p>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 uppercase tracking-wide">
              Admin
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
            {session?.user?.email || 'Your email'}
          </p>
        </div>
        <Shield size={16} className="text-emerald-400 dark:text-emerald-600 flex-shrink-0" />
      </div>

      {/* Team Members Section */}
      <div className="rounded-xl border border-gray-200/60 dark:border-gray-700/50 bg-white dark:bg-slate-800/40 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30">
            <Users size={16} className="text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Team Members</h3>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">Add up to 10 team members</p>
          </div>
        </div>

        {/* User Rows */}
        <div className="space-y-2.5 max-h-[320px] overflow-y-auto">
          <AnimatePresence>
            {invitedUsers.map((user, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="border border-gray-100 dark:border-gray-700/40 rounded-xl p-3.5 bg-gray-50/40 dark:bg-slate-800/30"
              >
                <div className="flex items-start gap-2.5">
                  {/* Email */}
                  <div className="flex-1 min-w-0">
                    <FormInput
                      type="email"
                      value={user.email}
                      onChange={(e) => updateUser(index, 'email', e.target.value)}
                      leftIcon={<Mail size={14} />}
                      error={!!emailErrors[index]}
                      placeholder="email@company.com"
                    />
                    {emailErrors[index] && (
                      <p className="text-[11px] text-red-500 mt-1 flex items-center gap-1">
                        <XCircle size={10} /> {emailErrors[index]}
                      </p>
                    )}
                    {user.email && !emailErrors[index] && isValidEmail(user.email) && (
                      <p className="text-[11px] text-emerald-500 mt-1 flex items-center gap-1">
                        <CheckCircle size={10} /> Valid
                      </p>
                    )}
                  </div>

                  {/* Role Select */}
                  <div className="w-40 flex-shrink-0">
                    <FormSelect
                      value={user.role}
                      onChange={(e) => updateUser(index, 'role', e.target.value)}
                    >
                      {ROLES.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </FormSelect>
                  </div>

                  {/* Invite Toggle */}
                  <label className="flex items-center gap-1.5 pt-2.5 flex-shrink-0 cursor-pointer" title="Send invite email">
                    <input
                      type="checkbox"
                      checked={user.sendInvite}
                      onChange={(e) => updateUser(index, 'sendInvite', e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">Invite</span>
                  </label>

                  {/* Remove */}
                  <button
                    onClick={() => removeUser(index)}
                    className="p-2 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all flex-shrink-0"
                    title="Remove"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Add User */}
        {invitedUsers.length < 10 && (
          <button
            onClick={addUser}
            className="mt-3 flex items-center gap-2 py-2.5 border-2 border-dashed border-gray-200 dark:border-gray-700/50 rounded-xl text-sm text-gray-400 dark:text-gray-500 hover:border-blue-300 hover:text-blue-600 dark:hover:border-blue-700 dark:hover:text-blue-400 transition-all w-full justify-center"
          >
            <Plus size={15} />
            Add Team Member
          </button>
        )}
      </div>

      {/* Note */}
      <div className="flex items-start gap-2.5 px-4 py-3 bg-blue-50/60 dark:bg-blue-900/15 border border-blue-100 dark:border-blue-800/40 rounded-xl">
        <Mail size={14} className="text-blue-500 dark:text-blue-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-blue-600 dark:text-blue-400 leading-relaxed">
          Invitations are sent after setup. Existing users are added immediately.
          You can always add more users later from Settings.
        </p>
      </div>
    </div>
  )
}
