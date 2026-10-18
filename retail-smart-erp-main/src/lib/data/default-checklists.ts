// Default inspection checklists by vehicle body type

export interface ChecklistItem {
  itemName: string
  itemType: 'checkbox' | 'select' | 'text' | 'number'
  options?: string[]
  isRequired: boolean
}

export interface ChecklistCategory {
  name: string
  items: ChecklistItem[]
}

export interface ChecklistTemplate {
  name: string
  description: string
  categories: ChecklistCategory[]
}

// Motorcycle/Scooter checklist (T-CLOCS framework)
export const motorcycleChecklist: ChecklistTemplate = {
  name: 'Motorcycle Check-in Inspection',
  description: 'Standard T-CLOCS inspection checklist for motorcycles',
  categories: [
    {
      name: 'Tires & Wheels',
      items: [
        { itemName: 'Front Tire Condition', itemType: 'checkbox', isRequired: true },
        { itemName: 'Front Tire Pressure', itemType: 'checkbox', isRequired: false },
        { itemName: 'Rear Tire Condition', itemType: 'checkbox', isRequired: true },
        { itemName: 'Rear Tire Pressure', itemType: 'checkbox', isRequired: false },
        { itemName: 'Wheel Bearings', itemType: 'checkbox', isRequired: false },
        { itemName: 'Spokes / Rims', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Controls',
      items: [
        { itemName: 'Handlebars', itemType: 'checkbox', isRequired: true },
        { itemName: 'Clutch Lever', itemType: 'checkbox', isRequired: true },
        { itemName: 'Brake Lever (Front)', itemType: 'checkbox', isRequired: true },
        { itemName: 'Throttle', itemType: 'checkbox', isRequired: true },
        { itemName: 'Mirrors', itemType: 'checkbox', isRequired: true },
        { itemName: 'Foot Pegs', itemType: 'checkbox', isRequired: false },
        { itemName: 'Brake Pedal (Rear)', itemType: 'checkbox', isRequired: true },
        { itemName: 'Gear Shifter', itemType: 'checkbox', isRequired: true }
      ]
    },
    {
      name: 'Lights & Electrical',
      items: [
        { itemName: 'Headlight (High/Low)', itemType: 'checkbox', isRequired: true },
        { itemName: 'Tail Light', itemType: 'checkbox', isRequired: true },
        { itemName: 'Brake Light', itemType: 'checkbox', isRequired: true },
        { itemName: 'Turn Signals (Front)', itemType: 'checkbox', isRequired: true },
        { itemName: 'Turn Signals (Rear)', itemType: 'checkbox', isRequired: true },
        { itemName: 'Horn', itemType: 'checkbox', isRequired: true },
        { itemName: 'Instrument Panel', itemType: 'checkbox', isRequired: false },
        { itemName: 'Battery', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Oil & Fluids',
      items: [
        { itemName: 'Engine Oil Level', itemType: 'checkbox', isRequired: true },
        { itemName: 'Engine Oil Condition', itemType: 'select', options: ['Clean', 'Dark', 'Dirty', 'Milky'], isRequired: false },
        { itemName: 'Coolant Level', itemType: 'checkbox', isRequired: false },
        { itemName: 'Brake Fluid Level', itemType: 'checkbox', isRequired: true },
        { itemName: 'Fuel Leaks', itemType: 'checkbox', isRequired: true }
      ]
    },
    {
      name: 'Chassis & Suspension',
      items: [
        { itemName: 'Frame Condition', itemType: 'checkbox', isRequired: true },
        { itemName: 'Front Suspension', itemType: 'checkbox', isRequired: true },
        { itemName: 'Rear Suspension', itemType: 'checkbox', isRequired: true },
        { itemName: 'Chain/Belt Condition', itemType: 'checkbox', isRequired: true },
        { itemName: 'Chain/Belt Tension', itemType: 'checkbox', isRequired: false },
        { itemName: 'Sprockets', itemType: 'checkbox', isRequired: false },
        { itemName: 'Front Brake Pads', itemType: 'checkbox', isRequired: true },
        { itemName: 'Rear Brake Pads', itemType: 'checkbox', isRequired: true }
      ]
    },
    {
      name: 'Stands & Other',
      items: [
        { itemName: 'Side Stand', itemType: 'checkbox', isRequired: true },
        { itemName: 'Center Stand', itemType: 'checkbox', isRequired: false },
        { itemName: 'Seat Condition', itemType: 'checkbox', isRequired: false },
        { itemName: 'Fairings/Body Panels', itemType: 'checkbox', isRequired: false },
        { itemName: 'Exhaust System', itemType: 'checkbox', isRequired: false }
      ]
    }
  ]
}

// Scooter checklist (similar to motorcycle but simplified)
export const scooterChecklist: ChecklistTemplate = {
  name: 'Scooter Check-in Inspection',
  description: 'Standard inspection checklist for scooters',
  categories: [
    {
      name: 'Tires & Wheels',
      items: [
        { itemName: 'Front Tire Condition', itemType: 'checkbox', isRequired: true },
        { itemName: 'Rear Tire Condition', itemType: 'checkbox', isRequired: true },
        { itemName: 'Wheel Condition', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Controls & Body',
      items: [
        { itemName: 'Handlebar', itemType: 'checkbox', isRequired: true },
        { itemName: 'Brake Levers', itemType: 'checkbox', isRequired: true },
        { itemName: 'Throttle', itemType: 'checkbox', isRequired: true },
        { itemName: 'Mirrors', itemType: 'checkbox', isRequired: true },
        { itemName: 'Body Panels', itemType: 'checkbox', isRequired: false },
        { itemName: 'Seat', itemType: 'checkbox', isRequired: false },
        { itemName: 'Storage Compartment', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Lights & Electrical',
      items: [
        { itemName: 'Headlight', itemType: 'checkbox', isRequired: true },
        { itemName: 'Tail Light', itemType: 'checkbox', isRequired: true },
        { itemName: 'Brake Light', itemType: 'checkbox', isRequired: true },
        { itemName: 'Turn Signals', itemType: 'checkbox', isRequired: true },
        { itemName: 'Horn', itemType: 'checkbox', isRequired: true },
        { itemName: 'Battery', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Mechanical',
      items: [
        { itemName: 'Engine Oil Level', itemType: 'checkbox', isRequired: true },
        { itemName: 'CVT Belt', itemType: 'checkbox', isRequired: false },
        { itemName: 'Brakes (Front)', itemType: 'checkbox', isRequired: true },
        { itemName: 'Brakes (Rear)', itemType: 'checkbox', isRequired: true },
        { itemName: 'Exhaust', itemType: 'checkbox', isRequired: false }
      ]
    }
  ]
}

// Three-wheeler (Tuk-tuk) checklist
export const threeWheelerChecklist: ChecklistTemplate = {
  name: 'Three-Wheeler Check-in Inspection',
  description: 'Standard inspection checklist for three-wheelers/tuk-tuks',
  categories: [
    {
      name: 'Exterior',
      items: [
        { itemName: 'Body Panels', itemType: 'checkbox', isRequired: true },
        { itemName: 'Canopy/Roof', itemType: 'checkbox', isRequired: true },
        { itemName: 'Windscreen', itemType: 'checkbox', isRequired: true },
        { itemName: 'Mirrors', itemType: 'checkbox', isRequired: true },
        { itemName: 'Paint Condition', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Lights & Electrical',
      items: [
        { itemName: 'Headlight', itemType: 'checkbox', isRequired: true },
        { itemName: 'Tail Lights', itemType: 'checkbox', isRequired: true },
        { itemName: 'Brake Lights', itemType: 'checkbox', isRequired: true },
        { itemName: 'Indicators', itemType: 'checkbox', isRequired: true },
        { itemName: 'Horn', itemType: 'checkbox', isRequired: true },
        { itemName: 'Meter/Dashboard', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Tires',
      items: [
        { itemName: 'Front Tire', itemType: 'checkbox', isRequired: true },
        { itemName: 'Rear Left Tire', itemType: 'checkbox', isRequired: true },
        { itemName: 'Rear Right Tire', itemType: 'checkbox', isRequired: true },
        { itemName: 'Spare Tire', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Mechanical',
      items: [
        { itemName: 'Engine Oil Level', itemType: 'checkbox', isRequired: true },
        { itemName: 'Engine Oil Condition', itemType: 'select', options: ['Clean', 'Dark', 'Dirty'], isRequired: false },
        { itemName: 'Coolant Level', itemType: 'checkbox', isRequired: false },
        { itemName: 'Brakes', itemType: 'checkbox', isRequired: true },
        { itemName: 'Steering', itemType: 'checkbox', isRequired: true },
        { itemName: 'Suspension', itemType: 'checkbox', isRequired: false },
        { itemName: 'Clutch', itemType: 'checkbox', isRequired: true },
        { itemName: 'Gearbox', itemType: 'checkbox', isRequired: true }
      ]
    },
    {
      name: 'Interior & Seats',
      items: [
        { itemName: 'Driver Seat', itemType: 'checkbox', isRequired: false },
        { itemName: 'Passenger Seats', itemType: 'checkbox', isRequired: false },
        { itemName: 'Floor Mat', itemType: 'checkbox', isRequired: false },
        { itemName: 'Meter Reading', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Compliance',
      items: [
        { itemName: 'Registration Visible', itemType: 'checkbox', isRequired: false },
        { itemName: 'Insurance Sticker', itemType: 'checkbox', isRequired: false },
        { itemName: 'Revenue License', itemType: 'checkbox', isRequired: false }
      ]
    }
  ]
}

// Standard car checklist (for sedan, hatchback, SUV, etc.)
export const carChecklist: ChecklistTemplate = {
  name: 'Vehicle Check-in Inspection',
  description: 'Standard inspection checklist for cars',
  categories: [
    {
      name: 'Exterior',
      items: [
        { itemName: 'Body Condition (Overall)', itemType: 'checkbox', isRequired: true },
        { itemName: 'Paint Condition', itemType: 'checkbox', isRequired: true },
        { itemName: 'Windshield', itemType: 'checkbox', isRequired: true },
        { itemName: 'Front Windows', itemType: 'checkbox', isRequired: true },
        { itemName: 'Rear Windows', itemType: 'checkbox', isRequired: true },
        { itemName: 'Side Mirrors', itemType: 'checkbox', isRequired: true },
        { itemName: 'Rear View Mirror', itemType: 'checkbox', isRequired: false },
        { itemName: 'Wipers', itemType: 'checkbox', isRequired: true },
        { itemName: 'Door Handles', itemType: 'checkbox', isRequired: false },
        { itemName: 'Antenna', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Lights',
      items: [
        { itemName: 'Headlights (Low Beam)', itemType: 'checkbox', isRequired: true },
        { itemName: 'Headlights (High Beam)', itemType: 'checkbox', isRequired: true },
        { itemName: 'Tail Lights', itemType: 'checkbox', isRequired: true },
        { itemName: 'Brake Lights', itemType: 'checkbox', isRequired: true },
        { itemName: 'Turn Signals (Front)', itemType: 'checkbox', isRequired: true },
        { itemName: 'Turn Signals (Rear)', itemType: 'checkbox', isRequired: true },
        { itemName: 'Hazard Lights', itemType: 'checkbox', isRequired: true },
        { itemName: 'Fog Lights', itemType: 'checkbox', isRequired: false },
        { itemName: 'Reverse Lights', itemType: 'checkbox', isRequired: false },
        { itemName: 'License Plate Light', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Tires & Wheels',
      items: [
        { itemName: 'Front Left Tire', itemType: 'checkbox', isRequired: true },
        { itemName: 'Front Right Tire', itemType: 'checkbox', isRequired: true },
        { itemName: 'Rear Left Tire', itemType: 'checkbox', isRequired: true },
        { itemName: 'Rear Right Tire', itemType: 'checkbox', isRequired: true },
        { itemName: 'Spare Tire', itemType: 'checkbox', isRequired: false },
        { itemName: 'Wheel Covers/Rims', itemType: 'checkbox', isRequired: false },
        { itemName: 'Tire Pressure (Overall)', itemType: 'select', options: ['Normal', 'Low', 'High', 'Uneven'], isRequired: false }
      ]
    },
    {
      name: 'Interior',
      items: [
        { itemName: 'Dashboard', itemType: 'checkbox', isRequired: false },
        { itemName: 'Instrument Cluster', itemType: 'checkbox', isRequired: true },
        { itemName: 'Steering Wheel', itemType: 'checkbox', isRequired: true },
        { itemName: 'Driver Seat', itemType: 'checkbox', isRequired: false },
        { itemName: 'Passenger Seats', itemType: 'checkbox', isRequired: false },
        { itemName: 'Rear Seats', itemType: 'checkbox', isRequired: false },
        { itemName: 'Seat Belts', itemType: 'checkbox', isRequired: true },
        { itemName: 'Air Conditioning', itemType: 'checkbox', isRequired: false },
        { itemName: 'Heater', itemType: 'checkbox', isRequired: false },
        { itemName: 'Radio/Audio System', itemType: 'checkbox', isRequired: false },
        { itemName: 'Horn', itemType: 'checkbox', isRequired: true },
        { itemName: 'Power Windows', itemType: 'checkbox', isRequired: false },
        { itemName: 'Central Locking', itemType: 'checkbox', isRequired: false },
        { itemName: 'Floor Mats', itemType: 'checkbox', isRequired: false },
        { itemName: 'Trunk/Boot Interior', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Under Hood',
      items: [
        { itemName: 'Engine Oil Level', itemType: 'checkbox', isRequired: true },
        { itemName: 'Engine Oil Condition', itemType: 'select', options: ['Clean', 'Dark', 'Dirty', 'Milky'], isRequired: false },
        { itemName: 'Coolant Level', itemType: 'checkbox', isRequired: true },
        { itemName: 'Brake Fluid Level', itemType: 'checkbox', isRequired: true },
        { itemName: 'Power Steering Fluid', itemType: 'checkbox', isRequired: false },
        { itemName: 'Washer Fluid Level', itemType: 'checkbox', isRequired: false },
        { itemName: 'Battery Condition', itemType: 'checkbox', isRequired: true },
        { itemName: 'Battery Terminals', itemType: 'checkbox', isRequired: false },
        { itemName: 'Air Filter', itemType: 'checkbox', isRequired: false },
        { itemName: 'Belts & Hoses', itemType: 'checkbox', isRequired: false },
        { itemName: 'Visible Leaks', itemType: 'checkbox', isRequired: true }
      ]
    },
    {
      name: 'Mechanical',
      items: [
        { itemName: 'Engine Start', itemType: 'checkbox', isRequired: true },
        { itemName: 'Engine Idle', itemType: 'select', options: ['Smooth', 'Rough', 'Stalls'], isRequired: false },
        { itemName: 'Unusual Engine Noise', itemType: 'checkbox', isRequired: false },
        { itemName: 'Transmission', itemType: 'select', options: ['Smooth', 'Slipping', 'Hard Shift'], isRequired: false },
        { itemName: 'Clutch (Manual)', itemType: 'checkbox', isRequired: false },
        { itemName: 'Brake Pedal Feel', itemType: 'checkbox', isRequired: true },
        { itemName: 'Parking Brake', itemType: 'checkbox', isRequired: true },
        { itemName: 'Steering', itemType: 'checkbox', isRequired: true },
        { itemName: 'Suspension', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Documents & Accessories',
      items: [
        { itemName: 'Jack & Tools', itemType: 'checkbox', isRequired: false },
        { itemName: 'Warning Triangle', itemType: 'checkbox', isRequired: false },
        { itemName: 'First Aid Kit', itemType: 'checkbox', isRequired: false },
        { itemName: 'Vehicle Manual', itemType: 'checkbox', isRequired: false }
      ]
    }
  ]
}

// Pickup truck checklist
export const pickupChecklist: ChecklistTemplate = {
  name: 'Pickup Truck Check-in Inspection',
  description: 'Standard inspection checklist for pickup trucks',
  categories: [
    ...carChecklist.categories.slice(0, 5), // Include exterior, lights, tires, interior, under hood
    {
      name: 'Truck Bed',
      items: [
        { itemName: 'Bed Floor', itemType: 'checkbox', isRequired: true },
        { itemName: 'Bed Sides', itemType: 'checkbox', isRequired: true },
        { itemName: 'Tailgate', itemType: 'checkbox', isRequired: true },
        { itemName: 'Tailgate Latch', itemType: 'checkbox', isRequired: false },
        { itemName: 'Bed Liner', itemType: 'checkbox', isRequired: false },
        { itemName: 'Tie-Down Points', itemType: 'checkbox', isRequired: false },
        { itemName: 'Bed Cover (if equipped)', itemType: 'checkbox', isRequired: false }
      ]
    },
    ...carChecklist.categories.slice(5) // Include mechanical, documents
  ]
}

// Van checklist
export const vanChecklist: ChecklistTemplate = {
  name: 'Van Check-in Inspection',
  description: 'Standard inspection checklist for vans',
  categories: [
    ...carChecklist.categories.slice(0, 4), // Include exterior, lights, tires, interior
    {
      name: 'Cargo Area',
      items: [
        { itemName: 'Cargo Floor', itemType: 'checkbox', isRequired: false },
        { itemName: 'Cargo Walls', itemType: 'checkbox', isRequired: false },
        { itemName: 'Sliding Door (Left)', itemType: 'checkbox', isRequired: false },
        { itemName: 'Sliding Door (Right)', itemType: 'checkbox', isRequired: false },
        { itemName: 'Rear Doors', itemType: 'checkbox', isRequired: true },
        { itemName: 'Interior Lights', itemType: 'checkbox', isRequired: false },
        { itemName: 'Tie-Down Points', itemType: 'checkbox', isRequired: false }
      ]
    },
    ...carChecklist.categories.slice(4) // Include under hood, mechanical, documents
  ]
}

// Lorry/Truck checklist
export const lorryChecklist: ChecklistTemplate = {
  name: 'Lorry/Truck Check-in Inspection',
  description: 'Standard inspection checklist for lorries/trucks',
  categories: [
    {
      name: 'Cab Exterior',
      items: [
        { itemName: 'Cab Body', itemType: 'checkbox', isRequired: true },
        { itemName: 'Windshield', itemType: 'checkbox', isRequired: true },
        { itemName: 'Side Windows', itemType: 'checkbox', isRequired: true },
        { itemName: 'Mirrors', itemType: 'checkbox', isRequired: true },
        { itemName: 'Door Condition', itemType: 'checkbox', isRequired: true },
        { itemName: 'Steps', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Lights & Signals',
      items: [
        { itemName: 'Headlights', itemType: 'checkbox', isRequired: true },
        { itemName: 'Marker Lights', itemType: 'checkbox', isRequired: true },
        { itemName: 'Turn Signals', itemType: 'checkbox', isRequired: true },
        { itemName: 'Brake Lights', itemType: 'checkbox', isRequired: true },
        { itemName: 'Reverse Lights', itemType: 'checkbox', isRequired: true },
        { itemName: 'Reflectors', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Tires',
      items: [
        { itemName: 'Front Left Tire', itemType: 'checkbox', isRequired: true },
        { itemName: 'Front Right Tire', itemType: 'checkbox', isRequired: true },
        { itemName: 'Rear Left Inner', itemType: 'checkbox', isRequired: true },
        { itemName: 'Rear Left Outer', itemType: 'checkbox', isRequired: true },
        { itemName: 'Rear Right Inner', itemType: 'checkbox', isRequired: true },
        { itemName: 'Rear Right Outer', itemType: 'checkbox', isRequired: true },
        { itemName: 'Spare Tire', itemType: 'checkbox', isRequired: false },
        { itemName: 'Lug Nuts', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Cargo Body',
      items: [
        { itemName: 'Body Panels', itemType: 'checkbox', isRequired: true },
        { itemName: 'Floor', itemType: 'checkbox', isRequired: true },
        { itemName: 'Roof', itemType: 'checkbox', isRequired: false },
        { itemName: 'Rear Doors/Gate', itemType: 'checkbox', isRequired: true },
        { itemName: 'Door Locks', itemType: 'checkbox', isRequired: false },
        { itemName: 'Tie-Down Points', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Mechanical',
      items: [
        { itemName: 'Engine Oil Level', itemType: 'checkbox', isRequired: true },
        { itemName: 'Coolant Level', itemType: 'checkbox', isRequired: true },
        { itemName: 'Air System', itemType: 'checkbox', isRequired: true },
        { itemName: 'Brakes', itemType: 'checkbox', isRequired: true },
        { itemName: 'Steering', itemType: 'checkbox', isRequired: true },
        { itemName: 'Clutch', itemType: 'checkbox', isRequired: true },
        { itemName: 'Horn', itemType: 'checkbox', isRequired: true },
        { itemName: 'Air Horn', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Safety Equipment',
      items: [
        { itemName: 'Fire Extinguisher', itemType: 'checkbox', isRequired: false },
        { itemName: 'Warning Triangle', itemType: 'checkbox', isRequired: false },
        { itemName: 'First Aid Kit', itemType: 'checkbox', isRequired: false },
        { itemName: 'Wheel Chocks', itemType: 'checkbox', isRequired: false }
      ]
    }
  ]
}

// Bus checklist
export const busChecklist: ChecklistTemplate = {
  name: 'Bus Check-in Inspection',
  description: 'Standard inspection checklist for buses',
  categories: [
    {
      name: 'Exterior',
      items: [
        { itemName: 'Body Panels', itemType: 'checkbox', isRequired: true },
        { itemName: 'Windshield', itemType: 'checkbox', isRequired: true },
        { itemName: 'Side Windows', itemType: 'checkbox', isRequired: true },
        { itemName: 'Mirrors', itemType: 'checkbox', isRequired: true },
        { itemName: 'Entry Door', itemType: 'checkbox', isRequired: true },
        { itemName: 'Emergency Exits', itemType: 'checkbox', isRequired: true },
        { itemName: 'Luggage Compartment Doors', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Lights & Signals',
      items: [
        { itemName: 'Headlights', itemType: 'checkbox', isRequired: true },
        { itemName: 'Marker Lights', itemType: 'checkbox', isRequired: true },
        { itemName: 'Turn Signals', itemType: 'checkbox', isRequired: true },
        { itemName: 'Brake Lights', itemType: 'checkbox', isRequired: true },
        { itemName: 'Interior Lights', itemType: 'checkbox', isRequired: false },
        { itemName: 'Destination Board', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Tires',
      items: [
        { itemName: 'Front Left Tire', itemType: 'checkbox', isRequired: true },
        { itemName: 'Front Right Tire', itemType: 'checkbox', isRequired: true },
        { itemName: 'Rear Left Tires', itemType: 'checkbox', isRequired: true },
        { itemName: 'Rear Right Tires', itemType: 'checkbox', isRequired: true },
        { itemName: 'Spare Tire', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Interior',
      items: [
        { itemName: 'Driver Seat', itemType: 'checkbox', isRequired: false },
        { itemName: 'Passenger Seats', itemType: 'checkbox', isRequired: true },
        { itemName: 'Seat Belts', itemType: 'checkbox', isRequired: false },
        { itemName: 'Handrails', itemType: 'checkbox', isRequired: true },
        { itemName: 'Floor', itemType: 'checkbox', isRequired: false },
        { itemName: 'Air Conditioning', itemType: 'checkbox', isRequired: false },
        { itemName: 'PA System', itemType: 'checkbox', isRequired: false }
      ]
    },
    {
      name: 'Mechanical',
      items: [
        { itemName: 'Engine Oil Level', itemType: 'checkbox', isRequired: true },
        { itemName: 'Coolant Level', itemType: 'checkbox', isRequired: true },
        { itemName: 'Air System', itemType: 'checkbox', isRequired: true },
        { itemName: 'Brakes', itemType: 'checkbox', isRequired: true },
        { itemName: 'Steering', itemType: 'checkbox', isRequired: true },
        { itemName: 'Door Mechanism', itemType: 'checkbox', isRequired: true },
        { itemName: 'Horn', itemType: 'checkbox', isRequired: true }
      ]
    },
    {
      name: 'Safety Equipment',
      items: [
        { itemName: 'Fire Extinguisher', itemType: 'checkbox', isRequired: true },
        { itemName: 'Emergency Hammer', itemType: 'checkbox', isRequired: true },
        { itemName: 'First Aid Kit', itemType: 'checkbox', isRequired: true },
        { itemName: 'Warning Triangle', itemType: 'checkbox', isRequired: false }
      ]
    }
  ]
}

// Map body type to checklist template
export const checklistByBodyType: Record<string, ChecklistTemplate> = {
  motorcycle: motorcycleChecklist,
  scooter: scooterChecklist,
  three_wheeler: threeWheelerChecklist,
  sedan: carChecklist,
  hatchback: carChecklist,
  suv: carChecklist,
  coupe: carChecklist,
  wagon: carChecklist,
  convertible: carChecklist,
  pickup: pickupChecklist,
  van: vanChecklist,
  mini_truck: pickupChecklist,
  lorry: lorryChecklist,
  bus: busChecklist,
  other: carChecklist
}

// Get checklist for a body type
export function getChecklistForBodyType(bodyType: string): ChecklistTemplate {
  return checklistByBodyType[bodyType] || carChecklist
}
