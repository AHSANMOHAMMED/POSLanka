'use client'

import { useCompany } from '@/components/providers/CompanyContextProvider'
import type { POSBusinessConfig } from '@/components/pos/types'

export function usePOSBusinessConfig(): POSBusinessConfig {
  const company = useCompany()
  const bt = company.businessType

  const isServiceCapable = bt === 'auto_service' || bt === 'dealership'

  return {
    showVehicleSelector: isServiceCapable,
    showTableSelector: bt === 'restaurant',
    showOrderTypeSelector: bt === 'restaurant',
    enableBarcodeAutoAdd: bt === 'supermarket' || bt === 'retail',
    enableWeighableItems: bt === 'supermarket' || bt === 'retail',
    enableModifiers: bt === 'restaurant',
    enableTips: bt === 'restaurant',
    enableKitchenSend: bt === 'restaurant',
    enableCoreChargeDisplay: isServiceCapable,
    redirectToDealPipeline: false,
  }
}
