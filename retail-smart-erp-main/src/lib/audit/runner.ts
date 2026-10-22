// Audit orchestrator — runs all modules, tracks progress, stores findings in aiAlerts

import { withTenant } from '@/lib/db'
import { aiAlerts, auditRuns } from '@/lib/db/schema'
import { broadcastChange } from '@/lib/websocket/broadcast'
import { eq, and, sql, or, ne, lt } from 'drizzle-orm'
import type { AuditModule, AuditProgress } from './types'

import { saleAuditModule } from './sale-audit'
import { purchaseAuditModule } from './purchase-audit'
import { stockAuditModule } from './stock-audit'
import { accountingAuditModule } from './accounting-audit'
import { customerAuditModule } from './customer-audit'
import { supplierAuditModule } from './supplier-audit'
import { workOrderAuditModule } from './work-order-audit'
import { layawayAuditModule } from './layaway-audit'
import { giftCardAuditModule } from './gift-card-audit'
import { posShiftAuditModule } from './pos-shift-audit'

const ALL_MODULES: AuditModule[] = [
  saleAuditModule,
  purchaseAuditModule,
  stockAuditModule,
  accountingAuditModule,
  customerAuditModule,
  supplierAuditModule,
  workOrderAuditModule,
  layawayAuditModule,
  giftCardAuditModule,
  posShiftAuditModule,
]

// Progress lives in audit_runs (one row per tenant) so every app instance reports the same run
// and only one audit per tenant runs at a time across instances. A 'running' row whose
// heartbeat (updated_at) is older than STALE_AFTER_MS belonged to an instance that died.
const STALE_AFTER_MS = 10 * 60 * 1000

function idleProgress(): AuditProgress {
  return {
    status: 'idle',
    currentCategory: null,
    completedCategories: 0,
    totalCategories: ALL_MODULES.length,
    totalFindings: 0,
    startedAt: null,
    completedAt: null,
  }
}

export async function getAuditProgress(tenantId: string): Promise<AuditProgress> {
  const row = await withTenant(tenantId, (db) =>
    db.query.auditRuns.findFirst({ where: eq(auditRuns.tenantId, tenantId) }))
  if (!row) return idleProgress()
  const progress = { ...idleProgress(), ...(row.progress as Partial<AuditProgress>) }
  if (progress.status === 'running' && Date.now() - new Date(row.updatedAt).getTime() > STALE_AFTER_MS) {
    return { ...progress, status: 'error', error: 'Audit was interrupted (server restarted). Start it again.', currentCategory: null }
  }
  return progress
}

export async function isAuditRunning(tenantId: string): Promise<boolean> {
  return (await getAuditProgress(tenantId)).status === 'running'
}

async function saveProgress(tenantId: string, progress: AuditProgress): Promise<void> {
  await withTenant(tenantId, (db) =>
    db.update(auditRuns)
      .set({ status: progress.status, progress: progress as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(eq(auditRuns.tenantId, tenantId)))
}

/**
 * Atomically claim the tenant's audit slot: succeeds unless a non-stale run is in progress
 * (on any instance). Returns the fresh progress record, or null when already running.
 */
async function claimAudit(tenantId: string): Promise<AuditProgress | null> {
  const progress: AuditProgress = {
    ...idleProgress(),
    status: 'running',
    startedAt: new Date().toISOString(),
  }
  const staleBefore = new Date(Date.now() - STALE_AFTER_MS)
  const claimed = await withTenant(tenantId, (db) =>
    db.insert(auditRuns)
      .values({ tenantId, status: 'running', progress: progress as unknown as Record<string, unknown>, startedAt: new Date(), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: auditRuns.tenantId,
        set: { status: 'running', progress: progress as unknown as Record<string, unknown>, startedAt: new Date(), updatedAt: new Date() },
        // drizzle operators map the Date like the stored value (UTC wall time in a timestamp column)
        setWhere: or(ne(auditRuns.status, 'running'), lt(auditRuns.updatedAt, staleBefore)),
      })
      .returning({ tenantId: auditRuns.tenantId }))
  return claimed.length > 0 ? progress : null
}

/**
 * Run a full system audit. Fire-and-forget — returns once the run is claimed.
 * Returns false when an audit is already running for this tenant (on any instance).
 * Progress can be polled via getAuditProgress().
 */
export async function startFullAudit(tenantId: string): Promise<boolean> {
  const progress = await claimAudit(tenantId)
  if (!progress) return false

  _runAudit(tenantId, progress).catch(async (err) => {
    console.error('[Audit] Full audit failed:', err)
    progress.status = 'error'
    progress.error = err instanceof Error ? err.message : 'Unknown error'
    progress.completedAt = new Date().toISOString()
    await saveProgress(tenantId, progress).catch(() => undefined)
  })
  return true
}

async function _runAudit(tenantId: string, progress: AuditProgress): Promise<void> {
  const auditId = `audit-${Date.now()}`

  // Clean up previous audit findings for this tenant
  await withTenant(tenantId, async (db) =>
    db.delete(aiAlerts).where(
      and(
        eq(aiAlerts.tenantId, tenantId),
        sql`${aiAlerts.metadata}->>'auditId' IS NOT NULL`
      )
    )
  )

  for (const mod of ALL_MODULES) {
    progress.currentCategory = mod.label
    await saveProgress(tenantId, progress)
    console.log(`[Audit] Running ${mod.category} audit for tenant ${tenantId}`)

    try {
      const findings = await mod.run(tenantId)
      console.log(`[Audit] ${mod.category} audit completed with ${findings.length} findings`)

      // Store findings in aiAlerts
      for (const finding of findings) {
        try {
          const [alert] = await withTenant(tenantId, async (db) =>
            db.insert(aiAlerts).values({
              tenantId,
              type: 'anomaly',
              severity: finding.severity,
              title: finding.title,
              message: finding.message,
              entityType: finding.entityType || null,
              entityId: finding.entityId || null,
              metadata: {
                auditId,
                auditCategory: finding.category,
              },
            }).returning()
          )

          if (alert) {
            broadcastChange(tenantId, 'ai-alert', 'created', alert.id)
          }
        } catch (insertErr) {
          console.error(`[Audit] Failed to insert finding for ${mod.category}:`, insertErr)
        }
      }

      progress.totalFindings += findings.length
    } catch (err) {
      console.error(`[Audit] Module ${mod.category} failed:`, err)
      // Store the error as a finding
      try {
        await withTenant(tenantId, async (db) =>
          db.insert(aiAlerts).values({
            tenantId,
            type: 'error',
            severity: 'high',
            title: `Audit module "${mod.label}" failed`,
            message: err instanceof Error ? err.message : 'Unknown error',
            metadata: { auditId, auditCategory: mod.category },
          })
        )
      } catch (insertErr) {
        console.error(`[Audit] Failed to insert error for ${mod.category}:`, insertErr)
      }
      progress.totalFindings += 1
    }

    progress.completedCategories += 1
    await saveProgress(tenantId, progress)
    // Update progress more frequently
    broadcastChange(tenantId, 'audit-progress', 'updated', tenantId, progress as unknown as Record<string, unknown>)
  }

  progress.status = 'completed'
  progress.currentCategory = null
  progress.completedAt = new Date().toISOString()
  await saveProgress(tenantId, progress)
}
