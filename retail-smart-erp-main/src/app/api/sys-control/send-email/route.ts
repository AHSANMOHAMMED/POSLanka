import { NextRequest, NextResponse } from 'next/server'
import { validateAdminSessionWithRefresh } from '@/lib/admin'
import { sendSystemEmail } from '@/lib/email/system-email'
import { validateBody } from '@/lib/validation/helpers'
import { sysSendEmailSchema } from '@/lib/validation/schemas/sys-control'

export async function POST(request: NextRequest) {
  const session = await validateAdminSessionWithRefresh()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await validateBody(request, sysSendEmailSchema)
  if (!parsed.success) return parsed.response
  const { to, subject, html, text } = parsed.data

  try {
    const result = await sendSystemEmail({
      to,
      subject,
      html: html || `<p>${text}</p>`,
      text,
    })

    return NextResponse.json({
      success: true,
      dev: result.dev || false,
      messageId: 'messageId' in result ? result.messageId : undefined,
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to send email' },
      { status: 500 }
    )
  }
}
