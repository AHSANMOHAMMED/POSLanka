import React, { useMemo } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { AccessBlockedView } from '../src/components/AccessBlockedView'
import { clearSession } from '../src/lib/api'

/**
 * Full-screen gate after login (or mid-session) when the company is
 * suspended / locked / archived. Params come from the server TENANT_LOCKED payload.
 */
export default function AccessBlockedScreen() {
  const params = useLocalSearchParams<{
    status?: string
    lockedReason?: string
    title?: string
    description?: string
    error?: string
    tenantName?: string
  }>()

  const props = useMemo(
    () => ({
      status: typeof params.status === 'string' ? params.status : null,
      lockedReason: typeof params.lockedReason === 'string' ? params.lockedReason : null,
      title: typeof params.title === 'string' ? params.title : null,
      description: typeof params.description === 'string' ? params.description : null,
      error: typeof params.error === 'string' ? params.error : null,
      tenantName: typeof params.tenantName === 'string' ? params.tenantName : null,
    }),
    [params],
  )

  async function backToLogin() {
    await clearSession().catch(() => undefined)
    router.replace('/login')
  }

  return <AccessBlockedView {...props} onBackToLogin={backToLogin} />
}
