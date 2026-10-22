import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ViewStyle } from 'react-native'

/**
 * Header padding that follows the device's real status bar / notch / cutout instead of a
 * hard-coded 44-48dp (which clipped on notched phones and wasted space on tablets).
 */
export function useHeaderPad(extraTop = 8): ViewStyle {
  const insets = useSafeAreaInsets()
  return {
    paddingTop: insets.top + extraTop,
    paddingBottom: 10,
    height: 'auto',
    minHeight: insets.top + 56,
    paddingLeft: Math.max(insets.left, 0) + 16,
    paddingRight: Math.max(insets.right, 0) + 16,
  }
}

/** Bottom padding for bars / scroll content so the home indicator never covers buttons. */
export function useBottomPad(min = 0): number {
  const insets = useSafeAreaInsets()
  return Math.max(insets.bottom, min)
}
