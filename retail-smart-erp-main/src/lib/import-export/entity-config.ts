// Central registry defining how each entity exports/imports
// Adapted from ERPNext's Data Import/Export pattern

export type BusinessType = 'retail' | 'restaurant' | 'supermarket' | 'auto_service'

export interface EntityFieldConfig {
  key: string              // DB column name (camelCase)
  label: string            // Human-readable column header
  type: 'string' | 'number' | 'decimal' | 'boolean' | 'date' | 'datetime' | 'enum' | 'lookup'
  required?: boolean       // For import validation
  unique?: boolean         // For update-mode matching (sku, barcode, email)
  enumValues?: string[]    // Valid values for enum fields
  lookup?: {
    entity: string         // e.g., 'categories'
    matchField: string     // e.g., 'name' — what the user types
    valueField: string     // e.g., 'id' — what gets stored
    table: string          // DB table name for lookup resolution
  }
  exportOnly?: boolean     // Fields shown in export but not imported (id, createdAt)
  importOnly?: boolean     // Fields only relevant during import
  defaultValue?: string    // Default if blank during import
  transform?: 'lowercase' | 'uppercase' | 'trim'
  businessTypes?: BusinessType[]  // If set, field only shown for these business types (omit = all)
}

export interface ChildEntityConfig {
  name: string                  // 'saleItems', 'purchaseItems'
  label: string                 // 'Sale Items', 'Purchase Items'
  parentKey: string             // 'saleId', 'purchaseId'
  fields: EntityFieldConfig[]
}

export interface EntityConfig {
  name: string                        // 'items', 'customers', etc.
  label: string                       // 'Items', 'Customers'
  table: string                       // DB table reference
  permission: string                  // Required permission
  importable: boolean                 // Whether import is supported
  fields: EntityFieldConfig[]
  children?: ChildEntityConfig[]
  uniqueMatchFields?: string[]        // Fields used to match for update mode
}

// ==================== ENTITY CONFIGURATIONS ====================

const itemFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'name', label: 'Name', type: 'string', required: true, transform: 'trim' },
  { key: 'sku', label: 'SKU', type: 'string', unique: true, transform: 'trim' },
  { key: 'barcode', label: 'Barcode', type: 'string', unique: true, transform: 'trim' },
  { key: 'categoryName', label: 'Category', type: 'lookup', lookup: { entity: 'categories', matchField: 'name', valueField: 'id', table: 'categories' } },
  { key: 'costPrice', label: 'Cost Price', type: 'decimal', defaultValue: '0' },
  { key: 'sellingPrice', label: 'Selling Price', type: 'decimal', required: true },
  { key: 'unit', label: 'Unit', type: 'string', defaultValue: 'pcs' },
  { key: 'trackStock', label: 'Track Stock', type: 'boolean', defaultValue: 'true' },
  { key: 'isActive', label: 'Active', type: 'boolean', defaultValue: 'true' },
  { key: 'brand', label: 'Brand', type: 'string' },
  { key: 'oemPartNumber', label: 'OEM Part Number', type: 'string', businessTypes: ['auto_service'] },
  { key: 'supplierPartNumber', label: 'Supplier Part Number', type: 'string', businessTypes: ['auto_service'] },
  { key: 'supplierName', label: 'Supplier', type: 'lookup', lookup: { entity: 'suppliers', matchField: 'name', valueField: 'id', table: 'suppliers' } },
  { key: 'condition', label: 'Condition', type: 'enum', enumValues: ['new', 'refurbished', 'used'], defaultValue: 'new', businessTypes: ['auto_service'] },
  { key: 'weight', label: 'Weight (kg)', type: 'decimal' },
  { key: 'dimensions', label: 'Dimensions', type: 'string' },
  { key: 'warrantyMonths', label: 'Warranty (months)', type: 'number', businessTypes: ['auto_service'] },
  { key: 'leadTimeDays', label: 'Lead Time (days)', type: 'number', businessTypes: ['auto_service'] },
  { key: 'description', label: 'Description', type: 'string' },
  // Compatible models (auto service / dealership)
  // Combined format: "Toyota Corolla 2018-2023; Honda Civic 2020-2025"
  { key: 'compatibleModels', label: 'Compatible Models', type: 'string', importOnly: true, businessTypes: ['auto_service'] },
  // Separate columns (semicolon-separated for multiple): "Toyota; Honda", "Corolla; Civic"
  { key: 'compatibleMake', label: 'Compatible Make', type: 'string', importOnly: true, businessTypes: ['auto_service'] },
  { key: 'compatibleModel', label: 'Compatible Model', type: 'string', importOnly: true, businessTypes: ['auto_service'] },
  { key: 'compatibleYearFrom', label: 'Compatible Year From', type: 'string', importOnly: true, businessTypes: ['auto_service'] },
  { key: 'compatibleYearTo', label: 'Compatible Year To', type: 'string', importOnly: true, businessTypes: ['auto_service'] },
  // Restaurant fields
  { key: 'preparationTime', label: 'Prep Time (min)', type: 'number', businessTypes: ['restaurant'] },
  { key: 'calories', label: 'Calories', type: 'number', businessTypes: ['restaurant'] },
  { key: 'isVegetarian', label: 'Vegetarian', type: 'boolean', defaultValue: 'false', businessTypes: ['restaurant'] },
  { key: 'isVegan', label: 'Vegan', type: 'boolean', defaultValue: 'false', businessTypes: ['restaurant'] },
  { key: 'isGlutenFree', label: 'Gluten Free', type: 'boolean', defaultValue: 'false', businessTypes: ['restaurant'] },
  { key: 'spiceLevel', label: 'Spice Level', type: 'string', businessTypes: ['restaurant'] },
  // Supermarket fields
  { key: 'pluCode', label: 'PLU Code', type: 'string', businessTypes: ['supermarket'] },
  { key: 'shelfLifeDays', label: 'Shelf Life (days)', type: 'number', businessTypes: ['supermarket'] },
  { key: 'storageTemp', label: 'Storage Temp', type: 'string', businessTypes: ['supermarket'] },
  { key: 'expiryDate', label: 'Expiry Date', type: 'date', businessTypes: ['supermarket'] },
  // Timestamps
  { key: 'createdAt', label: 'Created At', type: 'datetime', exportOnly: true },
  { key: 'updatedAt', label: 'Updated At', type: 'datetime', exportOnly: true },
]

const customerFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'name', label: 'Name', type: 'string', required: true, transform: 'trim' },
  { key: 'firstName', label: 'First Name', type: 'string' },
  { key: 'lastName', label: 'Last Name', type: 'string' },
  { key: 'companyName', label: 'Company Name', type: 'string' },
  { key: 'email', label: 'Email', type: 'string', unique: true, transform: 'lowercase' },
  { key: 'phone', label: 'Phone', type: 'string', unique: true, transform: 'trim' },
  { key: 'mobilePhone', label: 'Mobile Phone', type: 'string' },
  { key: 'addressLine1', label: 'Address Line 1', type: 'string' },
  { key: 'addressLine2', label: 'Address Line 2', type: 'string' },
  { key: 'city', label: 'City', type: 'string' },
  { key: 'state', label: 'State', type: 'string' },
  { key: 'postalCode', label: 'Postal Code', type: 'string' },
  { key: 'country', label: 'Country', type: 'string' },
  { key: 'taxId', label: 'Tax ID', type: 'string' },
  { key: 'taxExempt', label: 'Tax Exempt', type: 'boolean', defaultValue: 'false' },
  { key: 'businessType', label: 'Business Type', type: 'enum', enumValues: ['individual', 'company'], defaultValue: 'individual' },
  { key: 'customerType', label: 'Customer Type', type: 'enum', enumValues: ['retail', 'wholesale', 'vip'], defaultValue: 'retail' },
  { key: 'creditLimit', label: 'Credit Limit', type: 'decimal' },
  { key: 'paymentTerms', label: 'Payment Terms', type: 'string' },
  { key: 'balance', label: 'Balance', type: 'decimal', exportOnly: true },
  { key: 'loyaltyPoints', label: 'Loyalty Points', type: 'number', exportOnly: true },
  { key: 'loyaltyTier', label: 'Loyalty Tier', type: 'enum', enumValues: ['bronze', 'silver', 'gold', 'platinum'], exportOnly: true },
  { key: 'notes', label: 'Notes', type: 'string' },
  { key: 'birthday', label: 'Birthday', type: 'date' },
  { key: 'createdAt', label: 'Created At', type: 'datetime', exportOnly: true },
  { key: 'updatedAt', label: 'Updated At', type: 'datetime', exportOnly: true },
]

const supplierFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'name', label: 'Name', type: 'string', required: true, transform: 'trim' },
  { key: 'email', label: 'Email', type: 'string', transform: 'lowercase' },
  { key: 'phone', label: 'Phone', type: 'string', transform: 'trim' },
  { key: 'address', label: 'Address', type: 'string' },
  { key: 'taxId', label: 'Tax ID', type: 'string' },
  { key: 'taxInclusive', label: 'Tax Inclusive', type: 'boolean', defaultValue: 'false' },
  { key: 'balance', label: 'Balance', type: 'decimal', exportOnly: true },
  { key: 'isActive', label: 'Active', type: 'boolean', defaultValue: 'true' },
  { key: 'createdAt', label: 'Created At', type: 'datetime', exportOnly: true },
]

const categoryFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'name', label: 'Name', type: 'string', required: true, unique: true, transform: 'trim' },
  { key: 'isActive', label: 'Active', type: 'boolean', defaultValue: 'true' },
  { key: 'createdAt', label: 'Created At', type: 'datetime', exportOnly: true },
]

const vehicleFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'customerName', label: 'Customer', type: 'lookup', lookup: { entity: 'customers', matchField: 'name', valueField: 'id', table: 'customers' } },
  { key: 'make', label: 'Make', type: 'string', required: true },
  { key: 'model', label: 'Model', type: 'string', required: true },
  { key: 'year', label: 'Year', type: 'number' },
  { key: 'vin', label: 'VIN', type: 'string', unique: true },
  { key: 'licensePlate', label: 'License Plate', type: 'string', unique: true },
  { key: 'color', label: 'Color', type: 'string' },
  { key: 'currentMileage', label: 'Mileage', type: 'number' },
  { key: 'notes', label: 'Notes', type: 'string' },
  { key: 'createdAt', label: 'Created At', type: 'datetime', exportOnly: true },
]

const serviceTypeFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'name', label: 'Name', type: 'string', required: true, transform: 'trim' },
  { key: 'description', label: 'Description', type: 'string' },
  { key: 'groupName', label: 'Group', type: 'lookup', lookup: { entity: 'serviceTypeGroups', matchField: 'name', valueField: 'id', table: 'service_type_groups' } },
  { key: 'defaultHours', label: 'Default Hours', type: 'decimal' },
  { key: 'defaultRate', label: 'Default Rate', type: 'decimal' },
  { key: 'isActive', label: 'Active', type: 'boolean', defaultValue: 'true' },
  { key: 'createdAt', label: 'Created At', type: 'datetime', exportOnly: true },
]

// Export-only entity fields

const saleFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'invoiceNo', label: 'Invoice No', type: 'string', exportOnly: true },
  { key: 'customerName', label: 'Customer', type: 'string', exportOnly: true },
  { key: 'subtotal', label: 'Subtotal', type: 'decimal', exportOnly: true },
  { key: 'discountAmount', label: 'Discount', type: 'decimal', exportOnly: true },
  { key: 'taxAmount', label: 'Tax', type: 'decimal', exportOnly: true },
  { key: 'total', label: 'Total', type: 'decimal', exportOnly: true },
  { key: 'paidAmount', label: 'Paid', type: 'decimal', exportOnly: true },
  { key: 'paymentMethod', label: 'Payment Method', type: 'string', exportOnly: true },
  { key: 'status', label: 'Status', type: 'string', exportOnly: true },
  { key: 'isReturn', label: 'Is Return', type: 'boolean', exportOnly: true },
  { key: 'notes', label: 'Notes', type: 'string', exportOnly: true },
  { key: 'createdAt', label: 'Date', type: 'datetime', exportOnly: true },
]

const saleItemChildFields: EntityFieldConfig[] = [
  { key: 'itemName', label: 'Item Name', type: 'string', exportOnly: true },
  { key: 'quantity', label: 'Quantity', type: 'decimal', exportOnly: true },
  { key: 'unitPrice', label: 'Unit Price', type: 'decimal', exportOnly: true },
  { key: 'discount', label: 'Discount', type: 'decimal', exportOnly: true },
  { key: 'taxAmount', label: 'Tax', type: 'decimal', exportOnly: true },
  { key: 'total', label: 'Total', type: 'decimal', exportOnly: true },
]

const purchaseFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'purchaseNo', label: 'Purchase No', type: 'string', exportOnly: true },
  { key: 'supplierName', label: 'Supplier', type: 'string', exportOnly: true },
  { key: 'subtotal', label: 'Subtotal', type: 'decimal', exportOnly: true },
  { key: 'taxAmount', label: 'Tax', type: 'decimal', exportOnly: true },
  { key: 'total', label: 'Total', type: 'decimal', exportOnly: true },
  { key: 'paidAmount', label: 'Paid', type: 'decimal', exportOnly: true },
  { key: 'status', label: 'Status', type: 'string', exportOnly: true },
  { key: 'notes', label: 'Notes', type: 'string', exportOnly: true },
  { key: 'createdAt', label: 'Date', type: 'datetime', exportOnly: true },
]

const purchaseItemChildFields: EntityFieldConfig[] = [
  { key: 'itemName', label: 'Item Name', type: 'string', exportOnly: true },
  { key: 'quantity', label: 'Quantity', type: 'decimal', exportOnly: true },
  { key: 'unitPrice', label: 'Unit Price', type: 'decimal', exportOnly: true },
  { key: 'tax', label: 'Tax', type: 'decimal', exportOnly: true },
  { key: 'total', label: 'Total', type: 'decimal', exportOnly: true },
]

const purchaseOrderFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'orderNo', label: 'Order No', type: 'string', exportOnly: true },
  { key: 'supplierName', label: 'Supplier', type: 'string', exportOnly: true },
  { key: 'expectedDeliveryDate', label: 'Expected Delivery', type: 'date', exportOnly: true },
  { key: 'subtotal', label: 'Subtotal', type: 'decimal', exportOnly: true },
  { key: 'taxAmount', label: 'Tax', type: 'decimal', exportOnly: true },
  { key: 'total', label: 'Total', type: 'decimal', exportOnly: true },
  { key: 'status', label: 'Status', type: 'string', exportOnly: true },
  { key: 'notes', label: 'Notes', type: 'string', exportOnly: true },
  { key: 'createdAt', label: 'Date', type: 'datetime', exportOnly: true },
]

const workOrderFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'orderNo', label: 'Order No', type: 'string', exportOnly: true },
  { key: 'customerName', label: 'Customer', type: 'string', exportOnly: true },
  { key: 'vehiclePlate', label: 'Vehicle Plate', type: 'string', exportOnly: true },
  { key: 'vehicleDescription', label: 'Vehicle', type: 'string', exportOnly: true },
  { key: 'status', label: 'Status', type: 'string', exportOnly: true },
  { key: 'priority', label: 'Priority', type: 'string', exportOnly: true },
  { key: 'subtotal', label: 'Subtotal', type: 'decimal', exportOnly: true },
  { key: 'taxAmount', label: 'Tax', type: 'decimal', exportOnly: true },
  { key: 'total', label: 'Total', type: 'decimal', exportOnly: true },
  { key: 'assignedToName', label: 'Assigned To', type: 'string', exportOnly: true },
  { key: 'customerComplaint', label: 'Complaint', type: 'string', exportOnly: true },
  { key: 'diagnosis', label: 'Diagnosis', type: 'string', exportOnly: true },
  { key: 'createdAt', label: 'Date', type: 'datetime', exportOnly: true },
]

const workOrderServiceChildFields: EntityFieldConfig[] = [
  { key: 'description', label: 'Service Description', type: 'string', exportOnly: true },
  { key: 'hours', label: 'Hours', type: 'decimal', exportOnly: true },
  { key: 'rate', label: 'Rate', type: 'decimal', exportOnly: true },
  { key: 'amount', label: 'Amount', type: 'decimal', exportOnly: true },
]

const workOrderPartChildFields: EntityFieldConfig[] = [
  { key: 'itemName', label: 'Part Name', type: 'string', exportOnly: true },
  { key: 'quantity', label: 'Quantity', type: 'decimal', exportOnly: true },
  { key: 'unitPrice', label: 'Unit Price', type: 'decimal', exportOnly: true },
  { key: 'discount', label: 'Discount', type: 'decimal', exportOnly: true },
  { key: 'total', label: 'Total', type: 'decimal', exportOnly: true },
]

const stockMovementFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'itemName', label: 'Item', type: 'string', exportOnly: true },
  { key: 'itemSku', label: 'SKU', type: 'string', exportOnly: true },
  { key: 'itemBarcode', label: 'Barcode', type: 'string', exportOnly: true },
  { key: 'itemOemPartNumber', label: 'OEM Part #', type: 'string', exportOnly: true },
  { key: 'warehouseName', label: 'Warehouse', type: 'string', exportOnly: true },
  { key: 'type', label: 'Type', type: 'string', exportOnly: true },
  { key: 'quantity', label: 'Quantity', type: 'decimal', exportOnly: true },
  { key: 'referenceType', label: 'Reference Type', type: 'string', exportOnly: true },
  { key: 'notes', label: 'Notes', type: 'string', exportOnly: true },
  { key: 'createdAt', label: 'Date', type: 'datetime', exportOnly: true },
]

const appointmentFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'customerName', label: 'Customer', type: 'string', exportOnly: true },
  { key: 'vehiclePlate', label: 'Vehicle Plate', type: 'string', exportOnly: true },
  { key: 'vehicleDescription', label: 'Vehicle', type: 'string', exportOnly: true },
  { key: 'serviceName', label: 'Service', type: 'string', exportOnly: true },
  { key: 'scheduledDate', label: 'Date', type: 'date', exportOnly: true },
  { key: 'scheduledTime', label: 'Time', type: 'string', exportOnly: true },
  { key: 'durationMinutes', label: 'Duration (min)', type: 'number', exportOnly: true },
  { key: 'status', label: 'Status', type: 'string', exportOnly: true },
  { key: 'notes', label: 'Notes', type: 'string', exportOnly: true },
  { key: 'createdAt', label: 'Created At', type: 'datetime', exportOnly: true },
]

const activityLogFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'userName', label: 'User', type: 'string', exportOnly: true },
  { key: 'action', label: 'Action', type: 'string', exportOnly: true },
  { key: 'entityType', label: 'Entity Type', type: 'string', exportOnly: true },
  { key: 'entityName', label: 'Entity Name', type: 'string', exportOnly: true },
  { key: 'description', label: 'Description', type: 'string', exportOnly: true },
  { key: 'ipAddress', label: 'IP Address', type: 'string', exportOnly: true },
  { key: 'createdAt', label: 'Date', type: 'datetime', exportOnly: true },
]

const salesOrderFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'orderNo', label: 'Order No', type: 'string', exportOnly: true },
  { key: 'customerName', label: 'Customer', type: 'string', exportOnly: true },
  { key: 'subtotal', label: 'Subtotal', type: 'decimal', exportOnly: true },
  { key: 'taxAmount', label: 'Tax', type: 'decimal', exportOnly: true },
  { key: 'total', label: 'Total', type: 'decimal', exportOnly: true },
  { key: 'status', label: 'Status', type: 'string', exportOnly: true },
  { key: 'notes', label: 'Notes', type: 'string', exportOnly: true },
  { key: 'createdAt', label: 'Date', type: 'datetime', exportOnly: true },
]

const restaurantOrderFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'orderNo', label: 'Order No', type: 'string', exportOnly: true },
  { key: 'orderType', label: 'Type', type: 'string', exportOnly: true },
  { key: 'status', label: 'Status', type: 'string', exportOnly: true },
  { key: 'customerCount', label: 'Customer Count', type: 'number', exportOnly: true },
  { key: 'subtotal', label: 'Subtotal', type: 'decimal', exportOnly: true },
  { key: 'taxAmount', label: 'Tax', type: 'decimal', exportOnly: true },
  { key: 'tipAmount', label: 'Tip', type: 'decimal', exportOnly: true },
  { key: 'total', label: 'Total', type: 'decimal', exportOnly: true },
  { key: 'createdAt', label: 'Date', type: 'datetime', exportOnly: true },
]

const wasteLogFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'itemName', label: 'Item', type: 'string', exportOnly: true },
  { key: 'quantity', label: 'Quantity', type: 'decimal', exportOnly: true },
  { key: 'unit', label: 'Unit', type: 'string', exportOnly: true },
  { key: 'reason', label: 'Reason', type: 'string', exportOnly: true },
  { key: 'costAmount', label: 'Cost', type: 'decimal', exportOnly: true },
  { key: 'notes', label: 'Notes', type: 'string', exportOnly: true },
  { key: 'recordedAt', label: 'Date', type: 'datetime', exportOnly: true },
]

const refundFields: EntityFieldConfig[] = [
  { key: 'id', label: 'ID', type: 'string', exportOnly: true },
  { key: 'saleInvoiceNo', label: 'Return Invoice', type: 'string', exportOnly: true },
  { key: 'originalInvoiceNo', label: 'Original Invoice', type: 'string', exportOnly: true },
  { key: 'amount', label: 'Amount', type: 'decimal', exportOnly: true },
  { key: 'method', label: 'Method', type: 'string', exportOnly: true },
  { key: 'reason', label: 'Reason', type: 'string', exportOnly: true },
  { key: 'createdAt', label: 'Date', type: 'datetime', exportOnly: true },
]

// ==================== ENTITY REGISTRY ====================

export const ENTITY_CONFIGS: Record<string, EntityConfig> = {
  items: {
    name: 'items',
    label: 'Items',
    table: 'items',
    permission: 'manageItems',
    importable: true,
    fields: itemFields,
    uniqueMatchFields: ['sku', 'barcode'],
  },
  customers: {
    name: 'customers',
    label: 'Customers',
    table: 'customers',
    permission: 'manageCustomers',
    importable: true,
    fields: customerFields,
    uniqueMatchFields: ['email', 'phone'],
  },
  suppliers: {
    name: 'suppliers',
    label: 'Suppliers',
    table: 'suppliers',
    permission: 'managePurchases',
    importable: true,
    fields: supplierFields,
    uniqueMatchFields: ['name'],
  },
  categories: {
    name: 'categories',
    label: 'Categories',
    table: 'categories',
    permission: 'manageCategories',
    importable: true,
    fields: categoryFields,
    uniqueMatchFields: ['name'],
  },
  vehicles: {
    name: 'vehicles',
    label: 'Vehicles',
    table: 'vehicles',
    permission: 'manageVehicles',
    importable: true,
    fields: vehicleFields,
    uniqueMatchFields: ['vin', 'licensePlate'],
  },
  'service-types': {
    name: 'service-types',
    label: 'Service Types',
    table: 'service_types',
    permission: 'manageServiceTypes',
    importable: true,
    fields: serviceTypeFields,
    uniqueMatchFields: ['name'],
  },
  sales: {
    name: 'sales',
    label: 'Sales',
    table: 'sales',
    permission: 'viewReports',
    importable: false,
    fields: saleFields,
    children: [
      { name: 'saleItems', label: 'Sale Items', parentKey: 'saleId', fields: saleItemChildFields },
    ],
  },
  purchases: {
    name: 'purchases',
    label: 'Purchases',
    table: 'purchases',
    permission: 'managePurchases',
    importable: false,
    fields: purchaseFields,
    children: [
      { name: 'purchaseItems', label: 'Purchase Items', parentKey: 'purchaseId', fields: purchaseItemChildFields },
    ],
  },
  'purchase-orders': {
    name: 'purchase-orders',
    label: 'Purchase Orders',
    table: 'purchase_orders',
    permission: 'managePurchases',
    importable: false,
    fields: purchaseOrderFields,
  },
  'sales-orders': {
    name: 'sales-orders',
    label: 'Sales Orders',
    table: 'sales_orders',
    permission: 'manageSales',
    importable: false,
    fields: salesOrderFields,
  },
  'work-orders': {
    name: 'work-orders',
    label: 'Work Orders',
    table: 'work_orders',
    permission: 'manageWorkOrders',
    importable: false,
    fields: workOrderFields,
    children: [
      { name: 'workOrderServices', label: 'Services', parentKey: 'workOrderId', fields: workOrderServiceChildFields },
      { name: 'workOrderParts', label: 'Parts', parentKey: 'workOrderId', fields: workOrderPartChildFields },
    ],
  },
  'stock-movements': {
    name: 'stock-movements',
    label: 'Stock Movements',
    table: 'stock_movements',
    permission: 'manageInventory',
    importable: false,
    fields: stockMovementFields,
  },
  appointments: {
    name: 'appointments',
    label: 'Appointments',
    table: 'appointments',
    permission: 'manageAppointments',
    importable: false,
    fields: appointmentFields,
  },
  'activity-logs': {
    name: 'activity-logs',
    label: 'Activity Logs',
    table: 'activity_logs',
    permission: 'viewReports',
    importable: false,
    fields: activityLogFields,
  },
  'restaurant-orders': {
    name: 'restaurant-orders',
    label: 'Restaurant Orders',
    table: 'restaurant_orders',
    permission: 'manageRestaurantOrders',
    importable: false,
    fields: restaurantOrderFields,
  },
  'waste-log': {
    name: 'waste-log',
    label: 'Waste Log',
    table: 'waste_log',
    permission: 'manageItems',
    importable: false,
    fields: wasteLogFields,
  },
  refunds: {
    name: 'refunds',
    label: 'Refunds',
    table: 'refunds',
    permission: 'viewReports',
    importable: false,
    fields: refundFields,
  },
}

// Get entity config by name
export function getEntityConfig(name: string): EntityConfig | undefined {
  return ENTITY_CONFIGS[name]
}

// Get all importable entities
export function getImportableEntities(): EntityConfig[] {
  return Object.values(ENTITY_CONFIGS).filter(c => c.importable)
}

// Get all exportable entities
export function getExportableEntities(): EntityConfig[] {
  return Object.values(ENTITY_CONFIGS)
}

// Get export fields (excludes importOnly fields)
export function getExportFields(config: EntityConfig, businessType?: string): EntityFieldConfig[] {
  return config.fields.filter(f => {
    if (f.importOnly) return false
    if (businessType && f.businessTypes && !f.businessTypes.includes(businessType as BusinessType)) return false
    return true
  })
}

// Get import fields (excludes exportOnly fields)
export function getImportFields(config: EntityConfig, businessType?: string): EntityFieldConfig[] {
  return config.fields.filter(f => {
    if (f.exportOnly) return false
    if (businessType && f.businessTypes && !f.businessTypes.includes(businessType as BusinessType)) return false
    return true
  })
}
