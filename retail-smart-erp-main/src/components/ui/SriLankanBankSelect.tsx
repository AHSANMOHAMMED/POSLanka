'use client'

import { SRI_LANKAN_BANKS } from '@/lib/constants/sri-lankan-banks'

interface SriLankanBankSelectProps {
  value?: string
  onChange: (bankName: string) => void
  allowCustom?: boolean
  className?: string
  id?: string
  required?: boolean
}

export function SriLankanBankSelect({
  value = '',
  onChange,
  allowCustom = true,
  className = '',
  id,
  required,
}: SriLankanBankSelectProps) {
  const known = SRI_LANKAN_BANKS.some((b) => b.name === value)
  const selectValue = known ? value : value ? '__custom__' : ''

  return (
    <div className={`space-y-2 ${className}`}>
      <select
        id={id}
        required={required && !value}
        value={selectValue}
        onChange={(e) => {
          if (e.target.value === '__custom__') {
            onChange('')
            return
          }
          onChange(e.target.value)
        }}
        className="w-full border rounded-md px-3 py-2 text-sm bg-white"
      >
        <option value="">Select bank…</option>
        {SRI_LANKAN_BANKS.map((b) => (
          <option key={b.code} value={b.name}>
            {b.name}
          </option>
        ))}
        {allowCustom && <option value="__custom__">Other / custom…</option>}
      </select>
      {allowCustom && (!known || selectValue === '__custom__') && (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Bank name"
          className="w-full border rounded-md px-3 py-2 text-sm"
        />
      )}
    </div>
  )
}
