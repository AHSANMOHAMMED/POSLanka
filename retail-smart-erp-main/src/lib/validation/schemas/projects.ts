import { z } from 'zod'
import { dateStringSchema, optionalUuid, paginatedSearchSchema, uuidSchema } from './common'

// drizzle/0185 — projects, tasks, members and timesheets (src/lib/projects)

const money = z.coerce.number().min(0).max(100_000_000)

export const projectTaskInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'Task name is required').max(200),
  description: z.string().max(2000).nullish(),
  rate: money.default(0),
  billable: z.boolean().default(true),
  isActive: z.boolean().default(true),
})

export const projectMemberInputSchema = z.object({
  userId: uuidSchema,
  rate: money.default(0),
})

const projectFields = {
  name: z.string().trim().min(1, 'Project name is required').max(200),
  customerId: uuidSchema,
  warehouseId: optionalUuid,
  description: z.string().max(5000).nullish(),
  billingMethod: z.enum(['fixed', 'project_hourly', 'staff_hourly', 'task_hourly']).default('project_hourly'),
  fixedAmount: money.default(0),
  projectRate: money.default(0),
  budgetType: z.enum(['none', 'hours', 'amount']).default('none'),
  budgetHours: z.coerce.number().min(0).max(1_000_000).nullish(),
  budgetAmount: money.nullish(),
  serviceItemId: optionalUuid,
  startDate: dateStringSchema.nullish(),
  endDate: dateStringSchema.nullish(),
  status: z.enum(['active', 'on_hold', 'completed', 'cancelled']).default('active'),
  tasks: z.array(projectTaskInputSchema).max(200).default([]),
  members: z.array(projectMemberInputSchema).max(200).default([]),
}

export const createProjectSchema = z.object(projectFields).superRefine((d, ctx) => {
  if (d.billingMethod === 'fixed' && !(d.fixedAmount > 0)) ctx.addIssue({ code: 'custom', path: ['fixedAmount'], message: 'Enter the fixed price' })
  if (d.startDate && d.endDate && d.endDate < d.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date is before the start date' })
  const users = new Set<string>()
  for (const [i, m] of d.members.entries()) {
    if (users.has(m.userId)) ctx.addIssue({ code: 'custom', path: ['members', i, 'userId'], message: 'User listed twice' })
    users.add(m.userId)
  }
})
export const updateProjectSchema = createProjectSchema

export const projectsListSchema = paginatedSearchSchema.extend({
  status: z.enum(['active', 'on_hold', 'completed', 'cancelled', 'all']).optional(),
  customerId: z.string().uuid().optional(),
})

const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/

export const timeEntryInputSchema = z.object({
  projectId: uuidSchema,
  taskId: optionalUuid,
  /** someone else's time: managers only */
  userId: optionalUuid,
  entryDate: dateStringSchema,
  /** either start + end (HH:MM, same day) or durationMinutes */
  startTime: z.string().regex(timeRe, 'Time must be HH:MM').nullish(),
  endTime: z.string().regex(timeRe, 'Time must be HH:MM').nullish(),
  durationMinutes: z.coerce.number().int().min(1).max(1440).nullish(),
  notes: z.string().max(2000).nullish(),
  billable: z.boolean().default(true),
}).superRefine((d, ctx) => {
  if (d.startTime && d.endTime) {
    if (d.endTime <= d.startTime) ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'End time must be after the start time' })
  } else if (!d.durationMinutes) {
    ctx.addIssue({ code: 'custom', path: ['durationMinutes'], message: 'Enter start and end times or the duration' })
  }
})

export const timeEntriesListSchema = z.object({
  projectId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  fromDate: dateStringSchema.optional(),
  toDate: dateStringSchema.optional(),
  billable: z.enum(['true', 'false']).optional(),
  invoiced: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
})

export const timerActionSchema = z.object({
  action: z.enum(['start', 'stop', 'discard']),
  projectId: optionalUuid,
  taskId: optionalUuid,
  notes: z.string().max(2000).nullish(),
  billable: z.boolean().default(true),
})

export const projectInvoiceSchema = z.object({
  /** bill the unbilled billable time (hourly methods) */
  includeTime: z.boolean().default(true),
  /** only these entries (default: all unbilled billable entries) */
  entryIds: z.array(uuidSchema).max(5000).optional(),
  /** fixed-price projects: the amount to bill now (default: what is left of the fixed price) */
  fixedAmount: money.optional(),
})

export const projectReportSchema = z.object({
  fromDate: dateStringSchema.optional(),
  toDate: dateStringSchema.optional(),
  projectId: z.string().uuid().optional(),
})
