import { NextResponse } from 'next/server'
import { hasPermission } from '@/lib/auth/roles'
import type { ChequeError } from '@/lib/cheques/cheques'
import type { ExpenseError } from './expenses'

interface SessionLike { user: { role: string; tenantId: string; customRoleId?: string | null } }

/** Accounts: record office / bank expenses, approve, pay and void claims. */
export function canManageExpenses(session: SessionLike): boolean {
  return hasPermission(session.user.role, 'manageAccounting', session.user.tenantId, session.user.customRoleId)
}

export function expenseErrorResponse(error: ChequeError | ExpenseError) {
  const extra = 'extra' in error ? error.extra : {}
  return NextResponse.json({ error: error.message, code: error.code, ...extra }, { status: error.status })
}
