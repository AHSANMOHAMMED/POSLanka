import os
import json, sys, urllib.request, urllib.error, urllib.parse, http.cookiejar, uuid, time
BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:3000')
opener = urllib.request.build_opener()
results = []
ADMIN_COOKIES = {}  # manual cookie jar: admin session cookie is Secure, which urllib drops over http
def call(method, path, body=None, token=None, expect=None, label=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', 'Bearer ' + token)
    if ADMIN_COOKIES and path.startswith('/api/sys-control'):
        req.add_header('Cookie', '; '.join(f'{k}={v}' for k, v in ADMIN_COOKIES.items()))
    t0 = time.time()
    try:
        res = opener.open(req, timeout=30); status = res.status; text = res.read().decode(); hdrs = res.headers
    except urllib.error.HTTPError as e:
        status = e.code; text = e.read().decode(); hdrs = e.headers
    for sc in hdrs.get_all('Set-Cookie') or []:
        kv = sc.split(';',1)[0]
        if '=' in kv:
            k, v = kv.split('=',1)
            if v: ADMIN_COOKIES[k] = v
            else: ADMIN_COOKIES.pop(k, None)
    ms = int((time.time()-t0)*1000)
    try: payload = json.loads(text) if text else None
    except Exception: payload = text[:200]
    ok = (status == expect) if expect else status < 400
    results.append((ok, f"{method} {path}", status, ms, label or ''))
    if not ok:
        print(f"  !! {method} {path} -> {status} ({ms}ms): {str(payload)[:300]}")
    return status, payload

uid = uuid.uuid4().hex[:8]
slug = f"smoke{uid}"
# ---- Super admin
s, p = call('POST', '/api/sys-control/auth/login', {'email':os.environ['ADMIN_EMAIL'],'password':os.environ['ADMIN_PASSWORD']}, expect=200, label='super admin login')
s, p = call('GET', '/api/sys-control/stats', expect=200)
s, p = call('GET', '/api/sys-control/vendors?page=1&pageSize=10', expect=200)
s, p = call('GET', '/api/sys-control/analytics/sales?range=today', expect=200)
s, p = call('GET', '/api/sys-control/analytics/live', expect=200)
s, p = call('POST', '/api/sys-control/vendors', {
  'name': f'Smoke Mart {uid}', 'slug': slug, 'email': f'owner-{uid}@example.com', 'businessType':'supermarket', 'plan':'trial',
  'country':'LK','currency':'LKR','ownerName':'Smoke Owner','ownerPassword':'Owner@12345'}, expect=200, label='create vendor')
vendor_id = (p or {}).get('vendor',{}).get('id'); owner_email = (p or {}).get('owner',{}).get('email')
print('vendor', vendor_id, 'owner', owner_email, 'loginUrl', (p or {}).get('loginUrl'))
s, p = call('GET', f'/api/sys-control/vendors/{vendor_id}', expect=200)
s, p = call('GET', f'/api/sys-control/analytics/vendors/{vendor_id}', expect=200)
s, p = call('PUT', f'/api/sys-control/vendors/{vendor_id}', {'settings':{'featureFlags':{'loyalty':True}}}, expect=200)
s, p = call('POST', f'/api/sys-control/vendors/{vendor_id}/impersonate', {}, expect=200)
s, p = call('GET', '/api/sys-control/audit-logs?days=1&limit=5', expect=200)
# ---- Mobile login (owner)
s, p = call('POST', '/api/auth/mobile-login', {'email':owner_email,'password':'Owner@12345','tenantSlug':slug}, expect=200, label='mobile login')
tok = (p or {}).get('token'); owner_id = (p or {}).get('user',{}).get('id')
s, p = call('POST', '/api/auth/mobile-login', {'email':owner_email,'password':'wrong','tenantSlug':slug}, expect=401, label='bad password')
s, p = call('GET', '/api/auth/ws-token', token=tok, expect=200, label='ws-token via bearer')
s, p = call('GET', '/api/auth/validate', token=tok, expect=200)
s, p = call('POST', '/api/auth/heartbeat', token=tok, expect=200)
s, p = call('GET', '/api/features', token=tok, expect=200)
s, p = call('GET', '/api/tenant', token=tok, expect=200)
s, p = call('GET', '/api/warehouses', token=tok, expect=200)
wh = (p if isinstance(p, list) else (p or {}).get('data') or (p or {}).get('warehouses') or [])
wh_id = wh[0]['id'] if wh else None
s, p = call('GET', '/api/pos-profiles', token=tok, expect=200)
profiles = p if isinstance(p, list) else (p or {}).get('profiles', [])
prof_id = profiles[0]['id'] if profiles else None
print('warehouse', wh_id, 'profile', prof_id)
s, p = call('GET', '/api/categories?all=true', token=tok, expect=200)
s, p = call('POST', '/api/categories', {'name':'Grocery'}, token=tok, expect=200)
cat_id = (p or {}).get('id')
s, p = call('POST', '/api/items', {'name':'Rice 1kg','sellingPrice':250,'costPrice':200,'barcode':f'890{uid[:6]}1','sku':f'RICE-{uid}','categoryId':cat_id,'trackStock':False}, token=tok, expect=200, label='create item')
item_id = (p or {}).get('id'); barcode = f'890{uid[:6]}1'
s, p = call('POST', '/api/items', {'name':'Sugar 1kg','sellingPrice':300,'costPrice':240,'barcode':f'890{uid[:6]}2','pluCode':'4011','trackStock':False}, token=tok, expect=200)
item2 = (p or {}).get('id')
s, p = call('GET', f'/api/items?search=rice&warehouseId={wh_id}&pageSize=60', token=tok, expect=200)
s, p = call('GET', f'/api/items/barcode-lookup?barcode={barcode}&warehouseId={wh_id}', token=tok, expect=200, label='barcode lookup')
s, p = call('GET', f'/api/items/barcode-lookup?barcode=4011&warehouseId={wh_id}', token=tok, expect=200, label='PLU lookup')
s, p = call('GET', f'/api/items/barcode-lookup?barcode=nope&warehouseId={wh_id}', token=tok, expect=404)
s, p = call('GET', '/api/customers?search=&pageSize=20', token=tok, expect=200)
s, p = call('POST', '/api/customers', {'name':'Walk-in Nimal','phone':'0771234567'}, token=tok, expect=200)
cust_id = (p or {}).get('id')
s, p = call('GET', f'/api/customers/{cust_id}/credit', token=tok, expect=200)
# ---- Shift
s, p = call('GET', '/api/pos-opening-entries?current=true', token=tok, expect=200)
s, p = call('POST', '/api/pos-opening-entries', {'posProfileId':prof_id,'openingBalances':[{'paymentMethod':'cash','amount':5000}]}, token=tok, expect=200, label='open shift')
shift_id = (p or {}).get('id') or (p or {}).get('openingEntry',{}).get('id')
s, p = call('POST', '/api/pos-opening-entries', {'posProfileId':prof_id,'openingBalances':[{'paymentMethod':'cash','amount':1}]}, token=tok, expect=400, label='second shift refused')
s, p = call('GET', '/api/pos-opening-entries?current=true', token=tok, expect=200)
shift = (p or {}).get('shift') or {}
shift_id = shift.get('id') or shift_id; wh_id = shift.get('warehouseId') or wh_id
print('shift', shift_id)
# ---- Sale with idempotency
csid = str(uuid.uuid4())
sale = {'clientSaleId':csid,'cartItems':[{'itemId':item_id,'name':'Rice 1kg','quantity':2,'unitPrice':250,'discount':0},{'itemId':item2,'name':'Sugar 1kg','quantity':1,'unitPrice':300,'discount':0}],
        'paymentMethod':'cash','subtotal':800,'discount':0,'tax':0,'total':800,'amountPaid':1000,'creditAmount':0,'warehouseId':wh_id,'posOpeningEntryId':shift_id,'customerId':cust_id}
s, p = call('POST', '/api/sales', sale, token=tok, expect=200, label='sale')
inv1 = (p or {}).get('invoiceNo'); sale_id = (p or {}).get('id')
s, p = call('POST', '/api/sales', sale, token=tok, expect=200, label='sale retry (idempotent)')
inv2 = (p or {}).get('invoiceNo')
results.append((inv1 is not None and inv1 == inv2, 'idempotency: same invoice on retry', 0, 0, f'{inv1} == {inv2}'))
split = dict(sale, clientSaleId=str(uuid.uuid4()), paymentMethod='cash', paymentSplits=[{'method':'cash','amount':500},{'method':'card','amount':300,'reference':'VISA1234'}], amountPaid=800)
s, p = call('POST', '/api/sales', split, token=tok, expect=200, label='split tender sale')
s, p = call('GET', f'/api/sales/{sale_id}', token=tok, expect=200)
s, p = call('GET', '/api/sales?page=1&pageSize=20', token=tok, expect=200)
s, p = call('GET', '/api/sales/dashboard-stats', token=tok, expect=200)
s, p = call('POST', '/api/held-sales', {'cartItems':[{'itemId':item_id,'name':'Rice 1kg','quantity':1,'unitPrice':250,'total':250}],'subtotal':250,'warehouseId':wh_id}, token=tok, expect=200, label='hold sale')
held_id = (p or {}).get('id')
s, p = call('GET', '/api/held-sales?all=true', token=tok, expect=200)
s, p = call('DELETE', f'/api/held-sales/{held_id}', token=tok, expect=200)
# ---- Return
ret = {'clientSaleId':str(uuid.uuid4()),'cartItems':[{'itemId':item_id,'name':'Rice 1kg','quantity':-1,'unitPrice':250,'discount':0}],'paymentMethod':'cash','subtotal':-250,'discount':0,'tax':0,'total':-250,'amountPaid':0,'creditAmount':0,'isReturn':True,'returnAgainst':sale_id,'refundAmount':250,'refundMethod':'cash','warehouseId':wh_id,'posOpeningEntryId':shift_id}
s, p = call('POST', '/api/sales', ret, token=tok, expect=200, label='return')
# ---- PIN
s, p = call('PUT', f'/api/users/{owner_id}', {'pin':'4321'}, token=tok, expect=200, label='set PIN')
s, p = call('POST', '/api/auth/verify-pin', {'pin':'4321','scope':'self'}, token=tok, expect=200, label='verify own PIN')
s, p = call('POST', '/api/auth/verify-pin', {'pin':'0000','scope':'self'}, token=tok, expect=403, label='wrong PIN')
s, p = call('POST', '/api/auth/verify-pin', {'pin':'4321','scope':'supervisor','permission':'manageSales'}, token=tok, expect=200, label='supervisor PIN')
# ---- Other mobile/web screens
s, p = call('GET', '/api/stock-movements?page=1&pageSize=20', token=tok, expect=200)
s, p = call('GET', '/api/purchase-requisitions?status=pending_approval&pageSize=50', token=tok, expect=200)
s, p = call('GET', '/api/employee-advances?status=pending_approval&pageSize=50', token=tok, expect=200)
s, p = call('GET', '/api/kitchen-orders?activeOnly=true', token=tok, expect=200)
s, p = call('GET', '/api/loyalty-programs', token=tok, expect=200)
s, p = call('GET', '/api/accounting/tax-templates?all=true', token=tok, expect=200)
s, p = call('GET', '/api/sales-orders?page=1', token=tok, expect=200)
s, p = call('GET', '/api/role-permissions/effective', token=tok, expect=200)
s, p = call('GET', '/api/reports/sales-summary?fromDate=2026-01-01&toDate=2026-12-31', token=tok, expect=200)
s, p = call('GET', '/api/pos-daily-summary?date=' + time.strftime('%Y-%m-%d'), token=tok, expect=200)
# ---- Close shift
s, p = call('POST', f'/api/pos-opening-entries/{shift_id}/close', {'actualAmounts':[{'paymentMethod':'cash','amount':6050},{'paymentMethod':'card','amount':300}]}, token=tok, expect=200, label='close shift')
print('close summary:', json.dumps((p or {}).get('summary'))[:300]); print('reconciliation:', json.dumps((p or {}).get('reconciliation'))[:400])
summary=(p or {}).get('summary') or {}
results.append((summary.get('totalSales')==1600 and summary.get('totalReturns')==250 and abs(summary.get('totalVariance',99))<0.01, 'shift totals correct (1600 sales, 250 returns, 0 variance)', 0, 0, json.dumps(summary)))
s, p = call('GET', '/api/pos-opening-entries?current=true', token=tok, expect=200)
# ---- Cross-vendor analytics after sales
s, p = call('GET', '/api/sys-control/analytics/sales?range=today', expect=200)
print('platform today:', json.dumps((p or {}).get('totals'))[:200])
s, p = call('GET', '/api/sys-control/analytics/live', expect=200)
print('live receipts:', len((p or {}).get('receipts', [])))

# ---- Barcode varieties
import hmac, hashlib, base64, struct
def gtin_cd(d):
    s=0
    for i,ch in enumerate(reversed(d)): s += int(ch)*(3 if i%2==0 else 1)
    return (10 - s%10)%10
ean13 = '4006381333931'
s_, p_ = call('POST','/api/items',{'name':'EAN Soap','sellingPrice':120,'costPrice':90,'barcode':ean13,'trackStock':False},token=tok, expect=200)
s_, p_ = call('GET', f'/api/items/barcode-lookup?barcode={ean13}&warehouseId={wh_id}', token=tok, expect=200, label='EAN-13')
results.append(((p_ or {}).get('scan',{}).get('symbology')=='ean13' and (p_ or {}).get('scan',{}).get('gtinValid') is True, 'EAN-13 recognised with valid check digit', 0,0, json.dumps((p_ or {}).get('scan'))))
upca='012345000065'
s_, p_ = call('POST','/api/items',{'name':'UPC Cola','sellingPrice':150,'costPrice':100,'barcode':upca,'trackStock':False},token=tok, expect=200)
s_, p_ = call('GET', f'/api/items/barcode-lookup?barcode=01234565&warehouseId={wh_id}', token=tok, expect=200, label='UPC-E expands to UPC-A item')
s_, p_ = call('GET', f'/api/items/barcode-lookup?barcode=0{upca}&warehouseId={wh_id}', token=tok, expect=200, label='13-digit form of UPC-A item')
s_, p_ = call('POST','/api/items',{'name':'Pharma Pack','sellingPrice':900,'costPrice':700,'barcode':'09501101530003','trackStock':False},token=tok, expect=200)
gs1 = ']C10109501101530003\u001d17260131\u001d10AB12'
s_, p_ = call('GET', '/api/items/barcode-lookup?barcode=' + urllib.parse.quote(gs1) + f'&warehouseId={wh_id}', token=tok, expect=200, label='GS1-128 lookup')
sc=(p_ or {}).get('scan',{})
results.append((sc.get('symbology')=='gs1' and sc.get('batchNo')=='AB12' and sc.get('expiryDate')=='2026-01-31', 'GS1 batch + expiry parsed', 0,0, json.dumps(sc)))
s_, p_ = call('GET', f'/api/items/barcode-lookup?barcode=RICE-{uid}&warehouseId={wh_id}', token=tok, expect=200, label='SKU scan (Code128)')
# scale barcodes: enable on tenant, item with PLU 4011 exists (Sugar)
s_, p_ = call('PUT','/api/tenant',{'scaleBarcode':{'enabled':True,'prefixes':['2'],'pluStart':2,'pluLength':5,'valueStart':7,'valueLength':5,'valueType':'weight','valueDecimals':3}},token=tok, expect=200, label='enable scale barcodes')
s_, p_ = call('GET','/api/tenant',token=tok, expect=200)
results.append(((p_ or {}).get('scaleBarcode',{}).get('enabled') is True, 'tenant returns scaleBarcode config', 0,0, json.dumps((p_ or {}).get('scaleBarcode'))))
body='2'+'0'+'04011'+'01250'; scale_code=body+str(gtin_cd(body))
s_, p_ = call('GET', f'/api/items/barcode-lookup?barcode={scale_code}&warehouseId={wh_id}', token=tok, expect=200, label='weighing-scale label → PLU 4011 @ 1.250 kg')
sc=(p_ or {}).get('scan',{})
results.append((sc.get('symbology')=='scale' and abs((sc.get('quantity') or 0)-1.25)<1e-9 and (p_ or {}).get('name')=='Sugar 1kg', 'scale label resolves item + weight', 0,0, json.dumps(sc)))
# ---- Push device registration
s_, p_ = call('POST','/api/account/devices',{'pushToken':'ExponentPushToken[smoke-'+uid+']','platform':'android','deviceName':'Smoke Phone'},token=tok, expect=200, label='register push device')
s_, p_ = call('GET','/api/account/devices',token=tok, expect=200)
s_, p_ = call('DELETE','/api/account/devices',{'pushToken':'ExponentPushToken[smoke-'+uid+']'},token=tok, expect=200)
# ---- Super-admin mobile login + 2FA
s_, p_ = call('POST','/api/sys-control/auth/mobile-login',{'email':os.environ['ADMIN_EMAIL'],'password':os.environ['ADMIN_PASSWORD']}, expect=200, label='admin mobile login (no 2FA yet)')
atok=(p_ or {}).get('token')
req=urllib.request.Request(BASE+'/api/sys-control/stats'); req.add_header('Authorization','Bearer '+str(atok))
try: st_=urllib.request.urlopen(req).status
except urllib.error.HTTPError as e: st_=e.code
results.append((st_==200, 'admin bearer token accepted by /api/sys-control/stats', st_, 0, ''))
def totp(secret_b32):
    key=base64.b32decode(secret_b32 + '='*((8-len(secret_b32)%8)%8), casefold=True)
    counter=int(time.time())//30
    h=hmac.new(key, struct.pack('>Q', counter), hashlib.sha1).digest()
    o=h[-1]&0x0f; code=(struct.unpack('>I', h[o:o+4])[0] & 0x7fffffff) % 1000000
    return f'{code:06d}'
s_, p_ = call('POST','/api/sys-control/auth/2fa',{'action':'setup'}, expect=200, label='2FA setup')
secret=(p_ or {}).get('secret'); results.append((bool((p_ or {}).get('qrDataUrl','').startswith('data:image/png')), '2FA QR generated', 0,0,''))
s_, p_ = call('POST','/api/sys-control/auth/2fa',{'action':'enable','code':totp(secret)}, expect=200, label='2FA enable with TOTP')
s_, p_ = call('POST','/api/sys-control/auth/mobile-login',{'email':os.environ['ADMIN_EMAIL'],'password':os.environ['ADMIN_PASSWORD']}, expect=428, label='login without code → 428')
s_, p_ = call('POST','/api/sys-control/auth/mobile-login',{'email':os.environ['ADMIN_EMAIL'],'password':os.environ['ADMIN_PASSWORD'],'totpCode':totp(secret)}, expect=200, label='login with TOTP')
s_, p_ = call('POST','/api/sys-control/auth/2fa',{'action':'disable','code':totp(secret)}, expect=200, label='2FA disable')
s_, p_ = call('GET','/api/health', expect=200)
results.append(((p_ or {}).get('tenantIsolation')=='app_role', 'health reports tenantIsolation=app_role', 0,0, json.dumps(p_)))

# ---- Web pages render
for path, exp in [(f'/c/{slug}/login',200), ('/sys-control/login',200), ('/',200), (f'/c/{slug}/pos',None), (f'/c/{slug}/kds',None), (f'/c/{slug}/kiosk',None), (f'/c/{slug}/pos/display',None)]:
    call('GET', path, expect=exp, label='page')
print()
okc = sum(1 for r in results if r[0]); print(f"PASSED {okc}/{len(results)}")
for ok, name, st, ms, lab in results:
    print(('  ok ' if ok else ' FAIL'), name, st, f'{ms}ms', lab)
