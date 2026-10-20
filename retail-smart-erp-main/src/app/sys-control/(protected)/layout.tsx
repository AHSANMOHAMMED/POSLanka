import { redirect } from 'next/navigation'
import { validateAdminSession, getAdminFromSession } from '@/lib/admin'
import { SuperAdminLayoutShell } from '@/components/admin/SuperAdminLayoutShell'

export default async function AdminProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Validate admin session from super_admins table
  const session = await validateAdminSession()

  // Redirect to admin login if not authenticated
  if (!session) {
    redirect('/sys-control/login')
  }

  // Get admin details
  const admin = await getAdminFromSession()

  return (
    <SuperAdminLayoutShell adminEmail={admin?.email}>
      {children}
    </SuperAdminLayoutShell>
  )
}
