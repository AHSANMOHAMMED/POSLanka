'use client'

import { useEffect, useState } from 'react'
import { FormLabel, FormSelect } from '@/components/ui/form-elements'

interface BranchOption {
  id: string
  name: string
  code?: string | null
  isDefault: boolean
}

interface BranchSelectProps {
  value: string
  onChange: (warehouseId: string) => void
  label?: string
  className?: string
}

/**
 * K4: Branch picker for new records (restaurant tables, appointments, ...). Shows nothing when the
 * user can work with one branch only (the server then uses that branch). Pre-filled with the
 * user's own branch, else the default branch. Branch-restricted users only get their branches.
 */
export function BranchSelect({ value, onChange, label = 'Branch', className }: BranchSelectProps) {
  const [branches, setBranches] = useState<BranchOption[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [allRes, mineRes] = await Promise.all([
          fetch('/api/warehouses?all=true&activeOnly=true'),
          fetch('/api/warehouses?all=true&activeOnly=true&userOnly=true'),
        ])
        if (!allRes.ok || cancelled) return
        const all = ((await allRes.json()) as BranchOption[]).filter((b) => (b.code || '').trim().toUpperCase() !== 'QUARANTINE')
        const mine = mineRes.ok ? ((await mineRes.json()) as BranchOption[]) : []
        if (cancelled) return
        setBranches(all)
        if (!value && all.length > 1) {
          const preferred = mine.find((m) => all.some((b) => b.id === m.id)) || all.find((b) => b.isDefault) || all[0]
          if (preferred) onChange(preferred.id)
        }
      } catch {
        // No branch list: the server picks the user's branch
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (branches.length <= 1) return null

  return (
    <div className={className}>
      <FormLabel>{label}</FormLabel>
      <FormSelect value={value} onChange={(e) => onChange(e.target.value)}>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </FormSelect>
    </div>
  )
}
