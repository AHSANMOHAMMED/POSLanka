'use client'

// H5: search-and-pick chips for items / categories / customers / POS profiles (price lists, promotions).
import { useEffect, useRef, useState } from 'react'
import { X, Search } from 'lucide-react'

export type PickerEntity = 'items' | 'categories' | 'customers' | 'posProfiles'

export interface PickedOption { id: string; label: string; sub?: string }

const ENDPOINT: Record<PickerEntity, (q: string) => string> = {
  items: (q) => `/api/items?pageSize=20&search=${encodeURIComponent(q)}`,
  categories: (q) => `/api/categories?pageSize=50&search=${encodeURIComponent(q)}`,
  customers: (q) => `/api/customers?pageSize=20&search=${encodeURIComponent(q)}`,
  posProfiles: () => '/api/pos-profiles?all=true',
}

type Row = { id: string; name?: string; fullName?: string; itemCode?: string; barcode?: string | null; sellingPrice?: string; phone?: string | null }

function toOption(entity: PickerEntity, r: Row): PickedOption {
  if (entity === 'items') return { id: r.id, label: r.name || r.id, sub: [r.itemCode, r.sellingPrice ? `Rs ${r.sellingPrice}` : null].filter(Boolean).join(' · ') }
  if (entity === 'customers') return { id: r.id, label: r.name || r.fullName || r.id, sub: r.phone || undefined }
  return { id: r.id, label: r.name || r.id }
}

/** Fetch display labels for already-selected ids (edit forms). */
export async function fetchLabels(entity: PickerEntity, ids: string[]): Promise<PickedOption[]> {
  if (ids.length === 0) return []
  if (entity === 'customers') {
    return Promise.all(ids.slice(0, 100).map(async (id) => {
      try {
        const r = await fetch(`/api/customers/${id}`)
        return r.ok ? toOption('customers', await r.json()) : { id, label: id.slice(0, 8) }
      } catch {
        return { id, label: id.slice(0, 8) }
      }
    }))
  }
  const url = entity === 'items' ? `/api/items?ids=${ids.join(',')}&pageSize=200&includeInactive=true`
    : entity === 'posProfiles' ? '/api/pos-profiles?all=true'
      : entity === 'categories' ? '/api/categories?all=true' : null
  if (!url) return ids.map((id) => ({ id, label: id.slice(0, 8) }))
  try {
    const res = await fetch(url)
    const data = await res.json()
    const rows: Row[] = Array.isArray(data) ? data : data.data || data.profiles || []
    const byId = new Map(rows.map((r) => [r.id, toOption(entity, r)]))
    return ids.map((id) => byId.get(id) || { id, label: id.slice(0, 8) })
  } catch {
    return ids.map((id) => ({ id, label: id.slice(0, 8) }))
  }
}

interface Props {
  entity: PickerEntity
  value: PickedOption[]
  onChange: (v: PickedOption[]) => void
  placeholder?: string
  single?: boolean
}

export function EntityMultiPicker({ entity, value, onChange, placeholder, single }: Props) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<PickedOption[]>([])
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(async () => {
      try {
        const res = await fetch(ENDPOINT[entity](q))
        const data = await res.json()
        const rows: Row[] = Array.isArray(data) ? data : data.data || data.profiles || []
        const opts = rows.map((r) => toOption(entity, r))
        setOptions(entity === 'posProfiles' && q ? opts.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : opts)
      } catch {
        setOptions([])
      }
    }, 250)
    return () => clearTimeout(t)
  }, [q, open, entity])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const selected = new Set(value.map((v) => v.id))
  return (
    <div ref={box} className="relative">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {value.map((v) => (
            <span key={v.id} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
              {v.label}
              <button type="button" aria-label={`Remove ${v.label}`} onClick={() => onChange(value.filter((x) => x.id !== v.id))}><X size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 px-2 py-1.5 border rounded bg-white dark:bg-gray-800 dark:border-gray-600">
        <Search size={14} className="text-gray-400" />
        <input
          className="flex-1 text-sm bg-transparent outline-none dark:text-white"
          value={q}
          placeholder={placeholder || 'Search…'}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        />
      </div>
      {open && options.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-auto bg-white dark:bg-gray-800 border dark:border-gray-600 rounded shadow-lg">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={selected.has(o.id)}
              onClick={() => {
                onChange(single ? [o] : [...value, o])
                setQ('')
                if (single) setOpen(false)
              }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 dark:text-gray-200"
            >
              {o.label}{o.sub && <span className="ml-2 text-xs text-gray-500">{o.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
