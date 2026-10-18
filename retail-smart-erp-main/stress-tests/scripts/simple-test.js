/**
 * Simple Stress Test using Node.js
 * No external tools required - just run with: node stress-tests/scripts/simple-test.js
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

// Load config
const configPath = path.join(__dirname, '..', 'config.json');
let config;

try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('Config loaded successfully');
  console.log('Auth token length:', config.authToken?.length || 0);
} catch (e) {
  console.error('Failed to load config.json:', e.message);
  process.exit(1);
}

const BASE_URL = config.baseUrl || 'http://localhost:3000';
const AUTH_TOKEN = config.authToken;

if (!AUTH_TOKEN || AUTH_TOKEN === 'PASTE_YOUR_TOKEN_HERE') {
  console.error('ERROR: Please set authToken in stress-tests/config.json');
  process.exit(1);
}

// Test configuration
const CONCURRENT_USERS = parseInt(process.env.USERS) || 10;
const DURATION_SECONDS = parseInt(process.env.DURATION) || 30;
const ENDPOINTS = [
  '/api/items?pageSize=50',          // Paginated - 50 items
  '/api/items?pageSize=50&page=2',   // Page 2
  '/api/customers?pageSize=50',       // Paginated - 50 customers
  '/api/categories',                  // Categories usually small
  '/api/work-orders?pageSize=50',     // Paginated - 50 work orders
  '/api/appointments?pageSize=50',    // Paginated - 50 appointments
];

// Statistics
const stats = {
  requests: 0,
  success: 0,
  failed: 0,
  totalTime: 0,
  times: [],
};

async function makeRequest(endpoint) {
  const start = Date.now();
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `authjs.session-token=${AUTH_TOKEN}`,
      },
    });

    const duration = Date.now() - start;
    stats.requests++;
    stats.totalTime += duration;
    stats.times.push(duration);

    if (response.ok) {
      stats.success++;
    } else {
      stats.failed++;
      if (stats.failed <= 3) {
        console.log(`  [${response.status}] ${endpoint}`);
      }
    }
  } catch (error) {
    stats.failed++;
    stats.requests++;
    if (stats.failed <= 3) {
      console.log(`  [ERROR] ${endpoint}: ${error.message}`);
    }
  }
}

async function runUser(userId, endTime) {
  while (Date.now() < endTime) {
    const endpoint = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
    await makeRequest(endpoint);
    // Small random delay between requests
    await new Promise(r => setTimeout(r, Math.random() * 500 + 100));
  }
}

function calculatePercentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function main() {
  console.log('');
  console.log('═'.repeat(60));
  console.log('  SIMPLE STRESS TEST');
  console.log('═'.repeat(60));
  console.log('');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Users: ${CONCURRENT_USERS}`);
  console.log(`Duration: ${DURATION_SECONDS} seconds`);
  console.log('');

  // First, test a single request
  console.log('Testing connection...');
  const testStart = Date.now();
  try {
    const response = await fetch(`${BASE_URL}/api/items?pageSize=50`, {
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `authjs.session-token=${AUTH_TOKEN}`,
      },
    });
    const testDuration = Date.now() - testStart;

    if (response.ok) {
      const data = await response.json();
      const itemCount = data.data ? data.data.length : (Array.isArray(data) ? data.length : '?');
      const totalItems = data.pagination ? ` (${data.pagination.total} total)` : '';
      console.log(`  [OK] Connected in ${testDuration}ms, loaded ${itemCount} items${totalItems}`);
    } else {
      const text = await response.text();
      console.log(`  [FAIL] Status ${response.status}: ${text.substring(0, 100)}`);
      console.log('');
      console.log('Check if:');
      console.log('  1. Server is running (npm run dev)');
      console.log('  2. Auth token is valid (not expired)');
      console.log('  3. Token is correctly pasted in config.json');
      process.exit(1);
    }
  } catch (error) {
    console.log(`  [FAIL] ${error.message}`);
    console.log('');
    console.log('Make sure the server is running: npm run dev');
    process.exit(1);
  }

  console.log('');
  console.log('Starting load test...');
  console.log('');

  const endTime = Date.now() + (DURATION_SECONDS * 1000);
  const startTime = Date.now();

  // Progress indicator
  const progressInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _remaining = DURATION_SECONDS - elapsed;
    const rps = stats.requests / Math.max(1, elapsed);
    process.stdout.write(`\r  Running... ${elapsed}s/${DURATION_SECONDS}s | Requests: ${stats.requests} | RPS: ${rps.toFixed(1)} | Errors: ${stats.failed}`);
  }, 1000);

  // Start concurrent users
  const users = [];
  for (let i = 0; i < CONCURRENT_USERS; i++) {
    users.push(runUser(i, endTime));
  }

  try {
    await Promise.all(users);
  } finally {
    clearInterval(progressInterval);
  }

  // Calculate statistics
  const duration = (Date.now() - startTime) / 1000;
  const avgTime = stats.totalTime / stats.requests;
  const p50 = calculatePercentile(stats.times, 50);
  const p95 = calculatePercentile(stats.times, 95);
  const p99 = calculatePercentile(stats.times, 99);
  const rps = stats.requests / duration;
  const errorRate = (stats.failed / stats.requests) * 100;

  console.log('\n');
  console.log('═'.repeat(60));
  console.log('  RESULTS');
  console.log('═'.repeat(60));
  console.log('');
  console.log(`  Total Requests:  ${stats.requests}`);
  console.log(`  Successful:      ${stats.success} (${((stats.success / stats.requests) * 100).toFixed(1)}%)`);
  console.log(`  Failed:          ${stats.failed} (${errorRate.toFixed(1)}%)`);
  console.log('');
  console.log(`  Duration:        ${duration.toFixed(1)}s`);
  console.log(`  Requests/sec:    ${rps.toFixed(1)}`);
  console.log('');
  console.log('  Response Times:');
  console.log(`    Average:       ${avgTime.toFixed(0)}ms`);
  console.log(`    Median (p50):  ${p50}ms`);
  console.log(`    p95:           ${p95}ms`);
  console.log(`    p99:           ${p99}ms`);
  console.log('');

  // Evaluation
  console.log('  Evaluation:');
  if (p95 < 500 && errorRate < 5) {
    console.log('    ✓ PASS - System performs well under load');
  } else if (p95 < 1000 && errorRate < 10) {
    console.log('    ~ WARNING - Performance is acceptable but could be improved');
  } else {
    console.log('    ✗ FAIL - System struggles under load');
  }
  console.log('');
}

main().catch(console.error);
