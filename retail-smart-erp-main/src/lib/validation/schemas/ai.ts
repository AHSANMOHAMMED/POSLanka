import { z } from 'zod'
import { uuidSchema } from './common'

// ==================== AI CHAT ====================

// POST /api/ai/chat
export const aiChatSchema = z.object({
  message: z.string().min(1, 'Message is required').max(2000, 'Message too long'),
  context: z.object({
    page: z.string().optional(),
  }).optional(),
})

// ==================== ERROR LOGS ====================

// PUT /api/ai/error-logs
export const updateErrorLogSchema = z.object({
  id: uuidSchema,
  action: z.enum(['resolve', 'unresolve']).optional(),
  resolutionStatus: z.enum(['open', 'investigating', 'resolved', 'wont_fix']).optional(),
  resolutionNotes: z.string().max(5000).optional(),
})

// ==================== VALIDATE ACTION ====================

// POST /api/ai/validate-action
export const validateActionSchema = z.object({
  action: z.enum(['sale', 'return', 'purchase', 'stock_adjustment', 'price_change', 'payment']),
  data: z.record(z.string(), z.any()),
})

// ==================== ALERTS ====================

// PUT /api/ai/alerts
export const updateAlertSchema = z.object({
  id: uuidSchema.optional(),
  ids: z.array(uuidSchema).optional(),
  action: z.enum(['read', 'dismiss']),
}).refine(
  (data) => data.id || (data.ids && data.ids.length > 0),
  { message: 'Either id or ids must be provided', path: ['id'] }
)

// ==================== REWRITE BUG REPORT ====================

// POST /api/ai/rewrite-bug-report
export const rewriteBugReportSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(500),
  description: z.string().max(5000).optional(),
  severity: z.string().max(50).optional(),
  url: z.string().max(2000).optional(),
})

// ==================== GENERATE PRINT TEMPLATE ====================

// POST /api/ai/generate-print-template
export const generatePrintTemplateSchema = z.object({
  documentType: z.string().trim().min(1, 'Document type is required').max(100),
  style: z.string().max(100).optional(),
  primaryColor: z.string().max(50).optional(),
  companyName: z.string().max(255).optional(),
})

// ==================== GENERATE LETTERHEAD ====================

// POST /api/ai/generate-letterhead
export const generateLetterheadSchema = z.object({
  companyName: z.string().trim().min(1, 'Company name is required').max(255),
  logoUrl: z.string().max(2000).optional(),
  primaryColor: z.string().max(50).optional(),
  style: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
})

// ==================== SETUP AI SUGGEST ====================

// POST /api/c/[slug]/setup/ai-suggest
export const setupAiSuggestSchema = z.object({
  step: z.string().max(50).optional(),
  context: z.object({
    businessType: z.string().max(50).optional(),
    country: z.string().max(10).optional(),
    countryName: z.string().max(100).optional(),
    currency: z.string().max(10).optional(),
    companyName: z.string().max(255).optional(),
  }).optional(),
  question: z.string().max(500).optional(),
})
