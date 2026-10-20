import { z } from 'zod'
import { ALERT_TYPES } from '@/lib/notifications/alert-types'

const alertType = z.enum(ALERT_TYPES)
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)')

export const notificationsListSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  unread: z.enum(['1', 'true', '0', 'false']).optional(),
})

export const markNotificationsReadSchema = z.object({
  ids: z.array(z.string().uuid()).max(500).optional(),
  all: z.literal(true).optional(),
}).refine((v) => v.all === true || (v.ids && v.ids.length > 0), { message: 'Provide ids or all: true' })

/** PUT replaces the user's preferences; omitted fields fall back to defaults (quiet hours / digest off when omitted). */
export const alertPreferencesSchema = z.object({
  enabledTypes: z.array(alertType).max(ALERT_TYPES.length).optional(),
  mutedTypes: z.array(alertType).max(ALERT_TYPES.length).default([]),
  quietStart: hhmm.optional(),
  quietEnd: hhmm.optional(),
  timezone: z.string().max(50).optional(),
  digestHour: z.number().int().min(0).max(23).optional(),
  pushEnabled: z.boolean().default(true),
}).refine((v) => !!v.quietStart === !!v.quietEnd, { message: 'Set both quiet hours start and end, or neither', path: ['quietEnd'] })

export const tenantAlertSettingsSchema = z.object({
  defaultMinStock: z.number().min(0).max(1_000_000).optional(),
  expiryWarningDays: z.number().int().min(1).max(365).default(7),
  largeRefundAmount: z.number().min(0).max(1_000_000_000).optional(),
  varianceThreshold: z.number().min(0).max(1_000_000).default(1),
  digestEnabled: z.boolean().default(true),
})
