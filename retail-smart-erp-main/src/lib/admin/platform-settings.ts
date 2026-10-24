/**
 * Platform settings edited in /sys-control/settings and stored in system_settings (key → jsonb).
 * Each key has a strict schema; the shapes match what the readers expect:
 *   bank_details         /api/account/bank-details (bank transfer instructions for vendors)
 *   system_announcement  /api/system/announcement (banner in the vendor app)
 *   volume_discounts     src/lib/billing/settings.ts (multi-business discount tiers)
 *   contact_info         src/lib/billing/settings.ts → /api/public/settings (public pages)
 *   seasonal_offer       src/lib/billing/settings.ts → /api/public/settings (landing / pricing)
 */
import { z } from 'zod'

// Request bodies pass through validateBody, which drops '' and null values, so optional text
// defaults back to '' and an open-ended tier's max back to null.
const text = (max: number) => z.string().trim().max(max).optional().default('')

const phone = z.string().trim().max(30).optional().default('').refine((v) => v === '' || /^\+?[0-9 ()-]{7,30}$/.test(v), 'Use digits, spaces, + ( ) or -')

export const bankDetailsSchema = z.object({
  bankName: z.string().trim().min(2, 'Enter the bank name').max(100),
  branchName: z.string().trim().min(2, 'Enter the branch').max(100),
  accountName: z.string().trim().min(2, 'Enter the account name').max(150),
  accountNumber: z.string().trim().regex(/^[0-9][0-9 -]{3,29}$/, 'Use 4–30 digits (spaces and dashes allowed)'),
  swiftCode: z.string().trim().toUpperCase().optional().default('').refine((v) => v === '' || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v), 'A SWIFT code has 8 or 11 letters and digits'),
  notes: text(500),
})

export const announcementSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(300, 'Keep it under 300 characters').optional().default(''),
  type: z.enum(['info', 'warning', 'error']),
}).refine((v) => !v.enabled || v.message.length >= 5, { message: 'Write the announcement (at least 5 characters) before turning it on', path: ['message'] })

const volumeTier = z.object({
  min: z.number().int().min(2, 'Tiers start at 2 businesses').max(1000),
  max: z.number().int().min(2).max(1000).nullable().optional().transform((v) => v ?? null),
  percent: z.number().min(0).max(90, 'At most 90%'),
})

export const volumeDiscountsSchema = z.object({
  tiers: z.array(volumeTier).max(10),
}).superRefine((v, ctx) => {
  const tiers = v.tiers
  tiers.forEach((t, i) => {
    if (t.max !== null && t.max < t.min) ctx.addIssue({ code: 'custom', path: ['tiers', i, 'max'], message: `Tier ${i + 1}: the upper limit is below the lower limit` })
    if (t.max === null && i !== tiers.length - 1) ctx.addIssue({ code: 'custom', path: ['tiers', i, 'max'], message: `Tier ${i + 1}: only the last tier can be open-ended` })
    if (i > 0) {
      const prev = tiers[i - 1]
      if (prev.max === null || t.min <= prev.max) ctx.addIssue({ code: 'custom', path: ['tiers', i, 'min'], message: `Tier ${i + 1} overlaps tier ${i}` })
      if (t.percent < prev.percent) ctx.addIssue({ code: 'custom', path: ['tiers', i, 'percent'], message: `Tier ${i + 1} gives less discount than tier ${i}` })
    }
  })
})

export const contactInfoSchema = z.object({
  companyName: z.string().trim().min(2, 'Enter the company name').max(100),
  email: z.email('Enter a valid email address').max(255),
  phone: phone.refine((v) => v !== '', 'Enter a phone number'),
  whatsapp: phone,
  address: text(300),
  businessHours: text(120),
})

export const seasonalOfferSchema = z.object({
  enabled: z.boolean(),
  title: text(80),
  description: text(300),
  discountPercent: z.number().min(0).max(90).optional().default(0),
  validUntil: text(10).refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a date'),
  badgeText: text(30),
  applicableTiers: z.array(z.string().uuid()).max(50).optional().default([]),
  showOnLanding: z.boolean(),
  showOnPricing: z.boolean(),
}).superRefine((v, ctx) => {
  if (!v.enabled) return
  if (v.title.length < 3) ctx.addIssue({ code: 'custom', path: ['title'], message: 'Enter a title for the offer' })
  if (v.discountPercent < 1) ctx.addIssue({ code: 'custom', path: ['discountPercent'], message: 'Enter a discount of at least 1%' })
  if (!v.validUntil) ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'Choose the last day of the offer' })
  else if (new Date(`${v.validUntil}T23:59:59`) < new Date()) ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'The end date has already passed' })
  if (!v.showOnLanding && !v.showOnPricing) ctx.addIssue({ code: 'custom', path: ['showOnPricing'], message: 'Show it on the landing page, the pricing page or both' })
})

export const SETTING_SCHEMAS = {
  bank_details: bankDetailsSchema,
  system_announcement: announcementSchema,
  volume_discounts: volumeDiscountsSchema,
  contact_info: contactInfoSchema,
  seasonal_offer: seasonalOfferSchema,
} as const

export type SettingKey = keyof typeof SETTING_SCHEMAS
export const SETTING_KEYS = Object.keys(SETTING_SCHEMAS) as SettingKey[]

export const SETTING_DESCRIPTIONS: Record<SettingKey, string> = {
  bank_details: 'Bank account vendors pay into by transfer',
  system_announcement: 'Banner shown in the vendor app',
  volume_discounts: 'Discount for accounts with several businesses',
  contact_info: 'Contact details on public pages and emails',
  seasonal_offer: 'Limited-time offer on the landing and pricing pages',
}

/** Values used when nothing has been saved yet (mirrors the readers' fallbacks). */
export const SETTING_DEFAULTS: Record<SettingKey, unknown> = {
  bank_details: { bankName: '', branchName: '', accountName: '', accountNumber: '', swiftCode: '', notes: '' },
  system_announcement: { enabled: false, message: '', type: 'info' },
  volume_discounts: {
    tiers: [
      { min: 2, max: 5, percent: 15 },
      { min: 6, max: 10, percent: 25 },
      { min: 11, max: null, percent: 30 },
    ],
  },
  contact_info: {
    companyName: process.env.NEXT_PUBLIC_APP_NAME || 'skyERPOS',
    email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@poslanka.lk',
    phone: '',
    whatsapp: '',
    address: '',
    businessHours: '',
  },
  seasonal_offer: {
    enabled: false, title: '', description: '', discountPercent: 0, validUntil: '', badgeText: '',
    applicableTiers: [], showOnLanding: false, showOnPricing: false,
  },
}

export function isSettingKey(k: string): k is SettingKey {
  return (SETTING_KEYS as string[]).includes(k)
}
