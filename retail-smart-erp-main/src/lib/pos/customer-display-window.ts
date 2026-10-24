/**
 * Open the customer-facing display (/c/[slug]/pos/display) in its own window, on the second monitor
 * when the browser supports the Window Management API (Chrome/Edge: getScreenDetails, asks the user
 * once for "window management" permission). Otherwise a normal popup the cashier drags across.
 */

export interface ScreenBox {
  left: number
  top: number
  availLeft?: number
  availTop?: number
  width: number
  height: number
  availWidth?: number
  availHeight?: number
  isPrimary?: boolean
}

/** Pure: the screen to use for the customer display (any screen other than the POS one; null = single screen) */
export function pickSecondaryScreen<S extends ScreenBox>(screens: S[], current: S | null | undefined): S | null {
  if (!screens || screens.length < 2) return null
  const same = (a: S, b: S) => a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
  const others = current ? screens.filter((s) => !same(s, current)) : screens.filter((s) => !s.isPrimary)
  if (others.length === 0) return null
  // Prefer a non-primary screen, then the largest one
  return [...others].sort((a, b) => Number(!!a.isPrimary) - Number(!!b.isPrimary) || b.width * b.height - a.width * a.height)[0]
}

export const CUSTOMER_DISPLAY_WINDOW_NAME = 'skyerpos-customer-display'

type ScreenDetailsLike = { screens: ScreenBox[]; currentScreen: ScreenBox }

let displayWindow: Window | null = null

/**
 * Open (or focus) the customer display window. The popup is opened synchronously (inside the click /
 * key gesture, so popup blockers allow it) and then moved to the secondary screen when the Window
 * Management API is available. Returns false when the popup was blocked.
 */
export function openCustomerDisplayWindow(url: string): boolean {
  if (typeof window === 'undefined') return false
  if (displayWindow && !displayWindow.closed) {
    displayWindow.focus()
    return true
  }
  const win = window.open(url, CUSTOMER_DISPLAY_WINDOW_NAME, 'popup=yes,width=1280,height=800')
  if (!win) return false
  displayWindow = win
  void moveToSecondaryScreen(win)
  return true
}

async function moveToSecondaryScreen(win: Window): Promise<void> {
  try {
    const w = window as unknown as { getScreenDetails?: () => Promise<ScreenDetailsLike> }
    if (typeof w.getScreenDetails !== 'function') return
    const details = await w.getScreenDetails()
    const target = pickSecondaryScreen(details.screens, details.currentScreen)
    if (!target || win.closed) return
    win.moveTo(target.availLeft ?? target.left, target.availTop ?? target.top)
    win.resizeTo(target.availWidth ?? target.width, target.availHeight ?? target.height)
  } catch {
    // permission denied / not supported → the cashier drags the window across
  }
}
