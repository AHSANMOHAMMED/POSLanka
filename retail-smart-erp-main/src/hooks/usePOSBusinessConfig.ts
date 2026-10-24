'use client'

import { useCompany } from '@/components/providers/CompanyContextProvider'
import type { POSBusinessConfig } from '@/components/pos/types'
import { useFeatureFlag } from '@/hooks/useFeatureFlag'

export function usePOSBusinessConfig(): POSBusinessConfig {
  const company = useCompany()
  const bt = company.businessType
  const scaleOn = useFeatureFlag('weighing_scale')
  const retailLike = bt === 'supermarket' || bt === 'retail' || bt === 'pharmacy'

  const isServiceCapable = bt === 'auto_service' || bt === 'dealership'

  return {
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
