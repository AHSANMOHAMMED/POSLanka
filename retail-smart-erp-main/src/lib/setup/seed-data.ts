// Seed data constants for post-company-creation setup wizard
// Business-type-specific defaults

export interface CategorySeed {
  name: string
  selected?: boolean
}

export interface ServiceTypeSeed {
  name: string
  defaultHours?: number
  defaultRate?: number
}

export interface ServiceGroupSeed {
  name: string
  description?: string
  services: ServiceTypeSeed[]
}

// ==================== RETAIL ====================

export const retailCategories: CategorySeed[] = [
  { name: 'Electronics', selected: true },
  { name: 'Clothing & Apparel', selected: true },
  { name: 'Food & Beverages', selected: true },
  { name: 'Health & Beauty', selected: true },
  { name: 'Home & Garden', selected: false },
  { name: 'Sports & Outdoors', selected: false },
  { name: 'Books & Stationery', selected: false },
  { name: 'Toys & Games', selected: false },
  { name: 'Accessories', selected: true },
  { name: 'General', selected: true },
]

// ==================== RESTAURANT ====================

export const restaurantCategories: CategorySeed[] = [
  { name: 'Appetizers', selected: true },
  { name: 'Main Course', selected: true },
  { name: 'Rice & Noodles', selected: true },
  { name: 'Soups & Salads', selected: true },
  { name: 'Desserts', selected: true },
  { name: 'Hot Beverages', selected: true },
  { name: 'Cold Beverages', selected: true },
  { name: 'Sides', selected: false },
  { name: 'Specials', selected: false },
]

export const defaultTableAreas = ['Main Hall', 'Outdoor', 'VIP']

// ==================== SUPERMARKET ====================

export const supermarketCategories: CategorySeed[] = [
  { name: 'Fresh Produce', selected: true },
  { name: 'Dairy & Eggs', selected: true },
  { name: 'Meat & Seafood', selected: true },
  { name: 'Bakery', selected: true },
  { name: 'Canned & Packaged', selected: true },
  { name: 'Beverages', selected: true },
  { name: 'Snacks & Confectionery', selected: true },
  { name: 'Frozen Foods', selected: false },
  { name: 'Household & Cleaning', selected: false },
  { name: 'Personal Care', selected: false },
]

// ==================== AUTO SERVICE ====================

export const autoServiceGroups: ServiceGroupSeed[] = [
  {
    name: 'Engine & Mechanical',
    description: 'Engine repairs and mechanical services',
    services: [
      { name: 'Oil Change', defaultHours: 0.5, defaultRate: 30 },
      { name: 'Engine Tune-Up', defaultHours: 2, defaultRate: 80 },
      { name: 'Transmission Service', defaultHours: 3, defaultRate: 120 },
      { name: 'Brake Pad Replacement', defaultHours: 1.5, defaultRate: 60 },
      { name: 'Timing Belt Replacement', defaultHours: 4, defaultRate: 150 },
      { name: 'Clutch Replacement', defaultHours: 5, defaultRate: 200 },
    ],
  },
  {
    name: 'Electrical',
    description: 'Electrical system repairs',
    services: [
      { name: 'Battery Replacement', defaultHours: 0.5, defaultRate: 25 },
      { name: 'Alternator Repair', defaultHours: 2, defaultRate: 80 },
      { name: 'Starter Motor Repair', defaultHours: 2, defaultRate: 80 },
      { name: 'Wiring Repair', defaultHours: 1.5, defaultRate: 60 },
      { name: 'Headlight/Taillight Repair', defaultHours: 1, defaultRate: 40 },
    ],
  },
  {
    name: 'Body & Paint',
    description: 'Body work and painting services',
    services: [
      { name: 'Dent Repair', defaultHours: 2, defaultRate: 80 },
      { name: 'Paint Job', defaultHours: 8, defaultRate: 300 },
      { name: 'Bumper Repair', defaultHours: 3, defaultRate: 120 },
      { name: 'Scratch Removal', defaultHours: 1, defaultRate: 50 },
      { name: 'Windshield Replacement', defaultHours: 2, defaultRate: 80 },
    ],
  },
  {
    name: 'Maintenance',
    description: 'Regular maintenance services',
    services: [
      { name: 'Full Service', defaultHours: 3, defaultRate: 100 },
      { name: 'Wheel Alignment', defaultHours: 1, defaultRate: 50 },
      { name: 'AC Service', defaultHours: 2, defaultRate: 80 },
      { name: 'Tire Rotation', defaultHours: 0.5, defaultRate: 25 },
      { name: 'Fluid Top-Up', defaultHours: 0.5, defaultRate: 20 },
      { name: 'Filter Replacement', defaultHours: 0.5, defaultRate: 25 },
    ],
  },
]

export const autoServicePartCategories: CategorySeed[] = [
  { name: 'Engine Parts', selected: true },
  { name: 'Brake Components', selected: true },
  { name: 'Electrical Parts', selected: true },
  { name: 'Body Parts', selected: false },
  { name: 'Suspension Parts', selected: false },
  { name: 'Transmission Parts', selected: false },
  { name: 'Filters & Fluids', selected: true },
  { name: 'Tires & Wheels', selected: false },
]

// ==================== PAYMENT METHODS ====================

export const defaultPaymentMethods = [
  { method: 'cash', label: 'Cash', selected: true },
  { method: 'card', label: 'Card', selected: true },
  { method: 'bank_transfer', label: 'Bank Transfer', selected: true },
]

// ==================== CANCELLATION REASONS ====================

export interface CancellationReasonSeed {
  documentType: string
  reasons: string[]
}

const commonReasons = ['Customer request', 'Duplicate entry', 'Error in creation']

export function getCancellationReasonsForBusinessType(businessType: string): CancellationReasonSeed[] {
  const base: CancellationReasonSeed[] = [
    {
      documentType: 'purchase_order',
      reasons: [...commonReasons, 'Supplier issue', 'Price changed', 'No longer needed', 'Budget constraints'],
    },
    {
      documentType: 'purchase_invoice',
      reasons: [...commonReasons, 'Goods not received', 'Wrong items received', 'Supplier dispute', 'Invoice error'],
    },
    {
      documentType: 'sales_order',
      reasons: [...commonReasons, 'Customer changed mind', 'Out of stock', 'Payment issue', 'Price dispute'],
    },
    {
      documentType: 'sales_invoice',
      reasons: [...commonReasons, 'Customer return', 'Wrong items', 'Pricing error', 'Payment failed'],
    },
    {
      documentType: 'estimate',
      reasons: [...commonReasons, 'Customer declined', 'Price too high', 'Scope changed', 'Expired'],
    },
    {
      documentType: 'work_order',
      reasons: [...commonReasons, 'Customer no-show', 'Parts not available', 'Scheduling conflict'],
    },
  ]

  // Business-type-specific additions
  switch (businessType) {
    case 'restaurant':
      // Override sales_order with restaurant-specific reasons
      {
        const salesOrder = base.find(b => b.documentType === 'sales_order')!
        salesOrder.reasons = [...commonReasons, 'Customer left', 'Kitchen issue', 'Ingredient unavailable', 'Long wait time', 'Wrong order']
      }
      break
    case 'auto_service':
      {
        const workOrder = base.find(b => b.documentType === 'work_order')!
        workOrder.reasons.push('Vehicle not repairable', 'Insurance denied', 'Customer towed vehicle')
        const estimate = base.find(b => b.documentType === 'estimate')!
        estimate.reasons.push('Insurance rejected', 'Total loss declared')
      }
      break
    case 'supermarket':
      {
        const purchaseOrder = base.find(b => b.documentType === 'purchase_order')!
        purchaseOrder.reasons.push('Shelf life too short', 'Quality issue')
      }
      break
    case 'dealership':
      {
        const salesOrder = base.find(b => b.documentType === 'sales_order')!
        salesOrder.reasons = [...commonReasons, 'Financing not approved', 'Vehicle sold to another buyer', 'Buyer changed mind', 'Price disagreement', 'Vehicle condition issue', 'Trade-in value disagreement']
      }
      break
  }

  return base
}

// ==================== VEHICLE MAKES & MODELS (Global) ====================

export interface VehicleMakeSeed {
  make: string
  country: string
  models: string[]
}

export const vehicleMakesAndModels: VehicleMakeSeed[] = [
  // Japanese
  { make: 'Toyota', country: 'Japan', models: ['Corolla', 'Camry', 'RAV4', 'Hilux', 'Land Cruiser', 'Prius', 'Yaris', 'Fortuner', 'Vitz', 'Aqua', 'Rush', 'Avanza', 'Innova', 'Hiace', 'Prado'] },
  { make: 'Honda', country: 'Japan', models: ['Civic', 'Accord', 'CR-V', 'HR-V', 'Jazz', 'City', 'Vezel', 'Fit', 'BR-V', 'WR-V', 'Freed'] },
  { make: 'Nissan', country: 'Japan', models: ['Sunny', 'X-Trail', 'Patrol', 'Navara', 'March', 'Note', 'Juke', 'Kicks', 'Qashqai', 'Sentra', 'Altima', 'Leaf'] },
  { make: 'Suzuki', country: 'Japan', models: ['Swift', 'Alto', 'Wagon R', 'Vitara', 'Jimny', 'Baleno', 'Celerio', 'Every', 'Ertiga', 'S-Presso', 'Dzire', 'Ciaz'] },
  { make: 'Mitsubishi', country: 'Japan', models: ['Lancer', 'Outlander', 'Pajero', 'L200', 'Attrage', 'Montero', 'Eclipse Cross', 'Xpander', 'Triton'] },
  { make: 'Mazda', country: 'Japan', models: ['Mazda3', 'Mazda6', 'CX-3', 'CX-5', 'CX-30', 'MX-5', 'BT-50', 'CX-8', 'CX-9'] },
  { make: 'Subaru', country: 'Japan', models: ['Impreza', 'Outback', 'Forester', 'XV', 'WRX', 'Legacy', 'BRZ', 'Levorg'] },
  { make: 'Isuzu', country: 'Japan', models: ['D-Max', 'MU-X', 'Elf', 'Forward', 'Giga', 'NLR', 'NMR'] },
  { make: 'Daihatsu', country: 'Japan', models: ['Terios', 'Sirion', 'Rocky', 'Ayla', 'Sigra', 'Xenia', 'Gran Max'] },
  { make: 'Lexus', country: 'Japan', models: ['IS', 'ES', 'RX', 'NX', 'UX', 'LX', 'GX', 'LS'] },
  { make: 'Infiniti', country: 'Japan', models: ['Q50', 'Q60', 'QX50', 'QX60', 'QX80'] },
  { make: 'Acura', country: 'Japan', models: ['TLX', 'RDX', 'MDX', 'Integra'] },
  // Korean
  { make: 'Hyundai', country: 'South Korea', models: ['Tucson', 'Creta', 'i10', 'i20', 'i30', 'Elantra', 'Sonata', 'Santa Fe', 'Kona', 'Venue', 'Palisade', 'Accent'] },
  { make: 'Kia', country: 'South Korea', models: ['Sportage', 'Seltos', 'Picanto', 'Rio', 'Cerato', 'Sorento', 'Carnival', 'Stonic', 'EV6', 'Niro'] },
  { make: 'SsangYong', country: 'South Korea', models: ['Tivoli', 'Korando', 'Rexton', 'Musso'] },
  // German
  { make: 'BMW', country: 'Germany', models: ['3 Series', '5 Series', '7 Series', 'X1', 'X3', 'X5', 'X7', '1 Series', '4 Series', 'Z4', 'iX'] },
  { make: 'Mercedes-Benz', country: 'Germany', models: ['C-Class', 'E-Class', 'S-Class', 'A-Class', 'GLC', 'GLE', 'GLS', 'CLA', 'GLA', 'GLB', 'EQS'] },
  { make: 'Audi', country: 'Germany', models: ['A3', 'A4', 'A6', 'Q3', 'Q5', 'Q7', 'Q8', 'A1', 'TT', 'e-tron', 'RS3'] },
  { make: 'Volkswagen', country: 'Germany', models: ['Golf', 'Polo', 'Tiguan', 'Passat', 'T-Roc', 'Arteon', 'ID.4', 'Jetta', 'Atlas', 'Amarok'] },
  { make: 'Porsche', country: 'Germany', models: ['911', 'Cayenne', 'Macan', 'Panamera', 'Taycan', 'Boxster'] },
  { make: 'Opel', country: 'Germany', models: ['Corsa', 'Astra', 'Mokka', 'Crossland', 'Grandland'] },
  { make: 'Mini', country: 'Germany', models: ['Cooper', 'Countryman', 'Clubman', 'Convertible'] },
  // American
  { make: 'Ford', country: 'USA', models: ['Ranger', 'Everest', 'Focus', 'Mustang', 'Explorer', 'F-150', 'Bronco', 'Escape', 'Edge', 'EcoSport', 'Expedition'] },
  { make: 'Chevrolet', country: 'USA', models: ['Cruze', 'Spark', 'Malibu', 'Tahoe', 'Silverado', 'Suburban', 'Equinox', 'Traverse', 'Blazer', 'Colorado'] },
  { make: 'Jeep', country: 'USA', models: ['Wrangler', 'Cherokee', 'Grand Cherokee', 'Compass', 'Renegade', 'Gladiator'] },
  { make: 'Dodge', country: 'USA', models: ['Charger', 'Challenger', 'Durango', 'Ram 1500', 'Ram 2500'] },
  { make: 'GMC', country: 'USA', models: ['Sierra', 'Canyon', 'Terrain', 'Acadia', 'Yukon'] },
  { make: 'Tesla', country: 'USA', models: ['Model 3', 'Model Y', 'Model S', 'Model X', 'Cybertruck'] },
  { make: 'Cadillac', country: 'USA', models: ['CT5', 'XT4', 'XT5', 'Escalade'] },
  { make: 'Lincoln', country: 'USA', models: ['Corsair', 'Nautilus', 'Aviator', 'Navigator'] },
  // Chinese
  { make: 'BYD', country: 'China', models: ['Atto 3', 'Seal', 'Dolphin', 'Tang', 'Han', 'Song Plus', 'Yuan Plus'] },
  { make: 'Chery', country: 'China', models: ['Tiggo 4', 'Tiggo 7', 'Tiggo 8', 'Arrizo 5', 'Omoda 5'] },
  { make: 'Geely', country: 'China', models: ['Coolray', 'Azkarra', 'Okavango', 'Emgrand', 'Monjaro'] },
  { make: 'Haval', country: 'China', models: ['H6', 'Jolion', 'H9', 'Dargo', 'H2'] },
  { make: 'MG', country: 'China', models: ['ZS', 'HS', 'MG5', 'MG3', 'RX5', 'MG4', 'Gloster'] },
  { make: 'JAC', country: 'China', models: ['S2', 'S3', 'S4', 'S7', 'T6', 'T8'] },
  { make: 'DFSK', country: 'China', models: ['Glory 580', 'Glory 560', 'Super Cab', 'Mini Van'] },
  { make: 'Changan', country: 'China', models: ['CS35', 'CS55', 'CS75', 'UNI-T', 'UNI-K', 'Alsvin'] },
  // European (non-German)
  { make: 'Peugeot', country: 'France', models: ['208', '308', '3008', '2008', '5008', '508', 'Partner'] },
  { make: 'Renault', country: 'France', models: ['Clio', 'Megane', 'Captur', 'Kadjar', 'Koleos', 'Duster', 'Kwid'] },
  { make: 'Citroën', country: 'France', models: ['C3', 'C4', 'C5 Aircross', 'Berlingo', 'C3 Aircross'] },
  { make: 'Fiat', country: 'Italy', models: ['500', 'Panda', 'Tipo', 'Punto', 'Doblo', 'Ducato'] },
  { make: 'Volvo', country: 'Sweden', models: ['XC40', 'XC60', 'XC90', 'S60', 'S90', 'V60', 'V90'] },
  { make: 'Skoda', country: 'Czech Republic', models: ['Octavia', 'Fabia', 'Superb', 'Kodiaq', 'Karoq', 'Kamiq'] },
  { make: 'SEAT', country: 'Spain', models: ['Ibiza', 'Leon', 'Arona', 'Ateca', 'Tarraco'] },
  // British
  { make: 'Land Rover', country: 'UK', models: ['Defender', 'Discovery', 'Range Rover', 'Range Rover Sport', 'Range Rover Evoque', 'Velar'] },
  { make: 'Jaguar', country: 'UK', models: ['F-Pace', 'E-Pace', 'XE', 'XF', 'F-Type', 'I-Pace'] },
  // Indian
  { make: 'Tata', country: 'India', models: ['Nexon', 'Punch', 'Harrier', 'Safari', 'Altroz', 'Tiago', 'Tigor'] },
  { make: 'Mahindra', country: 'India', models: ['XUV700', 'Thar', 'Scorpio', 'XUV300', 'Bolero', 'KUV100'] },
  { make: 'Maruti Suzuki', country: 'India', models: ['Swift', 'Baleno', 'Brezza', 'Ertiga', 'Alto K10', 'Wagon R', 'Celerio', 'Dzire', 'Ciaz', 'Grand Vitara'] },
  // South-East Asian
  { make: 'Perodua', country: 'Malaysia', models: ['Myvi', 'Axia', 'Aruz', 'Bezza', 'Ativa', 'Alza'] },
  { make: 'Proton', country: 'Malaysia', models: ['Saga', 'X50', 'X70', 'Persona', 'Iriz', 'Exora'] },
  // Other
  { make: 'Bajaj', country: 'India', models: ['Pulsar', 'Dominar', 'Platina', 'CT110', 'RE (Three Wheeler)'] },
  { make: 'TVS', country: 'India', models: ['Apache', 'Jupiter', 'Ntorq', 'XL100', 'King'] },
  { make: 'Yamaha', country: 'Japan', models: ['YZF-R15', 'MT-15', 'FZ', 'Ray ZR', 'Fascino', 'NMAX', 'XMAX'] },
  { make: 'Kawasaki', country: 'Japan', models: ['Ninja 300', 'Z400', 'Versys', 'KLX', 'Vulcan'] },
]

// ==================== VEHICLE TYPES (System Defaults) ====================

export interface VehicleTypeSeed {
  name: string
  bodyType: string
  wheelCount: number
  description?: string
}

export const defaultVehicleTypes: VehicleTypeSeed[] = [
  { name: 'Motorcycle', bodyType: 'motorcycle', wheelCount: 2, description: 'Two-wheeled motorized vehicle' },
  { name: 'Scooter', bodyType: 'scooter', wheelCount: 2, description: 'Light two-wheeled vehicle with step-through frame' },
  { name: 'Three Wheeler', bodyType: 'three_wheeler', wheelCount: 3, description: 'Auto rickshaw or tuk-tuk' },
  { name: 'Sedan', bodyType: 'sedan', wheelCount: 4, description: 'Four-door passenger car' },
  { name: 'Hatchback', bodyType: 'hatchback', wheelCount: 4, description: 'Compact car with rear door' },
  { name: 'SUV', bodyType: 'suv', wheelCount: 4, description: 'Sport utility vehicle' },
  { name: 'Pickup Truck', bodyType: 'pickup', wheelCount: 4, description: 'Light truck with open cargo area' },
  { name: 'Van', bodyType: 'van', wheelCount: 4, description: 'Passenger or cargo van' },
  { name: 'Coupe', bodyType: 'coupe', wheelCount: 4, description: 'Two-door sports car' },
  { name: 'Station Wagon', bodyType: 'wagon', wheelCount: 4, description: 'Extended roof car with rear cargo area' },
  { name: 'Convertible', bodyType: 'convertible', wheelCount: 4, description: 'Car with retractable roof' },
  { name: 'Mini Truck', bodyType: 'mini_truck', wheelCount: 4, description: 'Small commercial truck' },
]

// ==================== INSPECTION TEMPLATES (Auto Service) ====================

export interface InspectionTemplateSeed {
  name: string
  type: 'check_in' | 'check_out'
  categories: {
    name: string
    items: { name: string; type?: 'checkbox' | 'select' | 'text' | 'number'; required?: boolean }[]
  }[]
}

export const defaultInspectionTemplates: InspectionTemplateSeed[] = [
  {
    name: 'Standard Vehicle Check-In',
    type: 'check_in',
    categories: [
      {
        name: 'Exterior',
        items: [
          { name: 'Body condition', type: 'select', required: true },
          { name: 'Paint scratches/dents' },
          { name: 'Windshield condition' },
          { name: 'Headlights working' },
          { name: 'Tail lights working' },
          { name: 'Side mirrors intact' },
          { name: 'Wipers condition' },
          { name: 'Tire condition' },
          { name: 'Wheel rims condition' },
        ],
      },
      {
        name: 'Interior',
        items: [
          { name: 'Seats condition' },
          { name: 'Dashboard condition' },
          { name: 'AC working' },
          { name: 'Radio/Infotainment working' },
          { name: 'Seatbelts working' },
          { name: 'Floor mats present' },
          { name: 'Odometer reading', type: 'number', required: true },
          { name: 'Fuel level', type: 'select' },
        ],
      },
      {
        name: 'Engine Bay',
        items: [
          { name: 'Oil level' },
          { name: 'Coolant level' },
          { name: 'Brake fluid level' },
          { name: 'Battery condition' },
          { name: 'Belt condition' },
          { name: 'Hose condition' },
          { name: 'Visible leaks' },
        ],
      },
      {
        name: 'Undercarriage',
        items: [
          { name: 'Exhaust system' },
          { name: 'Suspension condition' },
          { name: 'Brake pad thickness' },
          { name: 'Fluid leaks underneath' },
          { name: 'CV boot condition' },
        ],
      },
    ],
  },
  {
    name: 'Standard Vehicle Check-Out',
    type: 'check_out',
    categories: [
      {
        name: 'Work Verification',
        items: [
          { name: 'All requested work completed', required: true },
          { name: 'Test drive performed' },
          { name: 'No warning lights on dashboard', required: true },
          { name: 'Customer concerns addressed' },
        ],
      },
      {
        name: 'Cleanliness',
        items: [
          { name: 'Interior cleaned' },
          { name: 'Exterior washed' },
          { name: 'No tools left inside' },
          { name: 'Protective covers removed' },
        ],
      },
      {
        name: 'Final Checks',
        items: [
          { name: 'Tire pressure checked' },
          { name: 'Oil level correct' },
          { name: 'Coolant level correct' },
          { name: 'All fluids topped up' },
          { name: 'Odometer reading', type: 'number', required: true },
          { name: 'Fuel level', type: 'select' },
        ],
      },
    ],
  },
]

// ==================== INSURANCE COMPANIES (Auto Service) ====================

export interface InsuranceCompanySeed {
  name: string
  shortName: string
}

export const defaultInsuranceCompanies: InsuranceCompanySeed[] = [
  { name: 'Sri Lanka Insurance Corporation', shortName: 'SLIC' },
  { name: 'Allianz Insurance Lanka', shortName: 'Allianz' },
  { name: 'Ceylinco General Insurance', shortName: 'Ceylinco' },
  { name: 'Fairfirst Insurance', shortName: 'Fairfirst' },
  { name: 'AIA Insurance Lanka', shortName: 'AIA' },
  { name: 'HNB Assurance', shortName: 'HNB' },
  { name: 'Janashakthi Insurance', shortName: 'Janashakthi' },
  { name: 'Union Assurance', shortName: 'Union' },
  { name: 'Continental Insurance Lanka', shortName: 'Continental' },
  { name: 'Cooperative Insurance', shortName: 'Co-op' },
]

// ==================== PRINT TEMPLATES & DOCUMENT TYPES ====================

export const printTemplateDocumentTypes = [
  { type: 'sales_invoice', name: 'Sales Invoice' },
  { type: 'purchase_invoice', name: 'Purchase Invoice' },
  { type: 'sales_order', name: 'Sales Order' },
  { type: 'purchase_order', name: 'Purchase Order' },
  { type: 'delivery_note', name: 'Delivery Note' },
  { type: 'receipt', name: 'Receipt / POS' },
  { type: 'work_order', name: 'Work Order' },
  { type: 'estimate', name: 'Estimate' },
  { type: 'salary_slip', name: 'Salary Slip' },
  { type: 'journal_entry', name: 'Journal Entry' },
  { type: 'payment_receipt', name: 'Payment Receipt' },
]

// ==================== FISCAL YEAR DEFAULTS BY COUNTRY ====================

export function getDefaultFiscalYear(countryCode: string): { start: string; end: string; name: string } {
  const year = new Date().getFullYear()

  // Countries with Apr-Mar fiscal year
  const aprMarCountries = ['IN', 'LK', 'GB', 'JP', 'CA', 'HK', 'SG', 'NZ', 'ZA', 'BD', 'PK', 'NP', 'MM']
  // Countries with Jul-Jun fiscal year
  const julJunCountries = ['AU', 'EG', 'KE', 'NG', 'PH']
  // Countries with Oct-Sep fiscal year
  const octSepCountries = ['US', 'TH', 'MH']

  if (aprMarCountries.includes(countryCode)) {
    return { start: `${year}-04-01`, end: `${year + 1}-03-31`, name: `FY ${year}-${year + 1}` }
  }
  if (julJunCountries.includes(countryCode)) {
    return { start: `${year}-07-01`, end: `${year + 1}-06-30`, name: `FY ${year}-${year + 1}` }
  }
  if (octSepCountries.includes(countryCode)) {
    return { start: `${year}-10-01`, end: `${year + 1}-09-30`, name: `FY ${year}-${year + 1}` }
  }

  // Default: Jan-Dec (most countries)
  return { start: `${year}-01-01`, end: `${year}-12-31`, name: `FY ${year}` }
}

// ==================== HELPERS ====================

export const dealershipCategories: CategorySeed[] = [
  { name: 'New Vehicles', selected: true },
  { name: 'Used Vehicles', selected: true },
  { name: 'Demo Vehicles', selected: false },
  { name: 'Motorbikes', selected: true },
  { name: 'Scooters', selected: false },
  { name: 'Parts & Accessories', selected: true },
  { name: 'Vehicle Accessories', selected: true },
]

export function getCategoriesForBusinessType(businessType: string): CategorySeed[] {
  switch (businessType) {
    case 'retail':
      return retailCategories
    case 'restaurant':
      return restaurantCategories
    case 'supermarket':
      return supermarketCategories
    case 'auto_service':
      return autoServicePartCategories
    case 'dealership':
      return dealershipCategories
    default:
      return retailCategories
  }
}
