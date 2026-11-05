'use client'

/**
 * The shop's label print setup on the print page (GET/PUT /api/label-settings/print-setup).
 *
 * Owners / managers: every change is saved to the shop (debounced), so it is the same in
 * every browser and after sign-out; they can Lock / Unlock it. A locked setup is read-only
 * for everyone until a manager unlocks it. Other users print with the shop's setup; while it
 * is unlocked their own changes are kept on this PC only (localStorage).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/components/ui/toast'
import { DEFAULT_PRINT_SETUP, sanitizePrintSetup, type LabelPrintSetup } from '@/lib/labels/print-setup'

const LOCAL_KEY = 'sky_label_print_setup_v1'

function readLocal(key: string): string | null {
  try {
    return typeof window !== 'undefined' ? localStorage.getItem(key) : null
  } catch {
    return null
  }
}
function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

/** First use: carry over what this PC remembered before the setup was stored for the shop. */
function legacySetup(): LabelPrintSetup {
  const rowGap = readLocal('sky_label_row_gap_mm')
  return sanitizePrintSetup({
    ...DEFAULT_PRINT_SETUP,
    printer: { ...DEFAULT_PRINT_SETUP.printer, dpi: null },
    chrome: {
      ...DEFAULT_PRINT_SETUP.chrome,
      noGapSensing: readLocal('sky_label_no_gap_sensing') === '1',
      rowGapMm: rowGap !== null && Number.isFinite(Number(rowGap)) ? Number(rowGap) : null,
      offsetYMm: Number(readLocal('sky_label_offset_y_mm') || 0) || 0,
    },
    layout: { ...DEFAULT_PRINT_SETUP.layout, templateId: readLocal('sky_barcode_template_id'), setupId: readLocal('sky_barcode_setup_id') },
  })
}

/** The Add-to-print modal (items list) still reads these per-PC keys: keep them in step. */
function mirrorChrome(s: LabelPrintSetup) {
  writeLocal('sky_label_no_gap_sensing', s.chrome.noGapSensing ? '1' : null)
  writeLocal('sky_label_row_gap_mm', s.chrome.rowGapMm === null ? null : String(s.chrome.rowGapMm))
  writeLocal('sky_label_offset_y_mm', String(s.chrome.offsetYMm))
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function useLabelPrintSetup() {
  const [setup, setSetup] = useState<LabelPrintSetup>(DEFAULT_PRINT_SETUP)
  const [loaded, setLoaded] = useState(false)
  const [canManage, setCanManage] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<LabelPrintSetup | null>(null)
  const canManageRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/label-settings/print-setup')
      const data = res.ok ? await res.json() : null
      const shop: LabelPrintSetup | null = data?.printSetup ? sanitizePrintSetup(data.printSetup) : null
      const manage = !!data?.canManage
      canManageRef.current = manage
      setCanManage(manage)
      let next: LabelPrintSetup
      if (shop?.locked) next = shop
      else if (!manage) {
        const local = readLocal(LOCAL_KEY)
        next = local ? sanitizePrintSetup(JSON.parse(local)) : shop ?? legacySetup()
      } else next = shop ?? legacySetup()
      setSetup(next)
      mirrorChrome(next)
    } catch {
      setSetup(legacySetup())
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    // load() sets state only after the request answers
    void load()
  }, [load])

  const put = useCallback(
    async (body: Record<string, unknown>, keepalive = false): Promise<LabelPrintSetup | null> => {
      setSaveState('saving')
      try {
        const res = await fetch('/api/label-settings/print-setup', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          keepalive,
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setSaveState('error')
          toast.error(data?.error || 'Could not save the label setup')
          if (res.status === 409) void load()
          return null
        }
        setSaveState('saved')
        return sanitizePrintSetup(data.printSetup)
      } catch {
        setSaveState('error')
        return null
      }
    },
    [load]
  )

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const s = pending.current
    pending.current = null
    if (s && canManageRef.current) void put({ action: 'save', printSetup: s })
  }, [put])

  // Save what is pending when the page closes
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      const s = pending.current
      if (s && canManageRef.current) {
        void fetch('/api/label-settings/print-setup', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'save', printSetup: s }), keepalive: true }).catch(() => {})
      }
    },
    []
  )

  /** Change the setup (ignored while locked). Returns false when locked. */
  const update = useCallback(
    (fn: (s: LabelPrintSetup) => LabelPrintSetup): boolean => {
      let applied = false
      setSetup((cur) => {
        if (cur.locked) return cur
        const next = sanitizePrintSetup(fn(cur))
        applied = true
        mirrorChrome(next)
        if (canManageRef.current) {
          pending.current = next
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(flush, 700)
        } else {
          writeLocal(LOCAL_KEY, JSON.stringify(next))
        }
        return next
      })
      return applied
    },
    [flush]
  )

  /** Lock the setup as it is now (`patch` adds what the page shows but has not stored, e.g. the auto-picked roll). */
  const lock = useCallback(async (patch?: (s: LabelPrintSetup) => LabelPrintSetup) => {
    if (timer.current) clearTimeout(timer.current)
    pending.current = null
    const saved = await put({ action: 'lock', printSetup: patch ? patch(setup) : setup })
    if (saved) {
      setSetup(saved)
      toast.success('Label setup locked. It stays exactly like this until someone unlocks it.')
    }
  }, [put, setup])

  const unlock = useCallback(async () => {
    const saved = await put({ action: 'unlock' })
    if (saved) {
      setSetup(saved)
      toast.success('Label setup unlocked')
    }
  }, [put])

  return { setup, loaded, canManage, saveState, update, lock, unlock, reload: load }
}
