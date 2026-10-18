/**
 * k6 POS Checkout Flow Stress Test
 * Focused test on the critical checkout path
 *
 * This test simulates realistic POS usage:
 * 1. Cashier opens POS
 * 2. Searches/browses items
 * 3. Adds items to cart
 * 4. Optionally searches customer
 * 5. Processes payment
 * 6. Completes sale
 *
 * Usage:
 *   1. Edit stress-tests/config.json and paste your auth token
 *   2. Run: k6 run stress-tests/k6/pos-checkout-test.js
 *
 * For spike testing:
 *   k6 run -e SPIKE_TEST=true stress-tests/k6/pos-checkout-test.js
 */

import http from 'k6/http';
import { check, sleep, group, fail } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const checkoutDuration = new Trend('checkout_duration_ms');
const checkoutSuccess = new Rate('checkout_success_rate');
const salesCreated = new Counter('sales_created');
const cartAddDuration = new Trend('cart_add_duration_ms');
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const paymentDuration = new Trend('payment_duration_ms');

// Determine test type
const isSpikeTest = __ENV.SPIKE_TEST === 'true';

export const options = isSpikeTest
  ? {
      // Spike test configuration
      stages: [
        { duration: '10s', target: 10 },   // Baseline
        { duration: '10s', target: 200 },  // Spike!
        { duration: '30s', target: 200 },  // Hold spike
        { duration: '10s', target: 10 },   // Recovery
        { duration: '30s', target: 10 },   // Baseline again
      ],
      thresholds: {
        checkout_success_rate: ['rate>0.8'],  // 80% success during spike
        http_req_duration: ['p(95)<2000'],    // 95% under 2s during spike
      },
    }
  : {
      // Normal load test configuration
      stages: [
        { duration: '1m', target: 10 },   // Warm up
        { duration: '3m', target: 30 },   // Typical load (30 concurrent cashiers)
        { duration: '5m', target: 30 },   // Sustained
        { duration: '2m', target: 50 },   // Busy period
        { duration: '3m', target: 50 },   // Hold busy
        { duration: '1m', target: 10 },   // Cool down
      ],
      thresholds: {
        checkout_success_rate: ['rate>0.95'],    // 95% checkout success
        checkout_duration_ms: ['p(95)<3000'],    // 95% checkouts under 3s
        cart_add_duration_ms: ['p(95)<500'],     // Cart operations under 500ms
        payment_duration_ms: ['p(95)<1000'],     // Payment under 1s
        http_req_failed: ['rate<0.01'],          // Less than 1% failures
      },
    };

// Load config from file (path relative to this script)
const configFile = open('../config.json');
const config = JSON.parse(configFile);

console.log('Config loaded. Auth token length:', config.authToken ? config.authToken.length : 0);

// Environment variables override config file
const BASE_URL = __ENV.BASE_URL || config.baseUrl || 'http://localhost:3000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || config.authToken;

if (!AUTH_TOKEN || AUTH_TOKEN === 'PASTE_YOUR_TOKEN_HERE') {
  console.error('ERROR: Please set authToken in stress-tests/config.json');
}

const headers = {
  'Content-Type': 'application/json',
  'Cookie': `authjs.session-token=${AUTH_TOKEN}`,
};

// Helper functions
function authGet(url) {
  return http.get(`${BASE_URL}${url}`, { headers });
}

function authPost(url, body) {
  return http.post(`${BASE_URL}${url}`, JSON.stringify(body), { headers });
}

// Main checkout flow
// eslint-disable-next-line import/no-anonymous-default-export
export default function () {
  const startTime = Date.now();
  let checkoutSuccessful = false;

  group('Complete POS Checkout', function () {
    // Step 1: Load items (simulating POS page load)
    group('1. Load POS Items', function () {
      const itemsRes = authGet('/api/items');

      if (!check(itemsRes, { 'items loaded': (r) => r.status === 200 })) {
        fail('Failed to load items');
        return;
      }

      let items;
      try {
        items = JSON.parse(itemsRes.body);
      } catch {
        fail('Failed to parse items');
        return;
      }

      if (!items || items.length === 0) {
        console.log('No items available for sale');
        return;
      }

      // Store items in execution context for later use
      __ENV._items = JSON.stringify(items);
    });

    // Step 2: Load categories (typical user behavior)
    group('2. Load Categories', function () {
      const catRes = authGet('/api/categories');
      check(catRes, { 'categories loaded': (r) => r.status === 200 });
      sleep(0.3);
    });

    // Step 3: Simulate item selection (thinking time)
    sleep(1);

    // Step 4: Build cart and create sale
    group('3. Process Sale', function () {
      let items;
      try {
        items = JSON.parse(__ENV._items || '[]');
      } catch {
        items = [];
      }

      if (items.length === 0) {
        return;
      }

      // Select 1-3 random items
      const numItems = Math.floor(Math.random() * 3) + 1;
      const cartItems = [];
      let totalAmount = 0;

      for (let i = 0; i < numItems && i < items.length; i++) {
        const item = items[Math.floor(Math.random() * items.length)];
        const quantity = Math.floor(Math.random() * 3) + 1;
        const price = parseFloat(item.sellingPrice) || 100;

        cartItems.push({
          itemId: item.id,
          quantity: quantity,
          unitPrice: price,
        });

        totalAmount += price * quantity;
      }

      // Determine payment method (80% cash, 20% card)
      const paymentMethod = Math.random() < 0.8 ? 'cash' : 'card';

      const salePayload = {
        customerId: null,
        items: cartItems,
        payments: [
          {
            method: paymentMethod,
            amount: totalAmount,
          },
        ],
      };

      const cartStart = Date.now();
      const saleRes = authPost('/api/sales', salePayload);
      cartAddDuration.add(Date.now() - cartStart);

      checkoutSuccessful = check(saleRes, {
        'sale created successfully': (r) => r.status === 200 || r.status === 201,
      });

      if (checkoutSuccessful) {
        salesCreated.add(1);
      } else {
        console.log(`Sale failed: ${saleRes.status} - ${saleRes.body}`);
      }
    });
  });

  // Record metrics
  const duration = Date.now() - startTime;
  checkoutDuration.add(duration);
  checkoutSuccess.add(checkoutSuccessful);

  // Think time between checkouts (simulating next customer)
  sleep(Math.random() * 3 + 2); // 2-5 seconds
}

// Scenario: Checkout with customer lookup
export function checkoutWithCustomer() {
  group('Checkout with Customer', function () {
    // Search for customer
    const customerRes = authGet('/api/customers?search=john');
    check(customerRes, { 'customer search': (r) => r.status === 200 });

    let customerId = null;
    try {
      const customers = JSON.parse(customerRes.body);
      if (customers.length > 0) {
        customerId = customers[0].id;
      }
    } catch {
      // No customer found
    }

    // Get items
    const itemsRes = authGet('/api/items');
    let items = [];
    try {
      items = JSON.parse(itemsRes.body);
    } catch {
      return;
    }

    if (items.length === 0) return;

    // Create sale with customer
    const item = items[0];
    const salePayload = {
      customerId: customerId,
      items: [
        {
          itemId: item.id,
          quantity: 1,
          unitPrice: parseFloat(item.sellingPrice) || 100,
        },
      ],
      payments: [
        {
          method: 'cash',
          amount: parseFloat(item.sellingPrice) || 100,
        },
      ],
    };

    const saleRes = authPost('/api/sales', salePayload);
    check(saleRes, {
      'sale with customer created': (r) => r.status === 200 || r.status === 201,
    });
  });

  sleep(3);
}

// Scenario: Held sale flow
export function heldSaleFlow() {
  group('Held Sale Flow', function () {
    // Create a held sale
    const itemsRes = authGet('/api/items');
    let items = [];
    try {
      items = JSON.parse(itemsRes.body);
    } catch {
      return;
    }

    if (items.length === 0) return;

    const item = items[0];
    const heldSalePayload = {
      customerId: null,
      items: [
        {
          itemId: item.id,
          quantity: 2,
          unitPrice: parseFloat(item.sellingPrice) || 100,
        },
      ],
      note: `Test held sale ${Date.now()}`,
    };

    const createRes = authPost('/api/held-sales', heldSalePayload);
    const created = check(createRes, {
      'held sale created': (r) => r.status === 200 || r.status === 201,
    });

    if (!created) return;

    sleep(2);

    // List held sales
    const listRes = authGet('/api/held-sales');
    check(listRes, {
      'held sales listed': (r) => r.status === 200,
    });

    sleep(1);
  });
}

// Lifecycle hooks
export function setup() {
  console.log('='.repeat(50));
  console.log('POS Checkout Stress Test');
  console.log('='.repeat(50));
  console.log(`Target: ${BASE_URL}`);
  console.log(`Test type: ${isSpikeTest ? 'SPIKE TEST' : 'LOAD TEST'}`);
  console.log('');

  // Verify API is accessible
  const res = http.get(`${BASE_URL}/api/items`, { headers });
  if (res.status !== 200) {
    console.error(`WARNING: API health check failed with status ${res.status}`);
  } else {
    try {
      const items = JSON.parse(res.body);
      console.log(`Found ${items.length} items for testing`);
    } catch {
      console.error('WARNING: Could not parse items response');
    }
  }

  console.log('='.repeat(50));
}

export function teardown() {
  console.log('');
  console.log('='.repeat(50));
  console.log('Test completed!');
  console.log('='.repeat(50));
}
