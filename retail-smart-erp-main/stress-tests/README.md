# Stress Testing Suite

Comprehensive stress testing suite for the Retail Smart POS system.

## Prerequisites

### Required Tools

1. **k6** - Modern load testing tool
   ```bash
   # Windows
   winget install k6

   # macOS
   brew install k6

   # Linux (Debian/Ubuntu)
   sudo gpg -k
   sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
   echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
   sudo apt-get update
   sudo apt-get install k6
   ```

2. **Artillery** (optional, for additional tests)
   ```bash
   npm install -g artillery
   ```

## Quick Start

### 1. Set Environment Variables

```bash
# Required: Your session token (get from browser cookies)
export AUTH_TOKEN="your-session-token"

# Optional: Override default URLs
export BASE_URL="http://localhost:3000"
export WS_URL="ws://localhost:3000"
export TENANT_ID="your-tenant-id"
```

### 2. Run Tests

```bash
# Quick test (30 seconds, low load)
npm run stress:quick

# Full test suite (all tests, ~15-20 minutes)
npm run stress:all

# Specific tests
npm run stress:http      # HTTP API load test
npm run stress:ws        # WebSocket stress test
npm run stress:pos       # POS checkout flow test
npm run stress:spike     # Spike test (sudden traffic surge)
```

## Test Descriptions

### HTTP Load Test (`stress:http`)
Tests all major API endpoints with realistic user behavior patterns:
- Item browsing and search (30%)
- Customer lookup (20%)
- POS checkout flow (15%)
- Work orders (10%)
- Appointments (10%)
- Admin operations (5%)

**Stages:**
1. Warm up: 1 min, ramp to 20 users
2. Ramp up: 3 min, increase to 50 users
3. Sustained: 5 min, hold at 50 users
4. Peak: 3 min, increase to 100 users
5. Hold peak: 2 min
6. Ramp down: 2 min

### WebSocket Stress Test (`stress:ws`)
Tests WebSocket connection handling:
- Connection establishment
- Channel subscription
- Document watching (presence)
- Message latency
- Connection limits

**Stages:**
1. Ramp to 50 connections
2. Increase to 100 connections
3. Peak at 200 connections
4. Sustained connections
5. Ramp down

### POS Checkout Test (`stress:pos`)
Focused test on the critical checkout path:
1. Load items
2. Add to cart
3. Process payment
4. Complete sale

**Thresholds:**
- 95% checkout success rate
- 95% checkouts under 3 seconds
- Cart operations under 500ms

### Spike Test (`stress:spike`)
Tests system behavior under sudden traffic surge:
- Baseline: 10 users
- Spike: Jump to 200 users instantly
- Hold spike: 30 seconds
- Recovery: Back to 10 users

## Getting Your Auth Token

1. Log into your POS application in the browser
2. Open Developer Tools (F12)
3. Go to Application > Cookies
4. Find the cookie named `authjs.session-token`
5. Copy the value

```bash
export AUTH_TOKEN="paste-your-token-here"
```

## Test Results

Results are saved to `stress-tests/results/`:
- `k6-http.json` - HTTP load test results
- `k6-ws.json` - WebSocket test results
- `k6-pos.json` - POS checkout test results
- `artillery-*.json` - Artillery test results

### Viewing Results

```bash
# k6 provides summary in terminal
# For detailed analysis, use k6 cloud or grafana

# Artillery HTML report
npx artillery report stress-tests/results/artillery-http.json
```

## Setting Up Test Data

Before running stress tests, you may want to populate the database with test data:

```bash
# Set your tenant ID
export TENANT_ID="your-tenant-id"

# Run setup script
npm run stress:setup-data
```

This creates:
- 10 categories
- 500 items
- 200 customers
- 30 service types
- 20 vehicle makes
- 200 vehicle models
- 100 vehicles

## Performance Thresholds

### HTTP API
| Metric | Good | Warning | Critical |
|--------|------|---------|----------|
| p95 Response Time | <200ms | 200-500ms | >500ms |
| p99 Response Time | <500ms | 500ms-1s | >1s |
| Error Rate | <1% | 1-5% | >5% |
| Throughput | >100 req/s | 50-100 req/s | <50 req/s |

### WebSocket
| Metric | Good | Warning | Critical |
|--------|------|---------|----------|
| Connection Error Rate | <5% | 5-10% | >10% |
| Message Latency (p95) | <50ms | 50-100ms | >100ms |
| Connection Limit | >200 | 100-200 | <100 |

### POS Checkout
| Metric | Good | Warning | Critical |
|--------|------|---------|----------|
| Success Rate | >95% | 90-95% | <90% |
| Checkout Duration (p95) | <2s | 2-3s | >3s |
| Sales Created/min | >50 | 30-50 | <30 |

## Custom Test Configuration

### Modify k6 Tests

Edit files in `stress-tests/k6/`:

```javascript
// Change load pattern
export const options = {
  stages: [
    { duration: '2m', target: 100 },  // More users
    { duration: '5m', target: 100 },  // Longer duration
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'],  // Stricter threshold
  },
};
```

### Modify Artillery Tests

Edit files in `stress-tests/artillery/`:

```yaml
config:
  phases:
    - duration: 300      # 5 minutes
      arrivalRate: 100   # 100 users/second
```

## Troubleshooting

### "Unauthorized" Errors
- Check that AUTH_TOKEN is set correctly
- Token may have expired (24-hour validity)
- Get a fresh token from browser cookies

### Low Throughput
- Check if database connection pool is exhausted
- Monitor server CPU/memory
- Check for N+1 query issues

### WebSocket Connection Failures
- Verify WebSocket server is running (`npm run dev`, not `npm run dev:next`)
- Check firewall settings
- Monitor server memory for connection limits

### High Latency
- Check database query performance
- Monitor disk I/O
- Consider adding database indexes

## CI/CD Integration

```yaml
# GitHub Actions example
stress-test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v3

    - name: Install k6
      run: |
        sudo gpg -k
        sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
        echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
        sudo apt-get update
        sudo apt-get install k6

    - name: Run stress tests
      env:
        BASE_URL: ${{ secrets.STAGING_URL }}
        AUTH_TOKEN: ${{ secrets.TEST_AUTH_TOKEN }}
      run: npm run stress:quick
```

## Directory Structure

```
stress-tests/
├── artillery/
│   ├── http-load-test.yml       # HTTP API load test
│   └── websocket-load-test.yml  # WebSocket load test
├── k6/
│   ├── comprehensive-load-test.js  # Full API test suite
│   ├── websocket-stress-test.js    # WebSocket connections
│   └── pos-checkout-test.js        # Checkout flow test
├── scripts/
│   ├── run-all-tests.js         # Test runner
│   └── setup-test-data.ts       # Database seeding
├── results/                     # Test output (gitignored)
└── README.md                    # This file
```
