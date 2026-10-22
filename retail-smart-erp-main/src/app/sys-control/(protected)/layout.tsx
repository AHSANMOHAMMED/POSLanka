import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getAdminFromSession } from '@/lib/admin'
import { SuperAdminLayoutShell } from '@/components/admin/SuperAdminLayoutShell'
import { AccountSetupGate } from '@/components/admin/AccountSetupGate'

export const metadata: Metadata = {
  title: { default: 'Platform admin', template: '%s · POSLanka admin' },
  robots: { index: false, follow: false },
}

export default async function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Validates the super_admins session and loads the admin in one call
  const admin = await getAdminFromSession()

  if (!admin) {
    redirect('/sys-control/login')
  }

  // Another admin reset this password or requires 2FA: finish that before anything else
  const gate = admin.mustChangePassword ? 'password' : admin.totpRequired && !admin.totpEnabled ? 'totp' : null

  return (
    <SuperAdminLayoutShell adminEmail={admin.email} adminName={admin.fullName} adminRole={admin.role}>
      {gate ? <AccountSetupGate mode={gate} /> : children}
    </SuperAdminLayoutShell>
  )
}
