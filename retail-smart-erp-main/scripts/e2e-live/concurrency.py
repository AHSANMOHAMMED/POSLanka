import os, re
import json, uuid, time, subprocess, statistics, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:3000')
COOK={}
def call(method, path, body=None, token=None):
    req=urllib.request.Request(BASE+path, data=json.dumps(body).encode() if body is not None else None, method=method)
    req.add_header('Content-Type','application/json')
    if token: req.add_header('Authorization','Bearer '+token)
    if COOK and path.startswith('/api/sys-control'): req.add_header('Cookie','; '.join(f'{k}={v}' for k,v in COOK.items()))
    t0=time.time()
    try:
        r=urllib.request.urlopen(req, timeout=60); st=r.status; txt=r.read().decode(); h=r.headers
    except urllib.error.HTTPError as e:
        st=e.code; txt=e.read().decode(); h=e.headers
    for sc in h.get_all('Set-Cookie') or []:
        kv=sc.split(';',1)[0]
        if '=' in kv:
            k,v=kv.split('=',1); COOK[k]=v
    try: p=json.loads(txt) if txt else None
    except Exception: p=txt[:200]
    return st,p,int((time.time()-t0)*1000)
def psql(sql):
    return subprocess.run(['docker','exec','-i',os.environ.get('PG_CONTAINER','poslanka-test-pg'),'psql','-U',os.environ.get('PG_USER','postgres'),'-d',os.environ['PG_DATABASE'],'-tA'],input=sql,capture_output=True,text=True).stdout.strip()

uid=uuid.uuid4().hex[:8]; slug=f'load{uid}'
call('POST','/api/sys-control/auth/login',{'email':os.environ['ADMIN_EMAIL'],'password':os.environ['ADMIN_PASSWORD']})
st,p,_=call('POST','/api/sys-control/vendors',{'name':f'Load Mart {uid}','slug':slug,'email':f'o{uid}@ex.com','businessType':'supermarket','plan':'trial','country':'LK','currency':'LKR','ownerName':'Owner','ownerPassword':'Owner@12345'})
tenant_id=p['vendor']['id']; owner_email=p['owner']['email']
st,p,_=call('POST','/api/auth/mobile-login',{'email':owner_email,'password':'Owner@12345','tenantSlug':slug}); otok=p['token']; owner_id=p['user']['id']
st,p,_=call('GET','/api/pos-profiles',token=otok); prof=(p if isinstance(p,list) else p.get('profiles',[]))[0]; prof_id=prof['id']; wh_id=prof['warehouseId']
st,p,_=call('POST','/api/items',{'name':'Milk 1L','sellingPrice':480,'costPrice':400,'barcode':f'LOAD{uid}','trackStock':True,'currentStock':500,'warehouseId':wh_id},token=otok)
item_id=p['id']
st,p,_=call('GET',f'/api/items/barcode-lookup?barcode=LOAD{uid}&warehouseId={wh_id}',token=otok); print('initial stock', p.get('availableStock'), p.get('currentStock'))
# 4 extra cashiers cloned from the owner's password hash. One open shift per counter (cash
# drawer) is enforced, so each cashier gets their own counter on the same warehouse.
counters={owner_email: prof_id}
for i in range(1,5):
    counter_id=psql(f"""INSERT INTO users (tenant_id,email,password_hash,full_name,role,is_active) SELECT tenant_id,'cashier{i}-{uid}@ex.com',password_hash,'Cashier {i}','cashier',true FROM users WHERE id='{owner_id}';
    INSERT INTO pos_profiles (tenant_id,name,code,warehouse_id,is_default) VALUES ('{tenant_id}','Counter {i}','C{i}','{wh_id}',false) RETURNING id;""")
    counter_id=re.search(r'[0-9a-f]{8}-[0-9a-f-]{27}', counter_id).group(0)
    psql(f"""INSERT INTO pos_profile_users (tenant_id,pos_profile_id,user_id,is_default) SELECT '{tenant_id}','{counter_id}',id,true FROM users WHERE email='cashier{i}-{uid}@ex.com';""")
    counters[f'cashier{i}']=counter_id
users=[(owner_email,otok)]
for i in range(1,5):
    st,p,_=call('POST','/api/auth/mobile-login',{'email':f'cashier{i}-{uid}@ex.com','password':'Owner@12345','tenantSlug':slug}); assert st==200,(st,p); users.append((f'cashier{i}',p['token']))
shifts={}
for name,tok in users:
    st,p,_=call('POST','/api/pos-opening-entries',{'posProfileId':counters[name],'openingBalances':[{'paymentMethod':'cash','amount':2000}]},token=tok); assert st==200,(name,st,p); shifts[name]=p['id']
print('cashiers with open shifts:', len(shifts))

def sale(args):
    name,tok,n,csid=args
    body={'clientSaleId':csid,'cartItems':[{'itemId':item_id,'name':'Milk 1L','quantity':1,'unitPrice':480,'discount':0}],'paymentMethod':'cash','subtotal':480,'discount':0,'tax':0,'total':480,'amountPaid':500,'creditAmount':0,'warehouseId':wh_id,'posOpeningEntryId':shifts[name]}
    st,p,ms=call('POST','/api/sales',body,token=tok)
    return (name,st,(p or {}).get('invoiceNo') if isinstance(p,dict) else None,ms,(p or {}).get('error') if isinstance(p,dict) else p)
jobs=[(name,tok,n,str(uuid.uuid4())) for name,tok in users for n in range(20)]
# plus a racing duplicate: same clientSaleId fired 5 times at once
dup=str(uuid.uuid4()); jobs += [(users[0][0],users[0][1],99,dup)]*5
t0=time.time()
with ThreadPoolExecutor(max_workers=25) as ex: res=list(ex.map(sale,jobs))
wall=time.time()-t0
ok=[r for r in res if r[1]==200]; bad=[r for r in res if r[1]!=200]
lat=sorted(r[3] for r in res); p95=lat[int(len(lat)*0.95)-1]
invs=[r[2] for r in ok]; uniq=set(invs)
dup_invs={r[2] for r in res if r[0]==users[0][0] and jobs[res.index(r)][3]==dup} if False else None
print(f'{len(ok)} ok / {len(bad)} failed of {len(res)} in {wall:.1f}s; p50 {statistics.median(lat)}ms p95 {p95}ms max {lat[-1]}ms')
print('distinct invoices:', len(uniq), '(expected 101 = 100 sales + 1 for the 5 racing duplicates)')
if bad: print('failures:', bad[:5])
st,p,_=call('GET',f'/api/items/barcode-lookup?barcode=LOAD{uid}&warehouseId={wh_id}',token=otok); print('stock after:', p.get('availableStock'), '(expected 399 = 500 - 101 sales)')
print('db sales rows:', psql(f"select count(*) from sales where tenant_id='{tenant_id}'"), 'distinct invoice_no:', psql(f"select count(distinct invoice_no) from sales where tenant_id='{tenant_id}'"), 'rows with dup clientSaleId:', psql(f"select count(*) from sales where tenant_id='{tenant_id}' and client_sale_id='{dup}'"))
for name,tok in users:
    st,p,_=call('POST',f'/api/pos-opening-entries/{shifts[name]}/close',{'actualAmounts':[{'paymentMethod':'cash','amount':2000+480*(21 if name==users[0][0] else 20)}]},token=tok)  # owner (users[0]) also rang the de-duplicated sale
    summ=(p or {}).get('summary',{}) if isinstance(p,dict) else {}
    print(f'close {name}: status {st} sales {summ.get("totalSales")} variance {summ.get("totalVariance")}')
