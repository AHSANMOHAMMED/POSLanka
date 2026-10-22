import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { validateAdminSession } from '@/lib/admin'
import { AdminLoginForm } from './AdminLoginForm'

export const metadata: Metadata = {
  title: 'Admin sign in',
  robots: { index: false, follow: false },
}

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const [session, params] = await Promise.all([validateAdminSession({ permission: 'self', allowPendingSetup: true }), searchParams])
  if (session) redirect('/sys-control')
  return <AdminLoginForm sessionExpired={params.session === 'expired'} />
}
