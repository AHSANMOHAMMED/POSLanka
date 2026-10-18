/**
 * k6 WebSocket Stress Test
 * Tests WebSocket connection handling and real-time messaging
 *
 * Usage:
 *   k6 run stress-tests/k6/websocket-stress-test.js
 *
 * With environment variables:
 *   k6 run -e WS_URL=ws://localhost:3000 -e TENANT_ID=your-tenant stress-tests/k6/websocket-stress-test.js
 */

import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const connectionErrors = new Rate('ws_connection_errors');
const messageLatency = new Trend('ws_message_latency');
const connectionsOpened = new Counter('ws_connections_opened');
const messagesSent = new Counter('ws_messages_sent');
const messagesReceived = new Counter('ws_messages_received');

// Test configuration
export const options = {
  stages: [
    { duration: '30s', target: 50 },    // Ramp up to 50 connections
    { duration: '1m', target: 100 },    // Increase to 100 connections
    { duration: '2m', target: 100 },    // Hold 100 connections
    { duration: '1m', target: 200 },    // Peak at 200 connections
    { duration: '2m', target: 200 },    // Hold peak
    { duration: '1m', target: 0 },      // Ramp down
  ],

  thresholds: {
    ws_connection_errors: ['rate<0.1'],   // Less than 10% connection errors
    ws_message_latency: ['p(95)<100'],    // 95% messages under 100ms
  },
};

// Configuration
const WS_URL = __ENV.WS_URL || 'ws://localhost:3000';
const TENANT_ID = __ENV.TENANT_ID || 'test-tenant-id';

// eslint-disable-next-line import/no-anonymous-default-export
export default function () {
  const url = `${WS_URL}/ws`;

  const res = ws.connect(url, {}, function (socket) {
    connectionsOpened.add(1);

    socket.on('open', function () {
      // Subscribe to tenant channel
      const subscribeMsg = JSON.stringify({
        type: 'subscribe',
        tenantId: TENANT_ID,
      });
      socket.send(subscribeMsg);
      messagesSent.add(1);
    });

    socket.on('message', function (message) {
      messagesReceived.add(1);

      try {
        const data = JSON.parse(message);

        // Track latency for ping/pong
        if (data.type === 'pong' && data.timestamp) {
          const latency = Date.now() - data.timestamp;
          messageLatency.add(latency);
        }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_e) {
        // Non-JSON message, ignore
      }
    });

    socket.on('error', function (e) {
      connectionErrors.add(true);
      console.error('WebSocket error:', e);
    });

    socket.on('close', function () {
      // Connection closed
    });

    // Simulate real user behavior
    socket.setTimeout(function () {
      // Send ping with timestamp
      const pingMsg = JSON.stringify({
        type: 'ping',
        timestamp: Date.now(),
      });
      socket.send(pingMsg);
      messagesSent.add(1);
    }, 5000);

    // Watch a document (simulating user viewing a work order)
    socket.setTimeout(function () {
      const watchMsg = JSON.stringify({
        type: 'watch-document',
        documentType: 'work-order',
        documentId: `wo-${__VU}-${__ITER}`,
      });
      socket.send(watchMsg);
      messagesSent.add(1);
    }, 10000);

    // Leave document
    socket.setTimeout(function () {
      const leaveMsg = JSON.stringify({
        type: 'leave-document',
        documentType: 'work-order',
        documentId: `wo-${__VU}-${__ITER}`,
      });
      socket.send(leaveMsg);
      messagesSent.add(1);
    }, 25000);

    // Keep connection alive for 30 seconds
    socket.setTimeout(function () {
      // Unsubscribe before closing
      const unsubscribeMsg = JSON.stringify({
        type: 'unsubscribe',
        tenantId: TENANT_ID,
      });
      socket.send(unsubscribeMsg);
      messagesSent.add(1);

      socket.close();
    }, 30000);
  });

  // Check connection was successful
  const success = check(res, {
    'WebSocket connected': (r) => r && r.status === 101,
  });

  connectionErrors.add(!success);

  // Small pause between iterations
  sleep(1);
}

// Separate scenario for long-lived connections
export function longLivedConnection() {
  const url = `${WS_URL}/ws`;

  ws.connect(url, {}, function (socket) {
    connectionsOpened.add(1);

    socket.on('open', function () {
      socket.send(JSON.stringify({
        type: 'subscribe',
        tenantId: TENANT_ID,
      }));
    });

    socket.on('message', function () {
      messagesReceived.add(1);
    });

    // Keep connection for 5 minutes
    socket.setTimeout(function () {
      socket.close();
    }, 300000);

    // Send periodic pings
    for (let i = 1; i <= 10; i++) {
      socket.setTimeout(function () {
        socket.send(JSON.stringify({ type: 'ping' }));
        messagesSent.add(1);
      }, i * 30000);
    }
  });
}

// Stress test for rapid connect/disconnect
export function rapidConnections() {
  const url = `${WS_URL}/ws`;

  for (let i = 0; i < 10; i++) {
    const res = ws.connect(url, {}, function (socket) {
      connectionsOpened.add(1);

      socket.on('open', function () {
        socket.send(JSON.stringify({
          type: 'subscribe',
          tenantId: TENANT_ID,
        }));
        messagesSent.add(1);

        // Immediately close
        socket.setTimeout(function () {
          socket.close();
        }, 1000);
      });
    });

    check(res, {
      'rapid connection successful': (r) => r && r.status === 101,
    });

    sleep(0.1);
  }
}
