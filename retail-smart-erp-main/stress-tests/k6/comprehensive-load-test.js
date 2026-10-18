/**
 * k6 Comprehensive Load Test
 * Tests all major API endpoints with realistic user behavior
 *
 * Installation:
 *   Windows: winget install k6
 *   macOS: brew install k6
 *   Linux: See https://k6.io/docs/getting-started/installation/
 *
 * Usage:
 *   1. Edit stress-tests/config.json and paste your auth token
 *   2. Run: k6 run stress-tests/k6/comprehensive-load-test.js
 *
 * With more virtual users:
 *   k6 run --vus 100 --duration 5m stress-tests/k6/comprehensive-load-test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const itemsListDuration = new Trend('items_list_duration');
const salesCreateDuration = new Trend('sales_create_duration');
const customersListDuration = new Trend('customers_list_duration');
const successfulSales = new Counter('successful_sales');

// Test configuration
export const options = {
  // Load test stages
  stages: [
    { duration: '1m', target: 20 },   // Warm up: ramp to 20 users
    { duration: '3m', target: 50 },   // Ramp up: increase to 50 users
    { duration: '5m', target: 50 },   // Sustained: hold at 50 users
    { duration: '3m', target: 100 },  // Peak: increase to 100 users
    { duration: '2m', target: 100 },  // Hold peak
    { duration: '2m', target: 0 },    // Ramp down
  ],

  // Performance thresholds
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],  // 95% under 500ms, 99% under 1s
    errors: ['rate<0.1'],                             // Error rate under 10%
    http_req_failed: ['rate<0.05'],                   // HTTP failures under 5%
    items_list_duration: ['p(95)<300'],               // Items list under 300ms
    sales_create_duration: ['p(95)<1000'],            // Sale creation under 1s
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

// Common headers
const headers = {
  'Content-Type': 'application/json',
  'Cookie': `authjs.session-token=${AUTH_TOKEN}`,
};

// Helper function to make authenticated requests
function authGet(url) {
  return http.get(`${BASE_URL}${url}`, { headers });
}

function authPost(url, body) {
  return http.post(`${BASE_URL}${url}`, JSON.stringify(body), { headers });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function authPut(url, body) {
  return http.put(`${BASE_URL}${url}`, JSON.stringify(body), { headers });
}

// Main test function
// eslint-disable-next-line import/no-anonymous-default-export
export default function () {
  // Randomly select a scenario based on realistic usage patterns
  const scenario = Math.random();

  if (scenario < 0.30) {
    browseItemsScenario();
  } else if (scenario < 0.50) {
    browseCustomersScenario();
  } else if (scenario < 0.65) {
    posCheckoutScenario();
  } else if (scenario < 0.75) {
    workOrderScenario();
  } else if (scenario < 0.85) {
    searchScenario();
  } else if (scenario < 0.95) {
    appointmentScenario();
  } else {
    adminScenario();
  }
}

// Scenario: Browse Items (30% of traffic)
function browseItemsScenario() {
  group('Browse Items', function () {
    // List all items
    let res = authGet('/api/items');
    itemsListDuration.add(res.timings.duration);

    let success = check(res, {
      'items list status 200': (r) => r.status === 200,
      'items list has data': (r) => {
        try {
          const data = JSON.parse(r.body);
          return Array.isArray(data);
        } catch {
          return false;
        }
      },
    });

    errorRate.add(!success);
    sleep(1);

    // Get categories
    res = authGet('/api/categories');
    check(res, {
      'categories status 200': (r) => r.status === 200,
    });
    errorRate.add(res.status !== 200);
    sleep(0.5);

    // Search items
    res = authGet('/api/items?search=test');
    check(res, {
      'search items status 200': (r) => r.status === 200,
    });
    errorRate.add(res.status !== 200);
    sleep(1);
  });
}

// Scenario: Browse Customers (20% of traffic)
function browseCustomersScenario() {
  group('Browse Customers', function () {
    let res = authGet('/api/customers');
    customersListDuration.add(res.timings.duration);

    let success = check(res, {
      'customers list status 200': (r) => r.status === 200,
    });
    errorRate.add(!success);
    sleep(1);

    // Search customer
    res = authGet('/api/customers?search=john');
    check(res, {
      'search customers status 200': (r) => r.status === 200,
    });
    errorRate.add(res.status !== 200);
    sleep(0.5);
  });
}

// Scenario: POS Checkout (15% of traffic) - Critical path
function posCheckoutScenario() {
  group('POS Checkout', function () {
    // Step 1: Get items for the cart
    let itemsRes = authGet('/api/items');
    check(itemsRes, {
      'get items for cart': (r) => r.status === 200,
    });

    let items = [];
    try {
      items = JSON.parse(itemsRes.body);
    } catch {
      errorRate.add(true);
      return;
    }

    if (!items.length) {
      sleep(1);
      return;
    }

    sleep(0.5);

    // Step 2: Create a sale
    const item = items[0];
    const salePayload = {
      customerId: null,
      items: [
        {
          itemId: item.id,
          quantity: Math.floor(Math.random() * 3) + 1,
          unitPrice: item.sellingPrice || 100,
        },
      ],
      payments: [
        {
          method: 'cash',
          amount: (item.sellingPrice || 100) * (Math.floor(Math.random() * 3) + 1),
        },
      ],
    };

    let saleRes = authPost('/api/sales', salePayload);
    salesCreateDuration.add(saleRes.timings.duration);

    let success = check(saleRes, {
      'sale created': (r) => r.status === 200 || r.status === 201,
    });

    if (success) {
      successfulSales.add(1);
    }
    errorRate.add(!success);

    sleep(2);
  });
}

// Scenario: Work Orders (10% of traffic)
function workOrderScenario() {
  group('Work Orders', function () {
    // List work orders
    let res = authGet('/api/work-orders');
    check(res, {
      'work orders list status 200': (r) => r.status === 200,
    });
    errorRate.add(res.status !== 200);
    sleep(1);

    // Get vehicles
    res = authGet('/api/vehicles');
    check(res, {
      'vehicles list status 200': (r) => r.status === 200,
    });
    errorRate.add(res.status !== 200);
    sleep(0.5);

    // Get service types
    res = authGet('/api/service-types');
    check(res, {
      'service types status 200': (r) => r.status === 200,
    });
    errorRate.add(res.status !== 200);
    sleep(1);
  });
}

// Scenario: Search (10% of traffic)
function searchScenario() {
  group('Global Search', function () {
    const searchTerms = ['john', 'toyota', 'brake', 'oil', 'test'];
    const term = searchTerms[Math.floor(Math.random() * searchTerms.length)];

    let res = authGet(`/api/search?q=${term}`);
    check(res, {
      'global search status 200': (r) => r.status === 200,
    });
    errorRate.add(res.status !== 200);
    sleep(1);
  });
}

// Scenario: Appointments (10% of traffic)
function appointmentScenario() {
  group('Appointments', function () {
    let res = authGet('/api/appointments');
    check(res, {
      'appointments list status 200': (r) => r.status === 200,
    });
    errorRate.add(res.status !== 200);
    sleep(1);

    // Check for conflicts (common operation)
    const today = new Date().toISOString().split('T')[0];
    res = authGet(`/api/appointments?date=${today}`);
    check(res, {
      'appointments by date status 200': (r) => r.status === 200,
    });
    errorRate.add(res.status !== 200);
    sleep(0.5);
  });
}

// Scenario: Admin/Settings (5% of traffic)
function adminScenario() {
  group('Admin Operations', function () {
    // Activity logs
    let res = authGet('/api/activity-logs');
    check(res, {
      'activity logs status 200': (r) => r.status === 200,
    });
    errorRate.add(res.status !== 200);
    sleep(1);

    // Tenant settings
    res = authGet('/api/tenant');
    check(res, {
      'tenant info status 200': (r) => r.status === 200,
    });
    errorRate.add(res.status !== 200);
    sleep(1);
  });
}

// Lifecycle hooks
export function setup() {
  console.log(`Starting load test against ${BASE_URL}`);
  console.log('Make sure the server is running and AUTH_TOKEN is valid');

  // Verify connectivity
  const res = http.get(`${BASE_URL}/api/items`, { headers });
  if (res.status !== 200) {
    console.warn(`Warning: Initial health check returned status ${res.status}`);
    console.warn('Response:', res.body);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function teardown(data) {
  console.log('Load test completed');
}
