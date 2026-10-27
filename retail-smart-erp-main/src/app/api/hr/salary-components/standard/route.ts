import { NextRequest, NextResponse } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { withTenant } from '@/lib/db'
import { salaryComponents, salaryStructureComponents, salaryStructures } from '@/lib/db/schema'
import { hrAuth, hrError } from '@/lib/attendance/api'
import { validateBody } from '@/lib/validation/helpers'
import { z } from 'zod'
import { logAndBroadcast } from '@/lib/websocket/broadcast'

/**
 * Attendance-based salary components (formula variables from src/lib/attendance/payroll.ts).
 * None depends on payment days: they already are attendance amounts. EPF / ETF formulas written
 * on BP (basic) are unaffected; a formula on `gross` would include overtime.
 */
const STANDARD = [
  { name: 'Overtime', abbreviation: 'OT', componentType: 'earning' as const, formulaExpression: 'ot_amount', sortOrder: 900,
    description: 'Overtime hours from fingerprint attendance × hourly rate × OT multiplier (holiday/weekly-off OT at the holiday multiplier)' },
  { name: 'Late Deduction', abbreviation: 'LATE', componentType: 'deduction' as const, formulaExpression: 'hourly_rate * late_minutes / 60', sortOrder: 910,
    description: 'Late minutes beyond the grace period × hourly rate (optional — add to a structure to use it)' },
  { name: 'No-pay Deduction', abbreviation: 'NOPAY', componentType: 'deduction' as const, formulaExpression: 'daily_rate * absent_days', sortOrder: 920,
    description: 'Absent / no-pay days × daily rate. Use only with HR settings "absence mode = no-pay" (otherwise absence already reduces payment days)' },
]

// POST /api/hr/salary-components/standard { addOvertimeToStructures?: boolean }
export async function POST(request: NextRequest) {
  const auth = await hrAuth('manageSalaryComponents')
  if (auth.error) return auth.error
  const parsed = await validateBody(request, z.object({ addOvertimeToStructures: z.boolean().optional() }))
  if (!parsed.success) return parsed.response
  const addToStructures = parsed.data.addOvertimeToStructures === true
  try {
    const tenantId = auth.session.user.tenantId
    return await withTenant(tenantId, async (db) => {
      const created: string[] = []
      let otId: string | null = null
      for (const c of STANDARD) {
        const [existing] = await db.select({ id: salaryComponents.id }).from(salaryComponents)
          .where(sql`upper(${salaryComponents.abbreviation}) = ${c.abbreviation}`).limit(1)
        let id = existing?.id
        if (!id) {
          const [row] = await db.insert(salaryComponents).values({
            tenantId, name: c.name, abbreviation: c.abbreviation, componentType: c.componentType,
            formulaExpression: c.formulaExpression, dependsOnPaymentDays: false, description: c.description, sortOrder: c.sortOrder,
          }).returning({ id: salaryComponents.id })
          id = row.id
          created.push(c.abbreviation)
          logAndBroadcast(tenantId, 'salary-component', 'created', id, { userId: auth.session.user.id, entityName: c.name })
        }
        if (c.abbreviation === 'OT') otId = id
      }
      let structuresUpdated = 0
      if (addToStructures && otId) {
        const structures = await db.select({ id: salaryStructures.id }).from(salaryStructures).where(eq(salaryStructures.isActive, true))
        for (const s of structures) {
          const [has] = await db.select({ id: salaryStructureComponents.id }).from(salaryStructureComponents)
            .where(and(eq(salaryStructureComponents.structureId, s.id), eq(salaryStructureComponents.componentId, otId))).limit(1)
          if (has) continue
          await db.insert(salaryStructureComponents).values({ tenantId, structureId: s.id, componentId: otId, sortOrder: 900 })
          structuresUpdated++
        }
      }
      return NextResponse.json({ created, structuresUpdated })
    })
  } catch (error) {
    return hrError('api/hr/salary-components/standard', error, 'Failed to add standard components')
  }
}
