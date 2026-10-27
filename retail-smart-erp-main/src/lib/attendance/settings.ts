/**
 * Tenant HR / attendance settings, stored at tenants.settings.hr (other settings keys untouched).
 *
 *  attendancePayroll
 *    undefined (default, "auto"): an employee's payroll uses attendance when the employee is
 *      attendance-tracked — has a fingerprint user id, or any punch / attendance day in the period.
 *      Everyone else keeps the old behaviour (payment days = working days entered on the run).
 *    true: every employee's payroll uses attendance (no record on a past working day = absent).
 *    false: attendance never changes payroll.
 *  workingDaysMode
 *    'calendar' (default): working days = calendar days of the month; weekly offs and paid
 *      holidays are paid days, so pay = base / days-in-month × paid days (Sri Lankan monthly staff).
 *    'shift': working days = days that are not a weekly off; weekly offs are neither.
 *  absenceMode
 *    'prorate' (default): absent days reduce payment days, and components marked "depends on
 *      payment days" (basic, allowances, EPF/ETF on BP) are pro-rated.
 *    'nopay': payment days stay = working days and absence is charged through a "No-pay"
 *      deduction component (formula daily_rate * absent_days).
 */
import { sql, eq } from 'drizzle-orm'
import { tenants } from '@/lib/db/schema'
import type { TenantDb } from '@/lib/db'
import { safeTimezone } from './time'

export interface HrSettings {
  attendancePayroll?: boolean
  workingDaysMode: 'calendar' | 'shift'
  absenceMode: 'prorate' | 'nopay'
  /** Normal overtime multiplier when the employee has none (employee_profiles.ot_rate_multiplier wins) */
  otMultiplier: number
  /** Overtime on weekly offs and holidays */
  holidayOtMultiplier: number
  /** Default shift when an employee has no assignment / default shift (else the shift marked default) */
  defaultShiftId?: string | null
  /** How a day with a single punch (no check-out) counts */
  missedPunchAs: 'present' | 'half_day' | 'absent'
  /** Fixed hourly-rate divisor (e.g. 240 = 30 days × 8 h); 0/undefined = working days × shift hours */
  otHourlyDivisor?: number | null
  /** Punches closer than this are duplicates (seconds) */
  duplicatePunchSeconds: number
}

export const DEFAULT_HR_SETTINGS: HrSettings = {
  workingDaysMode: 'calendar',
  absenceMode: 'prorate',
  otMultiplier: 1.5,
  holidayOtMultiplier: 2,
  defaultShiftId: null,
  missedPunchAs: 'present',
  otHourlyDivisor: null,
  duplicatePunchSeconds: 120,
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback
}

export function normalizeHrSettings(raw: unknown): HrSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    attendancePayroll: typeof r.attendancePayroll === 'boolean' ? r.attendancePayroll : undefined,
    workingDaysMode: r.workingDaysMode === 'shift' ? 'shift' : 'calendar',
    absenceMode: r.absenceMode === 'nopay' ? 'nopay' : 'prorate',
    otMultiplier: num(r.otMultiplier, DEFAULT_HR_SETTINGS.otMultiplier, 0, 10),
    holidayOtMultiplier: num(r.holidayOtMultiplier, DEFAULT_HR_SETTINGS.holidayOtMultiplier, 0, 10),
    defaultShiftId: typeof r.defaultShiftId === 'string' && r.defaultShiftId ? r.defaultShiftId : null,
    missedPunchAs: r.missedPunchAs === 'half_day' || r.missedPunchAs === 'absent' ? r.missedPunchAs : 'present',
    otHourlyDivisor: r.otHourlyDivisor ? num(r.otHourlyDivisor, 0, 0, 10000) || null : null,
    duplicatePunchSeconds: num(r.duplicatePunchSeconds, DEFAULT_HR_SETTINGS.duplicatePunchSeconds, 0, 3600),
  }
}

/** HR settings + the tenant time zone. tenants has no RLS: always filtered by id. */
export async function loadHrSettings(db: Pick<TenantDb, 'select'>, tenantId: string): Promise<{ settings: HrSettings; timezone: string }> {
  const [row] = await db.select({ settings: tenants.settings, timezone: tenants.timezone })
    .from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  const all = (row?.settings && typeof row.settings === 'object' ? row.settings : {}) as Record<string, unknown>
  return { settings: normalizeHrSettings(all.hr), timezone: safeTimezone(row?.timezone) }
}

export async function saveHrSettings(db: Pick<TenantDb, 'update'>, tenantId: string, value: unknown): Promise<HrSettings> {
  const normalized = normalizeHrSettings(value)
  const stored: Record<string, unknown> = { ...normalized }
  if (normalized.attendancePayroll === undefined) delete stored.attendancePayroll
  await db.update(tenants)
    .set({ settings: sql`jsonb_set(COALESCE(${tenants.settings}, '{}'::jsonb), '{hr}', ${JSON.stringify(stored)}::jsonb, true)` })
    .where(eq(tenants.id, tenantId))
  return normalized
}
