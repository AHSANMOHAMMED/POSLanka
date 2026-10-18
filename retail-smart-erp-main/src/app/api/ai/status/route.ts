import { NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { isAIEnabled, isAIEnabledForTenant, getTokenUsage, getLastError, getActiveProvider } from '@/lib/ai/gemini'

export async function GET() {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const serverEnabled = isAIEnabled()
  const tenantEnabled = isAIEnabledForTenant(session)

  return NextResponse.json({
    enabled: tenantEnabled,
    serverEnabled,
    tenantEnabled: session.user.aiEnabled,
    provider: tenantEnabled ? getActiveProvider() : null,
    usage: tenantEnabled ? getTokenUsage() : null,
    lastError: tenantEnabled ? getLastError() : null,
  })
}
