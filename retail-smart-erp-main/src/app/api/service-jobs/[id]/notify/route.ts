import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { serviceJobs } from '@/lib/db/schema'
import { requireModule } from '@/lib/auth/roles'
import { assertRecordBranch } from '@/lib/auth/branch-access'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { serviceJobNotifySchema } from '@/lib/validation/schemas/service-jobs'
import { messagingAvailability, sendMessage } from '@/lib/messaging'
import { money, shopInfo } from '@/lib/messaging/service'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { SERVICE_JOB_VIEW, addServiceJobHistory, requireAnyPermission } from '@/lib/service-jobs/server'

async function guard() {
  const session = await authWithCompany()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const permError = requireAnyPermission(session, SERVICE_JOB_VIEW)
  if (permError) return { error: permError }
  const moduleError = requireModule(session, 'selling')
  if (moduleError) return { error: moduleError }
  return { session }
}

/** Default "ready for collection" text (also shown in the dialog for editing). */
function readyMessage(shop: string, job: { jobNo: string; title: string; customerName: string; balanceDue: string; jobType: string }, currency: string): string {
  const balance = Number(job.balanceDue) > 0 ? ` Balance due: ${money(currency, job.balanceDue)}.` : ''
  const what = job.jobType === 'tailoring' ? 'order' : job.jobType === 'service' ? 'job' : 'repair'
  return `Hi ${job.customerName}, your ${what} ${job.jobNo} (${job.title}) is ready for collection at ${shop}.${balance} Thank you!`.slice(0, 640)
}

async function loadJob(session: NonNullable<Awaited<ReturnType<typeof authWithCompany>>>, id: string) {
  return withTenant(session.user.tenantId, async (db) => {
    const denied = await assertRecordBranch(session, db, serviceJobs, id, { includeUnassigned: true })
    if (denied) return { denied, job: undefined }
    const [j] = await db.select().from(serviceJobs).where(eq(serviceJobs.id, id)).limit(1)
    return { denied: null, job: j }
  })
}

// GET /api/service-jobs/[id]/notify — which channels can be used + the default text
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await guard()
    if (g.error) return g.error
    const session = g.session!
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const loaded = await loadJob(session, p.data.id)
    if (loaded.denied) return loaded.denied
    if (!loaded.job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    const tenantId = session.user.tenantId
    const [availability, shop] = await Promise.all([messagingAvailability(tenantId), shopInfo(tenantId)])
    return NextResponse.json({ ...availability, phone: loaded.job.customerPhone, text: readyMessage(shop.name, loaded.job, shop.currency), notifiedAt: loaded.job.notifiedAt })
  } catch (error) {
    logError('api/service-jobs/[id]/notify', error)
    return NextResponse.json({ error: 'Failed to load messaging options' }, { status: 500 })
  }
}

// POST /api/service-jobs/[id]/notify — "Notify customer: ready" by SMS / WhatsApp (messaging add-on)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await guard()
    if (g.error) return g.error
    const session = g.session!
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const parsed = await validateBody(request, serviceJobNotifySchema)
    if (!parsed.success) return parsed.response
    const { channel, phone, text } = parsed.data
    const tenantId = session.user.tenantId
    const id = p.data.id

    const loaded = await loadJob(session, id)
    if (loaded.denied) return loaded.denied
    const job = loaded.job
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
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
        entityType: 'service_job',
        entityId: job.id,
        entityReference: job.jobNo,
      },
    })
    if (!res.ok) return NextResponse.json({ error: res.error || 'Message not sent', code: res.code }, { status: 400 })

    await withTenant(tenantId, async (db) => {
      await db.update(serviceJobs).set({ notifiedAt: new Date() }).where(eq(serviceJobs.id, id))
      await addServiceJobHistory(db, { tenantId, serviceJobId: id, note: `Customer notified (${channel}) to ${to}`, changedBy: session.user.id })
    })
    logAndBroadcast(tenantId, 'service-job', 'updated', id, {
      userId: session.user.id,
      entityName: job.jobNo,
      description: `Customer notified (${channel}) that job "${job.jobNo}" is ready`,
    })
    return NextResponse.json({ ok: true, units: res.units, remaining: res.remaining })
  } catch (error) {
    logError('api/service-jobs/[id]/notify', error)
    return NextResponse.json({ error: 'Failed to notify the customer' }, { status: 500 })
  }
}
