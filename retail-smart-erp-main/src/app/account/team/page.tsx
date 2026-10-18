'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Users,
  Mail,
  Search,
  MoreHorizontal,
  UserPlus,
  Clock,
  X,
  Loader2,
  Crown,
  Building2
} from 'lucide-react'

interface TeamMember {
  id: string
  accountId: string
  fullName: string
  email: string
  role: string
  isOwner: boolean
  sites: { id: string; name: string; role: string }[]
  joinedAt: string
}

interface Invite {
  id: string
  email: string
  status: string
  expiresAt: string
  createdAt: string
  tenantAssignments: { tenantId: string; tenantName: string; role: string }[]
}

export default function TeamPage() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [resending, setResending] = useState<string | null>(null)

  const fetchTeam = useCallback(async () => {
    try {
      const [membersRes, invitesRes] = await Promise.all([
        fetch('/api/account/team'),
        fetch('/api/account/invites'),
      ])

      if (membersRes.ok) {
        const data = await membersRes.json()
        setMembers(data.members || [])
      }

      if (invitesRes.ok) {
        const data = await invitesRes.json()
        setInvites(data || [])
      }
    } catch (error) {
      console.error('Failed to fetch team:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTeam()
  }, [fetchTeam])

  const handleInvite = async () => {
    if (!inviteEmail) return
    setInviting(true)

    try {
      const res = await fetch('/api/account/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          tenantAssignments: [],
        }),
      })

      if (res.ok) {
        setInviteEmail('')
        setShowInviteModal(false)
        fetchTeam()
      }
    } catch (error) {
      console.error('Failed to send invite:', error)
    } finally {
      setInviting(false)
    }
  }

  const handleResendInvite = async (inviteId: string) => {
    setResending(inviteId)
    try {
      const res = await fetch(`/api/account/invites/${inviteId}/resend`, {
        method: 'POST',
      })
      if (res.ok) {
        fetchTeam()
      }
    } catch (error) {
      console.error('Failed to resend invite:', error)
    } finally {
      setResending(null)
    }
  }

  const filteredMembers = members.filter(
    (m) =>
      m.fullName.toLowerCase().includes(search.toLowerCase()) ||
      m.email.toLowerCase().includes(search.toLowerCase())
  )

  const pendingInvites = invites.filter((i) => i.status === 'pending')

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400 dark:text-gray-500" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Account Team</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Invite people to manage billing and view sites. For POS staff (cashiers, technicians), use Staff in each site&apos;s settings.
          </p>
        </div>
        <button
          onClick={() => setShowInviteModal(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 rounded-md hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors font-medium"
        >
          <UserPlus className="w-4 h-4" />
          Invite Member
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-gray-500" />
        <input
          type="text"
          placeholder="Search members..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-12 pr-4 py-3 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md text-sm dark:text-white focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-400 focus:border-transparent placeholder:text-gray-400 dark:placeholder:text-gray-500"
        />
      </div>

      {/* Pending Invites */}
      {pendingInvites.length > 0 && (
        <div className="bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/30 dark:to-yellow-900/30 border border-amber-200 dark:border-amber-700 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-amber-200 dark:border-amber-700 flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 dark:bg-amber-800/50 rounded-md flex items-center justify-center">
              <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="font-semibold text-amber-900 dark:text-amber-300">Pending Invitations</h3>
              <p className="text-sm text-amber-700 dark:text-amber-400">{pendingInvites.length} invitation{pendingInvites.length > 1 ? 's' : ''} awaiting response</p>
            </div>
          </div>
          <div className="divide-y divide-amber-200 dark:divide-amber-700">
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="px-6 py-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-amber-100 dark:bg-amber-800/50 rounded-md flex items-center justify-center">
                    <Mail className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{invite.email}</p>
                    <p className="text-sm text-amber-700 dark:text-amber-400">
                      Expires {new Date(invite.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleResendInvite(invite.id)}
                  disabled={resending === invite.id}
                  className="px-4 py-2 text-sm font-medium text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-800/50 rounded transition-colors disabled:opacity-50"
                >
                  {resending === invite.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Resend'
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Members List */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-md flex items-center justify-center">
            <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Team Members</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">{members.length} member{members.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        {filteredMembers.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-gray-300 dark:text-gray-500" />
            </div>
            <p className="text-gray-500 dark:text-gray-400 font-medium">No team members found</p>
            {members.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Invite your first team member to get started</p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {filteredMembers.map((member) => (
              <div key={member.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-gray-700 to-gray-900 rounded-md flex items-center justify-center">
                    <span className="text-lg font-semibold text-white">
                      {member.fullName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900 dark:text-white">{member.fullName}</p>
                      {member.isOwner && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 text-xs font-medium rounded-full">
                          <Crown className="w-3 h-3" />
                          Owner
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{member.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="hidden md:flex flex-wrap gap-1 max-w-xs">
                    {member.sites.slice(0, 2).map((site) => (
                      <span
                        key={site.id}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs rounded"
                      >
                        <Building2 className="w-3 h-3" />
                        {site.name}
                        <span className="text-gray-400 dark:text-gray-500">({site.role})</span>
                      </span>
                    ))}
                    {member.sites.length > 2 && (
                      <span className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1">
                        +{member.sites.length - 2} more
                      </span>
                    )}
                  </div>
                  <div className="hidden lg:block text-sm text-gray-500 dark:text-gray-400">
                    {new Date(member.joinedAt).toLocaleDateString()}
                  </div>
                  <button className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors">
                    <MoreHorizontal className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-md flex items-center justify-center">
                  <UserPlus className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Invite Team Member</h2>
              </div>
              <button
                onClick={() => setShowInviteModal(false)}
                className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-gray-500" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@example.com"
                    className="w-full pl-12 pr-4 py-3 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-400 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                  />
                </div>
              </div>
              <div className="p-4 bg-blue-50 dark:bg-blue-900/30 rounded-md">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  An invitation email will be sent. They can accept and join your team with access to manage billing and view sites.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 rounded-b-2xl">
              <button
                onClick={() => setShowInviteModal(false)}
                className="px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleInvite}
                disabled={!inviteEmail || inviting}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white dark:text-gray-900 bg-gray-900 dark:bg-gray-100 hover:bg-gray-800 dark:hover:bg-gray-200 rounded-md disabled:opacity-50 transition-colors"
              >
                {inviting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4" />
                    Send Invite
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
