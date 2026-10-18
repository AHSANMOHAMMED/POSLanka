import * as dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './src/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

// Load environment variables
dotenv.config({ path: '.env.local' });

async function createFirstCompany() {
  try {
    console.log('DATABASE_URL_ADMIN:', process.env.DATABASE_URL_ADMIN);
    
    if (!process.env.DATABASE_URL_ADMIN) {
      throw new Error('DATABASE_URL_ADMIN not set');
    }
    
    // Create admin pool
    const adminPool = new Pool({
      connectionString: process.env.DATABASE_URL_ADMIN,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    
    const adminDb = drizzle(adminPool, { schema });
    
    console.log('\n=== CREATING FIRST COMPANY ===\n');
    
    // Get user's account
    const account = await adminDb.query.accounts.findFirst({
      where: eq(schema.accounts.email, 'ravindu2012@hotmail.com'),
    });
    
    if (!account) {
      console.log('Account not found. Creating account first...');
      
      // Create account if it doesn't exist
      const passwordHash = await bcrypt.hash('password123', 10);
      const [newAccount] = await adminDb.insert(schema.accounts).values({
        email: 'ravindu2012@hotmail.com',
        fullName: 'Ravindu Gajanayaka',
        passwordHash,
        emailVerified: true,
        isSuperAdmin: false,
        phone: '+94123456789',
      }).returning();
      
      console.log('Created account:', newAccount.email);
    } else {
      console.log('Found account:', account.email);
    }
    
    // Check if tenant already exists
    const existingTenant = await adminDb.query.tenants.findFirst({
      where: eq(schema.tenants.slug, 'gajanayakaenterprises'),
    });
    
    if (existingTenant) {
      console.log('Tenant already exists:', existingTenant.name);
      console.log('Status:', existingTenant.status);
      return;
    }
    
    // Create tenant
    const now = new Date();
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14); // 14-day trial
    
    console.log('Creating tenant "gajanayakaenterprises"...');
    
    // Get trial tier
    const trialTier = await adminDb.query.pricingTiers.findFirst({
      where: eq(schema.pricingTiers.name, 'trial'),
    });
    
    if (!trialTier) {
      console.log('Warning: Trial tier not found. Creating one...');
      const [newTier] = await adminDb.insert(schema.pricingTiers).values({
        name: 'trial',
        displayName: 'Trial',
        priceMonthly: '0',
        priceYearly: '0',
        currency: 'USD',
        maxDatabaseBytes: 1073741824, // 1GB
        maxFileStorageBytes: 5368709120, // 5GB
        maxUsers: null,
        maxSalesMonthly: null,
        isActive: true,
        features: {},
        sortOrder: 0,
      }).returning();
      console.log('Created trial tier');
    }
    
    const result = await adminDb.transaction(async (tx) => {
      // Create tenant
      const [tenant] = await tx.insert(schema.tenants).values({
        name: 'Gajanayaka Enterprises',
        slug: 'gajanayakaenterprises',
        email: 'ravindu2012@hotmail.com',
        phone: null,
        address: null,
        businessType: 'retail',
        country: 'LK',
        currency: 'LKR',
        dateFormat: 'DD/MM/YYYY',
        timeFormat: '24h',
        primaryOwnerId: account?.id || 'unknown',
        plan: 'trial',
        planExpiresAt: trialEndsAt,
        status: 'active',
      }).returning();
      
      console.log('Created tenant:', tenant.name, `(${tenant.slug})`);
      
      // Set tenant context for RLS
      await tx.execute(`SELECT set_config('app.tenant_id', '${tenant.id}', true)`);
      
      // Create subscription with trial
      if (trialTier) {
        await tx.insert(schema.subscriptions).values({
          tenantId: tenant.id,
          billingAccountId: account?.id || 'unknown',
          tierId: trialTier.id,
          status: 'trial',
          trialEndsAt,
          currentPeriodStart: now,
          currentPeriodEnd: trialEndsAt,
          billingCycle: 'monthly',
        });
        console.log('Created trial subscription');
      }
      
      // Create account-tenant membership
      await tx.insert(schema.accountTenants).values({
        accountId: account?.id || 'unknown',
        tenantId: tenant.id,
        role: 'owner',
        isOwner: true,
        acceptedAt: now,
        isActive: true,
      });
      console.log('Created account-tenant membership');
      
      // Create user in tenant
      await tx.insert(schema.users).values({
        tenantId: tenant.id,
        accountId: account?.id || 'unknown',
        email: account?.email || 'ravindu2012@hotmail.com',
        fullName: account?.fullName || 'Ravindu Gajanayaka',
        passwordHash: account?.passwordHash || '',
        role: 'owner',
        isActive: true,
      });
      console.log('Created user in tenant');
      
      // Initialize tenant usage
      await tx.insert(schema.tenantUsage).values({
        tenantId: tenant.id,
        storageBytes: 0,
        fileStorageBytes: 0,
      }).onConflictDoNothing();
      console.log('Initialized tenant usage');
      
      return tenant;
    });
    
    console.log('\n✅ SUCCESS: Company created successfully!');
    console.log(`Name: ${result.name}`);
    console.log(`Slug: ${result.slug}`);
    console.log(`Status: ${result.status}`);
    console.log(`Access URL: http://${result.slug}.localhost:3000/dashboard`);
    console.log('\nYou can now access your company at:');
    console.log(`- http://gajanayakaenterprises.localhost:3000`);
    console.log(`- Or from your account page at: http://localhost:3000/account`);
    
  } catch (error) {
    console.error('Error:', error);
    console.error('\n❌ FAILED to create company. Error details above.');
  } finally {
    process.exit(0);
  }
}

createFirstCompany();