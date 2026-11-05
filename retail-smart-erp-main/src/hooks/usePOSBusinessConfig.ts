'use client'

import type { POSBusinessConfig } from '@/components/pos/types'
import { useFeatureFlag } from '@/hooks/useFeatureFlag'
import { useBusinessScope } from '@/hooks/useBusinessScope'
import { tillBusinessType } from '@/lib/business-types/scope'

/**
 * Till behaviour for the business type the counter works as. Every vendor except a mall has one
 * type, so this is its own type; a mall counter (POS profile) set to one of the mall's segments
 * works as that type (food-court counter → restaurant till), other mall counters as the primary type.
 */
export function usePOSBusinessConfig(counterSegment?: string | null): POSBusinessConfig {
  const { scope } = useBusinessScope()
  const bt = tillBusinessType(scope, counterSegment)
  const scaleOn = useFeatureFlag('weighing_scale')
  const retailLike = bt === 'supermarket' || bt === 'retail' || bt === 'pharmacy'
    || bt === 'electronics' || bt === 'hardware' || bt === 'print_studio' || bt === 'office' || bt === 'textile'

  const isServiceCapable = bt === 'auto_service' || bt === 'dealership'

  return {
    tillBusinessType: bt,
    showVehicleSelector: isServiceCapable,
    showTableSelector: bt === 'restaurant',
    showOrderTypeSelector: bt === 'restaurant',
    enableBarcodeAutoAdd: retailLike,
    enableWeighableItems: retailLike && scaleOn,
    enableModifiers: bt === 'restaurant',
    enableTips: bt === 'restaurant',
    enableKitchenSend: bt === 'restaurant',
    enableCoreChargeDisplay: isServiceCapable,
    redirectToDealPipeline: false,
  }
}
