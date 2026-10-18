import { z } from 'zod'
import {
  paginatedSearchSchema,
  paginationSchema,
  uuidSchema,
  optionalUuid,
  shortTextSchema,
} from './common'

// ==================== VEHICLE INVENTORY ====================

// GET /api/vehicle-inventory
export const vehicleInventoryListSchema = paginatedSearchSchema.extend({
  status: z.string().max(50).optional(),
  condition: z.string().max(50).optional(),
})

// POST /api/vehicle-inventory
export const createVehicleInventorySchema = z.object({
  stockNo: z.string().trim().max(100).nullish(),
  vin: z.string().trim().max(50).nullish(),
  makeId: uuidSchema,
  modelId: optionalUuid,
  year: z.coerce.number().int().min(1900).max(2100),
  trim: z.string().trim().max(100).nullish(),
  condition: z.string().max(50).default('used'),
  status: z.string().max(50).default('available'),
  mileage: z.coerce.number().int().min(0).nullish(),
  exteriorColor: z.string().max(100).nullish(),
  interiorColor: z.string().max(100).nullish(),
  transmission: z.string().max(50).nullish(),
  fuelType: z.string().max(50).nullish(),
  engineType: z.string().max(100).nullish(),
  drivetrain: z.string().max(50).nullish(),
  bodyType: z.string().max(50).nullish(),
  purchasePrice: z.coerce.number().min(0).nullish(),
  askingPrice: z.coerce.number().min(0).nullish(),
  minimumPrice: z.coerce.number().min(0).nullish(),
  warehouseId: optionalUuid,
  location: z.string().max(255).nullish(),
  description: z.string().max(5000).nullish(),
  features: z.array(z.string()).default([]),
  photos: z.array(z.string()).default([]),
  purchasedFrom: z.string().max(255).nullish(),
  purchaseDate: z.string().nullish(),
})

// PUT /api/vehicle-inventory/[id]
export const updateVehicleInventorySchema = z.object({
  stockNo: z.string().trim().max(100).nullish(),
  vin: z.string().trim().max(50).nullish(),
  makeId: z.string().uuid().nullish(),
  modelId: z.string().uuid().nullish(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
  trim: z.string().trim().max(100).nullish(),
  condition: z.string().max(50).optional(),
  status: z.string().max(50).optional(),
  mileage: z.coerce.number().int().min(0).nullish(),
  exteriorColor: z.string().max(100).nullish(),
  interiorColor: z.string().max(100).nullish(),
  transmission: z.string().max(50).nullish(),
  fuelType: z.string().max(50).nullish(),
  engineType: z.string().max(100).nullish(),
  drivetrain: z.string().max(50).nullish(),
  bodyType: z.string().max(50).nullish(),
  purchasePrice: z.coerce.number().min(0).nullish(),
  askingPrice: z.coerce.number().min(0).nullish(),
  minimumPrice: z.coerce.number().min(0).nullish(),
  warehouseId: z.string().uuid().nullish(),
  location: z.string().max(255).nullish(),
  description: z.string().max(5000).nullish(),
  features: z.array(z.string()).optional(),
  photos: z.array(z.string()).optional(),
  purchasedFrom: z.string().max(255).nullish(),
  purchaseDate: z.string().nullish(),
  soldDate: z.string().nullish(),
  soldPrice: z.coerce.number().min(0).nullish(),
  saleId: z.string().uuid().nullish(),
  isActive: z.boolean().optional(),
  expectedUpdatedAt: z.string().optional(),
})

// ==================== VEHICLE DOCUMENTS ====================

// GET /api/vehicle-documents
export const vehicleDocumentsListSchema = paginationSchema.extend({
  search: z.string().max(200).optional().default(''),
  vehicleInventoryId: z.string().uuid().optional(),
  vehicleImportId: z.string().uuid().optional(),
  dealerId: z.string().uuid().optional(),
  documentType: z.string().max(100).optional(),
  status: z.string().max(50).optional(),
})

// POST /api/vehicle-documents
export const createVehicleDocumentSchema = z.object({
  vehicleInventoryId: optionalUuid,
  vehicleImportId: optionalUuid,
  dealerId: optionalUuid,
  documentType: z.string().trim().min(1, 'Document type is required').max(100),
  name: z.string().trim().min(1, 'Document name is required').max(255),
  description: z.string().max(1000).nullish(),
  fileUrl: z.string().max(2000).nullish(),
  fileType: z.string().max(100).nullish(),
  fileSize: z.coerce.number().int().min(0).nullish(),
  issueDate: z.string().nullish(),
  expiryDate: z.string().nullish(),
  alertBeforeDays: z.coerce.number().int().min(0).default(30),
  documentNo: z.string().max(100).nullish(),
  issuedBy: z.string().max(255).nullish(),
  status: z.string().max(50).default('valid'),
  notes: z.string().max(5000).nullish(),
})

// PUT /api/vehicle-documents/[id]
export const updateVehicleDocumentSchema = z.object({
  documentType: z.string().trim().min(1).max(100).optional(),
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().max(1000).nullish(),
  fileUrl: z.string().max(2000).nullish(),
  fileType: z.string().max(100).nullish(),
  fileSize: z.coerce.number().int().min(0).nullish(),
  issueDate: z.string().nullish(),
  expiryDate: z.string().nullish(),
  alertBeforeDays: z.coerce.number().int().min(0).nullish(),
  documentNo: z.string().max(100).nullish(),
  issuedBy: z.string().max(255).nullish(),
  status: z.string().max(50).optional(),
  notes: z.string().max(5000).nullish(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

// ==================== VEHICLE INSPECTIONS ====================

// GET /api/vehicle-inspections
export const vehicleInspectionsListSchema = paginationSchema.extend({
  search: z.string().max(200).optional().default(''),
  vehicleInventoryId: z.string().uuid().optional(),
  type: z.string().max(50).optional(),
  status: z.string().max(50).optional(),
})

// POST /api/vehicle-inspections
export const createVehicleInspectionSchema = z.object({
  vehicleInventoryId: optionalUuid,
  type: z.string().trim().min(1, 'Inspection type is required').max(50),
  inspectionDate: z.string().nullish(),
  overallRating: z.string().max(50).nullish(),
  checklist: z.array(z.any()).default([]),
  photos: z.array(z.string()).default([]),
  mileageAtInspection: z.coerce.number().int().min(0).nullish(),
  notes: z.string().max(5000).nullish(),
  status: z.string().max(50).default('draft'),
})

// PUT /api/vehicle-inspections/[id]
export const updateVehicleInspectionSchema = z.object({
  type: z.string().trim().min(1).max(50).optional(),
  inspectionDate: z.string().nullish(),
  overallRating: z.string().max(50).nullish(),
  checklist: z.array(z.any()).optional(),
  photos: z.array(z.string()).optional(),
  mileageAtInspection: z.coerce.number().int().min(0).nullish(),
  notes: z.string().max(5000).nullish(),
  status: z.string().max(50).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

// ==================== VEHICLE IMPORTS ====================

// GET /api/vehicle-imports
export const vehicleImportsListSchema = paginatedSearchSchema.extend({
  status: z.string().max(50).optional(),
  vehicleInventoryId: z.string().uuid().optional(),
})

// POST /api/vehicle-imports
export const createVehicleImportSchema = z.object({
  vehicleInventoryId: optionalUuid,
  supplierId: optionalUuid,
  purchaseOrderId: optionalUuid,
  fobValue: z.coerce.number().min(0).nullish(),
  freightCost: z.coerce.number().min(0).nullish(),
  insuranceCost: z.coerce.number().min(0).nullish(),
  cifValue: z.coerce.number().min(0).nullish(),
  cifCurrency: z.string().max(10).default('USD'),
  exchangeRate: z.coerce.number().min(0).nullish(),
  cifValueLkr: z.coerce.number().min(0).nullish(),
  customsImportDuty: z.coerce.number().min(0).nullish(),
  customsImportDutyRate: z.coerce.number().min(0).nullish(),
  surcharge: z.coerce.number().min(0).nullish(),
  surchargeRate: z.coerce.number().min(0).nullish(),
  exciseDuty: z.coerce.number().min(0).nullish(),
  exciseDutyRate: z.coerce.number().min(0).nullish(),
  luxuryTax: z.coerce.number().min(0).nullish(),
  luxuryTaxRate: z.coerce.number().min(0).nullish(),
  vatAmount: z.coerce.number().min(0).nullish(),
  vatRate: z.coerce.number().min(0).nullish(),
  palCharge: z.coerce.number().min(0).nullish(),
  cessFee: z.coerce.number().min(0).nullish(),
  totalTaxes: z.coerce.number().min(0).nullish(),
  totalLandedCost: z.coerce.number().min(0).nullish(),
  hsCode: z.string().max(50).nullish(),
  engineCapacityCc: z.coerce.number().int().min(0).nullish(),
  enginePowerKw: z.coerce.number().min(0).nullish(),
  importCountry: z.string().max(100).nullish(),
  yearOfManufacture: z.coerce.number().int().min(1900).max(2100).nullish(),
  billOfLadingNo: z.string().max(100).nullish(),
  lcNo: z.string().max(100).nullish(),
  customsDeclarationNo: z.string().max(100).nullish(),
  portOfEntry: z.string().max(255).nullish(),
  arrivalDate: z.string().nullish(),
  clearanceDate: z.string().nullish(),
  registrationNo: z.string().max(50).nullish(),
  status: z.string().max(50).default('pending'),
  notes: z.string().max(5000).nullish(),
  additionalCosts: z.coerce.number().min(0).nullish(),
  additionalCostsBreakdown: z.array(z.any()).default([]),
  documents: z.array(z.any()).default([]),
})

// PUT /api/vehicle-imports/[id]
export const updateVehicleImportSchema = z.object({
  vehicleInventoryId: optionalUuid,
  supplierId: optionalUuid,
  purchaseOrderId: optionalUuid,
  fobValue: z.coerce.number().min(0).nullish(),
  freightCost: z.coerce.number().min(0).nullish(),
  insuranceCost: z.coerce.number().min(0).nullish(),
  cifValue: z.coerce.number().min(0).nullish(),
  cifCurrency: z.string().max(10).nullish(),
  exchangeRate: z.coerce.number().min(0).nullish(),
  cifValueLkr: z.coerce.number().min(0).nullish(),
  customsImportDuty: z.coerce.number().min(0).nullish(),
  customsImportDutyRate: z.coerce.number().min(0).nullish(),
  surcharge: z.coerce.number().min(0).nullish(),
  surchargeRate: z.coerce.number().min(0).nullish(),
  exciseDuty: z.coerce.number().min(0).nullish(),
  exciseDutyRate: z.coerce.number().min(0).nullish(),
  luxuryTax: z.coerce.number().min(0).nullish(),
  luxuryTaxRate: z.coerce.number().min(0).nullish(),
  vatAmount: z.coerce.number().min(0).nullish(),
  vatRate: z.coerce.number().min(0).nullish(),
  palCharge: z.coerce.number().min(0).nullish(),
  cessFee: z.coerce.number().min(0).nullish(),
  totalTaxes: z.coerce.number().min(0).nullish(),
  totalLandedCost: z.coerce.number().min(0).nullish(),
  hsCode: z.string().max(50).nullish(),
  engineCapacityCc: z.coerce.number().int().min(0).nullish(),
  enginePowerKw: z.coerce.number().min(0).nullish(),
  importCountry: z.string().max(100).nullish(),
  yearOfManufacture: z.coerce.number().int().min(1900).max(2100).nullish(),
  billOfLadingNo: z.string().max(100).nullish(),
  lcNo: z.string().max(100).nullish(),
  customsDeclarationNo: z.string().max(100).nullish(),
  portOfEntry: z.string().max(255).nullish(),
  arrivalDate: z.string().nullish(),
  clearanceDate: z.string().nullish(),
  registrationNo: z.string().max(50).nullish(),
  status: z.string().max(50).optional(),
  notes: z.string().max(5000).nullish(),
  additionalCosts: z.coerce.number().min(0).nullish(),
  additionalCostsBreakdown: z.array(z.any()).optional(),
  documents: z.array(z.any()).optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

// POST /api/vehicle-imports/[id]/calculate-tax
export const calculateImportTaxSchema = z.object({
  fobValue: z.coerce.number().min(0).optional(),
  freightCost: z.coerce.number().min(0).optional(),
  insuranceCost: z.coerce.number().min(0).optional(),
  exchangeRate: z.coerce.number().min(0).optional(),
  engineCapacityCc: z.coerce.number().int().min(0).optional(),
  enginePowerKw: z.coerce.number().min(0).optional(),
  fuelType: z.enum(['petrol', 'diesel', 'hybrid', 'electric']).default('petrol'),
  vehicleType: z.enum(['car', 'suv', 'van', 'truck', 'bus', 'motorcycle']).default('car'),
  condition: z.enum(['new', 'used']).default('new'),
  yearOfManufacture: z.coerce.number().int().min(1900).max(2100).optional(),
  overrides: z.record(z.string(), z.any()).optional(),
})

// ==================== VEHICLE MAKES ====================

// POST /api/vehicle-makes
export const createVehicleMakeSchema = z.object({
  name: shortTextSchema,
  country: z.string().max(100).nullish(),
})

// PUT /api/vehicle-makes/[id]
export const updateVehicleMakeSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  country: z.string().max(100).nullish(),
  isActive: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

// ==================== VEHICLE MODELS ====================

// GET /api/vehicle-models
export const vehicleModelsListSchema = z.object({
  makeId: z.string().uuid().optional(),
})

// POST /api/vehicle-models
export const createVehicleModelSchema = z.object({
  name: shortTextSchema,
  makeId: uuidSchema,
})

// PUT /api/vehicle-models/[id]
export const updateVehicleModelSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  makeId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

// ==================== VEHICLE EXPENSES ====================

// GET /api/vehicle-expenses
export const vehicleExpensesListSchema = paginationSchema.extend({
  vehicleInventoryId: z.string().uuid().optional(),
  category: z.string().max(100).optional(),
})

// POST /api/vehicle-expenses
export const createVehicleExpenseSchema = z.object({
  vehicleInventoryId: uuidSchema,
  category: z.string().trim().min(1, 'Category is required').max(100),
  description: z.string().max(1000).nullish(),
  amount: z.coerce.number().positive('Amount must be greater than zero'),
  vendorName: z.string().max(255).nullish(),
  supplierId: optionalUuid,
  receiptNo: z.string().max(100).nullish(),
  expenseDate: z.string().nullish(),
  isCapitalized: z.boolean().default(true),
  notes: z.string().max(5000).nullish(),
})

// PUT /api/vehicle-expenses/[id]
export const updateVehicleExpenseSchema = z.object({
  category: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(1000).nullish(),
  amount: z.coerce.number().positive().optional(),
  vendorName: z.string().max(255).nullish(),
  supplierId: optionalUuid,
  receiptNo: z.string().max(100).nullish(),
  expenseDate: z.string().nullish(),
  isCapitalized: z.boolean().optional(),
  notes: z.string().max(5000).nullish(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

// ==================== VEHICLE WARRANTIES ====================

// GET /api/vehicle-warranties
export const vehicleWarrantiesListSchema = paginationSchema.extend({
  status: z.string().max(50).optional(),
  vehicleInventoryId: z.string().uuid().optional(),
})

// POST /api/vehicle-warranties
export const createVehicleWarrantySchema = z.object({
  saleId: uuidSchema,
  vehicleInventoryId: uuidSchema,
  warrantyType: z.string().trim().min(1, 'Warranty type is required').max(100),
  provider: z.string().max(255).nullish(),
  policyNumber: z.string().max(100).nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  mileageLimit: z.coerce.number().int().min(0).nullish(),
  coverageDetails: z.string().max(5000).nullish(),
  price: z.coerce.number().min(0).nullish(),
})

// PUT /api/vehicle-warranties/[id]
export const updateVehicleWarrantySchema = z.object({
  warrantyType: z.string().trim().min(1).max(100).optional(),
  provider: z.string().max(255).nullish(),
  policyNumber: z.string().max(100).nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  mileageLimit: z.coerce.number().int().min(0).nullish(),
  coverageDetails: z.string().max(5000).nullish(),
  price: z.coerce.number().min(0).nullish(),
  status: z.string().max(50).optional(),
  isActive: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, { message: 'At least one field must be provided' })

// ==================== VEHICLE SALES ====================

// GET /api/vehicle-sales
export const vehicleSalesListSchema = paginatedSearchSchema.extend({
  customerId: z.string().uuid().optional(),
  vehicleInventoryId: z.string().uuid().optional(),
})

// POST /api/vehicle-sales
export const createVehicleSaleSchema = z.object({
  vehicleInventoryId: uuidSchema,
  customerId: optionalUuid,
  askingPrice: z.coerce.number().positive('Asking price must be greater than zero'),
  tradeInAllowance: z.coerce.number().min(0).default(0),
  downPayment: z.coerce.number().min(0).default(0),
  financingOptionId: optionalUuid,
  financeAmount: z.coerce.number().min(0).nullish(),
  monthlyPayment: z.coerce.number().min(0).nullish(),
  loanTermMonths: z.coerce.number().int().min(0).nullish(),
  interestRate: z.coerce.number().min(0).nullish(),
  salespersonId: optionalUuid,
  commissionAmount: z.coerce.number().min(0).nullish(),
  warrantyType: z.string().max(100).nullish(),
  warrantyMonths: z.coerce.number().int().min(0).nullish(),
  warrantyMileage: z.coerce.number().int().min(0).nullish(),
  warrantyPrice: z.coerce.number().min(0).nullish(),
  taxAmount: z.coerce.number().min(0).default(0),
  notes: z.string().max(5000).nullish(),
  deliveryDate: z.string().nullish(),
  deliveryNotes: z.string().max(5000).nullish(),
})

// ==================== SERVICE VEHICLES ====================

// GET /api/vehicles (service vehicles)
export const vehiclesListSchema = paginatedSearchSchema.extend({
  customerId: z.string().uuid().optional(),
})

// POST /api/vehicles
export const createVehicleSchema = z.object({
  customerId: optionalUuid,
  vehicleTypeId: optionalUuid,
  make: z.string().trim().min(1, 'Make is required').max(100),
  model: z.string().trim().min(1, 'Model is required').max(100),
  year: z.coerce.number().int().min(1900).max(2100).nullish(),
  vin: z.string().trim().max(50).nullish(),
  licensePlate: z.string().trim().max(50).nullish(),
  color: z.string().max(50).nullish(),
  currentMileage: z.coerce.number().int().min(0).nullish(),
  notes: z.string().max(5000).nullish(),
})

// PUT /api/vehicles/[id]
export const updateVehicleSchema = z.object({
  customerId: optionalUuid,
  vehicleTypeId: optionalUuid,
  make: z.string().trim().min(1, 'Make is required').max(100),
  model: z.string().trim().min(1, 'Model is required').max(100),
  year: z.coerce.number().int().min(1900).max(2100).nullish(),
  vin: z.string().trim().max(50).nullish(),
  licensePlate: z.string().trim().max(50).nullish(),
  color: z.string().max(50).nullish(),
  currentMileage: z.coerce.number().int().min(0).nullish(),
  notes: z.string().max(5000).nullish(),
  expectedUpdatedAt: z.string().optional(),
})

// ==================== VEHICLE DOCUMENTS EXPIRING ====================

// GET /api/vehicle-documents/expiring
export const vehicleDocumentsExpiringSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
})

// ==================== VEHICLE SALES DETAIL ====================

// PUT /api/vehicle-sales/[id]
export const updateVehicleSaleDetailSchema = z.object({
  deliveryDate: z.string().nullish(),
  deliveryNotes: z.string().max(5000).nullish(),
  warrantyType: z.string().max(100).nullish(),
  warrantyMonths: z.coerce.number().int().min(0).nullish(),
  warrantyMileage: z.coerce.number().int().min(0).nullish(),
  warrantyPrice: z.coerce.number().min(0).nullish(),
  commissionAmount: z.coerce.number().min(0).nullish(),
})

// ==================== VEHICLE TYPES ====================

// POST /api/vehicle-types (union: seed-defaults action OR create new type)
const seedDefaultsSchema = z.object({
  action: z.literal('seed-defaults'),
})

const createVehicleTypeBodySchema = z.object({
  name: shortTextSchema,
  bodyType: z.string().trim().min(1, 'Body type is required').max(100),
  description: z.string().max(1000).optional(),
  wheelCount: z.coerce.number().int().min(1).max(20).optional(),
})

export const createVehicleTypeSchema = z.union([
  seedDefaultsSchema,
  createVehicleTypeBodySchema,
])

// PUT /api/vehicle-types/[id]
export const updateVehicleTypeSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  bodyType: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  wheelCount: z.coerce.number().int().min(1).max(20).optional(),
  isActive: z.boolean().optional(),
})

// ==================== VEHICLE TYPE DIAGRAM VIEWS ====================

// POST /api/vehicle-types/[id]/diagram-views
export const createDiagramViewSchema = z.object({
  viewName: z.string().trim().min(1, 'View name is required').max(100),
  imageUrl: z.string().max(2000).nullish(),
  imageWidth: z.coerce.number().int().min(0).nullish(),
  imageHeight: z.coerce.number().int().min(0).nullish(),
  sortOrder: z.coerce.number().int().min(0).optional(),
})
