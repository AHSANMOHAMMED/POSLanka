#!/usr/bin/env node

/**
 * Stress Test Runner Script
 * Runs all stress tests in sequence with proper configuration
 *
 * Usage:
 *   node stress-tests/scripts/run-all-tests.js
 *
 * Options:
 *   --quick     Run quick tests only (reduced duration)
 *   --http      Run HTTP tests only
 *   --ws        Run WebSocket tests only
 *   --pos       Run POS checkout tests only
 *   --spike     Run spike test
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execSync, spawn } = require('child_process');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');

// Configuration
const CONFIG = {
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  wsUrl: process.env.WS_URL || 'ws://localhost:3000',
  authToken: process.env.AUTH_TOKEN || '',
  tenantId: process.env.TENANT_ID || '',
  outputDir: path.join(__dirname, '..', 'results'),
};

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  quick: args.includes('--quick'),
  httpOnly: args.includes('--http'),
  wsOnly: args.includes('--ws'),
  posOnly: args.includes('--pos'),
  spike: args.includes('--spike'),
};

// Ensure output directory exists
if (!fs.existsSync(CONFIG.outputDir)) {
  fs.mkdirSync(CONFIG.outputDir, { recursive: true });
}

// Check for required tools
function checkTools() {
  console.log('Checking required tools...\n');

  const tools = [
    { name: 'k6', check: 'k6 version', install: 'winget install k6 (Windows) or brew install k6 (macOS)' },
    { name: 'artillery', check: 'npx artillery version', install: 'npm install -g artillery' },
  ];

  const missing = [];

  for (const tool of tools) {
    try {
      execSync(tool.check, { stdio: 'pipe' });
      console.log(`  [OK] ${tool.name}`);
    } catch {
      console.log(`  [MISSING] ${tool.name} - Install with: ${tool.install}`);
      missing.push(tool.name);
    }
  }

  console.log('');

  if (missing.length > 0) {
    console.log('Some tools are missing. Install them to run all tests.');
    console.log('Continuing with available tools...\n');
  }

  return missing;
}

// Run a command and stream output
function runCommand(command, description) {
  return new Promise((resolve, reject) => {
    console.log('='.repeat(60));
    console.log(`Running: ${description}`);
    console.log('='.repeat(60));
    console.log(`Command: ${command}\n`);

    const startTime = Date.now();

    const child = spawn(command, {
      shell: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        BASE_URL: CONFIG.baseUrl,
        WS_URL: CONFIG.wsUrl,
        AUTH_TOKEN: CONFIG.authToken,
        TENANT_ID: CONFIG.tenantId,
      },
    });

    child.on('close', (code) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\nCompleted in ${duration}s with exit code ${code}\n`);
      resolve(code);
    });

    child.on('error', (err) => {
      console.error(`Error: ${err.message}`);
      reject(err);
    });
  });
}

// Test definitions
const tests = {
  httpArtillery: {
    name: 'Artillery HTTP Load Test',
    command: 'npx artillery run stress-tests/artillery/http-load-test.yml --output stress-tests/results/artillery-http.json',
    type: 'http',
  },
  wsArtillery: {
    name: 'Artillery WebSocket Load Test',
    command: 'npx artillery run stress-tests/artillery/websocket-load-test.yml --output stress-tests/results/artillery-ws.json',
    type: 'ws',
  },
  httpK6: {
    name: 'k6 Comprehensive Load Test',
    command: 'k6 run --out json=stress-tests/results/k6-http.json stress-tests/k6/comprehensive-load-test.js',
    type: 'http',
  },
  wsK6: {
    name: 'k6 WebSocket Stress Test',
    command: 'k6 run --out json=stress-tests/results/k6-ws.json stress-tests/k6/websocket-stress-test.js',
    type: 'ws',
  },
  posK6: {
    name: 'k6 POS Checkout Test',
    command: 'k6 run --out json=stress-tests/results/k6-pos.json stress-tests/k6/pos-checkout-test.js',
    type: 'pos',
  },
  spikeK6: {
    name: 'k6 Spike Test',
    command: 'k6 run -e SPIKE_TEST=true --out json=stress-tests/results/k6-spike.json stress-tests/k6/pos-checkout-test.js',
    type: 'spike',
  },
};

// Quick test variants
const quickTests = {
  httpK6Quick: {
    name: 'k6 Quick HTTP Test',
    command: 'k6 run --vus 10 --duration 30s --out json=stress-tests/results/k6-http-quick.json stress-tests/k6/comprehensive-load-test.js',
    type: 'http',
  },
  posK6Quick: {
    name: 'k6 Quick POS Test',
    command: 'k6 run --vus 5 --duration 30s --out json=stress-tests/results/k6-pos-quick.json stress-tests/k6/pos-checkout-test.js',
    type: 'pos',
  },
};

// Main execution
async function main() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           RETAIL POS STRESS TEST SUITE                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Target URL: ${CONFIG.baseUrl}`);
  console.log(`WebSocket URL: ${CONFIG.wsUrl}`);
  console.log(`Auth Token: ${CONFIG.authToken ? '[SET]' : '[NOT SET - Tests may fail!]'}`);
  console.log(`Tenant ID: ${CONFIG.tenantId || '[NOT SET]'}`);
  console.log('');

  // Check required tools
  const missingTools = checkTools();

  // Validate auth token
  if (!CONFIG.authToken) {
    console.log('⚠️  WARNING: AUTH_TOKEN is not set!');
    console.log('   Most tests will fail without authentication.');
    console.log('   Set it with: AUTH_TOKEN=your-token node stress-tests/scripts/run-all-tests.js\n');
  }

  // Determine which tests to run
  let testsToRun = [];

  if (options.quick) {
    testsToRun = Object.values(quickTests);
  } else if (options.httpOnly) {
    testsToRun = Object.values(tests).filter(t => t.type === 'http');
  } else if (options.wsOnly) {
    testsToRun = Object.values(tests).filter(t => t.type === 'ws');
  } else if (options.posOnly) {
    testsToRun = Object.values(tests).filter(t => t.type === 'pos');
  } else if (options.spike) {
    testsToRun = [tests.spikeK6];
  } else {
    // Run all except spike test
    testsToRun = Object.values(tests).filter(t => t.type !== 'spike');
  }

  // Filter out tests that require missing tools
  if (missingTools.includes('k6')) {
    testsToRun = testsToRun.filter(t => !t.command.startsWith('k6'));
  }
  if (missingTools.includes('artillery')) {
    testsToRun = testsToRun.filter(t => !t.command.includes('artillery'));
  }

  if (testsToRun.length === 0) {
    console.log('No tests to run! Please install required tools.');
    process.exit(1);
  }

  console.log(`Running ${testsToRun.length} test(s):\n`);
  testsToRun.forEach((t, i) => console.log(`  ${i + 1}. ${t.name}`));
  console.log('');

  // Run tests
  const results = [];
  const startTime = Date.now();

  for (const test of testsToRun) {
    try {
      const exitCode = await runCommand(test.command, test.name);
      results.push({ name: test.name, success: exitCode === 0, exitCode });
    } catch (error) {
      results.push({ name: test.name, success: false, error: error.message });
    }
  }

  // Summary
  const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                     TEST SUMMARY                           ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  results.forEach(r => {
    const status = r.success ? '[PASS]' : '[FAIL]';
    console.log(`  ${status} ${r.name}`);
  });

  console.log('');
  console.log(`Total: ${passed} passed, ${failed} failed`);
  console.log(`Duration: ${totalDuration} minutes`);
  console.log(`Results saved to: ${CONFIG.outputDir}`);
  console.log('');

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
