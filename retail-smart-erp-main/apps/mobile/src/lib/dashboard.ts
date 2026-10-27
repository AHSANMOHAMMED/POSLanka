// Data for the Home dashboard, from existing endpoints only. Each call is made only when the role
// may use it (the server enforces the same permissions), and every part degrades on its own:
//   GET /api/sales/dashboard-stats             viewReports  store totals today / week / month
//   GET /api/reports/daily-sales?fromDate&toDate viewReports  7-day chart
//   GET /api/pos-opening-entries?current=true  createSales  my open shift (cached offline)
//   GET /api/sales?posOpeningEntryId=…         selling      my shift's sales (cash in drawer)
//   GET /api/pos-cash-movements?openingEntryId=…            paid in / paid out of my shift
//   GET /api/sales?pageSize=6                  selling      recent sales
//   GET /api/dashboard/stats                   any role     low-stock count
//   GET /api/purchase-requisitions / employee-advances (pending_approval) approvers
import { apiGet, asList, isNetworkError, qs, type AuthUser } from './api'
import { hasPermission } from './roles'
import { loadShiftOfflineAware, type Shift } from './shift'

export interface SaleRow {
  id: string
  invoiceNo: string
  total: string | number
  status: string
  isReturn?: boolean
  paymentMethod?: string | null
  customerName?: string | null
  customer?: { name?: string | null } | null
  posOpeningEntryId?: string | null
  createdAt: string
  payments?: Array<{ method: string; amount: string | number; voidedAt?: string | null }>
  items?: unknown[]
}

export interface DayPoint {
  date: string
  total: number
  count: number
}

export interface DashboardData {
  /** 'store' = store-wide figures (viewReports), 'shift' = the user's open shift, null = none */
  scope: 'store' | 'shift' | null
  today: { sales: number; count: number; average: number; returns: number } | null
  week: { sales: number; count: number } | null
  month: { sales: number; count: number } | null
  paymentBreakdown: Array<{ method: string; total: number; count: number }>
  shift: Shift | null
  shiftOffline: boolean
  cashInDrawer: number | null
  lowStock: number | null
  pendingApprovals: number | null
  days: DayPoint[] | null
  recent: SaleRow[]
  offline: boolean
  problems: string[]
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Last 7 calendar days (oldest first), zero-filled. */
export function lastSevenDays(rows: Array<{ date: string; totalSales?: number | string; orderCount?: number }>): DayPoint[] {
  const byDate = new Map(rows.map((r) => [r.date, r]))
  const out: DayPoint[] = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const key = isoDay(d)
    const r = byDate.get(key)
    out.push({ date: key, total: num(r?.totalSales), count: num(r?.orderCount) })
  }
  return out
}

function totalOf(body: any): number | null {
  if (body && typeof body === 'object' && body.pagination && typeof body.pagination.total === 'number') return body.pagination.total
  if (body && typeof body.total === 'number') return body.total
  const list = asList(body)
  return list.length
}

export async function loadDashboard(user: AuthUser | null): Promise<DashboardData> {
  const reports = hasPermission(user, 'viewReports')
  const sells = hasPermission(user, 'createSales')
  const approveReq = hasPermission(user, 'approveRequisitions')
  const approveAdv = hasPermission(user, 'approveAdvances')
  const problems: string[] = []

  const today = new Date()
  const from = isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6))
  const to = isoDay(today)

  const [statsRes, dailyRes, shiftRes, recentRes, lowRes, reqRes, advRes] = await Promise.all([
    reports ? apiGet<any>('/api/sales/dashboard-stats') : Promise.resolve(null),
    reports ? apiGet<any>(`/api/reports/daily-sales${qs({ fromDate: from, toDate: to })}`) : Promise.resolve(null),
    sells ? loadShiftOfflineAware().catch(() => null) : Promise.resolve(null),
    apiGet<any>(`/api/sales${qs({ page: 1, pageSize: 6 })}`),
    apiGet<any>('/api/dashboard/stats'),
    approveReq ? apiGet<any>(`/api/purchase-requisitions${qs({ status: 'pending_approval', pageSize: 100 })}`) : Promise.resolve(null),
    approveAdv ? apiGet<any>(`/api/employee-advances${qs({ status: 'pending_approval', pageSize: 100 })}`) : Promise.resolve(null),
  ])

  const offline = isNetworkError(recentRes)
  const data: DashboardData = {
    scope: null,
    today: null,
    week: null,
    month: null,
    paymentBreakdown: [],
    shift: shiftRes?.shift || null,
    shiftOffline: !!shiftRes?.offline && !!shiftRes?.shift,
    cashInDrawer: null,
    lowStock: null,
    pendingApprovals: null,
    days: null,
    recent: recentRes.ok ? asList<SaleRow>(recentRes.data) : [],
    offline,
    problems,
  }

  if (statsRes?.ok && statsRes.data?.today) {
    const t = statsRes.data.today
    const sales = num(t.totalSales)
    const count = num(t.transactionCount)
    data.scope = 'store'
    data.today = { sales: num(t.netSales ?? sales), count, average: count > 0 ? sales / count : 0, returns: num(t.totalReturns) }
    data.week = { sales: num(statsRes.data.week?.netSales), count: num(statsRes.data.week?.transactionCount) }
    data.month = { sales: num(statsRes.data.month?.netSales), count: num(statsRes.data.month?.transactionCount) }
    data.paymentBreakdown = (statsRes.data.paymentBreakdown || []).map((p: any) => ({ method: p.method || 'cash', total: num(p.total), count: num(p.count) }))
  } else if (statsRes && !statsRes.ok && statsRes.status !== 403 && !offline) {
    problems.push(`Store totals: ${statsRes.error}`)
  }

  if (dailyRes?.ok && Array.isArray(dailyRes.data)) data.days = lastSevenDays(dailyRes.data)

  if (lowRes.ok && lowRes.data?.stats) data.lowStock = num(lowRes.data.stats.lowStockItems)

  if (reqRes || advRes) {
    let pending = 0
    let any = false
    for (const r of [reqRes, advRes]) {
      if (r && r.ok) {
        pending += totalOf(r.data) || 0
        any = true
      }
    }
    data.pendingApprovals = any ? pending : null
  }

  // My shift: sales on this shift + paid in / out → cash expected in the drawer
  if (data.shift && !offline) {
    const shift = data.shift
    const [shiftSales, moves] = await Promise.all([
      apiGet<any>(`/api/sales${qs({ posOpeningEntryId: shift.id, page: 1, pageSize: 100 })}`),
      apiGet<any>(`/api/pos-cash-movements${qs({ openingEntryId: shift.id })}`),
    ])
    if (shiftSales.ok) {
      const rows = asList<SaleRow>(shiftSales.data).filter((s) => s.status !== 'void' && (!s.posOpeningEntryId || s.posOpeningEntryId === shift.id))
      let gross = 0
      let returns = 0
      let count = 0
      let cash = 0
      for (const s of rows) {
        const total = num(s.total)
        const tenders = s.payments && s.payments.length ? s.payments.filter((p) => !p.voidedAt) : [{ method: s.paymentMethod || 'cash', amount: total }]
        const cashPart = tenders.filter((p) => (p.method || 'cash') === 'cash').reduce((a, p) => a + num(p.amount), 0)
        if (s.isReturn) {
          returns += Math.abs(total)
          cash -= Math.abs(cashPart)
        } else {
          gross += total
          count += 1
          cash += cashPart
        }
      }
      const opening = num((shift.balances || []).find((b) => b.paymentMethod === 'cash')?.openingAmount)
      let movement = 0
      if (moves.ok) {
        for (const m of asList<any>(moves.data)) {
          if (m.status === 'voided') continue
          movement += m.type === 'paid_in' ? num(m.amount) : m.type === 'paid_out' ? -num(m.amount) : 0
        }
      }
      data.cashInDrawer = Math.round((opening + cash + movement) * 100) / 100
      if (!data.today) {
        data.scope = 'shift'
        data.today = { sales: gross - returns, count, average: count > 0 ? gross / count : 0, returns }
      }
    }
  }

  return data
}

export function saleCustomer(s: SaleRow): string {
  return s.customerName || s.customer?.name || 'Walk-in'
}

export function timeOf(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const sameDay = isoDay(d) === isoDay(new Date())
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return sameDay ? time : `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`
}
