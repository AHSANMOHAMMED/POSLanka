import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { generateText, isAIEnabledForTenant } from '@/lib/ai/gemini'
import { validateBody } from '@/lib/validation/helpers'
import { generateLetterheadSchema } from '@/lib/validation/schemas/ai'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const permError = requirePermission(session, 'manageSettings')
  if (permError) return permError

  if (!isAIEnabledForTenant(session)) {
    return NextResponse.json({ error: 'AI features are not enabled for this company.' }, { status: 403 })
  }

  try {
    const parsed = await validateBody(request, generateLetterheadSchema)
    if (!parsed.success) return parsed.response
    const { companyName, logoUrl, primaryColor, style, industry } = parsed.data

    const systemPrompt = `You are a professional letterhead designer for business documents.
Generate clean, professional HTML/CSS letterhead designs suitable for printing.

Rules:
- Use inline CSS only (no external stylesheets)
- Keep designs clean and professional
- Use the provided colors when available
- Designs must look good on A4 paper
- Header should include company name prominently
- Footer should be subtle with thank you message
- Do NOT include any images or logo references unless logoUrl is provided
- Return ONLY valid JSON, no markdown fences`

    const userPrompt = `Generate 3 letterhead designs for:

Company: ${companyName}
Style: ${style || 'modern'}
Industry: ${industry || 'general business'}
Primary Color: ${primaryColor || '#2563eb'}
${logoUrl ? `Logo URL: ${logoUrl}` : 'No logo available'}

Return a JSON array of 3 designs, each with this structure:
[
  {
    "name": "Design name",
    "headerHtml": "<div style='...'>header HTML with company name</div>",
    "footerHtml": "<div style='...'>footer HTML</div>",
    "headerHeight": 80,
    "footerHeight": 40
  }
]

Design styles to generate:
1. Clean & Modern - minimal, sans-serif, accent color border
2. Classic & Professional - serif font, centered, elegant
3. Bold & Corporate - strong brand presence, full-width color bar`

    const result = await generateText(userPrompt, {
      systemPrompt,
      maxTokens: 3000,
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
      const designs = JSON.parse(jsonText)
      if (!Array.isArray(designs)) {
        throw new Error('Expected array')
      }
      return NextResponse.json({ designs })
    } catch {
      // Fallback: generate a single default design
      const color = primaryColor || '#2563eb'
      const fallbackDesigns = [
        {
          name: 'Modern Minimal',
          headerHtml: `<div style="padding:20px 0;border-bottom:3px solid ${color};"><h1 style="margin:0;font-size:24px;font-weight:700;color:${color};font-family:Arial,sans-serif;">${companyName}</h1></div>`,
          footerHtml: `<div style="padding:10px 0;border-top:1px solid #e5e7eb;text-align:center;"><p style="margin:0;font-size:10px;color:#9ca3af;font-family:Arial,sans-serif;">Thank you for your business</p></div>`,
          headerHeight: 70,
          footerHeight: 35,
        },
        {
          name: 'Classic Centered',
          headerHtml: `<div style="text-align:center;padding:25px 0;"><h1 style="margin:0;font-size:26px;font-weight:bold;color:#1f2937;font-family:Georgia,serif;letter-spacing:1px;">${companyName}</h1><div style="width:60px;height:2px;background:${color};margin:10px auto;"></div></div>`,
          footerHtml: `<div style="text-align:center;padding:12px 0;"><p style="margin:0;font-size:10px;color:#9ca3af;font-family:Georgia,serif;font-style:italic;">Thank you for choosing ${companyName}</p></div>`,
          headerHeight: 80,
          footerHeight: 35,
        },
        {
          name: 'Bold Corporate',
          headerHtml: `<div style="background:${color};padding:15px 25px;"><h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff;font-family:Arial,sans-serif;">${companyName}</h1></div>`,
          footerHtml: `<div style="background:#f9fafb;padding:10px 25px;border-top:2px solid ${color};"><p style="margin:0;font-size:10px;color:#6b7280;font-family:Arial,sans-serif;">Thank you for your business | ${companyName}</p></div>`,
          headerHeight: 55,
          footerHeight: 35,
        },
      ]
      return NextResponse.json({ designs: fallbackDesigns })
    }
  } catch (error) {
    console.error('Generate letterhead error:', error)
    return NextResponse.json({ error: 'Failed to generate letterhead designs' }, { status: 500 })
  }
}
