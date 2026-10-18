import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { generateText } from '@/lib/ai/gemini'
import { validateBody } from '@/lib/validation/helpers'
import { rewriteBugReportSchema } from '@/lib/validation/schemas/ai'

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const permError = requirePermission(session, 'manageSettings')
  if (permError) return permError

  try {
    const parsed = await validateBody(request, rewriteBugReportSchema)
    if (!parsed.success) return parsed.response
    const { title, description, severity, url } = parsed.data

    // Determine module from URL
    const urlPath = url ? new URL(url).pathname : ''
    const moduleHint = extractModuleFromUrl(urlPath)

    const systemPrompt = `You are a technical writer helping improve bug reports for a POS (Point of Sale) system.
Your job is to rewrite the user's bug report to be clearer, more structured, and more useful for developers.

Rules:
- Keep the improved title concise (under 80 characters) and actionable
- Structure the description with clear sections
- Be professional but clear
- If the URL suggests a specific module, mention it
- Auto-analyze the possible root cause based on the module and description
- Return ONLY valid JSON, no markdown fences`

    const userPrompt = `Rewrite this bug report:

Title: ${title}
Description: ${description || 'No description provided'}
Severity: ${severity}
Page URL: ${url || 'Unknown'}
Module: ${moduleHint}

Return a JSON object with exactly these fields:
{
  "improvedTitle": "concise actionable title",
  "improvedDescription": "## Steps to Reproduce\\n1. ...\\n\\n## Expected Behavior\\n...\\n\\n## Actual Behavior\\n...\\n\\n## Additional Context\\n...",
  "analysis": "Brief analysis of what might be causing this issue based on the module and description"
}`

    const result = await generateText(userPrompt, {
      systemPrompt,
      maxTokens: 1000,
      temperature: 0.3,
    })

    if (!result?.text) {
      return NextResponse.json({ error: 'AI service unavailable' }, { status: 503 })
    }

    // Parse the JSON response
    try {
      // Strip markdown code fences if present
      let jsonText = result.text.trim()
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
      }
      const aiResult = JSON.parse(jsonText)
      return NextResponse.json({
        improvedTitle: aiResult.improvedTitle || title,
        improvedDescription: aiResult.improvedDescription || description,
        analysis: aiResult.analysis || '',
      })
    } catch {
      // If JSON parsing fails, return raw text as description improvement
      return NextResponse.json({
        improvedTitle: title,
        improvedDescription: result.text,
        analysis: '',
      })
    }
  } catch (error) {
    console.error('AI rewrite error:', error)
    return NextResponse.json({ error: 'Failed to rewrite bug report' }, { status: 500 })
  }
}

function extractModuleFromUrl(path: string): string {
  if (path.includes('/pos')) return 'POS / Point of Sale'
  if (path.includes('/sales')) return 'Sales'
  if (path.includes('/purchases')) return 'Purchases'
  if (path.includes('/inventory') || path.includes('/stock') || path.includes('/warehouses')) return 'Inventory / Stock'
  if (path.includes('/customers')) return 'Customers'
  if (path.includes('/suppliers')) return 'Suppliers'
  if (path.includes('/work-orders')) return 'Work Orders (Auto Service)'
  if (path.includes('/appointments')) return 'Appointments'
  if (path.includes('/estimates')) return 'Insurance Estimates'
  if (path.includes('/accounting')) return 'Accounting'
  if (path.includes('/settings')) return 'Settings'
  if (path.includes('/dashboard')) return 'Dashboard'
  if (path.includes('/setup')) return 'Setup Wizard'
  if (path.includes('/reports')) return 'Reports'
  if (path.includes('/restaurant') || path.includes('/tables') || path.includes('/reservations')) return 'Restaurant'
  if (path.includes('/loyalty')) return 'Loyalty Program'
  return 'Unknown module'
}
