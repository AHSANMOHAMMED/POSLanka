'use client'

import { useSession, signOut } from 'next-auth/react'

export function ImpersonationBanner() {
  const { data: session } = useSession()
  if (!session?.user?.impersonating) return null

  const admin = session.user.impersonatedByAdminEmail || 'Super Admin'

  return (
    <div className="bg-amber-500 text-amber-950 text-sm px-4 py-2 flex items-center justify-between gap-3">
      <span>
        Support mode: you are impersonating <strong>{session.user.tenantName}</strong> as owner
        (started by {admin}).
      </span>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: '/sys-control/vendors' })}
        className="shrink-0 px-3 py-1 rounded bg-amber-950 text-amber-50 text-xs font-medium"
      >
        Exit impersonation
      </button>
    </div>
  )
}
