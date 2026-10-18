import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db, withTenant } from '@/lib/db'
import { tenants, users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { generateText, generateJSON, isAIEnabled } from '@/lib/ai/gemini'
import { SYSTEM_PROMPTS } from '@/lib/ai/prompts'
import { getDefaultFiscalYear } from '@/lib/setup/seed-data'
import { getTaxSuggestionForCountryCode } from '@/lib/setup/country-wise-tax'
import { validateBody } from '@/lib/validation/helpers'
import { setupAiSuggestSchema } from '@/lib/validation/schemas/ai'

/** Check if AI is enabled at both server and tenant level */
function isTenantAIEnabled(tenant: { aiEnabled: boolean }): boolean {
  return isAIEnabled() && tenant.aiEnabled
}

interface BusinessProfileSuggestion {
  taxRate?: number
  taxInclusive?: boolean
  fiscalYearStart?: string
  fiscalYearEnd?: string
  fiscalYearName?: string
  taxNote?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify user has access to this tenant
    const { slug } = await params
    const tenant = await db.query.tenants.findFirst({
      where: eq(tenants.slug, slug),
    })

    if (!tenant) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    const userRecord = await withTenant(tenant.id, async (tdb) => {
      return tdb.query.users.findFirst({
        where: and(
          eq(users.id, session.user.id),
          eq(users.isActive, true)
        ),
      })
    })

    if (!userRecord) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const parsed = await validateBody(request, setupAiSuggestSchema)
    if (!parsed.success) return parsed.response
    const { step, context, question } = parsed.data

    // Free-form question mode (limit question length)
    if (question) {
      const trimmedQuestion = typeof question === 'string' ? question.substring(0, 500) : ''

      if (!isTenantAIEnabled(tenant)) {
        return NextResponse.json({
          response: 'AI features are not configured. Please set up your business manually.',
        })
      }

      const prompt = `Business type: ${context?.businessType || 'retail'}
Country: ${context?.countryName || context?.country || 'Unknown'}
Currency: ${context?.currency || 'LKR'}
Company: ${context?.companyName || 'New Business'}

User question: ${trimmedQuestion}`

      const aiResponse = await generateText(prompt, {
        systemPrompt: SYSTEM_PROMPTS.setupAssistant,
        maxTokens: 300,
        temperature: 0.7,
      })

      return NextResponse.json({
        response: aiResponse?.text || 'I\'m unable to help right now. Please try again.',
      })
    }

    // Step-specific auto-suggestions
    if (step === 'business_profile') {
      const country = context?.country || ''
      const businessType = context?.businessType || 'retail'
      const countryName = context?.countryName || ''

      // Get fiscal year defaults (always available, no AI needed)
      const fyDefaults = getDefaultFiscalYear(country)

      // Use country-wise tax database for tax suggestions (no AI needed)
      const taxSuggestionFromDb = getTaxSuggestionForCountryCode(country, businessType)

      // Build tax suggestion
      let taxSuggestion: BusinessProfileSuggestion = {
        fiscalYearStart: fyDefaults.start,
        fiscalYearEnd: fyDefaults.end,
        fiscalYearName: fyDefaults.name,
        taxRate: taxSuggestionFromDb.taxRate,
        taxInclusive: taxSuggestionFromDb.taxInclusive,
        taxNote: taxSuggestionFromDb.taxNote,
      }

      // If AI is enabled and tax rate is 0 (not found in database), try AI as fallback
      if (isTenantAIEnabled(tenant) && country && taxSuggestion.taxRate === 0) {
        const aiResult = await generateJSON<BusinessProfileSuggestion>(
          `For a ${businessType} business in ${countryName || country}, suggest:
1. Standard VAT/GST/Sales tax rate (number)
2. Whether prices are typically tax-inclusive (boolean)
3. A brief note about the tax (1 sentence)

Respond with JSON: { "taxRate": number, "taxInclusive": boolean, "taxNote": "string" }`,
          {
            systemPrompt: SYSTEM_PROMPTS.setupAssistant,
            maxTokens: 150,
            temperature: 0.3,
          }
        )

        if (aiResult) {
          taxSuggestion = { ...taxSuggestion, ...aiResult }
        }
      }

      return NextResponse.json(taxSuggestion)
    }

    if (step === 'categories') {
      if (!isTenantAIEnabled(tenant)) {
        return NextResponse.json({ suggestedCategories: [] })
      }

      const aiResult = await generateJSON<{ suggestedCategories: string[] }>(
        `Suggest 8-10 product/item categories for a ${context?.businessType || 'retail'} business in ${context?.countryName || context?.country || 'any country'}.
Return JSON: { "suggestedCategories": ["Category 1", "Category 2", ...] }`,
        {
          systemPrompt: SYSTEM_PROMPTS.setupAssistant,
          maxTokens: 200,
          temperature: 0.5,
        }
      )

      return NextResponse.json(aiResult || { suggestedCategories: [] })
    }

    if (step === 'warehouses') {
      if (!isTenantAIEnabled(tenant)) {
        return NextResponse.json({ suggestedNames: ['Main Warehouse'] })
      }

      const aiResult = await generateJSON<{ suggestedNames: string[] }>(
        `Suggest 3 warehouse names for a ${context?.businessType || 'retail'} business called "${context?.companyName || 'My Business'}".
Return JSON: { "suggestedNames": ["Name 1", "Name 2", "Name 3"] }`,
        {
          systemPrompt: SYSTEM_PROMPTS.setupAssistant,
          maxTokens: 100,
          temperature: 0.5,
        }
      )

      return NextResponse.json(aiResult || { suggestedNames: ['Main Warehouse'] })
    }

    if (step === 'cost_centers') {
      if (!isTenantAIEnabled(tenant)) {
        return NextResponse.json({ suggestedCenters: ['Main'] })
      }

      const aiResult = await generateJSON<{ suggestedCenters: string[] }>(
        `Suggest 3-5 cost centers for a ${context?.businessType || 'retail'} business called "${context?.companyName || 'My Business'}".
Cost centers track expenses by department or location.
Return JSON: { "suggestedCenters": ["Center 1", "Center 2", ...] }`,
        {
          systemPrompt: SYSTEM_PROMPTS.setupAssistant,
          maxTokens: 150,
          temperature: 0.5,
        }
      )

      return NextResponse.json(aiResult || { suggestedCenters: ['Main'] })
    }

    if (step === 'business_config') {
      const businessType = context?.businessType || 'retail'
      const countryName = context?.countryName || context?.country || 'any country'
      const currency = context?.currency || 'LKR'

      if (!isTenantAIEnabled(tenant)) {
        return NextResponse.json({ suggestedCategories: [] })
      }

      // Build prompt with business-type-specific fields
      let extraFields = ''
      let extraSchema = ''
      if (businessType === 'restaurant') {
        extraFields = '\n2. A reasonable number of tables for a new restaurant (number between 5-50)\n3. Brief reason for table suggestion (1 sentence)'
        extraSchema = '"numberOfTables": number, "tableNote": "string", '
      } else if (businessType === 'auto_service') {
        extraFields = `\n2. A default hourly labor rate in ${currency} (number)\n3. Brief reason for rate suggestion (1 sentence)`
        extraSchema = '"defaultLaborRate": number, "laborRateNote": "string", '
      }

      const aiResult = await generateJSON<{
        suggestedCategories: string[]
        numberOfTables?: number
        tableNote?: string
        defaultLaborRate?: number
        laborRateNote?: string
      }>(
        `For a ${businessType} business in ${countryName} (currency: ${currency}):
1. Suggest 8-10 ${businessType === 'restaurant' ? 'menu' : 'product'} categories specific to ${countryName}${extraFields}

Respond with JSON: { ${extraSchema}"suggestedCategories": ["Category 1", "Category 2", ...] }`,
        {
          systemPrompt: SYSTEM_PROMPTS.setupAssistant,
          maxTokens: 250,
          temperature: 0.5,
        }
      )

      return NextResponse.json(aiResult || { suggestedCategories: [] })
    }

    if (step === 'pos') {
      const businessType = context?.businessType || 'retail'
      const countryName = context?.countryName || context?.country || 'any country'
      const currency = context?.currency || 'LKR'

      if (!isTenantAIEnabled(tenant)) {
        return NextResponse.json({
          receiptFormat: '80mm',
          paymentMethods: ['cash', 'card', 'bank_transfer'],
        })
      }

      const aiResult = await generateJSON<{
        receiptFormat?: string
        receiptNote?: string
        paymentMethods?: string[]
        paymentNote?: string
      }>(
        `For a ${businessType} business in ${countryName} (currency: ${currency}):
1. Which receipt format is most common? Choose from: 58mm, 80mm, A4
2. Which payment methods should be enabled? Choose from: cash, card, bank_transfer
3. Brief reason for each choice (1 sentence each)

Respond with JSON: { "receiptFormat": "80mm", "receiptNote": "string", "paymentMethods": ["cash", "card"], "paymentNote": "string" }`,
        {
          systemPrompt: SYSTEM_PROMPTS.setupAssistant,
          maxTokens: 150,
          temperature: 0.3,
        }
      )

      return NextResponse.json(aiResult || {
        receiptFormat: '80mm',
        paymentMethods: ['cash', 'card', 'bank_transfer'],
      })
    }


    return NextResponse.json({ error: 'Unknown step' }, { status: 400 })
  } catch {
    return NextResponse.json(
      { response: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
