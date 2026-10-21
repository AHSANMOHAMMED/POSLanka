# Live end-to-end checks

Run these against a **staging** deployment (or a fresh local build) before giving a vendor access.
They create their own throwaway vendors through the super-admin console, so use a staging
database or delete the `smoke…`, `load…`, `ui…`, `uit…` and `sweep…` vendors afterwards.

```bash
export BASE_URL=https://staging.your-domain        # or http://localhost:3000
export ADMIN_EMAIL=you@company.lk ADMIN_PASSWORD='…' # a super admin WITHOUT 2FA on staging
export PG_CONTAINER=poslanka-test-pg PG_DATABASE=poslanka_staging   # only for concurrency/real-id sweeps (local DB)
export CHROME_PATH=/usr/bin/google-chrome           # optional; else Playwright's Chromium

python3 scripts/e2e-live/api-smoke.py            # 100 API checks: vendor → login → shift → sales → returns → close
python3 scripts/e2e-live/concurrency.py          # 5 cashiers × 21 concurrent checkouts, invoice/stock exactness
node    scripts/e2e-live/ui-checkout.cjs         # browser: scan, scale label, F-keys, pay, lock/PIN, all pages
node    scripts/e2e-live/ui-day-one.cjs          # browser: split pay, scan-to-return, close shift, intake sync, history
python3 scripts/e2e-live/api-sweep.py routes.json out.json   # every API handler, no 5xx allowed
```

`routes.json` for the sweep is generated with:
`python3 -c "import os,re,json;print(json.dumps([{'url':'/'+r[len('src/app/'):],'methods':sorted(set(re.findall(r'export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b',open(os.path.join(r,'route.ts')).read())))} for r,_,f in os.walk('src/app/api') if 'route.ts' in f]))" > routes.json`
