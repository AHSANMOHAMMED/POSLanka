// Audit orchestrator — runs all modules, tracks progress, stores findings in aiAlerts

import { withTenant } from '@/lib/db'
import { aiAlerts } from '@/lib/db/schema'
import { broadcastChange } from '@/lib/websocket/broadcast'
import { eq, and, sql } from 'drizzle-orm'
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

// In-memory progress per tenant (only one audit per tenant at a time)
const progressMap = new Map<string, AuditProgress>()

export function getAuditProgress(tenantId: string): AuditProgress {
  return progressMap.get(tenantId) || {
    status: 'idle',
    currentCategory: null,
    completedCategories: 0,
    totalCategories: ALL_MODULES.length,
    totalFindings: 0,
    startedAt: null,
    completedAt: null,
  }
}

export function isAuditRunning(tenantId: string): boolean {
  return progressMap.get(tenantId)?.status === 'running'
}

/**
 * Run a full system audit. Fire-and-forget — returns immediately.
 * Progress can be polled via getAuditProgress().
 */
export function startFullAudit(tenantId: string): void {
  if (isAuditRunning(tenantId)) return

  _runAudit(tenantId).catch(err => {
    console.error('[Audit] Full audit failed:', err)
    const progress = progressMap.get(tenantId)
    if (progress) {
      progress.status = 'error'
      progress.error = err instanceof Error ? err.message : 'Unknown error'
      progress.completedAt = new Date().toISOString()
    }
  })
}

async function _runAudit(tenantId: string): Promise<void> {
  const auditId = `audit-${Date.now()}`

  const progress: AuditProgress = {
    status: 'running',
    currentCategory: null,
    completedCategories: 0,
    totalCategories: ALL_MODULES.length,
    totalFindings: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
  }
  progressMap.set(tenantId, progress)

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
    // Update progress more frequently
    broadcastChange(tenantId, 'audit-progress', 'updated', tenantId, progress as unknown as Record<string, unknown>)
  }

  progress.status = 'completed'
  progress.currentCategory = null
  progress.completedAt = new Date().toISOString()
}
