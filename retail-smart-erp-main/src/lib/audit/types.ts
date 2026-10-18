// System-wide integrity audit types

export type AuditCategory =
  | 'sales'
  | 'purchases'
  | 'stock'
  | 'accounting'
  | 'customers'
  | 'suppliers'
  | 'work-orders'
  | 'layaways'
  | 'gift-cards'
  | 'pos-shifts'

export type AuditSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface AuditFinding {
  category: AuditCategory
  severity: AuditSeverity
  title: string
  message: string
  entityType?: string
  entityId?: string
}

export interface AuditModuleResult {
  category: AuditCategory
  label: string
  findings: AuditFinding[]
  checkedCount: number
}

export interface AuditProgress {
  status: 'idle' | 'running' | 'completed' | 'error'
  currentCategory: string | null
  completedCategories: number
  totalCategories: number
  totalFindings: number
  startedAt: string | null
  completedAt: string | null
  error?: string
}

export interface AuditModule {
  category: AuditCategory
  label: string
  run: (tenantId: string) => Promise<AuditFinding[]>
}
