import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { accountTenants } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

/**
 * Legacy dashboard layout - redirects to new /c/[slug] path structure.
 * This handles old bookmarks and links that don't include the company slug.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()

  // Redirect to login if no session
  if (!session || !session.user?.id) {
    redirect('/login')
  }

  // If user has an accountId, find their first company and redirect
  if (session.user.accountId) {
    const membership = await db.query.accountTenants.findFirst({
      where: and(
        eq(accountTenants.accountId, session.user.accountId),
        eq(accountTenants.isActive, true)
      ),
      with: {
        tenant: true,
      },
    })

    const tenant = Array.isArray(membership?.tenant) ? membership.tenant[0] : membership?.tenant
    if (tenant) {
      // Redirect to the new path structure
      redirect(`/c/${tenant.slug}/dashboard`)
    }

    // No companies - redirect to account page to create one
    redirect('/account')
  }

  // Legacy users without accountId - redirect to account page
  redirect('/account')
}
