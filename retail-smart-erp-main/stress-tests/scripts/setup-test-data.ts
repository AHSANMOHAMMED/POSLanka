/**
 * Test Data Setup Script - Large Scale
 * Creates massive sample data for stress testing
 *
 * Usage:
 *   npx tsx stress-tests/scripts/setup-test-data.ts
 *
 * Environment variables:
 *   DATABASE_URL  - PostgreSQL connection string (required)
 *   TENANT_ID     - Target tenant ID for test data (required)
 *
 * Optional - Override data amounts:
 *   ITEMS         - Number of items (default: 10000)
 *   CUSTOMERS     - Number of customers (default: 5000)
 *   VEHICLES      - Number of vehicles (default: 3000)
 *   CATEGORIES    - Number of categories (default: 50)
 *   SERVICES      - Number of service types (default: 200)
 *
 * Examples:
 *   # Default (10,000 items, 5,000 customers)
 *   set TENANT_ID=your-tenant-id
 *   npx tsx stress-tests/scripts/setup-test-data.ts
 *
 *   # Custom amounts (50,000 items, 20,000 customers)
 *   set TENANT_ID=your-tenant-id
 *   set ITEMS=50000
 *   set CUSTOMERS=20000
 *   npx tsx stress-tests/scripts/setup-test-data.ts
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  categories,
  items,
  customers,
  serviceTypes,
  vehicles,
  vehicleMakes,
  vehicleModels,
} from '../../src/lib/db/schema';

// Configuration from environment variables
const TENANT_ID = process.env.TENANT_ID || '';

const CONFIG = {
  categories: parseInt(process.env.CATEGORIES || '50'),
  items: parseInt(process.env.ITEMS || '10000'),
  customers: parseInt(process.env.CUSTOMERS || '5000'),
  serviceTypes: parseInt(process.env.SERVICES || '200'),
  vehicleMakes: 50,
  modelsPerMake: 20,
  vehicles: parseInt(process.env.VEHICLES || '3000'),
  batchSize: 500, // Insert in batches for performance
};

// Validation
if (!TENANT_ID) {
  console.error('═'.repeat(60));
  console.error('ERROR: TENANT_ID environment variable is required');
  console.error('═'.repeat(60));
  console.error('');
  console.error('Usage (Windows CMD):');
  console.error('  set TENANT_ID=your-tenant-id');
  console.error('  npx tsx stress-tests/scripts/setup-test-data.ts');
  console.error('');
  console.error('Usage (PowerShell):');
  console.error('  $env:TENANT_ID="your-tenant-id"');
  console.error('  npx tsx stress-tests/scripts/setup-test-data.ts');
  console.error('');
  console.error('With custom amounts:');
  console.error('  set TENANT_ID=your-tenant-id');
  console.error('  set ITEMS=50000');
  console.error('  set CUSTOMERS=20000');
  console.error('  npx tsx stress-tests/scripts/setup-test-data.ts');
  console.error('');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  console.error('Make sure your .env file exists with DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10, // Connection pool size
});

const db = drizzle(pool);

// Progress bar helper
function progressBar(current: number, total: number, label: string): void {
  const percent = Math.floor((current / total) * 100);
  const filled = Math.floor(percent / 2);
  const empty = 50 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  process.stdout.write(`\r  ${label}: [${bar}] ${percent}% (${current}/${total})`);
  if (current === total) console.log('');
}

// Random data generators
const firstNames = [
  'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda',
  'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Nancy', 'Daniel', 'Lisa',
  'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley',
  'Steven', 'Kimberly', 'Paul', 'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle',
  'Kenneth', 'Dorothy', 'Kevin', 'Carol', 'Brian', 'Amanda', 'George', 'Melissa',
  'Edward', 'Deborah', 'Ronald', 'Stephanie', 'Timothy', 'Rebecca', 'Jason', 'Sharon',
  'Nimal', 'Kamal', 'Sunil', 'Anil', 'Saman', 'Chamara', 'Nuwan', 'Prasad',
  'Kumari', 'Sanduni', 'Nimali', 'Dilani', 'Chamini', 'Ishara', 'Tharushi', 'Sachini'
];

const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
  'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Perera', 'Fernando', 'Silva', 'Bandara', 'Jayasuriya', 'Wickramasinghe', 'Rathnayake',
  'Dissanayake', 'Kumara', 'Gunasekara', 'Wijesinghe', 'Samaraweera', 'Herath'
];

const productAdjectives = [
  'Premium', 'Professional', 'Heavy-Duty', 'Standard', 'Economy', 'Deluxe', 'Ultra',
  'Super', 'Max', 'Pro', 'Elite', 'Classic', 'Advanced', 'Basic', 'Essential'
];

const productNouns = [
  'Brake Pad', 'Oil Filter', 'Air Filter', 'Spark Plug', 'Battery', 'Tire', 'Wiper Blade',
  'Headlight', 'Tail Light', 'Mirror', 'Belt', 'Hose', 'Gasket', 'Bearing', 'Seal',
  'Pump', 'Sensor', 'Switch', 'Relay', 'Fuse', 'Cable', 'Connector', 'Mount', 'Bracket',
  'Cover', 'Cap', 'Valve', 'Spring', 'Shock', 'Strut', 'Rotor', 'Caliper', 'Pad Set',
  'Fluid', 'Grease', 'Lubricant', 'Cleaner', 'Polish', 'Wax', 'Sealant', 'Adhesive'
];

const categoryNames = [
  'Brakes', 'Engine Parts', 'Electrical', 'Filters', 'Fluids & Chemicals', 'Body Parts',
  'Suspension', 'Steering', 'Transmission', 'Exhaust', 'Cooling System', 'Fuel System',
  'Ignition', 'Lighting', 'Interior', 'Exterior', 'Wheels & Tires', 'Tools', 'Accessories',
  'Performance Parts', 'OEM Parts', 'Aftermarket', 'Used Parts', 'Rebuilt Parts',
  'Hardware', 'Fasteners', 'Gaskets & Seals', 'Bearings', 'Belts & Hoses', 'Sensors',
  'Switches', 'Relays', 'Fuses', 'Cables', 'Connectors', 'Mounts', 'Brackets', 'Covers',
  'Caps', 'Valves', 'Springs', 'Shocks', 'Struts', 'Rotors', 'Calipers', 'Pads',
  'Batteries', 'Alternators', 'Starters', 'Motors'
];

const vehicleMakeNames = [
  'Toyota', 'Honda', 'Ford', 'Chevrolet', 'BMW', 'Mercedes-Benz', 'Audi', 'Volkswagen',
  'Nissan', 'Hyundai', 'Kia', 'Mazda', 'Subaru', 'Lexus', 'Jeep', 'Dodge', 'Ram',
  'GMC', 'Cadillac', 'Buick', 'Acura', 'Infiniti', 'Volvo', 'Porsche', 'Land Rover',
  'Jaguar', 'Tesla', 'Mitsubishi', 'Suzuki', 'Isuzu', 'Fiat', 'Alfa Romeo', 'Chrysler',
  'Lincoln', 'Genesis', 'Maserati', 'Bentley', 'Rolls-Royce', 'Ferrari', 'Lamborghini',
  'McLaren', 'Aston Martin', 'Peugeot', 'Renault', 'Citroen', 'Skoda', 'Seat', 'Opel',
  'Tata', 'Mahindra'
];

const serviceNames = [
  'Oil Change', 'Brake Service', 'Tire Rotation', 'Wheel Alignment', 'Engine Tune-Up',
  'Transmission Service', 'Coolant Flush', 'Power Steering Flush', 'Fuel System Cleaning',
  'Air Filter Replacement', 'Cabin Filter Replacement', 'Spark Plug Replacement',
  'Battery Replacement', 'Alternator Replacement', 'Starter Replacement', 'Belt Replacement',
  'Hose Replacement', 'Radiator Repair', 'AC Service', 'Heater Repair', 'Electrical Diagnosis',
  'Check Engine Light', 'Brake Pad Replacement', 'Rotor Replacement', 'Caliper Replacement',
  'Shock Replacement', 'Strut Replacement', 'Suspension Repair', 'Steering Repair',
  'Exhaust Repair', 'Muffler Replacement', 'Catalytic Converter', 'Oxygen Sensor',
  'Fuel Pump Replacement', 'Fuel Injector Cleaning', 'Timing Belt', 'Water Pump',
  'Head Gasket', 'Engine Rebuild', 'Transmission Rebuild', 'Clutch Replacement',
  'Differential Service', 'Transfer Case Service', '4WD Service', 'Driveshaft Repair',
  'CV Joint Replacement', 'Axle Replacement', 'Hub Bearing', 'Wheel Bearing',
  'Ball Joint Replacement', 'Tie Rod Replacement', 'Control Arm Replacement',
  'Sway Bar Link', 'Bushing Replacement', 'Mount Replacement', 'Windshield Replacement',
  'Glass Repair', 'Body Work', 'Paint Touch-Up', 'Dent Repair', 'Rust Treatment',
  'Undercoating', 'Detailing', 'Interior Cleaning', 'Exterior Wash', 'Wax & Polish'
];

const colors = ['White', 'Black', 'Silver', 'Gray', 'Red', 'Blue', 'Green', 'Brown', 'Beige', 'Gold'];

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPhone(): string {
  return `+94${Math.floor(Math.random() * 900000000 + 100000000)}`;
}

// Batch insert helper
async function batchInsert<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  records: T[],
  batchSize: number,
  label: string
): Promise<void> {
  const total = records.length;
  let inserted = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    await db.insert(table).values(batch).onConflictDoNothing();
    inserted += batch.length;
    progressBar(inserted, total, label);
  }
}

async function setupTestData() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         LARGE SCALE TEST DATA GENERATOR                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Tenant ID: ${TENANT_ID}`);
  console.log('');
  console.log('Configuration:');
  console.log(`  Categories:     ${CONFIG.categories.toLocaleString()}`);
  console.log(`  Items:          ${CONFIG.items.toLocaleString()}`);
  console.log(`  Customers:      ${CONFIG.customers.toLocaleString()}`);
  console.log(`  Service Types:  ${CONFIG.serviceTypes.toLocaleString()}`);
  console.log(`  Vehicle Makes:  ${CONFIG.vehicleMakes.toLocaleString()}`);
  console.log(`  Vehicle Models: ${(CONFIG.vehicleMakes * CONFIG.modelsPerMake).toLocaleString()}`);
  console.log(`  Vehicles:       ${CONFIG.vehicles.toLocaleString()}`);
  console.log('');
  console.log(`Total records: ~${(
    CONFIG.categories +
    CONFIG.items +
    CONFIG.customers +
    CONFIG.serviceTypes +
    CONFIG.vehicleMakes +
    CONFIG.vehicleMakes * CONFIG.modelsPerMake +
    CONFIG.vehicles
  ).toLocaleString()}`);
  console.log('');
  console.log('─'.repeat(60));

  const startTime = Date.now();

  try {
    // ═══════════════════════════════════════════════════════════
    // CREATE CATEGORIES
    // ═══════════════════════════════════════════════════════════
    console.log('\n📁 Creating categories...');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const categoryRecords: any[] = [];
    const categoryIds: string[] = [];

    for (let i = 0; i < CONFIG.categories; i++) {
      const id = uuidv4();
      categoryIds.push(id);
      const name = i < categoryNames.length
        ? categoryNames[i]
        : `Category ${i + 1}`;

      categoryRecords.push({
        id,
        tenantId: TENANT_ID,
        name,
        description: `${name} - Test category for stress testing`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await batchInsert(categories, categoryRecords, CONFIG.batchSize, 'Categories');

    // ═══════════════════════════════════════════════════════════
    // CREATE ITEMS
    // ═══════════════════════════════════════════════════════════
    console.log('\n📦 Creating items...');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itemRecords: any[] = [];

    for (let i = 0; i < CONFIG.items; i++) {
      const categoryId = categoryIds[i % categoryIds.length];
      const price = Math.floor(Math.random() * 50000) + 100; // 100-50100

      const adj = randomElement(productAdjectives);
      const noun = randomElement(productNouns);
      const variant = Math.floor(i / (productAdjectives.length * productNouns.length)) + 1;
      const name = variant > 1 ? `${adj} ${noun} V${variant}` : `${adj} ${noun}`;

      itemRecords.push({
        id: uuidv4(),
        tenantId: TENANT_ID,
        categoryId,
        name,
        sku: `SKU-${String(i + 1).padStart(6, '0')}`,
        barcode: `${String(i + 1).padStart(13, '0')}`,
        description: `${name} - High quality auto part for stress testing`,
        costPrice: String(Math.floor(price * 0.6)),
        sellingPrice: String(price),
        quantity: Math.floor(Math.random() * 500) + 10,
        reorderLevel: Math.floor(Math.random() * 20) + 5,
        unit: 'pcs',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await batchInsert(items, itemRecords, CONFIG.batchSize, 'Items    ');

    // ═══════════════════════════════════════════════════════════
    // CREATE CUSTOMERS
    // ═══════════════════════════════════════════════════════════
    console.log('\n👥 Creating customers...');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customerRecords: any[] = [];
    const customerIds: string[] = [];

    for (let i = 0; i < CONFIG.customers; i++) {
      const id = uuidv4();
      customerIds.push(id);

      const firstName = randomElement(firstNames);
      const lastName = randomElement(lastNames);
      const suffix = Math.floor(i / (firstNames.length * lastNames.length)) + 1;
      const name = suffix > 1 ? `${firstName} ${lastName} ${suffix}` : `${firstName} ${lastName}`;

      customerRecords.push({
        id,
        tenantId: TENANT_ID,
        name,
        email: `customer${i + 1}@example.com`,
        phone: randomPhone(),
        address: `${Math.floor(Math.random() * 999) + 1} ${randomElement(['Main', 'Oak', 'Park', 'Lake', 'Hill', 'River', 'Galle', 'Kandy', 'Temple'])} Street, ${randomElement(['Colombo', 'Kandy', 'Galle', 'Jaffna', 'Negombo', 'Kurunegala', 'Ratnapura'])}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await batchInsert(customers, customerRecords, CONFIG.batchSize, 'Customers');

    // ═══════════════════════════════════════════════════════════
    // CREATE SERVICE TYPES
    // ═══════════════════════════════════════════════════════════
    console.log('\n🔧 Creating service types...');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const serviceRecords: any[] = [];

    for (let i = 0; i < CONFIG.serviceTypes; i++) {
      const price = Math.floor(Math.random() * 20000) + 500;
      const baseName = i < serviceNames.length ? serviceNames[i] : `Service ${i + 1}`;
      const variant = Math.floor(i / serviceNames.length) + 1;
      const name = variant > 1 ? `${baseName} - Type ${variant}` : baseName;

      serviceRecords.push({
        id: uuidv4(),
        tenantId: TENANT_ID,
        name,
        description: `${name} - Professional auto service`,
        price: String(price),
        estimatedTime: Math.floor(Math.random() * 240) + 15, // 15-255 minutes
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await batchInsert(serviceTypes, serviceRecords, CONFIG.batchSize, 'Services ');

    // ═══════════════════════════════════════════════════════════
    // CREATE VEHICLE MAKES
    // ═══════════════════════════════════════════════════════════
    console.log('\n🚗 Creating vehicle makes...');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const makeRecords: any[] = [];
    const makeIds: string[] = [];

    for (let i = 0; i < CONFIG.vehicleMakes; i++) {
      const id = uuidv4();
      makeIds.push(id);

      const name = i < vehicleMakeNames.length
        ? vehicleMakeNames[i]
        : `Make ${i + 1}`;

      makeRecords.push({
        id,
        name,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await batchInsert(vehicleMakes, makeRecords, CONFIG.batchSize, 'Makes    ');

    // ═══════════════════════════════════════════════════════════
    // CREATE VEHICLE MODELS
    // ═══════════════════════════════════════════════════════════
    console.log('\n🚙 Creating vehicle models...');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modelRecords: any[] = [];
    const modelMap: Map<string, string[]> = new Map();

    for (const makeId of makeIds) {
      const modelIds: string[] = [];
      for (let i = 0; i < CONFIG.modelsPerMake; i++) {
        const id = uuidv4();
        modelIds.push(id);

        modelRecords.push({
          id,
          makeId,
          name: `Model ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) || ''}`,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      modelMap.set(makeId, modelIds);
    }

    await batchInsert(vehicleModels, modelRecords, CONFIG.batchSize, 'Models   ');

    // ═══════════════════════════════════════════════════════════
    // CREATE VEHICLES
    // ═══════════════════════════════════════════════════════════
    console.log('\n🚘 Creating vehicles...');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vehicleRecords: any[] = [];

    for (let i = 0; i < CONFIG.vehicles; i++) {
      const customerId = customerIds[i % customerIds.length];
      const makeId = makeIds[i % makeIds.length];
      const models = modelMap.get(makeId) || [];
      const modelId = models[Math.floor(Math.random() * models.length)];

      vehicleRecords.push({
        id: uuidv4(),
        tenantId: TENANT_ID,
        customerId,
        makeId,
        modelId,
        year: 2010 + Math.floor(Math.random() * 15), // 2010-2024
        licensePlate: `${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        vin: `VIN${String(i + 1).padStart(14, '0')}`,
        color: randomElement(colors),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await batchInsert(vehicles, vehicleRecords, CONFIG.batchSize, 'Vehicles ');

    // ═══════════════════════════════════════════════════════════
    // COMPLETE
    // ═══════════════════════════════════════════════════════════
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '═'.repeat(60));
    console.log('✅ TEST DATA SETUP COMPLETE!');
    console.log('═'.repeat(60));
    console.log('');
    console.log('Summary:');
    console.log(`  Categories:     ${CONFIG.categories.toLocaleString()}`);
    console.log(`  Items:          ${CONFIG.items.toLocaleString()}`);
    console.log(`  Customers:      ${CONFIG.customers.toLocaleString()}`);
    console.log(`  Service Types:  ${CONFIG.serviceTypes.toLocaleString()}`);
    console.log(`  Vehicle Makes:  ${CONFIG.vehicleMakes.toLocaleString()}`);
    console.log(`  Vehicle Models: ${(CONFIG.vehicleMakes * CONFIG.modelsPerMake).toLocaleString()}`);
    console.log(`  Vehicles:       ${CONFIG.vehicles.toLocaleString()}`);
    console.log('');
    console.log(`  Total:          ${(
      CONFIG.categories +
      CONFIG.items +
      CONFIG.customers +
      CONFIG.serviceTypes +
      CONFIG.vehicleMakes +
      CONFIG.vehicleMakes * CONFIG.modelsPerMake +
      CONFIG.vehicles
    ).toLocaleString()} records`);
    console.log('');
    console.log(`  Duration:       ${duration} seconds`);
    console.log('');

  } catch (error) {
    console.error('\n❌ Error setting up test data:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run setup
setupTestData();
