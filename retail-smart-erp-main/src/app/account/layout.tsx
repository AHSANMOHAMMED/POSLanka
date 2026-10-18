import { accountAuth } from '@/lib/auth/account-auth'
import { redirect } from 'next/navigation'
import { SessionProvider } from 'next-auth/react'
import { AccountShell } from '@/components/account/AccountShell'
import { SessionValidator } from '@/components/auth/SessionValidator'
import { ActivityTracker } from '@/components/auth/ActivityTracker'
import { SystemAnnouncement } from '@/components/layout/SystemAnnouncement'
import { db } from '@/lib/db'
import { accounts } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await accountAuth()

  // Redirect to login if no session or session is invalid (account deleted)
  if (!session || !session.user?.id) {
    redirect('/login')
  }

  // Super admins should only access /sys-control
  if (session.user.accountId) {
    const account = await db.query.accounts.findFirst({
      where: eq(accounts.id, session.user.accountId),
      columns: { isSuperAdmin: true },
    })
    if (account?.isSuperAdmin) {
      redirect('/sys-control')
    }
  }

  return (
    <SessionProvider basePath="/api/account-auth" session={session} refetchInterval={840}>
      <SessionValidator
        validateUrl="/api/account-auth/validate"
        scope="account"
      >
        <ActivityTracker
          heartbeatUrl="/api/account-auth/heartbeat"
          validateUrl="/api/account-auth/validate"
          scope="account"
        />
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
          <SystemAnnouncement />
          <AccountShell>
            {children}
          </AccountShell>
        </div>
      </SessionValidator>
    </SessionProvider>
  )
}
