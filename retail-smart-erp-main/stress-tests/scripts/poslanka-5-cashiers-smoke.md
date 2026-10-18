# POSLanka — 5 parallel cashiers smoke test

Use existing k6 POS scripts against a staging tenant:

```bash
cd retail-smart-erp-main
npm run stress:pos
# or spike:
npm run stress:spike
```

Success criteria (spec):

- POS bill creation &lt; 3 seconds p95 online
- 5 concurrent cashiers without checkout failures
- Offline queue drains after reconnect (manual: toggle airplane mode on PWA)

Ensure `BASE_URL`, tenant slug, and cashier credentials are set in the k6 env.
