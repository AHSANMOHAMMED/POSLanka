/**
 * User-adjustable text size.
 *
 * Vendor app: the root font size is `14px * --ui-text-scale` (globals.css), so
 * every rem-based size (Tailwind text-*, spacing) grows with it.
 * Super-admin console: its kit is mostly px, so the main area is scaled with
 * CSS `zoom: var(--admin-zoom)` instead.
 *
 * Stored in localStorage per user (`<key>:<userId>`) plus a device-wide "last
 * used" value that the pre-paint script in the root layout applies before
 * React hydrates (no flash of the wrong size).
 */

export const TEXT_SCALES = [0.9, 1, 1.1, 1.25, 1.4] as const
export type TextScale = (typeof TEXT_SCALES)[number]
export const TEXT_SCALE_LABELS: Record<TextScale, string> = {
  0.9: '90%',
  1: '100%',
  1.1: '110%',
  1.25: '125%',
  1.4: '140%',
}

export type TextScaleScope = 'app' | 'admin'

const KEYS: Record<TextScaleScope, { storage: string; cssVar: string }> = {
  app: { storage: 'skyerpos:text-scale', cssVar: '--ui-text-scale' },
  admin: { storage: 'skyerpos:admin-text-scale', cssVar: '--admin-zoom' },
}

export const TEXT_SCALE_EVENT = 'skyerpos:text-scale'

export function normalizeTextScale(v: unknown): TextScale {
  const n = Number(v)
  if (!Number.isFinite(n)) return 1
  // nearest allowed step
  let best: TextScale = 1
  for (const s of TEXT_SCALES) if (Math.abs(s - n) < Math.abs(best - n)) best = s
  return best
}

function storageKey(scope: TextScaleScope, userId?: string | null) {
  return userId ? `${KEYS[scope].storage}:${userId}` : KEYS[scope].storage
}

export function readTextScale(scope: TextScaleScope, userId?: string | null): TextScale {
  try {
    // Signed-in user: their own value (a new user on a shared till starts at 100%)
    const v = userId ? localStorage.getItem(storageKey(scope, userId)) : localStorage.getItem(storageKey(scope))
    return v == null ? 1 : normalizeTextScale(v)
  } catch {
    return 1
  }
}

export function applyTextScale(scope: TextScaleScope, scale: TextScale): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (scale === 1) root.style.removeProperty(KEYS[scope].cssVar)
  else root.style.setProperty(KEYS[scope].cssVar, String(scale))
  root.dataset[scope === 'app' ? 'textScale' : 'adminTextScale'] = String(scale)
}

export function saveTextScale(scope: TextScaleScope, scale: TextScale, userId?: string | null): void {
  try {
    if (userId) localStorage.setItem(storageKey(scope, userId), String(scale))
    localStorage.setItem(storageKey(scope), String(scale))
  } catch {
    /* private mode */
  }
  applyTextScale(scope, scale)
  try {
    window.dispatchEvent(new CustomEvent(TEXT_SCALE_EVENT, { detail: { scope, scale } }))
  } catch {
    /* ignore */
  }
}

/** Inline pre-paint script (root layout): applies the last used scales before hydration. */
export const TEXT_SCALE_SCRIPT = `
(function() {
  try {
    var r = document.documentElement;
    var admin = location.pathname.indexOf('/sys-control') === 0;
    var a = parseFloat(localStorage.getItem('${KEYS.app.storage}') || '1');
    if (!admin && a && a !== 1 && a >= 0.8 && a <= 1.5) r.style.setProperty('${KEYS.app.cssVar}', String(a));
    var z = parseFloat(localStorage.getItem('${KEYS.admin.storage}') || '1');
    if (z && z !== 1 && z >= 0.8 && z <= 1.5) r.style.setProperty('${KEYS.admin.cssVar}', String(z));
  } catch (e) {}
})();
`
