// In-app text size (90% .. 140%), on top of the phone's own accessibility font
// size (Text allowFontScaling stays on). Screens keep their fixed fontSize
// numbers: Text / TextInput are wrapped once at startup so every explicit
// fontSize (and lineHeight) is multiplied by the chosen scale. Nested Text
// without its own size inherits from its (already scaled) parent.
//
// Stored in SecureStore (read synchronously at startup, so the first frame is
// already the right size). Changing it re-renders every Text through context.
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput } from 'react-native'
import * as SecureStore from 'expo-secure-store'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TextAncestor: React.Context<boolean> = require('react-native/Libraries/Text/TextAncestor')

export const TEXT_SCALES = [0.9, 1, 1.1, 1.25, 1.4] as const
export type TextScale = (typeof TEXT_SCALES)[number]
const KEY = 'skyerpos_text_scale'
/** RN default font size when a style sets none. */
const DEFAULT_FONT_SIZE = 14

export function normalizeTextScale(v: unknown): TextScale {
  const n = Number(v)
  if (!Number.isFinite(n)) return 1
  let best: TextScale = 1
  for (const s of TEXT_SCALES) if (Math.abs(s - n) < Math.abs(best - n)) best = s
  return best
}

function readStored(): TextScale {
  try {
    return normalizeTextScale(SecureStore.getItem(KEY) ?? 1)
  } catch {
    return 1
  }
}

let currentScale: TextScale = readStored()

const TextScaleContext = createContext<TextScale>(currentScale)

/** Scaled style for one Text / TextInput, or the original style when nothing changes. */
export function scaleTextStyle(style: unknown, scale: number, nested: boolean): unknown {
  if (scale === 1) return style
  const flat = (StyleSheet.flatten(style as never) || {}) as { fontSize?: number; lineHeight?: number }
  if (flat.fontSize == null && nested) return style // inherits the parent's scaled size
  const patch: { fontSize: number; lineHeight?: number } = { fontSize: (flat.fontSize ?? DEFAULT_FONT_SIZE) * scale }
  if (flat.lineHeight != null) patch.lineHeight = flat.lineHeight * scale
  return [style, patch]
}

let installed = false

/** Wrap Text / TextInput rendering once (call at app start, before the first render). */
export function installTextScale(): void {
  if (installed) return
  installed = true
  for (const [C, canNest] of [
    [Text, true],
    [TextInput, false],
  ] as const) {
    const comp = C as unknown as { render?: (props: Record<string, unknown>, ref: unknown) => React.ReactNode }
    const orig = comp.render
    if (typeof orig !== 'function') continue // not a forwardRef component: leave untouched
    comp.render = function scaledRender(props: Record<string, unknown>, ref: unknown) {
      // Hooks are fine here: forwardRef render functions are function components
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const scale = useContext(TextScaleContext)
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const nested = canNest ? useContext(TextAncestor) : false
      if (scale === 1) return orig(props, ref)
      return orig({ ...props, style: scaleTextStyle(props.style, scale, !!nested) }, ref)
    }
  }
}

/** Provides the scale to every Text; wrap the app root with it. */
export function TextScaleProvider({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState<TextScale>(currentScale)
  useEffect(() => {
    setter = setScale
    return () => {
      if (setter === setScale) setter = null
    }
  }, [])
  return <TextScaleContext.Provider value={scale}>{children}</TextScaleContext.Provider>
}

let setter: ((s: TextScale) => void) | null = null

export function getTextScale(): TextScale {
  return currentScale
}

export async function setTextScale(s: TextScale): Promise<void> {
  currentScale = normalizeTextScale(s)
  setter?.(currentScale)
  try {
    await SecureStore.setItemAsync(KEY, String(currentScale))
  } catch {
    // best effort
  }
}

/** Current scale + setter for settings UI. */
export function useTextScale(): [TextScale, (s: TextScale) => void] {
  const scale = useContext(TextScaleContext)
  const set = useCallback((s: TextScale) => void setTextScale(s), [])
  return [scale, set]
}
