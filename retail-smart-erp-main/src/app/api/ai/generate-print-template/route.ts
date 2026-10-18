import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { generateText } from '@/lib/ai/gemini'
import { validateBody } from '@/lib/validation/helpers'
import { generatePrintTemplateSchema } from '@/lib/validation/schemas/ai'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const permError = requirePermission(session, 'manageSettings')
  if (permError) return permError

  try {
    const parsed = await validateBody(request, generatePrintTemplateSchema)
    if (!parsed.success) return parsed.response
    const { documentType, style, primaryColor, companyName } = parsed.data

    const systemPrompt = `You are a print template designer for business documents in a POS system.
Design clean, practical print template configurations optimized for each document type.

Rules:
- Generate CSS that works well for printing
- Focus on readability and practical layout
- Use the provided color for accent elements
- Templates should be professional and clean
- Return ONLY valid JSON, no markdown fences`

    const userPrompt = `Generate 3 print template configurations for document type: ${documentType}

Company: ${companyName || 'Business'}
Style: ${style || 'modern'}
Color: ${primaryColor || '#2563eb'}

Return a JSON array of 3 template configs:
[
  {
    "name": "Template name",
    "customCss": "CSS for the print template body area",
    "description": "Brief description of the design"
  }
]

Template styles:
1. Clean & Minimal - lots of whitespace, simple borders
2. Detailed & Structured - clear sections with borders and backgrounds
3. Compact - space-efficient for thermal or small paper

The CSS should style elements like .invoice-header, .invoice-items table, .invoice-totals, .invoice-footer.`

    const result = await generateText(userPrompt, {
      systemPrompt,
      maxTokens: 2000,
      temperature: 0.7,
    })

    if (!result?.text) {
      return NextResponse.json({ error: 'AI service unavailable' }, { status: 503 })
    }

    try {
      let jsonText = result.text.trim()
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      }
      const templates = JSON.parse(jsonText)
      if (!Array.isArray(templates)) throw new Error('Expected array')
      return NextResponse.json({ templates })
    } catch {
      const color = primaryColor || '#2563eb'
      const fallbackTemplates = [
        {
          name: 'Clean Minimal',
          customCss: `body { font-family: Arial, sans-serif; color: #374151; } table { width: 100%; border-collapse: collapse; } th { background: #f9fafb; padding: 8px 12px; text-align: left; font-size: 12px; border-bottom: 2px solid ${color}; } td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 12px; } .totals { margin-top: 16px; text-align: right; }`,
          description: 'Clean layout with minimal borders and accent color',
        },
        {
          name: 'Structured Detail',
          customCss: `body { font-family: Arial, sans-serif; color: #1f2937; } table { width: 100%; border-collapse: collapse; border: 1px solid #d1d5db; } th { background: ${color}; color: white; padding: 10px 12px; text-align: left; font-size: 12px; } td { padding: 8px 12px; border: 1px solid #e5e7eb; font-size: 12px; } tr:nth-child(even) { background: #f9fafb; } .totals { margin-top: 16px; padding: 12px; background: #f3f4f6; border-radius: 4px; }`,
          description: 'Bordered table with colored header and alternating rows',
        },
        {
          name: 'Compact',
          customCss: `body { font-family: Arial, sans-serif; color: #374151; font-size: 11px; } table { width: 100%; border-collapse: collapse; } th { padding: 4px 8px; text-align: left; font-size: 10px; border-bottom: 1px solid #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; } td { padding: 4px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; } .totals { margin-top: 8px; font-size: 11px; text-align: right; }`,
          description: 'Space-efficient layout ideal for receipts and small paper',
        },
      ]
      return NextResponse.json({ templates: fallbackTemplates })
    }
  } catch (error) {
    console.error('Generate print template error:', error)
    return NextResponse.json({ error: 'Failed to generate templates' }, { status: 500 })
  }
}
