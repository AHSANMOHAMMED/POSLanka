'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { AlertCircle, Building2, CheckCircle2, Lock, Phone, User } from 'lucide-react'
import {
  Alert,
  AuthHeading,
  AuthResult,
  AuthShell,
  Badge,
  Button,
  Field,
  Input,
  LinkButton,
  PasswordInput,
  Skeleton,
  businessTypeLabel,
} from '@/components/admin/kit'

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

  const single = invite?.tenantAssignments.length === 1 ? invite.tenantAssignments[0] : null
  const signInHref = single ? `/c/${single.tenantSlug}/login?invited=true` : '/login?tab=account'

  if (loading) {
    return (
      <AuthShell aside={null}>
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </AuthShell>
    )
  }

  if (error && !invite) {
    return (
      <AuthShell aside={null}>
        <AuthResult icon={<AlertCircle size={26} aria-hidden />} tone="danger" title="This invite can’t be used" description={error}>
          <LinkButton href="/login" variant="primary" size="lg" className="w-full">Go to sign in</LinkButton>
        </AuthResult>
      </AuthShell>
    )
  }

  if (success) {
    return (
      <AuthShell aside={null}>
        <AuthResult
          icon={<CheckCircle2 size={26} aria-hidden />}
          title="You’re in"
          description={single ? `You now have access to ${single.tenantName}. Sign in to get started.` : 'You now have access to the companies you were invited to. Sign in to get started.'}
        >
          <LinkButton href={signInHref} variant="primary" size="lg" className="w-full">Sign in</LinkButton>
        </AuthResult>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      width="md"
      footer={
        <>
          Already have an account?{' '}
          <Link href={signInHref} className="font-medium text-adm-primary hover:underline">Sign in</Link>
        </>
      }
    >
      <AuthHeading
        title="You’ve been invited"
        description={<><span className="font-medium text-adm-fg">{invite?.invitedBy}</span> invited <span className="font-medium text-adm-fg break-all">{invite?.email}</span> to join:</>}
      />

      <ul className="mb-6 space-y-2">
        {invite?.tenantAssignments.map((t) => (
          <li key={t.tenantId} className="flex items-center justify-between gap-3 rounded-xl border border-adm-border bg-adm-surface px-3.5 py-3">
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-adm-primary-soft text-adm-primary-soft-fg">
                <Building2 size={18} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium text-adm-fg">{t.tenantName}</span>
                <span className="block text-[12.5px] text-adm-subtle">{businessTypeLabel(t.businessType)}</span>
              </span>
            </span>
            <Badge tone="primary" className="capitalize">{t.role.replace(/_/g, ' ')}</Badge>
          </li>
        ))}
      </ul>

      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}

      {invite?.hasExistingAccount ? (
        <div className="space-y-4">
          <p className="text-[14px] text-adm-muted">You already have a skyERPOS account, so accepting just adds these companies to it.</p>
          <Button variant="primary" size="lg" fullWidth onClick={handleAccept} loading={accepting}>
            {accepting ? 'Accepting…' : 'Accept invite'}
          </Button>
        </div>
      ) : (
        <form onSubmit={handleAccept} className="space-y-4">
          <Field label="Your name" htmlFor="fullName">
            <Input id="fullName" leftIcon={User} size="lg" value={formData.fullName} onChange={(e) => setFormData((prev) => ({ ...prev, fullName: e.target.value }))} placeholder="Nimal Perera" autoComplete="name" required />
          </Field>
          <Field label="Mobile number" htmlFor="phone">
            <Input id="phone" type="tel" leftIcon={Phone} size="lg" value={formData.phone} onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))} placeholder="+94 77 123 4567" autoComplete="tel" required />
          </Field>
          <Field label="Password" htmlFor="password" hint="At least 8 characters.">
            <PasswordInput id="password" leftIcon={Lock} size="lg" value={formData.password} onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))} placeholder="Create a password" autoComplete="new-password" required minLength={8} />
          </Field>
          <Field label="Confirm password" htmlFor="confirmPassword">
            <PasswordInput id="confirmPassword" leftIcon={Lock} size="lg" value={formData.confirmPassword} onChange={(e) => setFormData((prev) => ({ ...prev, confirmPassword: e.target.value }))} placeholder="Type it again" autoComplete="new-password" required invalid={!!formData.confirmPassword && formData.confirmPassword !== formData.password} />
          </Field>
          <Button type="submit" variant="primary" size="lg" fullWidth loading={accepting}>
            {accepting ? 'Creating account…' : 'Create account and join'}
          </Button>
        </form>
      )}
    </AuthShell>
  )
}
