import type { Tone } from '@/components/admin/kit'

export const PRIORITY_TONE: Record<string, Tone> = { low: 'neutral', normal: 'info', high: 'warning', urgent: 'danger' }

export const CATEGORY_LABEL: Record<string, string> = {
  general: 'General',
  billing: 'Billing',
  technical: 'Technical',
  feature_request: 'Feature request',
  bug_report: 'Bug report',
}
