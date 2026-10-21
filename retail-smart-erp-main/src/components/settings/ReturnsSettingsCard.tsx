'use client'

import { useEffect, useState } from 'react'
import { RotateCcw, Loader2, Save } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { SectionCard } from '@/components/ui/section-card'
import { Button } from '@/components/ui/button'
import { FormField, FormSelect, FormCheckbox } from '@/components/ui/form-elements'

type SerialReturnStatus = 'available' | 'defective'
type RestockMode = 'stock' | 'quarantine'

/**
 * D1 — "Returns" settings (tenants.settings.returns / .batches via GET/PUT /api/tenant).
 * Saved independently of the rest of the page. Requires manageSettings to edit.
 */
export function ReturnsSettingsCard({ canEdit }: { canEdit: boolean }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [serialReturnStatus, setSerialReturnStatus] = useState<SerialReturnStatus>('available')
  const [restockMode, setRestockMode] = useState<RestockMode>('stock')
  const [allowExpiredSale, setAllowExpiredSale] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/tenant')
        if (!res.ok) throw new Error('Failed to load')
        const t = await res.json()
        if (cancelled) return
        setSerialReturnStatus(t.returnSettings?.serialReturnStatus === 'defective' ? 'defective' : 'available')
        setRestockMode(t.returnSettings?.restockMode === 'quarantine' ? 'quarantine' : 'stock')
        setAllowExpiredSale(t.batchSettings?.allowExpiredSale === true)
      } catch {
        if (!cancelled) toast.error('Failed to load return settings')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/tenant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnSettings: { serialReturnStatus, restockMode },
          batchSettings: { allowExpiredSale },
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to save')
      }
      toast.success('Return settings saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save return settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      title="Returns"
      icon={<RotateCcw size={16} />}
      actions={canEdit ? (
        <Button size="sm" onClick={save} disabled={loading || saving}>
          {saving ? <Loader2 size={14} className="animate-spin mr-1" /> : <Save size={14} className="mr-1" />}
          Save
        </Button>
      ) : undefined}
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : (
        <fieldset disabled={!canEdit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Returned goods go to" hint="Quarantine keeps returns out of sellable stock (Quarantine warehouse) until checked">
              <FormSelect value={restockMode} onChange={(e) => setRestockMode(e.target.value === 'quarantine' ? 'quarantine' : 'stock')}>
                <option value="stock">Sellable stock (same warehouse)</option>
                <option value="quarantine">Quarantine warehouse</option>
              </FormSelect>
            </FormField>
            <FormField label="Returned serial numbers" hint="Status given to serial-numbered items that come back">
              <FormSelect value={serialReturnStatus} onChange={(e) => setSerialReturnStatus(e.target.value === 'defective' ? 'defective' : 'available')}>
                <option value="available">Available (can be sold again)</option>
                <option value="defective">Defective (blocked from sale)</option>
              </FormSelect>
            </FormField>
          </div>
          <FormCheckbox
            label="Allow selling expired batches"
            description="Off: the POS never picks a batch past its expiry date"
            checked={allowExpiredSale}
            onChange={(e) => setAllowExpiredSale(e.target.checked)}
          />
        </fieldset>
      )}
    </SectionCard>
  )
}
