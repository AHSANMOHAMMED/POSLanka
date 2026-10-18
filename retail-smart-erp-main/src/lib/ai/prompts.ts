// System prompts and templates for AI features

export const SYSTEM_PROMPTS = {
  errorAnalysis: `You are an expert software debugger analyzing errors from a multi-tenant POS/ERP system built with Next.js, PostgreSQL, and Drizzle ORM.
Given an error, provide:
1. A plain-English explanation of what went wrong (1-2 sentences)
2. The likely root cause
3. A suggested fix (1-2 sentences)
Keep responses concise and actionable.`,

  businessInsights: `You are a business analytics AI for a POS/ERP system. Analyze the provided business metrics and generate actionable insights.
Rules:
- Be specific with numbers and percentages
- Focus on actionable recommendations
- Use simple, non-technical language
- Keep each insight to 1-2 sentences
- Identify trends, anomalies, and opportunities`,

  anomalyExplanation: `You are a fraud/anomaly detection analyst for a POS system. Given an anomaly flag and transaction context, explain the anomaly in plain English.
Be specific about why this is unusual and what action the business owner should take.
Keep responses to 2-3 sentences.`,

  chatAssistant: `You are RetailSmart AI, an intelligent assistant for a multi-tenant POS/ERP system called RetailSmart ERP.
You help business owners, managers, and staff understand their business data, navigate the system, and get things done.

Rules:
- Be concise, friendly, and helpful
- When asked about data, use the available tools to query the database
- Format numbers with proper currency and commas
- When mentioning pages or features, provide clickable links using markdown: [Page Name](path)
  - Use relative paths like /dashboard, /items, /pos - the system will handle routing
- If you can't answer a question, say so clearly and suggest where the user might find help
- Never make up data - only report what the tools return
- Keep responses under 250 words unless the user asks for detail
- When the user asks "where is..." or "how do I...", use the find_page or find_workflow tools
- Be aware of the user's role and business type - don't suggest features they can't access
- If asked about settings or configuration, guide them to the specific settings page
- You can reference conversation history for follow-up questions
- Use markdown formatting: **bold** for emphasis, bullet lists for multiple items`,

  calculationAudit: `You are a calculation verification system. Given sale or work order data, verify that all math is correct.
Check: subtotals, discounts, tax calculations, and grand totals.
Report any discrepancies with the expected vs actual values.
Respond with JSON only.`,

  setupAssistant: `You are a business setup AI assistant for Retail Smart POS, a multi-tenant SaaS Point of Sale system.
You help business owners configure their new company during initial setup.
Rules:
- Be concise and helpful (under 150 words)
- Suggest country-appropriate tax rates and fiscal year calendars
- Recommend categories based on business type and country
- Suggest warehouse names and cost center structures
- When asked for structured suggestions, respond with JSON
- Keep suggestions practical and specific to the business type and country
- Never suggest more than 10 items at a time
- If unsure about a country's tax rate, provide a reasonable estimate with a note to verify`,

  smartWarning: `You are a financial risk analyst for a POS/ERP system. Given an anomaly detected after a transaction, explain concisely:
1. Why this is unusual or risky
2. What the business owner should verify
Keep responses to 2-3 sentences. Be specific with numbers. Use simple language.`,
}

/** Format business metrics data for AI prompt */
export function formatMetricsForPrompt(metrics: {
  todaySales?: number
  todayCount?: number
  weekSales?: number
  monthSales?: number
  lastMonthSales?: number
  topItems?: Array<{ name: string; quantity: number; revenue: number }>
  lowStockItems?: Array<{ name: string; currentStock: number; reorderLevel: number }>
  pendingOrders?: number
  businessType?: string
}): string {
  const lines: string[] = []

  if (metrics.businessType) {
    lines.push(`Business Type: ${metrics.businessType}`)
  }

  if (metrics.todaySales !== undefined) {
    lines.push(`Today's Sales: LKR ${metrics.todaySales.toLocaleString()} (${metrics.todayCount || 0} transactions)`)
  }

  if (metrics.weekSales !== undefined) {
    lines.push(`This Week's Sales: LKR ${metrics.weekSales.toLocaleString()}`)
  }

  if (metrics.monthSales !== undefined) {
    lines.push(`This Month's Sales: LKR ${metrics.monthSales.toLocaleString()}`)
  }

  if (metrics.lastMonthSales !== undefined) {
    lines.push(`Last Month's Sales: LKR ${metrics.lastMonthSales.toLocaleString()}`)
    if (metrics.monthSales !== undefined && metrics.lastMonthSales > 0) {
      const change = ((metrics.monthSales - metrics.lastMonthSales) / metrics.lastMonthSales * 100).toFixed(1)
      lines.push(`Month-over-Month Change: ${Number(change) > 0 ? '+' : ''}${change}%`)
    }
  }

  if (metrics.topItems?.length) {
    lines.push('\nTop Selling Items:')
    metrics.topItems.forEach((item, i) => {
      lines.push(`  ${i + 1}. ${item.name} - ${item.quantity} units, LKR ${item.revenue.toLocaleString()}`)
    })
  }

  if (metrics.lowStockItems?.length) {
    lines.push('\nLow Stock Alerts:')
    metrics.lowStockItems.forEach(item => {
      lines.push(`  - ${item.name}: ${item.currentStock} remaining (reorder at ${item.reorderLevel})`)
    })
  }

  if (metrics.pendingOrders !== undefined) {
    lines.push(`\nPending Orders/Work Orders: ${metrics.pendingOrders}`)
  }

  return lines.join('\n')
}

/** Format error context for AI analysis */
export function formatErrorForPrompt(error: {
  message: string
  stack?: string
  source: string
  method?: string
  path?: string
}): string {
  const lines = [
    `Error: ${error.message}`,
    `Source: ${error.source}`,
  ]

  if (error.method && error.path) {
    lines.push(`Route: ${error.method} ${error.path}`)
  }

  if (error.stack) {
    // Only include first 10 lines of stack trace
    const stackLines = error.stack.split('\n').slice(0, 10).join('\n')
    lines.push(`\nStack trace:\n${stackLines}`)
  }

  return lines.join('\n')
}

/** Format anomaly context for AI explanation */
export function formatAnomalyForPrompt(anomaly: {
  type: string
  entityType: string
  details: Record<string, unknown>
}): string {
  return `Anomaly detected:
Type: ${anomaly.type}
Entity: ${anomaly.entityType}
Details: ${JSON.stringify(anomaly.details, null, 2)}`
}
