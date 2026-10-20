/**
 * Receipt customisation settings (W7).
 *
 * Stored as JSONB in `tenants.receipt_settings` (tenant defaults) and
 * `pos_profiles.receipt_settings` (per-counter overrides). Both columns hold a
 * *partial* object; the effective settings are
 *   DEFAULTS <- tenant.receipt_settings <- legacy pos_profile columns <- pos_profile.receipt_settings
 *
 * Pure module (no DOM / server imports) so it can be shared by API routes,
 * React components and the ESC/POS encoder.
 */
import { z } from 'zod'

export const INVOICE_CODE_TYPES = ['barcode', 'qr', 'both', 'none'] as const
export type InvoiceCodeType = (typeof INVOICE_CODE_TYPES)[number]

const line = z.string().trim().max(120)

/** Full (resolved) shape. */
export const receiptSettingsSchema = z.object({
  showLogo: z.boolean(),
  logoWidthPct: z.coerce.number().int().min(40).max(100),
  showLegalName: z.boolean(),
  showAddress: z.boolean(),
  showPhone: z.boolean(),
  showEmail: z.boolean(),
  showWebsite: z.boolean(),
  showTaxId: z.boolean(),
  showBrn: z.boolean(),
  headerLines: z.array(line).max(5),
  footerLines: z.array(line).max(5),
  returnPolicy: z.string().trim().max(300),
  invoiceCode: z.enum(INVOICE_CODE_TYPES),
  showCashier: z.boolean(),
  showCounter: z.boolean(),
  showCustomer: z.boolean(),
  showItemSku: z.boolean(),
  fontSize: z.enum(['normal', 'large']),
})

export type ReceiptSettings = z.infer<typeof receiptSettingsSchema>

/** Partial shape accepted by PUT /api/tenant and pos-profile routes (strict: unknown keys rejected). */
export const receiptSettingsPatchSchema = receiptSettingsSchema.partial().strict()
export type ReceiptSettingsPatch = z.infer<typeof receiptSettingsPatchSchema>

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  showLogo: true,
  logoWidthPct: 60,
  showLegalName: true,
  showAddress: true,
  showPhone: true,
  showEmail: true,
  showWebsite: true,
  showTaxId: true,
  showBrn: true,
  headerLines: [],
  footerLines: [],
  returnPolicy: '',
  invoiceCode: 'both',
  showCashier: true,
  showCounter: true,
  showCustomer: true,
  showItemSku: false,
  fontSize: 'normal',
}

/**
 * Leniently parse a stored JSONB value: invalid / unknown keys are dropped
 * field-by-field instead of failing the whole object (old rows stay usable).
 */
export function sanitizeReceiptSettingsPatch(raw: unknown): ReceiptSettingsPatch {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, unknown> = {}
  const shape = receiptSettingsSchema.shape as Record<string, z.ZodTypeAny>
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const field = shape[k]
    if (!field || v === undefined) continue
    const r = field.safeParse(v)
    if (r.success) out[k] = r.data
  }
  return out as ReceiptSettingsPatch
}

/** Split a legacy free-text header/footer into at most 5 trimmed lines. */
export function textToLines(text: string | null | undefined): string[] {
  if (!text) return []
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 5)
}

export interface LegacyProfileReceiptFields {
  receiptHeader?: string | null
  receiptFooter?: string | null
  showLogoOnReceipt?: boolean | null
  receiptSettings?: unknown
}

/** Compute the effective settings for a print. */
export function resolveReceiptSettings(
  tenantSettings: unknown,
  profile?: LegacyProfileReceiptFields | null
): ReceiptSettings {
  const tenantPatch = sanitizeReceiptSettingsPatch(tenantSettings)
  const legacy: ReceiptSettingsPatch = {}
  if (profile) {
    const h = textToLines(profile.receiptHeader)
    const f = textToLines(profile.receiptFooter)
    if (h.length) legacy.headerLines = h
    if (f.length) legacy.footerLines = f
    if (profile.showLogoOnReceipt === false) legacy.showLogo = false
  }
  const profilePatch = sanitizeReceiptSettingsPatch(profile?.receiptSettings)
  return { ...DEFAULT_RECEIPT_SETTINGS, ...tenantPatch, ...legacy, ...profilePatch }
}

/** Default footer used when no footer lines are configured anywhere. */
export const DEFAULT_FOOTER_LINE = 'Thank you for your purchase!'
