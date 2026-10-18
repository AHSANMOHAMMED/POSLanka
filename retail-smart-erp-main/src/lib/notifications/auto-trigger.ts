import { db } from '@/lib/db'
import { eq, and, gte } from 'drizzle-orm'
import { notificationTemplates, notificationLogs, customers } from '@/lib/db/schema'
import { renderTemplate, type RenderContext } from './templates/renderer'
import { sendSmsWithLogging } from './sms/send'
import { sendEmailWithLogging } from './email/send'

export type TriggerEvent =
  | 'appointment_confirmed'
  | 'appointment_reminder'
  | 'work_order_completed'
  | 'work_order_invoiced'
  | 'sale_completed'
  | 'reservation_confirmed'
  | 'estimate_approved'
  | 'estimate_rejected'
  | 'delivery_dispatched'
  | 'delivery_delivered'

interface TriggerContext extends RenderContext {
  recipientPhone?: string
  recipientEmail?: string
}

/**
 * Trigger auto-notifications for a given event.
 * Finds matching templates with isAutoTrigger=true and triggerEvent matching,
 * renders them, and sends via configured channels.
 *
 * Deduplication: skips if same template sent to same recipient within 5 minutes.
 */
export async function triggerNotification(
  tenantId: string,
  event: TriggerEvent,
  context: TriggerContext
): Promise<void> {
  try {
    // Find matching auto-trigger templates
    const templates = await db.query.notificationTemplates.findMany({
      where: and(
        eq(notificationTemplates.tenantId, tenantId),
        eq(notificationTemplates.isAutoTrigger, true),
        eq(notificationTemplates.isActive, true),
        eq(notificationTemplates.triggerEvent, event)
      ),
    })

    if (templates.length === 0) return

    // Resolve recipient contact info from customer if not provided
    let phone = context.recipientPhone
    let email = context.recipientEmail

    if ((!phone || !email) && context.customerId) {
      const customer = await db.query.customers.findFirst({
        where: eq(customers.id, context.customerId),
      })
      if (customer) {
        if (!phone) phone = customer.phone || undefined
        if (!email) email = customer.email || undefined
      }
    }

    // Process each template
    for (const template of templates) {
      const recipient = template.channel === 'email' ? email : phone
      if (!recipient) continue

      // Deduplication: check if same template sent to same recipient in last 5 min
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
      const recentLog = await db.query.notificationLogs.findFirst({
        where: and(
          eq(notificationLogs.tenantId, tenantId),
          eq(notificationLogs.templateId, template.id),
          eq(notificationLogs.recipientContact, recipient),
          gte(notificationLogs.sentAt, fiveMinAgo)
        ),
      })

      if (recentLog) continue // Skip duplicate

      // Render template content
      const renderContext: RenderContext = {
        tenantId,
        customerId: context.customerId,
        vehicleId: context.vehicleId,
        workOrderId: context.workOrderId,
        appointmentId: context.appointmentId,
        saleId: context.saleId,
        estimateId: context.estimateId,
        variables: context.variables,
      }

      // Send via appropriate channel
      if ((template.channel === 'sms' || template.channel === 'both') && phone && template.smsContent) {
        const renderedSms = await renderTemplate(template.smsContent, renderContext)
        await sendSmsWithLogging({
          to: phone,
          message: renderedSms,
          tenantId,
          templateId: template.id,
        })
      }

      if ((template.channel === 'email' || template.channel === 'both') && email && template.emailSubject && template.emailBody) {
        const renderedSubject = await renderTemplate(template.emailSubject, renderContext)
        const renderedBody = await renderTemplate(template.emailBody, renderContext)
        await sendEmailWithLogging({
          to: email,
          subject: renderedSubject,
          body: renderedBody,
          tenantId,
          templateId: template.id,
        })
      }
    }
  } catch (error) {
    // Don't let notification failures break the main workflow
    console.error(`Auto-trigger notification failed for event ${event}:`, error)
  }
}
