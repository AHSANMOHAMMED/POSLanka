/**
 * L1 — HR attendance (drizzle/0183): fingerprint push (ZKTeco ADMS "iclock"), attendance engine,
 * corrections, import, leave, holidays, branch scoping and attendance-based payroll.
 *
 *   DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/poslanka_<db> DATABASE_APP_ROLE=app_user \
 *   npx tsx --tsconfig scripts/tests/w8-harness/tsconfig.json scripts/tests/l1-attendance.ts
 *
 * Calls the real route handlers (auth mocked via the w8 harness) on a throw-away tenant with two
 * branches. Payroll runs for the previous month, so every day of it is in the past.
 * Prints PASS/FAIL per check and exits non-zero on failure. KEEP_TEST_DATA=1 keeps the tenant.
 */
import { Client } from 'pg'
import { randomUUID } from 'crypto'
import { NextRequest } from 'next/server'
import { setTestSession } from './w8-harness/auth-mock'
import { closeAllPools } from '@/lib/db'
import { clearBranchScopeCache } from '@/lib/auth/branch-access'
import { GET as iclockHandshake, POST as iclockUpload } from '@/app/iclock/cdata/route'
import { GET as iclockPoll } from '@/app/iclock/getrequest/route'
import { POST as createShift } from '@/app/api/hr/shifts/route'
import { POST as registerDevice, GET as listDevices } from '@/app/api/hr/attendance-devices/route'
import { GET as checkDevice } from '@/app/api/hr/attendance-devices/check/route'
import { GET as listUnmapped } from '@/app/api/hr/attendance-devices/unmapped/route'
import { POST as mapUser } from '@/app/api/hr/attendance-devices/map/route'
import { GET as getAttendance } from '@/app/api/hr/attendance/route'
import { PUT as editDay } from '@/app/api/hr/attendance/day/route'
import { POST as addPunch } from '@/app/api/hr/attendance/punches/route'
import { POST as importPunches } from '@/app/api/hr/attendance/import/route'
import { POST as recalc } from '@/app/api/hr/attendance/recalculate/route'
import { POST as markAttendance } from '@/app/api/hr/attendance/mark/route'
import { GET as listLeaveTypes } from '@/app/api/hr/leave-types/route'
import { POST as createLeave } from '@/app/api/hr/leave-requests/route'
import { GET as leaveBalances } from '@/app/api/hr/leave-balances/route'
import { POST as importHolidays } from '@/app/api/hr/holidays/import/route'
import { PUT as saveSettings, GET as getSettings } from '@/app/api/hr/settings/route'
import { POST as seedComponents } from '@/app/api/hr/salary-components/standard/route'
import { POST as createPayrollRun } from '@/app/api/payroll-runs/route'
import { invalidateIclockDevice } from '@/lib/attendance/iclock-server'
import { addDays, monthRange, weekdayOf, eachDate, localToUtc } from '@/lib/attendance/time'

type J = Record<string, unknown> & { [k: string]: any } // eslint-disable-line @typescript-eslint/no-explicit-any
type Who = 'owner' | 'managerA'
interface Emp { profileId: string; userId: string }
interface Fx { tenantId: string; slug: string; whA: string; whB: string; users: Record<Who, string>; e1: Emp; e2: Emp; e3: Emp; e4: Emp }

const DB_GUARD = /@(127\.0\.0\.1|localhost)(:\d+)?\/poslanka_[a-z0-9_]+$/i
const TZ = 'Asia/Colombo'

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? `  — ${detail}` : ''}`)
}
async function step(name: string, fn: () => Promise<void>) {
  try { await fn() } catch (err) { check(name, false, err instanceof Error ? err.stack : String(err)) }
}
function as(f: Fx, who: Who) {
  setTestSession({
    user: {
      id: f.users[who], accountId: null, email: `${who}-${f.slug}@example.test`, name: who, role: who === 'owner' ? 'owner' : 'manager',
      tenantId: f.tenantId, tenantSlug: f.slug, tenantName: 'L1', businessType: 'retail',
      aiEnabled: false, isSuperAdmin: false, isOwner: who === 'owner', mode: 'company',
    },
  } as unknown as Parameters<typeof setTestSession>[0])
}
function req(method: string, url: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } })
}
function textReq(method: string, url: string, body?: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method, body, headers: { 'content-type': 'text/plain', 'x-forwarded-for': '203.0.113.7' } })
}
async function json(res: Response | undefined): Promise<{ status: number; body: J }> {
  if (!res) return { status: 0, body: { error: 'no response' } }
  const text = await res.text()
  let body: J = {}
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  return { status: res.status, body }
}
const short = (b: unknown) => JSON.stringify(b).slice(0, 500)

async function makeTenant(admin: Client): Promise<Fx> {
  const tenantId = randomUUID()
  const slug = `l1-${tenantId.slice(0, 8)}`
  const whA = randomUUID()
  const whB = randomUUID()
  await admin.query(`INSERT INTO tenants (id, name, slug, email, timezone) VALUES ($1, 'L1 office', $2, $3, $4)`, [tenantId, slug, `${slug}@example.test`, TZ])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Colombo', 'CMB', true)`, [whA, tenantId])
  await admin.query(`INSERT INTO warehouses (id, tenant_id, name, code, is_default) VALUES ($1, $2, 'Kandy', 'KDY', false)`, [whB, tenantId])
  const user = async (name: string, role: string) => {
    const id = randomUUID()
    await admin.query(`INSERT INTO users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, $3, 'x', $4, $5)`, [id, tenantId, `${name.toLowerCase().replace(/\s/g, '')}-${slug}@example.test`, name, role])
    return id
  }
  const users = { owner: await user('Owner', 'owner'), managerA: await user('Manager Colombo', 'manager') }
  await admin.query(`INSERT INTO user_warehouses (tenant_id, user_id, warehouse_id, is_active) VALUES ($1,$2,$3,true)`, [tenantId, users.managerA, whA])
  const emp = async (name: string, wh: string | null, bio: string | null, ot: boolean): Promise<Emp> => {
    const userId = await user(name, 'cashier')
    const profileId = randomUUID()
    await admin.query(`INSERT INTO employee_profiles (id, tenant_id, user_id, employee_code, base_salary, warehouse_id, biometric_user_id, ot_eligible, hire_date)
      VALUES ($1,$2,$3,$4,60000,$5,$6,$7,'2025-01-01')`, [profileId, tenantId, userId, name.slice(0, 3).toUpperCase(), wh, bio, ot])
    return { profileId, userId }
  }
  return {
    tenantId, slug, whA, whB, users,
    e1: await emp('Nimal Perera', whA, '101', true),
    e2: await emp('Kamala Silva', whB, '102', false),
    e3: await emp('Sunil Fernando', whA, null, false),
    e4: await emp('Ruwan Jayasuriya', whA, null, false),
  }
}

async function cleanup(admin: Client, tenantId: string, serials: string[]) {
  await admin.query(`SET session_replication_role = replica`)
  const tables = await admin.query(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema='public' AND column_name='tenant_id'
       AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')`)
  for (const t of tables.rows) await admin.query(`DELETE FROM "${t.table_name}" WHERE tenant_id=$1`, [tenantId]).catch(() => undefined)
  await admin.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]).catch((e) => console.warn('cleanup tenant:', e.message))
  await admin.query(`DELETE FROM attendance_pending_devices WHERE serial_number = ANY($1)`, [serials]).catch(() => undefined)
  await admin.query(`SET session_replication_role = origin`)
}

async function main() {
  const url = process.env.DATABASE_URL || ''
  if (!DB_GUARD.test(url)) throw new Error(`Refusing to run against ${url}: use a local poslanka_* scratch database`)
  const admin = new Client({ connectionString: url })
  await admin.connect()
  const tenants: string[] = []
  const serial = `L1T${randomUUID().slice(0, 8).toUpperCase()}`
  const unknownSerial = `L1U${randomUUID().slice(0, 8).toUpperCase()}`
  try {
    const f = await makeTenant(admin)
    tenants.push(f.tenantId)
    clearBranchScopeCache('*')

    // Previous month: payroll period; D1 = its first Monday, D2..D4 the following days
    const nowLocal = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
    const [ty, tm] = nowLocal.split('-').map(Number)
    const pm = tm === 1 ? 12 : tm - 1
    const py = tm === 1 ? ty - 1 : ty
    const { from: mFrom, to: mTo } = monthRange(py, pm)
    let D1 = mFrom
    while (weekdayOf(D1) !== 1) D1 = addDays(D1, 1)
    const D2 = addDays(D1, 1), D3 = addDays(D1, 2), D4 = addDays(D1, 3), D5 = addDays(D1, 4)
    const dayRow = async (emp: Emp, date: string) => (await admin.query(`SELECT * FROM attendance_days WHERE employee_profile_id=$1 AND attendance_date=$2`, [emp.profileId, date])).rows[0]

    // ============================================================ shift + device
    let deviceId = ''
    await step('setup shift and device', async () => {
      as(f, 'owner')
      const s = await json(await createShift(req('POST', '/api/hr/shifts', { name: 'Office', startTime: '08:00', endTime: '17:00', breakMinutes: 60, graceLateMinutes: 10, graceEarlyMinutes: 10, halfDayHours: 4, fullDayHours: 8, otStartsAfterMinutes: 30, weeklyOffDays: [0], isDefault: true })))
      check('create default shift → 201', s.status === 201 && s.body.isDefault === true, short(s.body))

      // Unknown device first: backs off, uploads refused, remembered as pending
      const hs = await iclockHandshake(textReq('GET', `/iclock/cdata?SN=${unknownSerial}&options=all&pushver=2.4.1`))
      const hsText = await hs.text()
      check('unknown SN handshake → back-off options', hs.status === 200 && /Delay=300/.test(hsText) && hsText.includes(`GET OPTION FROM: ${unknownSerial}`), hsText)
      const up = await iclockUpload(textReq('POST', `/iclock/cdata?SN=${unknownSerial}&table=ATTLOG&Stamp=1`, `101\t${D1} 08:00:00\t0\t1`))
      check('unknown SN upload refused (device keeps its log) → 403', up.status === 403, await up.text())
      const chk = await json(await checkDevice(req('GET', `/api/hr/attendance-devices/check?serial=${unknownSerial}`)))
      check('register form sees the unknown serial contacted the server', chk.status === 200 && chk.body.seen === true, short(chk.body))

      const d = await json(await registerDevice(req('POST', '/api/hr/attendance-devices', { name: 'Front door', serialNumber: serial, warehouseId: f.whA, model: 'ZKTeco K40' })))
      check('register device → 201', d.status === 201 && d.body.serialNumber === serial, short(d.body))
      deviceId = d.body.id
      const dup = await json(await registerDevice(req('POST', '/api/hr/attendance-devices', { name: 'Again', serialNumber: serial.toLowerCase() })))
      check('same serial again (any case) → 409', dup.status === 409, short(dup.body))
      invalidateIclockDevice()
    })

    // ============================================================ iclock push
    await step('iclock push', async () => {
      const hs = await iclockHandshake(textReq('GET', `/iclock/cdata?SN=${serial}&options=all&pushver=2.4.1&language=69`))
      const t = await hs.text()
      check('registered handshake: ATTLOGStamp=None, Realtime=1, TransInterval', hs.status === 200 && /ATTLOGStamp=None/.test(t) && /Realtime=1/.test(t) && /Delay=10/.test(t), t)
      const body = [
        `101\t${D1} 08:05:00\t0\t1\t0\t0`,
        `101\t${D1} 08:06:00\t0\t1\t0\t0`, // duplicate within 2 min
        `101\t${D1} 18:00:00\t1\t1\t0\t0`,
        `101\t${D2} 08:30:00\t0\t1\t0\t0`,
        `101\t${D2} 17:00:00\t1\t1\t0\t0`,
        `999\t${D1} 09:00:00\t0\t1\t0\t0`, // unmapped user id
        `102\t${D1} 08:00:00\t0\t15\t0\t0`,
      ].join('\n')
      const r = await iclockUpload(textReq('POST', `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=9001`, body))
      const rt = await r.text()
      check('ATTLOG upload → "OK: 7"', r.status === 200 && rt === 'OK: 7', rt)
      const again = await iclockUpload(textReq('POST', `/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=9001`, body))
      check('re-upload acknowledged', again.status === 200, await again.text())
      const n = await admin.query(`SELECT count(*)::int n FROM attendance_punches WHERE tenant_id=$1`, [f.tenantId])
      check('re-upload adds no duplicate punches (7 stored)', n.rows[0].n === 7, String(n.rows[0].n))
      const dev = (await admin.query(`SELECT attlog_stamp, last_seen_at FROM attendance_devices WHERE id=$1`, [deviceId])).rows[0]
      check('device stamp + last seen stored', dev.attlog_stamp === '9001' && !!dev.last_seen_at, short(dev))
      const poll = await iclockPoll(textReq('GET', `/iclock/getrequest?SN=${serial}`))
      check('getrequest → OK', poll.status === 200 && (await poll.text()) === 'OK')
      const users = await iclockUpload(textReq('POST', `/iclock/cdata?SN=${serial}&table=OPERLOG&Stamp=5`, 'USER PIN=999\tName=New Guard\tPri=0'))
      check('OPERLOG user list acknowledged', users.status === 200 && /^OK: 1/.test(await users.text()))

      const d1 = await dayRow(f.e1, D1)
      check('D1: present, not late, OT 60 min, worked 535 min, duplicate ignored', d1?.status === 'present' && d1.late_minutes === 0 && d1.ot_minutes === 60 && d1.worked_minutes === 535 && d1.punch_count === 2, short(d1))
      const d2 = await dayRow(f.e1, D2)
      check('D2: late 30 min, no OT', d2?.status === 'present' && d2.late_minutes === 30 && d2.ot_minutes === 0, short(d2))
      const e2d1 = await dayRow(f.e2, D1)
      check('E2 (not OT eligible) single punch → missed check-out', e2d1?.missed_punch === true && e2d1.ot_minutes === 0, short(e2d1))
    })

    // ============================================================ boards, mapping, corrections
    await step('attendance board and corrections', async () => {
      as(f, 'owner')
      const b = await json(await getAttendance(req('GET', `/api/hr/attendance?from=${mFrom}&to=${mTo}`)))
      check('register lists the 4 employees', b.status === 200 && b.body.employees.length === 4, short(b.body))
      const e1Days = b.body.days.filter((d: J) => d.employeeProfileId === f.e1.profileId)
      check('tracked employee gets a row for every past day (absences filled in)', e1Days.length === eachDate(mFrom, mTo).length && e1Days.find((d: J) => d.attendanceDate === D3)?.status === 'absent', String(e1Days.length))

      const dl = await json(await listDevices())
      check('device list: punches + unmapped counts', dl.status === 200 && dl.body[0]?.punches === 7 && dl.body[0]?.unmapped === 1 && dl.body[0].commKey === undefined, short(dl.body))
      const um = await json(await listUnmapped())
      check('unmapped user 999 listed with the name from the device', um.status === 200 && um.body.some((u: J) => u.biometricUserId === '999' && u.nameOnDevice === 'New Guard'), short(um.body))
      const mp = await json(await mapUser(req('POST', '/api/hr/attendance-devices/map', { biometricUserId: '999', employeeProfileId: f.e3.profileId })))
      check('map 999 → E3 attaches the punch', mp.status === 200 && mp.body.attached === 1, short(mp.body))
      const e3d1 = await dayRow(f.e3, D1)
      check('E3 day recomputed after mapping', e3d1?.punch_count === 1, short(e3d1))
      const taken = await json(await mapUser(req('POST', '/api/hr/attendance-devices/map', { biometricUserId: '101', employeeProfileId: f.e3.profileId })))
      check('mapping an id used by another employee → 409', taken.status === 409, short(taken.body))

      const mp2 = await json(await addPunch(req('POST', '/api/hr/attendance/punches', { employeeProfileId: f.e2.profileId, date: D1, time: '17:05', punchType: 'out', note: 'Forgot to punch out' })))
      check('manual punch → 201', mp2.status === 201, short(mp2.body))
      const e2d1 = await dayRow(f.e2, D1)
      check('… day complete, no longer missed punch', e2d1?.missed_punch === false && e2d1.status === 'present', short(e2d1))

      const ed = await json(await editDay(req('PUT', '/api/hr/attendance/day', { employeeProfileId: f.e2.profileId, date: D2, status: 'half_day', notes: 'Approved half day' })))
      check('manual correction saved (is_manual)', ed.status === 200 && ed.body.isManual === true && ed.body.status === 'half_day', short(ed.body))
      await json(await recalc(req('POST', '/api/hr/attendance/recalculate', { from: mFrom, to: mTo })))
      check('recalculation keeps the manual day', (await dayRow(f.e2, D2))?.status === 'half_day')
      const rv = await json(await editDay(req('PUT', '/api/hr/attendance/day', { employeeProfileId: f.e2.profileId, date: D2, revert: true })))
      check('revert → recomputed (absent: no punches)', rv.status === 200 && rv.body?.isManual === false && rv.body?.status === 'absent', short(rv.body))
      const audit = await admin.query(`SELECT count(*)::int n FROM activity_logs WHERE tenant_id=$1 AND entity_type='attendance'`, [f.tenantId]).catch(() => ({ rows: [{ n: -1 }] }))
      check('corrections are in the activity log', audit.rows[0].n !== 0, String(audit.rows[0].n))

      const mk = await json(await markAttendance(req('POST', '/api/hr/attendance/mark', { date: D1, entries: [{ employeeProfileId: f.e4.profileId, status: 'present' }] })))
      check('mark attendance (no device) → manual day', mk.status === 200 && mk.body.days === 1 && (await dayRow(f.e4, D1))?.is_manual === true, short(mk.body))
      // keep E4 on the old payroll behaviour: undo the mark
      await admin.query(`DELETE FROM attendance_days WHERE employee_profile_id=$1`, [f.e4.profileId])
    })

    // ============================================================ CSV import
    await step('import', async () => {
      as(f, 'owner')
      const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
      const csv = `AC-No.,Name,Date Time,State\n101,Nimal,${dmy(D5)} 07:58,C/In\n101,Nimal,${dmy(D5)} 17:10,C/Out\nSUN,Sunil,${dmy(D5)} 08:00,C/In\nxx,bad,garbage,\n`
      const fd = new FormData()
      fd.append('file', new File([csv], 'export.csv', { type: 'text/csv' }))
      const r = await json(await importPunches(new NextRequest('http://localhost/api/hr/attendance/import', { method: 'POST', body: fd })))
      check('CSV import: 3 punches, 1 bad row, employee code matched', r.status === 200 && r.body.inserted === 3 && r.body.errors.length === 1 && r.body.unmapped === 0, short(r.body))
      check('… E1 day computed from the import', (await dayRow(f.e1, D5))?.status === 'present')
      const again = await json(await importPunches(new NextRequest('http://localhost/api/hr/attendance/import', { method: 'POST', body: fd })))
      check('re-import skips duplicates', again.status === 200 && again.body.inserted === 0 && again.body.duplicates === 3, short(again.body))
    })

    // ============================================================ leave
    await step('leave', async () => {
      as(f, 'owner')
      const types = await json(await listLeaveTypes())
      const annual = types.body.find?.((t: J) => t.name === 'Annual Leave')
      check('default leave types seeded', types.status === 200 && !!annual, short(types.body))
      const lv = await json(await createLeave(req('POST', '/api/hr/leave-requests', { employeeProfileId: f.e1.profileId, leaveTypeId: annual.id, fromDate: D4, toDate: D4, approve: true })))
      check('approved leave → 201, 1 day', lv.status === 201 && Number(lv.body.days) === 1, short(lv.body))
      const row = await dayRow(f.e1, D4)
      check('… the day becomes paid leave', row?.status === 'leave' && row.leave_paid === true, short(row))
      const ov = await json(await createLeave(req('POST', '/api/hr/leave-requests', { employeeProfileId: f.e1.profileId, leaveTypeId: annual.id, fromDate: D4, toDate: D4 })))
      check('overlapping leave → 409', ov.status === 409, short(ov.body))
      const bal = await json(await leaveBalances(req('GET', `/api/hr/leave-balances?year=${py}&employeeProfileId=${f.e1.profileId}`)))
      const ab = bal.body.find?.((b: J) => b.leaveTypeId === annual.id)
      check('balance: 14 − 1 = 13', bal.status === 200 && ab?.remaining === 13, short(bal.body))
    })

    // ============================================================ branch scoping
    await step('branch scoping', async () => {
      as(f, 'managerA')
      clearBranchScopeCache('*')
      const b = await json(await getAttendance(req('GET', `/api/hr/attendance?date=${D1}`)))
      const ids = (b.body.employees || []).map((e: J) => e.id)
      check('Colombo manager sees Colombo employees only', b.status === 200 && ids.includes(f.e1.profileId) && !ids.includes(f.e2.profileId), short(ids))
      const ed = await json(await editDay(req('PUT', '/api/hr/attendance/day', { employeeProfileId: f.e2.profileId, date: D1, status: 'absent' })))
      check('editing a Kandy employee → 403', ed.status === 403 && ed.body.code === 'BRANCH_ACCESS_DENIED', short(ed.body))
      const kb = await json(await getAttendance(req('GET', `/api/hr/attendance?date=${D1}&warehouseId=${f.whB}`)))
      check('filtering by Kandy → 403', kb.status === 403, short(kb.body))
    })

    // ============================================================ payroll
    await step('payroll from attendance', async () => {
      as(f, 'owner')
      const st = await json(await getSettings())
      check('settings default: calendar days, pro-rate, auto', st.status === 200 && st.body.settings.workingDaysMode === 'calendar' && st.body.settings.attendancePayroll === undefined, short(st.body))
      const seed = await json(await seedComponents(req('POST', '/api/hr/salary-components/standard', {})))
      check('standard components OT / LATE / NOPAY created', seed.status === 200 && seed.body.created.length === 3, short(seed.body))
      const ot = (await admin.query(`SELECT id FROM salary_components WHERE tenant_id=$1 AND abbreviation='OT'`, [f.tenantId])).rows[0].id
      const bp = randomUUID()
      await admin.query(`INSERT INTO salary_components (id, tenant_id, name, abbreviation, component_type, formula_expression, depends_on_payment_days) VALUES ($1,$2,'Basic','BP','earning','base',true)`, [bp, f.tenantId])
      const epf = randomUUID()
      await admin.query(`INSERT INTO salary_components (id, tenant_id, name, abbreviation, component_type, formula_expression, depends_on_payment_days, is_statutory) VALUES ($1,$2,'EPF 8%','EPF_E','deduction','BP * 0.08',false,true)`, [epf, f.tenantId])
      const ss = randomUUID()
      await admin.query(`INSERT INTO salary_structures (id, tenant_id, name) VALUES ($1,$2,'Office')`, [ss, f.tenantId])
      for (const [c, o] of [[bp, 1], [ot, 2], [epf, 3]] as Array<[string, number]>) {
        await admin.query(`INSERT INTO salary_structure_components (tenant_id, structure_id, component_id, sort_order) VALUES ($1,$2,$3,$4)`, [f.tenantId, ss, c, o])
      }
      await admin.query(`UPDATE employee_profiles SET salary_structure_id=$1 WHERE tenant_id=$2`, [ss, f.tenantId])

      const run = await json(await createPayrollRun(req('POST', '/api/payroll-runs', { payrollMonth: pm, payrollYear: py, totalWorkingDays: 30 })))
      check('payroll run created', run.status === 200 && run.body.totalEmployees === 4, short(run.body))
      const slips = (await admin.query(`SELECT * FROM salary_slips WHERE tenant_id=$1`, [f.tenantId])).rows
      const slip1 = slips.find((s) => s.employee_profile_id === f.e1.profileId)
      const days = eachDate(mFrom, mTo)
      const sundays = days.filter((d) => weekdayOf(d) === 0).length
      // E1 paid: Sundays + D1, D2, D5 present + D4 paid leave; every other past working day absent
      const expectedPaid = sundays + 4
      const sum = slip1?.attendance_summary
      check('E1 slip from attendance: working = calendar days, paid = Sundays + 4', !!slip1 && sum?.source === 'attendance' && Number(slip1.total_working_days) === days.length && Number(slip1.payment_days) === expectedPaid, short({ wd: slip1?.total_working_days, pd: slip1?.payment_days, expectedPaid, sum }))
      check('E1 summary: late 30, OT 1 h', sum?.lateMinutes === 30 && sum?.otHours === 1, short(sum))
      const comps = (await admin.query(`SELECT abbreviation, amount FROM salary_slip_components WHERE salary_slip_id=$1`, [slip1.id])).rows
      const amt = (a: string) => Number(comps.find((c) => c.abbreviation === a)?.amount)
      const hourly = 60000 / ((days.length - sundays) * 8)
      const expBP = Math.round(60000 * expectedPaid / days.length * 100) / 100
      check('Basic pro-rated by paid days', Math.abs(amt('BP') - expBP) < 0.02, short({ comps, expBP }))
      check('Overtime = hourly × 1 h × 1.5 (not pro-rated)', Math.abs(amt('OT') - Math.round(hourly * 1.5 * 100) / 100) < 0.02, short({ comps, hourly }))
      check('EPF still on BP', Math.abs(amt('EPF_E') - Math.round(amt('BP') * 0.08 * 100) / 100) < 0.02, short(comps))
      const slip4 = slips.find((s) => s.employee_profile_id === f.e4.profileId)
      check('E4 (no fingerprint id, no punches) keeps the old behaviour: 30 / 30', slip4?.attendance_summary?.source === 'manual' && Number(slip4.payment_days) === 30 && Number(slip4.total_working_days) === 30, short(slip4))
      await admin.query(`DELETE FROM salary_slip_components WHERE tenant_id=$1`, [f.tenantId])
      await admin.query(`DELETE FROM salary_slips WHERE tenant_id=$1`, [f.tenantId])
      await admin.query(`DELETE FROM payroll_runs WHERE tenant_id=$1`, [f.tenantId])

      const off = await json(await saveSettings(req('PUT', '/api/hr/settings', { attendancePayroll: false })))
      check('settings: attendance payroll off', off.status === 200 && off.body.settings.attendancePayroll === false, short(off.body))
      const run2 = await json(await createPayrollRun(req('POST', '/api/payroll-runs', { payrollMonth: pm, payrollYear: py, totalWorkingDays: 26 })))
      const s1 = (await admin.query(`SELECT payment_days, total_working_days FROM salary_slips WHERE tenant_id=$1 AND employee_profile_id=$2`, [f.tenantId, f.e1.profileId])).rows[0]
      check('… then everyone is paid on the entered days (26/26)', run2.status === 200 && Number(s1?.payment_days) === 26 && Number(s1?.total_working_days) === 26, short(s1))
      const auto = await json(await saveSettings(req('PUT', '/api/hr/settings', { attendancePayroll: 'auto' })))
      check('settings back to auto', auto.status === 200 && auto.body.settings.attendancePayroll === undefined, short(auto.body))
    })

    // ============================================================ holidays
    await step('holidays', async () => {
      as(f, 'owner')
      const y = Number(nowLocal.slice(0, 4))
      if (y !== 2026 && y !== 2027) { check('holiday import (skipped: no list for this year)', true); return }
      const r = await json(await importHolidays(req('POST', '/api/hr/holidays/import', { year: y })))
      check('Sri Lanka holidays imported (checked list)', r.status === 200 && r.body.imported > 20 && r.body.verified === true, short(r.body))
      const past = (await admin.query(`SELECT holiday_date::text d FROM holidays WHERE tenant_id=$1 AND holiday_date <= $2::date AND holiday_date >= '2025-01-01' ORDER BY holiday_date DESC LIMIT 1`, [f.tenantId, nowLocal])).rows[0]?.d
      if (past) {
        const row = await dayRow(f.e1, past)
        check(`past holiday ${past} recomputed as holiday`, row?.status === 'holiday' && row.day_type === 'holiday', short(row))
      }
      const again = await json(await importHolidays(req('POST', '/api/hr/holidays/import', { year: y })))
      check('second import adds nothing', again.status === 200 && again.body.imported === 0, short(again.body))
    })

    // sanity: the device clock is local time
    check('device time read as Asia/Colombo', localToUtc(D1, '08:05', TZ).toISOString() === (await admin.query(`SELECT punch_time FROM attendance_punches WHERE tenant_id=$1 AND biometric_user_id='101' ORDER BY punch_time LIMIT 1`, [f.tenantId])).rows[0].punch_time.toISOString())
  } finally {
    if (!process.env.KEEP_TEST_DATA) for (const t of tenants) await cleanup(admin, t, [serial, unknownSerial])
    await admin.end()
    await closeAllPools()
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}

main().catch(async (err) => {
  console.error(err)
  await closeAllPools().catch(() => undefined)
  process.exit(1)
})
