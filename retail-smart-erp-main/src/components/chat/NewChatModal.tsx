'use client'

import { useState, useEffect } from 'react'
import { X, Loader2, MessageCircle, Users, Search } from 'lucide-react'

interface StaffUser {
  id: string
  fullName: string | null
  email: string
  role: string
}

const GROUP_COLORS = [
  { value: 'blue', label: 'Blue', class: 'bg-blue-500' },
  { value: 'green', label: 'Green', class: 'bg-green-500' },
  { value: 'purple', label: 'Purple', class: 'bg-purple-500' },
  { value: 'orange', label: 'Orange', class: 'bg-orange-500' },
  { value: 'pink', label: 'Pink', class: 'bg-pink-500' },
  { value: 'teal', label: 'Teal', class: 'bg-teal-500' },
  { value: 'red', label: 'Red', class: 'bg-red-500' },
  { value: 'indigo', label: 'Indigo', class: 'bg-indigo-500' },
]

interface NewChatModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (conversationId: string) => void
  currentUserId: string
}

export function NewChatModal({ isOpen, onClose, onCreated, currentUserId }: NewChatModalProps) {
  const [type, setType] = useState<'direct' | 'group'>('direct')
  const [staffUsers, setStaffUsers] = useState<StaffUser[]>([])
  const [search, setSearch] = useState('')
  const [selectedUsers, setSelectedUsers] = useState<StaffUser[]>([])
  const [groupName, setGroupName] = useState('')
  const [groupColor, setGroupColor] = useState('blue')
  const [creating, setCreating] = useState(false)
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setType('direct')
    setSearch('')
    setSelectedUsers([])
    setGroupName('')
    setGroupColor('blue')
    fetchStaff()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const fetchStaff = async () => {
    setLoadingUsers(true)
    try {
      const res = await fetch('/api/users?all=true')
      if (res.ok) {
        const data = await res.json()
        const list = (Array.isArray(data) ? data : data.data || []) as StaffUser[]
        setStaffUsers(list.filter((u: StaffUser) => u.id !== currentUserId))
      }
    } catch {
      // silent
    } finally {
      setLoadingUsers(false)
    }
  }

  const filteredUsers = staffUsers.filter(u => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (u.fullName?.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  })

  const toggleUser = (user: StaffUser) => {
    if (type === 'direct') {
      setSelectedUsers([user])
    } else {
      setSelectedUsers(prev =>
        prev.find(u => u.id === user.id)
          ? prev.filter(u => u.id !== user.id)
          : [...prev, user]
      )
    }
  }

  const handleCreate = async () => {
    if (selectedUsers.length === 0) return
    if (type === 'group' && !groupName.trim()) return

    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          participantIds: selectedUsers.map(u => u.id),
          name: type === 'group' ? groupName.trim() : undefined,
          avatarColor: type === 'group' ? groupColor : undefined,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        onCreated(data.conversationId)
        onClose()
      } else {
        const err = await res.json().catch(() => ({}))
        setError(err.error || 'Failed to create conversation')
      }
    } catch {
      setError('Failed to create conversation')
    } finally {
      setCreating(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-[60]" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-md w-full max-w-md mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white">New Chat</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Type toggle */}
        <div className="flex px-4 pt-3 gap-2">
          <button
            onClick={() => { setType('direct'); setSelectedUsers([]) }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded transition-colors ${
              type === 'direct'
                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            <MessageCircle className="w-4 h-4" /> Direct Message
          </button>
          <button
            onClick={() => { setType('group'); setSelectedUsers([]) }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded transition-colors ${
              type === 'group'
                ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            <Users className="w-4 h-4" /> Group Chat
          </button>
        </div>

        {/* Group name + color */}
        {type === 'group' && (
          <div className="px-4 pt-3 space-y-2">
            <input
              type="text"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              placeholder="Group name..."
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:ring-1 focus:ring-blue-500"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">Color:</span>
              {GROUP_COLORS.map(c => (
                <button
                  key={c.value}
                  onClick={() => setGroupColor(c.value)}
                  className={`w-6 h-6 rounded-full ${c.class} ${groupColor === c.value ? 'ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-gray-800' : ''}`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Selected users */}
        {selectedUsers.length > 0 && (
          <div className="px-4 pt-2 flex flex-wrap gap-1">
            {selectedUsers.map(u => (
              <span key={u.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs rounded-full">
                {u.fullName || u.email}
                <button onClick={() => toggleUser(u)} className="hover:text-blue-900">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="px-4 pt-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search staff..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* User list */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-0.5 min-h-0 max-h-60">
          {loadingUsers ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : (
            filteredUsers.map(user => {
              const isSelected = selectedUsers.some(u => u.id === user.id)
              return (
                <button
                  key={user.id}
                  onClick={() => toggleUser(user)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded transition-colors ${
                    isSelected
                      ? 'bg-blue-50 dark:bg-blue-900/20'
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-600 flex items-center justify-center text-xs font-medium text-gray-600 dark:text-gray-300">
                    {(user.fullName || user.email)[0].toUpperCase()}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {user.fullName || user.email}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{user.role}</p>
                  </div>
                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </button>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400 mb-2">{error}</p>
          )}
          <button
            onClick={handleCreate}
            disabled={creating || selectedUsers.length === 0 || (type === 'group' && !groupName.trim())}
            className="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {type === 'direct' ? 'Start Conversation' : 'Create Group'}
          </button>
        </div>
      </div>
    </div>
  )
}
