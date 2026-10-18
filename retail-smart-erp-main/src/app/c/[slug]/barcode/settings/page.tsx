'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Tag, Loader2 } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { SectionCard } from '@/components/ui/section-card'
import { FormInput, FormField } from '@/components/ui/form-elements'
import { useDebounce } from '@/hooks/useDebounce'
import { toast } from '@/components/ui/toast'

export default function BarcodeLabelSettingsPage() {
  const [codeWord, setCodeWord] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/label-settings')
      .then(r => r.json())
      .then(data => setCodeWord(data.codeWord || ''))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const pendingRef = useRef<string | null>(null)

  const saveToServer = useCallback(async () => {
    const cw = pendingRef.current
    if (cw === null) return

    setSaving(true)
    try {
      const res = await fetch('/api/label-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codeWord: cw }),
      })
      if (res.ok) {
        toast.success('Label settings saved')
      } else {
        const data = await res.json().catch(() => null)
        toast.error(data?.error || 'Failed to save label settings')
      }
    } catch {
      toast.error('Error saving label settings')
    } finally {
      setSaving(false)
    }
  }, [])

  const debouncedSave = useDebounce(saveToServer, 800)

  function updateCodeWord(value: string) {
    const cleaned = value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10)
    setCodeWord(cleaned)
    pendingRef.current = cleaned
    debouncedSave()
  }

  return (
    <ListPageLayout
      module="Barcode & Labels"
      moduleHref="/barcode"
      title="Label Settings"
    >
      <div className="max-w-2xl">
        <SectionCard
          title="Price Code"
          icon={<Tag size={16} />}
          actions={
            saving ? (
              <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <Loader2 size={12} className="animate-spin" />
                Saving...
              </span>
            ) : null
          }
        >
          {loading ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Used to encode cost and selling prices on barcode labels so only staff who know the code word can read them.
              </p>
              <FormField label="Code Word (10 unique letters)">
                <FormInput
                  type="text"
                  value={codeWord}
                  onChange={(e) => updateCodeWord(e.target.value)}
                  placeholder="e.g. MAKEPROFIT"
                  maxLength={10}
                  inputSize="sm"
                  className={`w-64 uppercase ${
                    codeWord.length > 0 && new Set(codeWord).size < codeWord.length
                      ? 'border-red-400 focus:ring-red-400'
                      : ''
                  }`}
                />
              </FormField>
              {codeWord.length > 0 && new Set(codeWord).size < codeWord.length && (
                <p className="text-xs text-red-500 mt-1">Each letter must be unique</p>
              )}
              {codeWord.length === 10 && new Set(codeWord).size === 10 && (
                <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-700/50 rounded text-xs text-gray-600 dark:text-gray-300 font-mono">
                  {[1,2,3,4,5,6,7,8,9,0].map((d, i) => `${codeWord[i]}=${d}`).join('  ')}
                </div>
              )}
              {!codeWord && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Enter a 10-letter word where each letter maps to a digit (1-9, 0). Example: MAKEPROFIT
                </p>
              )}
            </>
          )}
        </SectionCard>
      </div>
    </ListPageLayout>
  )
}
