import { redirect } from 'next/navigation'
import Link from 'next/link'
import { AdminSessionTimer } from '@/components/admin/AdminSessionTimer'
import { validateAdminSession, getAdminFromSession } from '@/lib/admin'

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
    <div className="min-h-screen bg-gray-100">
      {/* Admin Header */}
      <header className="bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <Link href="/sys-control" className="font-bold text-lg">
                Admin Panel
              </Link>
              <nav className="flex gap-6">
                <Link
                  href="/sys-control"
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  Dashboard
                </Link>
                <Link
                  href="/sys-control/vendors"
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  Vendors
                </Link>
                <Link
                  href="/sys-control/users"
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  Users
                </Link>
                <Link
                  href="/sys-control/payments"
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  Payments
                </Link>
                <Link
                  href="/sys-control/subscriptions"
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  Subscriptions
                </Link>
                <Link
                  href="/sys-control/audit-logs"
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  Audit Logs
                </Link>
                <Link
                  href="/sys-control/error-logs"
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  Error Logs
                </Link>
                <Link
                  href="/sys-control/pricing"
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  Pricing
                </Link>
                <Link
                  href="/sys-control/messages"
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  Messages
                </Link>
                <Link
                  href="/sys-control/notifications"
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  Notifications
                </Link>
                <Link
                  href="/sys-control/settings"
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  Settings
                </Link>
                <Link
                  href="/sys-control/send-email"
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  Send Email
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <AdminSessionTimer />
              <span className="text-sm text-gray-400">{admin?.email}</span>
              <form action="/api/sys-control/auth/logout" method="POST" className="inline">
                <button
                  type="submit"
                  className="text-sm text-gray-400 hover:text-white"
                >
                  Logout
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  )
}
