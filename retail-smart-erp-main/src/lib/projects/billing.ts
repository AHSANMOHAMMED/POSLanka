/**
 * Project billing math (drizzle/0185). Pure and client-safe: the project page previews the invoice
 * with the same function the invoice route bills with.
 *
 * Billing methods:
 *  - fixed:          one line, the fixed price (or what is left of it); time is not billed
 *  - project_hourly: unbilled billable hours × the project's rate (one line per task)
 *  - staff_hourly:   hours × the rate of the member who logged them (one line per member)
 *  - task_hourly:    hours × the task's rate (one line per task)
 * An entry is billable when the entry and its task are billable, it is not invoiced and its timer
 * is not running. Line quantity = hours (3 decimals), amount = rate × quantity (rounded to cents).
 */

export type BillingMethod = 'fixed' | 'project_hourly' | 'staff_hourly' | 'task_hourly'

export interface BillingProject {
  name: string
  billingMethod: BillingMethod
  projectRate: number
  fixedAmount: number
  /** fixed price already invoiced */
  fixedInvoiced: number
}
export interface BillingTask { id: string; name: string; rate: number; billable: boolean }
export interface BillingMember { userId: string; name: string; rate: number }
export interface BillingEntry {
  id: string; taskId: string | null; userId: string; durationMinutes: number
  billable: boolean; invoiced: boolean; isRunning: boolean
}

export interface BillingLine {
  key: string
  name: string
  minutes: number
  hours: number
  rate: number
  amount: number
  entryIds: string[]
  kind: 'time' | 'fixed'
}

export interface BillingPreview {
  lines: BillingLine[]
  totalMinutes: number
  totalAmount: number
  fixedRemaining: number
  /** entry id → rate it is billed at */
  entryRates: Record<string, number>
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const r3 = (n: number) => Math.round(n * 1000) / 1000

export function isBillableEntry(e: BillingEntry, tasks: Map<string, BillingTask>): boolean {
  if (!e.billable || e.invoiced || e.isRunning || e.durationMinutes <= 0) return false
  const t = e.taskId ? tasks.get(e.taskId) : undefined
  return !t || t.billable
}

export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

export function previewProjectInvoice(
  project: BillingProject, tasks: BillingTask[], members: BillingMember[], entries: BillingEntry[],
  opts: { includeTime?: boolean; fixedAmount?: number; entryIds?: string[] } = {},
): BillingPreview {
  const taskMap = new Map(tasks.map((t) => [t.id, t]))
  const memberMap = new Map(members.map((m) => [m.userId, m]))
  const fixedRemaining = r2(Math.max(0, project.fixedAmount - project.fixedInvoiced))
  const lines: BillingLine[] = []
  const entryRates: Record<string, number> = {}

  if (project.billingMethod === 'fixed') {
    const amount = r2(Math.max(0, opts.fixedAmount ?? fixedRemaining))
    if (amount > 0) {
      lines.push({ key: 'fixed', name: `${project.name} — fixed price`, minutes: 0, hours: 1, rate: amount, amount, entryIds: [], kind: 'fixed' })
    }
    return { lines, totalMinutes: 0, totalAmount: amount, fixedRemaining, entryRates }
  }

  if (opts.includeTime === false) return { lines, totalMinutes: 0, totalAmount: 0, fixedRemaining, entryRates }
  const only = opts.entryIds ? new Set(opts.entryIds) : null
  const groups = new Map<string, BillingLine>()
  for (const e of entries) {
    if (only && !only.has(e.id)) continue
    if (!isBillableEntry(e, taskMap)) continue
    const task = e.taskId ? taskMap.get(e.taskId) : undefined
    let key: string; let label: string; let rate: number
    if (project.billingMethod === 'staff_hourly') {
      const m = memberMap.get(e.userId)
      key = `user:${e.userId}`; label = m?.name || 'Staff'; rate = m?.rate ?? 0
    } else if (project.billingMethod === 'task_hourly') {
      key = `task:${task?.id || 'none'}`; label = task?.name || 'General'; rate = task?.rate ?? 0
    } else {
      key = `task:${task?.id || 'none'}`; label = task?.name || 'General'; rate = project.projectRate
    }
    entryRates[e.id] = rate
    const g = groups.get(key) || { key, name: `${project.name} — ${label}`, minutes: 0, hours: 0, rate, amount: 0, entryIds: [], kind: 'time' as const }
    g.minutes += e.durationMinutes
    g.entryIds.push(e.id)
    groups.set(key, g)
  }
  for (const g of groups.values()) {
    g.hours = r3(g.minutes / 60)
    g.amount = r2(g.rate * g.hours)
    lines.push(g)
  }
  lines.sort((a, b) => a.name.localeCompare(b.name))
  return {
    lines,
    totalMinutes: lines.reduce((s, l) => s + l.minutes, 0),
    totalAmount: r2(lines.reduce((s, l) => s + l.amount, 0)),
    fixedRemaining,
    entryRates,
  }
}

/** Minutes between two HH:MM times of one day */
export function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}
