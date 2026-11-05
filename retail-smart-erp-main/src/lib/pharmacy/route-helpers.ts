/** Small shared bits for the /api/pharmacy routes */
import { NextResponse } from 'next/server'
import { hasPermission, type Permission } from '@/lib/auth/roles'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface SessionLike { user: { role: string; tenantId: string; customRoleId?: string | null } }

/** 403 unless the user has at least one of these permissions */
export function requireAnyPermission(session: SessionLike, perms: Permission[]): NextResponse | null {
  const ok = perms.some((p) => hasPermission(session.user.role, p, session.user.tenantId, session.user.customRoleId))
  return ok ? null : NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/** ?from=&to= (YYYY-MM-DD); defaults to the first of this month … today. Swapped when reversed. */
export function dateRange(sp: URLSearchParams): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10)
  let from = sp.get('from') || ''
  let to = sp.get('to') || ''
  if (!DATE_RE.test(from)) from = `${today.slice(0, 8)}01`
  if (!DATE_RE.test(to)) to = today
  return from <= to ? { from, to } : { from: to, to: from }
}

/** A uuid query parameter, or null (anything else is ignored) */
export function uuidParam(sp: URLSearchParams, name: string): string | null {
  const v = sp.get(name)
  return v && UUID_RE.test(v) ? v : null
}
