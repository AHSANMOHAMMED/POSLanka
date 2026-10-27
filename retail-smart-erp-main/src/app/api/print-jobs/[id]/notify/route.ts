import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { printJobs } from '@/lib/db/schema'
import { requireModule, requirePermission } from '@/lib/auth/roles'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { printJobNotifySchema } from '@/lib/validation/schemas/print-jobs'
import { messagingAvailability, sendMessage } from '@/lib/messaging'
import { money, shopInfo } from '@/lib/messaging/service'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'

async function guard() {
  const session = await authWithCompany()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const permError = requirePermission(session, 'createSales')
  if (permError) return { error: permError }
  const moduleError = requireModule(session, 'selling')
  if (moduleError) return { error: moduleError }
  return { session }
}

/** Default "job ready" text (also shown in the dialog for editing). */
function readyMessage(shop: string, job: { jobNo: string; title: string; customerName: string; balanceDue: string }, currency: string): string {
  const balance = Number(job.balanceDue) > 0 ? ` Balance due: ${money(currency, job.balanceDue)}.` : ''
  return `Hi ${job.customerName}, your order ${job.jobNo} (${job.title}) is ready for collection at ${shop}.${balance} Thank you!`.slice(0, 640)
}

// GET /api/print-jobs/[id]/notify — which channels can be used + the default text
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await guard()
    if (g.error) return g.error
    const session = g.session!
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const tenantId = session.user.tenantId
    const job = await withTenant(tenantId, async (db) => {
      const denied = await assertRecordBranch(session, db, printJobs, p.data.id, { includeUnassigned: true })
      if (denied) return { denied, job: undefined }
      const [j] = await db.select().from(printJobs).where(eq(printJobs.id, p.data.id)).limit(1)
      return { denied: null, job: j }
    })
    if (job.denied) return job.denied
    if (!job.job) return NextResponse.json({ error: 'Print job not found' }, { status: 404 })
    const [availability, shop] = await Promise.all([messagingAvailability(tenantId), shopInfo(tenantId)])
    return NextResponse.json({ ...availability, phone: job.job.customerPhone, text: readyMessage(shop.name, job.job, shop.currency), notifiedAt: job.job.notifiedAt })
  } catch (error) {
    logError('api/print-jobs/[id]/notify', error)
    return NextResponse.json({ error: 'Failed to load messaging options' }, { status: 500 })
  }
}

// POST /api/print-jobs/[id]/notify — "Notify customer: job ready" by SMS / WhatsApp
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await guard()
    if (g.error) return g.error
    const session = g.session!
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, printJobNotifySchema)
    if (!parsed.success) return parsed.response
    const { channel, phone, text } = parsed.data
    const tenantId = session.user.tenantId
    const id = p.data.id

    const loaded = await withTenant(tenantId, async (db) => {
      const denied = await assertRecordBranch(session, db, printJobs, id, { includeUnassigned: true })
      if (denied) return { denied, job: undefined }
      const [j] = await db.select().from(printJobs).where(eq(printJobs.id, id)).limit(1)
      return { denied: null, job: j }
    })
    if (loaded.denied) return loaded.denied
    const job = loaded.job
    if (!job) return NextResponse.json({ error: 'Print job not found' }, { status: 404 })
    if (job.status === 'cancelled') return NextResponse.json({ error: 'The job is cancelled' }, { status: 400 })
    const to = (phone || job.customerPhone || '').trim()
    if (!to) return NextResponse.json({ error: 'Enter the customer’s mobile number', code: 'INVALID_NUMBER' }, { status: 400 })

    const shop = await shopInfo(tenantId)
    const res = await sendMessage({
      tenantId,
      channel,
      to,
      purpose: 'manual',
      text: text || readyMessage(shop.name, job, shop.currency),
      context: {
        userId: session.user.id,
        recipientType: 'customer',
        recipientId: job.customerId,
        recipientName: job.customerName,
        entityType: 'print_job',
        entityId: job.id,
        entityReference: job.jobNo,
      },
    })
    if (!res.ok) return NextResponse.json({ error: res.error || 'Message not sent', code: res.code }, { status: 400 })

    await withTenant(tenantId, (db) => db.update(printJobs).set({ notifiedAt: new Date() }).where(eq(printJobs.id, id)))
    logAndBroadcast(tenantId, 'print-job', 'updated', id, {
      userId: session.user.id,
      entityName: job.jobNo,
      description: `Customer notified (${channel}) that print job "${job.jobNo}" is ready`,
    })
    return NextResponse.json({ ok: true, units: res.units, remaining: res.remaining })
  } catch (error) {
    logError('api/print-jobs/[id]/notify', error)
    return NextResponse.json({ error: 'Failed to notify the customer' }, { status: 500 })
  }
}
