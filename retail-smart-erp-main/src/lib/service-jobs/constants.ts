// Service jobs (drizzle/0193): labels, colours and per-type defaults. Client-safe.
import { getTerms } from '@/lib/terminology'
import { type BusinessScope, primaryBusinessType } from '@/lib/business-types/scope'

export const SERVICE_JOB_STATUSES = ['received', 'diagnosing', 'awaiting_approval', 'in_progress', 'ready', 'delivered', 'cancelled'] as const
export type ServiceJobStatusKey = (typeof SERVICE_JOB_STATUSES)[number]

/** Workflow in order (cancelled is off the line; delivered happens through "convert to invoice"). */
export const SERVICE_JOB_PIPELINE = ['received', 'diagnosing', 'awaiting_approval', 'in_progress', 'ready', 'delivered'] as const
export const OPEN_SERVICE_JOB_STATUSES = ['received', 'diagnosing', 'awaiting_approval', 'in_progress', 'ready'] as const

export type ServiceJobKind = 'repair' | 'tailoring' | 'service'

const STATUS_LABELS: Record<ServiceJobKind, Record<string, string>> = {
  repair: {
    received: 'Received', diagnosing: 'Diagnosing', awaiting_approval: 'Awaiting approval', in_progress: 'Repairing',
    ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled',
  },
  tailoring: {
    received: 'Received', diagnosing: 'Measuring / cutting', awaiting_approval: 'Awaiting approval', in_progress: 'Stitching',
    ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled',
  },
  service: {
    received: 'Open', diagnosing: 'Assessing', awaiting_approval: 'Awaiting approval', in_progress: 'In progress',
    ready: 'Done', delivered: 'Closed', cancelled: 'Cancelled',
  },
}

export function serviceJobStatusLabel(status: string, kind: ServiceJobKind = 'repair'): string {
  return STATUS_LABELS[kind]?.[status] || STATUS_LABELS.repair[status] || status
}

export const SERVICE_JOB_STATUS_COLORS: Record<string, string> = {
  received: 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
  diagnosing: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  awaiting_approval: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  ready: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  delivered: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

export const ESTIMATE_STATUS_LABELS: Record<string, string> = {
  none: 'No estimate', pending: 'Estimate sent', approved: 'Estimate approved', declined: 'Estimate declined',
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', cheque: 'Cheque', credit: 'On account', gift_card: 'Gift card',
}

export const LINE_TYPE_LABELS: Record<string, string> = { part: 'Part', labour: 'Labour', other: 'Other' }

/** The job kind a business type works with (its job cards look like that by default). */
export function jobKindForBusinessType(businessType?: BusinessScope): ServiceJobKind {
  // A mall: the job kind of its primary type (the job form lets the user pick another)
  const type = primaryBusinessType(businessType)
  if (type === 'textile') return 'tailoring'
  if (type === 'office') return 'service'
  return 'repair'
}

/** Module / document words for the business type (terminology.ts, with fallbacks). */
export function serviceJobTerms(businessType?: BusinessScope): { one: string; many: string } {
  const t = getTerms(businessType)
  return { one: t.serviceJob || 'Service Job', many: t.serviceJobs || 'Service Jobs' }
}

export const DEVICE_TYPES = [
  'Mobile phone', 'Tablet', 'Laptop', 'Desktop / PC', 'Television', 'Refrigerator', 'Washing machine', 'Air conditioner',
  'Microwave / oven', 'Rice cooker', 'Blender / mixer', 'Fan', 'Iron', 'Sound system', 'Sewing machine', 'Printer', 'Other',
]

/** Physical condition checklist offered on intake (repairs). */
export const DEFAULT_CONDITION_CHECKLIST = [
  'Powers on', 'Screen / display OK', 'Touch works', 'Body scratches / dents', 'Back cover intact', 'Buttons work',
  'Charging port OK', 'Camera OK', 'Speaker / mic OK', 'Water damage signs', 'SIM / memory card removed',
]

export const DEFAULT_ACCESSORIES = ['Charger', 'Cable', 'Battery', 'Back cover', 'Box', 'SIM tray', 'Remote', 'Stand', 'Bag']

/** Common measurement names for tailoring orders (free keys allowed). */
export const MEASUREMENT_PRESETS: Record<string, string[]> = {
  Shirt: ['Neck', 'Chest', 'Waist', 'Shoulder', 'Sleeve length', 'Cuff', 'Shirt length'],
  Trouser: ['Waist', 'Hip', 'Thigh', 'Knee', 'Bottom', 'Inseam', 'Length'],
  Blouse: ['Bust', 'Under bust', 'Waist', 'Shoulder', 'Arm hole', 'Sleeve length', 'Sleeve round', 'Front neck', 'Back neck', 'Blouse length'],
  Frock: ['Bust', 'Waist', 'Hip', 'Shoulder', 'Sleeve length', 'Length'],
}

/** Days → "until" date (yyyy-mm-dd) from a start date (default today). */
export function addDaysIso(days: number, from = new Date()): string {
  const d = new Date(from.getTime())
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
