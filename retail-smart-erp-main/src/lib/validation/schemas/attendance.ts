import { z } from 'zod'

// ==================== HR ATTENDANCE (/api/hr/*) ====================

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Time must be HH:MM')
const uuid = z.string().uuid()
const optionalUuid = z.union([z.string().uuid(), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null))

export const hrSettingsSchema = z.object({
  attendancePayroll: z.union([z.boolean(), z.literal('auto')]).optional(), // 'auto' = decide per employee
  workingDaysMode: z.enum(['calendar', 'shift']).optional(),
  absenceMode: z.enum(['prorate', 'nopay']).optional(),
  otMultiplier: z.coerce.number().min(0).max(10).optional(),
  holidayOtMultiplier: z.coerce.number().min(0).max(10).optional(),
  defaultShiftId: optionalUuid,
  missedPunchAs: z.enum(['present', 'half_day', 'absent']).optional(),
  otHourlyDivisor: z.union([z.coerce.number().min(0).max(10000), z.null()]).optional(),
  duplicatePunchSeconds: z.coerce.number().int().min(0).max(3600).optional(),
})

export const workShiftSchema = z.object({
  name: z.string().trim().min(1).max(100),
  startTime: timeOfDay,
  endTime: timeOfDay,
  crossesMidnight: z.boolean().optional().default(false),
  breakMinutes: z.coerce.number().int().min(0).max(600).default(60),
  graceLateMinutes: z.coerce.number().int().min(0).max(600).default(10),
  graceEarlyMinutes: z.coerce.number().int().min(0).max(600).default(10),
  halfDayHours: z.coerce.number().min(0).max(24).default(4),
  fullDayHours: z.coerce.number().min(0.5).max(24).default(8),
  otStartsAfterMinutes: z.coerce.number().int().min(0).max(1440).default(30),
  weeklyOffDays: z.array(z.coerce.number().int().min(0).max(6)).max(7).default([0]),
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
})
export const updateWorkShiftSchema = workShiftSchema.partial()

export const shiftAssignmentSchema = z.object({
  employeeProfileIds: z.array(uuid).min(1).max(1000),
  shiftId: uuid,
  fromDate: date,
  toDate: date.nullish(),
  notes: z.string().trim().max(500).nullish(),
  /** Also make it the employees' default shift */
  setAsDefault: z.boolean().optional().default(false),
})

export const attendanceListSchema = z.object({
  date: date.optional(),
  from: date.optional(),
  to: date.optional(),
  warehouseId: z.string().uuid().optional(),
  employeeProfileId: z.string().uuid().optional(),
  department: z.string().max(100).optional(),
})

export const attendanceDayEditSchema = z.object({
  employeeProfileId: uuid,
  date,
  /** true = drop the manual override and recompute from punches */
  revert: z.boolean().optional(),
  status: z.enum(['present', 'absent', 'half_day', 'leave', 'holiday', 'weekly_off']).optional(),
  inTime: timeOfDay.nullish(),
  outTime: timeOfDay.nullish(),
  /** out time is on the next day (night shift) */
  outNextDay: z.boolean().optional(),
  workedMinutes: z.coerce.number().int().min(0).max(1440).nullish(),
  lateMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  earlyLeaveMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  otMinutes: z.coerce.number().int().min(0).max(1440).optional(),
  leavePaid: z.boolean().optional(),
  notes: z.string().trim().max(1000).nullish(),
})

export const punchesListSchema = z.object({
  employeeProfileId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
  from: date,
  to: date,
  includeDeleted: z.coerce.boolean().optional(),
})

export const manualPunchSchema = z.object({
  employeeProfileId: uuid,
  date,
  time: timeOfDay,
  punchType: z.enum(['in', 'out', 'unknown']).default('unknown'),
  note: z.string().trim().min(1, 'A reason is required for a manual punch').max(500),
})

export const deletePunchSchema = z.object({
  note: z.string().trim().min(1, 'A reason is required').max(500),
})

export const recalculateSchema = z.object({
  from: date,
  to: date,
  employeeProfileIds: z.array(uuid).max(2000).optional(),
})

export const markAttendanceSchema = z.object({
  date,
  entries: z.array(z.object({
    employeeProfileId: uuid,
    status: z.enum(['present', 'absent', 'half_day', 'leave']).optional(),
    inTime: timeOfDay.nullish(),
    outTime: timeOfDay.nullish(),
  })).min(1).max(1000),
  note: z.string().trim().max(500).nullish(),
})

export const attendanceDeviceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  serialNumber: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/, 'Serial number: letters, digits, - _ . only'),
  warehouseId: optionalUuid,
  model: z.string().trim().max(100).nullish(),
  commKey: z.string().trim().max(100).nullish(),
  timezone: z.string().trim().max(50).optional(),
  isActive: z.boolean().optional(),
  /** Ask the device to re-send its whole log on the next handshake */
  resync: z.boolean().optional(),
})
export const updateAttendanceDeviceSchema = attendanceDeviceSchema.partial()

export const mapBiometricSchema = z.object({
  biometricUserId: z.string().trim().min(1).max(50),
  employeeProfileId: uuid,
})

export const leaveTypeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().max(20).nullish(),
  daysPerYear: z.coerce.number().min(0).max(366).default(0),
  isPaid: z.boolean().optional().default(true),
  isActive: z.boolean().optional().default(true),
})
export const updateLeaveTypeSchema = leaveTypeSchema.partial()

export const leaveRequestsListSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  employeeProfileId: z.string().uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
})

export const leaveRequestSchema = z.object({
  employeeProfileId: uuid,
  leaveTypeId: uuid,
  fromDate: date,
  toDate: date,
  halfDay: z.boolean().optional().default(false),
  reason: z.string().trim().max(1000).nullish(),
  /** Managers may record an already-approved leave */
  approve: z.boolean().optional(),
}).refine((v) => v.toDate >= v.fromDate, { message: 'To date must be on or after from date', path: ['toDate'] })
  .refine((v) => !v.halfDay || v.fromDate === v.toDate, { message: 'A half day leave is a single day', path: ['halfDay'] })

export const leaveActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'cancel']),
  rejectionReason: z.string().trim().max(500).nullish(),
})

export const holidaySchema = z.object({
  holidayDate: date,
  name: z.string().trim().min(1).max(150),
  isPaid: z.boolean().optional().default(true),
})
export const updateHolidaySchema = holidaySchema.partial()

export const holidaysListSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
})

export const importHolidaysSchema = z.object({
  year: z.coerce.number().int().min(2026).max(2027),
  /** Also import Poya days (all are public holidays in Sri Lanka) */
  includePoya: z.boolean().optional().default(true),
})
