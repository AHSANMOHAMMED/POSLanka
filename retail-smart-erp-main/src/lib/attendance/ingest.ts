/**
 * Store punches (device push, USB/CSV import, manual entry) and recompute the affected days.
 * Device user ids (PIN / enrolment no.) are mapped to employees through
 * employee_profiles.biometric_user_id; unmapped punches are kept (employee NULL) and attached
 * later by mapUnmappedPunches when the admin maps the user id on the Devices page.
 */
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm'
import type { TenantDb } from '@/lib/db'
import { attendancePunches, employeeProfiles } from '@/lib/db/schema'
import { recomputeForPunches } from './compute'

export interface PunchInput {
  biometricUserId?: string | null
  employeeProfileId?: string | null
  punchTime: Date
  punchType?: 'in' | 'out' | 'unknown'
  verifyMode?: string | null
  source: 'device' | 'manual' | 'import' | 'mobile'
  deviceId?: string | null
  raw?: Record<string, unknown> | null
  note?: string | null
  createdBy?: string | null
}

export interface IngestResult {
  received: number
  inserted: number
  duplicates: number
  unmapped: number
}

export function normalizeBiometricId(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  // Devices pad nothing, spreadsheets turn "007" into 7 — compare without leading zeros
  return s.replace(/^0+(?=\d)/, '').slice(0, 50)
}

export async function ingestPunches(db: TenantDb, tenantId: string, punches: PunchInput[], timezone: string): Promise<IngestResult> {
  const result: IngestResult = { received: punches.length, inserted: 0, duplicates: 0, unmapped: 0 }
  if (punches.length === 0) return result

  const ids = [...new Set(punches.map((p) => normalizeBiometricId(p.biometricUserId)).filter((v): v is string => !!v))]
  const map = new Map<string, string>()
  if (ids.length > 0) {
    const rows = await db.select({ id: employeeProfiles.id, bio: employeeProfiles.biometricUserId })
      .from(employeeProfiles).where(and(isNotNull(employeeProfiles.biometricUserId)))
    for (const r of rows) {
      const key = normalizeBiometricId(r.bio)
      if (key) map.set(key, r.id)
    }
  }

  const values = punches
    .filter((p) => p.punchTime instanceof Date && !Number.isNaN(p.punchTime.getTime()))
    .map((p) => {
      const bio = normalizeBiometricId(p.biometricUserId)
      const employeeProfileId = p.employeeProfileId || (bio ? map.get(bio) ?? null : null)
      return {
        tenantId,
        employeeProfileId,
        biometricUserId: bio,
        deviceId: p.deviceId ?? null,
        punchTime: p.punchTime,
        punchType: p.punchType ?? 'unknown',
        verifyMode: p.verifyMode ? String(p.verifyMode).slice(0, 20) : null,
        source: p.source,
        raw: p.raw ?? null,
        note: p.note ?? null,
        createdBy: p.createdBy ?? null,
      }
    })

  const byEmployee = new Map<string, Date[]>()
  const CHUNK = 500
  for (let i = 0; i < values.length; i += CHUNK) {
    const inserted = await db.insert(attendancePunches).values(values.slice(i, i + CHUNK))
      .onConflictDoNothing()
      .returning({ employeeProfileId: attendancePunches.employeeProfileId, punchTime: attendancePunches.punchTime })
    result.inserted += inserted.length
    for (const r of inserted) {
      if (!r.employeeProfileId) { result.unmapped++; continue }
      const list = byEmployee.get(r.employeeProfileId) ?? []
      list.push(new Date(r.punchTime))
      byEmployee.set(r.employeeProfileId, list)
    }
  }
  result.duplicates = values.length - result.inserted

  if (byEmployee.size > 0) await recomputeForPunches(db, tenantId, byEmployee, timezone)
  return result
}

/**
 * Attach earlier unmapped punches of a device user id to the employee (after the admin sets the
 * employee's biometric user id) and recompute those days. Returns the number of punches attached.
 */
export async function mapUnmappedPunches(db: TenantDb, tenantId: string, biometricUserId: string, employeeProfileId: string, timezone: string): Promise<number> {
  const bio = normalizeBiometricId(biometricUserId)
  if (!bio) return 0
  const rows = await db.update(attendancePunches)
    .set({ employeeProfileId })
    .where(and(isNull(attendancePunches.employeeProfileId), eq(attendancePunches.biometricUserId, bio)))
    .returning({ punchTime: attendancePunches.punchTime })
  if (rows.length > 0) {
    await recomputeForPunches(db, tenantId, new Map([[employeeProfileId, rows.map((r) => new Date(r.punchTime))]]), timezone)
  }
  return rows.length
}

/** Unmapped device user ids with their punch counts (Devices page). */
export function listUnmappedUserIds(db: TenantDb) {
  return db.select({
    biometricUserId: attendancePunches.biometricUserId,
    deviceId: sql<string | null>`(array_agg(${attendancePunches.deviceId}))[1]`,
    punches: sql<number>`count(*)::int`,
    firstPunch: sql<string>`min(${attendancePunches.punchTime})`,
    lastPunch: sql<string>`max(${attendancePunches.punchTime})`,
  }).from(attendancePunches)
    .where(and(isNull(attendancePunches.employeeProfileId), eq(attendancePunches.isDeleted, false), isNotNull(attendancePunches.biometricUserId)))
    .groupBy(attendancePunches.biometricUserId)
    .orderBy(attendancePunches.biometricUserId)
    .limit(500)
}
