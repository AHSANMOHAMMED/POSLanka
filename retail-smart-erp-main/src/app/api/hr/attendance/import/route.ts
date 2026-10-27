import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/db'
import { employeeProfiles } from '@/lib/db/schema'
import { readFormData } from '@/lib/api/form-data'
import { hrAuth, hrError, scopedEmployeeIds } from '@/lib/attendance/api'
import { parsePunchFile } from '@/lib/attendance/import-file'
import { ingestPunches, normalizeBiometricId } from '@/lib/attendance/ingest'
import { loadHrSettings } from '@/lib/attendance/settings'
import { localToUtc } from '@/lib/attendance/time'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

export const runtime = 'nodejs'
const MAX_FILE_BYTES = 10 * 1024 * 1024

/**
 * POST /api/hr/attendance/import (multipart: file) — punches exported from a fingerprint machine
 * (USB attlog.dat / txt) or a CSV / Excel sheet (user id + date-time [+ state]). The user id is
 * matched to the employee's fingerprint user id, else to the employee code. Unknown ids are kept
 * as unmapped punches (map them on the Fingerprint Devices page). Re-importing is safe: duplicate
 * punches are ignored.
 */
export async function POST(request: NextRequest) {
  const auth = await hrAuth('manageEmployees')
  if (auth.error) return auth.error
  const form = await readFormData(request)
  if (form instanceof NextResponse) return form
  const file = form.get('file')
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Choose a file to import' }, { status: 400 })
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: 'The file is larger than 10 MB' }, { status: 413 })

  try {
    const parsed = await parsePunchFile(file.name || 'punches.csv', await file.arrayBuffer())
    if (parsed.punches.length === 0) {
      return NextResponse.json({ error: parsed.errors[0]?.message || 'No punches found in the file', errors: parsed.errors }, { status: 400 })
    }
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const { timezone } = await loadHrSettings(db, tenantId)
      const { ids: allowed } = await scopedEmployeeIds(auth.session, db)
      const profiles = await db.select({ id: employeeProfiles.id, bio: employeeProfiles.biometricUserId, code: employeeProfiles.employeeCode }).from(employeeProfiles)
      const byBio = new Map<string, string>()
      const byCode = new Map<string, string>()
      for (const p of profiles) {
        const b = normalizeBiometricId(p.bio)
        if (b) byBio.set(b, p.id)
        if (p.code) byCode.set(p.code.trim().toLowerCase(), p.id)
      }
      let skippedOtherBranch = 0
      const inputs = []
      for (const p of parsed.punches) {
        const bio = normalizeBiometricId(p.userId)
        const empId = (bio && byBio.get(bio)) || byCode.get(p.userId.trim().toLowerCase()) || null
        // A branch-restricted manager may only import for their own employees (unmapped ids are kept)
        if (empId && allowed && !allowed.has(empId)) { skippedOtherBranch++; continue }
        inputs.push({
          biometricUserId: p.userId,
          employeeProfileId: empId,
          punchTime: localToUtc(p.date, p.time, timezone),
          punchType: p.punchType,
          source: 'import' as const,
          raw: { file: (file.name || '').slice(0, 100), row: p.row },
          createdBy: auth.session.user.id,
        })
      }
      const result = await ingestPunches(db, tenantId, inputs, timezone)
      logAndBroadcast(tenantId, 'attendance', 'created', 'import', {
        userId: auth.session.user.id,
        description: `Imported ${result.inserted} punches from ${file.name} (${result.duplicates} duplicates, ${result.unmapped} unmapped)`,
        metadata: { file: file.name, ...result, skippedOtherBranch },
      })
      return NextResponse.json({ ...result, skippedOtherBranch, errors: parsed.errors, columns: parsed.columns })
    })
  } catch (error) {
    return hrError('api/hr/attendance/import', error, 'Failed to import punches')
  }
}
