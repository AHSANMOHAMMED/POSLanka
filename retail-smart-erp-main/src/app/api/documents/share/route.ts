import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requireTenantFeature } from '@/lib/features/check'
import {
  buildDocumentShareText,
  buildWhatsAppShareUrl,
  type WhatsAppDocumentType,
} from '@/lib/whatsapp'
import { renderDocumentHtml, type DocumentPayload } from '@/lib/pdf/documents'
import { z } from 'zod'

const schema = z.object({
  documentType: z.enum(['receipt', 'invoice', 'quotation', 'credit_note']),
  documentId: z.string().min(1),
  label: z.string().min(1),
  phone: z.string().optional(),
  amount: z.string().optional(),
  pdfUrl: z.string().url().optional(),
  document: z
    .object({
      shopName: z.string(),
      shopAddress: z.string().optional(),
      shopPhone: z.string().optional(),
      customerName: z.string().optional(),
      customerPhone: z.string().optional(),
      lines: z.array(
        z.object({
          name: z.string(),
          quantity: z.number(),
          unitPrice: z.number(),
          total: z.number(),
        })
      ),
      subtotal: z.number(),
      tax: z.number(),
      total: z.number(),
      currency: z.string().optional(),
      notes: z.string().optional(),
      locale: z.enum(['en', 'si']).optional(),
    })
    .optional(),
})

export async function POST(request: NextRequest) {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const feature = await requireTenantFeature(session.user.tenantId, 'whatsapp')
  if (!feature.ok) {
    return NextResponse.json({ error: 'WhatsApp feature disabled' }, { status: 403 })
  }

  const body = await request.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const text = buildDocumentShareText({
    documentType: parsed.data.documentType as WhatsAppDocumentType,
    label: parsed.data.label,
    shopName: session.user.tenantName,
    pdfUrl: parsed.data.pdfUrl,
    amount: parsed.data.amount,
  })

  const whatsappUrl = buildWhatsAppShareUrl({
    phone: parsed.data.phone,
    text,
  })

  let html: string | undefined
  if (parsed.data.document) {
    const payload: DocumentPayload = {
      type: parsed.data.documentType,
      number: parsed.data.label,
      shopName: parsed.data.document.shopName || session.user.tenantName,
      ...parsed.data.document,
    }
    html = renderDocumentHtml(payload)
  }

  return NextResponse.json({
    whatsappUrl,
    text,
    html,
  })
}
