// Default vehicle types for the system
// Note: Diagrams are NOT included - users upload their own images for 3+ wheel vehicles
// 2-wheel vehicles (motorcycle, scooter) don't need diagrams - they use checklist only

export interface DefaultVehicleType {
  name: string
  bodyType: 'motorcycle' | 'scooter' | 'three_wheeler' | 'sedan' | 'hatchback' | 'suv' | 'pickup' | 'van' | 'coupe' | 'wagon' | 'convertible' | 'mini_truck' | 'lorry' | 'bus' | 'other'
  description: string
  wheelCount: number
}

export const defaultVehicleTypes: DefaultVehicleType[] = [
  // 2-wheel vehicles (no diagram, checklist only)
  {
    name: 'Motorcycle',
    bodyType: 'motorcycle',
    description: 'Standard motorcycle - 2 wheels, checklist only',
    wheelCount: 2,
  },
  {
    name: 'Scooter',
    bodyType: 'scooter',
    description: 'Scooter/Moped - 2 wheels, checklist only',
    wheelCount: 2,
  },

  // 3-wheel vehicles
  {
    name: 'Three-Wheeler',
    bodyType: 'three_wheeler',
    description: 'Auto-rickshaw/Tuk-tuk - 3 wheels',
    wheelCount: 3,
  },

  // 4-wheel vehicles
  {
    name: 'Sedan',
    bodyType: 'sedan',
    description: 'Standard sedan/saloon car - 4 wheels',
    wheelCount: 4,
  },
  {
    name: 'Hatchback',
    bodyType: 'hatchback',
    description: 'Compact hatchback - 4 wheels',
    wheelCount: 4,
  },
  {
    name: 'SUV',
    bodyType: 'suv',
    description: 'Sport Utility Vehicle - 4 wheels',
    wheelCount: 4,
  },
  {
    name: 'Pickup',
    bodyType: 'pickup',
    description: 'Pickup truck - 4 wheels',
    wheelCount: 4,
  },
  {
    name: 'Van',
    bodyType: 'van',
    description: 'Passenger or cargo van - 4 wheels',
    wheelCount: 4,
  },
  {
    name: 'Coupe',
    bodyType: 'coupe',
    description: 'Two-door coupe - 4 wheels',
    wheelCount: 4,
  },
  {
    name: 'Wagon',
    bodyType: 'wagon',
    description: 'Station wagon/estate - 4 wheels',
    wheelCount: 4,
  },
  {
    name: 'Convertible',
    bodyType: 'convertible',
    description: 'Convertible/Cabriolet - 4 wheels',
    wheelCount: 4,
  },
  {
    name: 'Mini Truck',
    bodyType: 'mini_truck',
    description: 'Small commercial truck - 4 wheels',
    wheelCount: 4,
  },

  // Heavy vehicles
  {
    name: 'Lorry',
    bodyType: 'lorry',
    description: 'Heavy goods vehicle/truck - 6+ wheels',
    wheelCount: 6,
  },
  {
    name: 'Bus',
    bodyType: 'bus',
    description: 'Passenger bus - 6+ wheels',
    wheelCount: 6,
  },
]

// Body type display names for UI
export const bodyTypeDisplayNames: Record<string, string> = {
  motorcycle: 'Motorcycle',
  scooter: 'Scooter',
  three_wheeler: 'Three-Wheeler',
  sedan: 'Sedan',
  hatchback: 'Hatchback',
  suv: 'SUV',
  pickup: 'Pickup',
  van: 'Van',
  coupe: 'Coupe',
  wagon: 'Wagon',
  convertible: 'Convertible',
  mini_truck: 'Mini Truck',
  lorry: 'Lorry',
  bus: 'Bus',
  other: 'Other',
}
