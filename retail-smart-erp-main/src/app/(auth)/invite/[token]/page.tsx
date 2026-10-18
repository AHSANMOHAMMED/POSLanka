'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { Store, User, Lock, Building2, Loader2, CheckCircle, AlertCircle, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface TenantAssignment {
  tenantId: string
  tenantName: string
  tenantSlug: string
  businessType: string
  role: string
}

interface InviteData {
  email: string
  invitedBy: string
  expiresAt: string
  tenantAssignments: TenantAssignment[]
  hasExistingAccount: boolean
}

export default function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = use(params)
  const [invite, setInvite] = useState<InviteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [accepting, setAccepting] = useState(false)
  const [success, setSuccess] = useState(false)

  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    password: '',
    confirmPassword: '',
  })

  useEffect(() => {
    async function fetchInvite() {
      try {
        const res = await fetch(`/api/invites/${token}`)
        const data = await res.json()

        if (!res.ok) {
          setError(data.error || 'Invalid invite')
          return
        }

        setInvite(data)
      } catch {
        setError('Failed to load invite')
      } finally {
        setLoading(false)
      }
    }

    fetchInvite()
  }, [token])

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validate for new accounts
    if (!invite?.hasExistingAccount) {
      if (!formData.fullName.trim()) {
        setError('Please enter your name')
        return
      }
      if (!formData.phone.trim()) {
        setError('Please enter your mobile number')
        return
      }
      if (formData.password.length < 8) {
        setError('Password must be at least 8 characters')
        return
      }
      if (formData.password !== formData.confirmPassword) {
        setError('Passwords do not match')
        return
      }
    }

    setAccepting(true)

    try {
      const res = await fetch(`/api/invites/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          invite?.hasExistingAccount
            ? {}
            : {
                fullName: formData.fullName.trim(),
                phone: formData.phone.trim(),
                password: formData.password,
              }
        ),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to accept invite')
        setAccepting(false)
        return
      }

      setSuccess(true)
    } catch {
      setError('Failed to accept invite')
      setAccepting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3">
          <Loader2 size={24} className="animate-spin text-blue-600" />
          <span className="text-gray-600">Loading invite...</span>
        </div>
      </div>
    )
  }

  if (error && !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Invalid Invite</h2>
            <p className="text-gray-600 mb-6">{error}</p>
            <Link href="/login">
              <Button>Go to Login</Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100 text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Invite Accepted!</h2>
            <p className="text-gray-600 mb-6">
              You now have access to the invited companies. Sign in to get started.
            </p>
            <Link href="/login">
              <Button className="w-full">Sign In</Button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-lg w-full">
        {/* Header */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-12 h-12 bg-blue-600 rounded-md flex items-center justify-center text-white">
            <Store size={28} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Smart POS</h1>
            <p className="text-gray-500 text-sm">Point of Sale System</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold text-gray-900">You&apos;ve Been Invited</h2>
            <p className="text-gray-500 mt-1">
              <span className="font-medium">{invite?.invitedBy}</span> has invited you to join
            </p>
          </div>

          {/* Companies you're invited to */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              You&apos;ll have access to:
            </label>
            <div className="space-y-2">
              {invite?.tenantAssignments.map((t) => (
                <div
                  key={t.tenantId}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-blue-100 rounded flex items-center justify-center">
                      <Building2 className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">{t.tenantName}</div>
                      <div className="text-xs text-gray-500 capitalize">{t.businessType.replace('_', ' ')}</div>
                    </div>
                  </div>
                  <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded capitalize">
                    {t.role}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-600 text-sm">{error}</p>
            </div>
          )}

          {invite?.hasExistingAccount ? (
            // Existing account - just need to accept
            <div>
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-md">
                <p className="text-blue-800 text-sm">
                  Accepting as <span className="font-medium">{invite.email}</span>
                </p>
              </div>
              <Button
                onClick={handleAccept}
                disabled={accepting}
                className="w-full"
              >
                {accepting ? (
                  <>
                    <Loader2 size={20} className="animate-spin mr-2" />
                    Accepting...
                  </>
                ) : (
                  'Accept Invite'
                )}
              </Button>
            </div>
          ) : (
            // New account - need to create
            <form onSubmit={handleAccept} className="space-y-4">
              <div className="p-4 bg-gray-50 rounded">
                <Label className="text-gray-600 text-sm">Email</Label>
                <p className="font-medium text-gray-900">{invite?.email}</p>
              </div>

              <div>
                <Label htmlFor="fullName">Your Name</Label>
                <div className="relative mt-1">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <Input
                    id="fullName"
                    value={formData.fullName}
                    onChange={(e) => setFormData((prev) => ({ ...prev, fullName: e.target.value }))}
                    placeholder="John Doe"
                    className="pl-11"
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="phone">Mobile Number</Label>
                <div className="relative mt-1">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
                    placeholder="+94 77 123 4567"
                    className="pl-11"
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="password">Password</Label>
                <div className="relative mt-1">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <Input
                    id="password"
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                    placeholder="Create a password"
                    className="pl-11"
                    required
                    minLength={8}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">Must be at least 8 characters</p>
              </div>

              <div>
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <div className="relative mt-1">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                    placeholder="Confirm your password"
                    className="pl-11"
                    required
                  />
                </div>
              </div>

              <Button type="submit" disabled={accepting} className="w-full">
                {accepting ? (
                  <>
                    <Loader2 size={20} className="animate-spin mr-2" />
                    Creating Account...
                  </>
                ) : (
                  'Create Account & Accept'
                )}
              </Button>
            </form>
          )}

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
              Already have an account?{' '}
              <Link href="/login" className="text-blue-600 hover:text-blue-700 font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
