import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { eq, and } from 'drizzle-orm'
import { notificationTemplates } from '@/lib/db/schema'
import { sendSmsWithLogging, sendEmailWithLogging, renderTemplate } from '@/lib/notifications'
import type { SendNotificationResult } from '@/lib/notifications/types'
import { logError } from '@/lib/ai/error-logger'
import { validateBody } from '@/lib/validation'
import { sendNotificationSchema } from '@/lib/validation/schemas/settings'

// POST - Send SMS or email notification
export async function POST(request: Request) {
  try {
    const session = await auth()
    if (!session?.user?.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const parsed = await validateBody(request, sendNotificationSchema)
    if (!parsed.success) return parsed.response
    const {
      channel,
      recipients,
      templateId,
      templateVariables,
      smsContent,
      emailSubject,
      emailBody,
      entityType,
      entityId,
      entityReference,
    } = parsed.data

    // Get template if using one (within RLS context)
    let template: typeof notificationTemplates.$inferSelect | null = null
    if (templateId) {
      template = await withTenant(session.user.tenantId, async (db) => {
        const [t] = await db
          .select()
          .from(notificationTemplates)
          .where(and(
            eq(notificationTemplates.id, templateId),
            eq(notificationTemplates.tenantId, session.user.tenantId)
          ))
        return t || null
      })
    }

    // Resolve content
    let finalSmsContent = smsContent
    let finalEmailSubject = emailSubject
    let finalEmailBody = emailBody

    if (template) {
      // Render template with variables
      const renderContext = {
        tenantId: session.user.tenantId,
        variables: templateVariables,
      }

      if (template.smsContent && (channel === 'sms' || channel === 'both')) {
        finalSmsContent = await renderTemplate(template.smsContent, renderContext)
      }

      if (template.emailSubject && (channel === 'email' || channel === 'both')) {
        finalEmailSubject = await renderTemplate(template.emailSubject, renderContext)
      }

      if (template.emailBody && (channel === 'email' || channel === 'both')) {
        finalEmailBody = await renderTemplate(template.emailBody, renderContext)
      }
    }

    // Send to all recipients
    const results: SendNotificationResult['results'] = []
    let totalSent = 0
    let totalFailed = 0

    for (const recipient of recipients) {
      // Send SMS
      if ((channel === 'sms' || channel === 'both') && finalSmsContent) {
        const smsResult = await sendSmsWithLogging({
          to: recipient.contact,
          message: finalSmsContent,
          tenantId: session.user.tenantId,
          userId: session.user.id,
          recipientType: recipient.type || 'manual',
          recipientId: recipient.id,
          recipientName: recipient.name,
          entityType,
          entityId,
          entityReference,
          templateId,
        })

        results.push({
          channel: 'sms',
          recipient: recipient.contact,
          success: smsResult.success,
          messageId: smsResult.messageId,
          errorMessage: smsResult.errorMessage,
        })

        if (smsResult.success) totalSent++
        else totalFailed++
      }

      // Send Email
      if ((channel === 'email' || channel === 'both') && finalEmailSubject && finalEmailBody) {
        const emailResult = await sendEmailWithLogging({
          to: recipient.contact,
          subject: finalEmailSubject,
          body: finalEmailBody,
          tenantId: session.user.tenantId,
          userId: session.user.id,
          recipientType: recipient.type || 'manual',
          recipientId: recipient.id,
          recipientName: recipient.name,
          entityType,
          entityId,
          entityReference,
          templateId,
        })

        results.push({
          channel: 'email',
          recipient: recipient.contact,
          success: emailResult.success,
          messageId: emailResult.messageId,
          errorMessage: emailResult.errorMessage,
        })

        if (emailResult.success) totalSent++
        else totalFailed++
      }
    }

    const response: SendNotificationResult = {
      success: totalFailed === 0,
      results,
      totalSent,
      totalFailed,
    }

    return NextResponse.json(response)
  } catch (error) {
    logError('api/send-notification', error)
    return NextResponse.json({ error: 'Failed to send notification' }, { status: 500 })
  }
}
