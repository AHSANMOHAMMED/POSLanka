// Auto-service part compatibility columns (items import): shared by the validator (preview
// warnings) and the runner (writes part_compatibility, auto-creating makes/models).

export const COMPAT_KEYS = new Set(['compatibleModels', 'compatibleMake', 'compatibleModel', 'compatibleYearFrom', 'compatibleYearTo'])

export interface CompatEntry { makeName: string; modelName?: string; yearFrom?: number; yearTo?: number }

/** Combine "Compatible Models" with the separate Make/Model/Year columns into one `;` list. */
export function compatRawOf(data: Record<string, unknown>): string {
  const s = (k: string) => (data[k] != null ? String(data[k]).trim() : '')
  const separateMake = s('compatibleMake')
  const combinedRaw = s('compatibleModels')
  if (!separateMake) return combinedRaw
  const makes = separateMake.split(';').map(x => x.trim()).filter(Boolean)
  const models = s('compatibleModel') ? s('compatibleModel').split(';').map(x => x.trim()) : []
  const yearsFrom = s('compatibleYearFrom') ? s('compatibleYearFrom').split(';').map(x => x.trim()) : []
  const yearsTo = s('compatibleYearTo') ? s('compatibleYearTo').split(';').map(x => x.trim()) : []
  const entries = makes.map((make, i) => {
    let entry = make
    if (models[i]) entry += ` ${models[i]}`
    if (yearsFrom[i] && yearsTo[i]) entry += ` ${yearsFrom[i]}-${yearsTo[i]}`
    else if (yearsFrom[i]) entry += ` ${yearsFrom[i]}-${yearsFrom[i]}`
    return entry
  })
  return combinedRaw ? `${combinedRaw}; ${entries.join('; ')}` : entries.join('; ')
}

/** "Toyota Corolla 2010-2015; Honda" → entries (make = first word, model = rest). */
export function parseCompatibleModels(raw: string): CompatEntry[] {
  if (!raw || !raw.trim()) return []
  return raw.split(';').map(s => s.trim()).filter(Boolean).map(entry => {
    const yearMatch = entry.match(/\s+(\d{4})\s*[-–]\s*(\d{4})$/)
    let yearFrom: number | undefined
    let yearTo: number | undefined
    let rest = entry
    if (yearMatch) {
      yearFrom = parseInt(yearMatch[1])
      yearTo = parseInt(yearMatch[2])
      rest = entry.slice(0, yearMatch.index!).trim()
    } else {
      const singleYear = rest.match(/\s+(\d{4})$/)
      if (singleYear) {
        yearFrom = parseInt(singleYear[1])
        yearTo = yearFrom
        rest = rest.slice(0, singleYear.index!).trim()
      }
    }
    const parts = rest.split(/\s+/)
    return { makeName: parts[0] || '', modelName: parts.slice(1).join(' ') || undefined, yearFrom, yearTo }
  }).filter(e => e.makeName)
}
