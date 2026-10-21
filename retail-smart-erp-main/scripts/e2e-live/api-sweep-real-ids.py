import os
import json, re, subprocess, urllib.request, urllib.error, sys, time
from concurrent.futures import ThreadPoolExecutor
BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:3000'); DB=os.environ['PG_DATABASE']
def psql(q):
    return subprocess.run(['docker','exec','-i','poslanka-test-pg','psql','-U','postgres','-d',DB,'-tA'],input=q,capture_output=True,text=True).stdout.strip()
slug,email=psql("select t.slug||'|'||u.email from tenants t join users u on u.tenant_id=t.id and u.role='owner' where t.slug like 'smoke%' order by t.created_at desc limit 1").split('|')
T=psql(f"select id from tenants where slug='{slug}'")
def call(m,p,h):
    req=urllib.request.Request(BASE+p,method=m)
    for k,v in h.items(): req.add_header(k,v)
    t0=time.time()
    try: r=urllib.request.urlopen(req,timeout=30); st=r.status; b=r.read(300).decode(errors='replace')
    except urllib.error.HTTPError as e: st=e.code; b=e.read(300).decode(errors='replace')
    except Exception as e: st=0; b=str(e)
    return st,b,int((time.time()-t0)*1000)
req=urllib.request.Request(BASE+'/api/auth/mobile-login',data=json.dumps({'email':email,'password':'Owner@12345','tenantSlug':slug}).encode(),method='POST'); req.add_header('Content-Type','application/json')
tok=json.loads(urllib.request.urlopen(req).read())['token']; H={'Authorization':'Bearer '+tok}
tables=set(psql("select table_name from information_schema.columns where table_schema='public' and column_name='tenant_id'").split('\n'))
alias={'pos-profiles':'pos_profiles','sales':'sales','items':'items','journal-entries':'journal_entries','payment-entries':'payment_entries','gl-entries':'gl_entries','warehouses':'warehouses','categories':'categories','customers':'customers','users':'users','held-sales':'held_sales','pos-opening-entries':'pos_opening_entries','pos-closing-entries':'pos_closing_entries','stock-takes':'stock_takes','stock-intake':'stock_intake_batches','loyalty-programs':'loyalty_programs','label-templates':'label_templates','print-templates':'print_templates','letter-heads':'letter_heads','accounts':'chart_of_accounts','custom-roles':'custom_roles','import/jobs':'import_jobs','notification-templates':'notification_templates','cost-centers':'cost_centers','fiscal-years':'fiscal_years','modes-of-payment':'modes_of_payment','tax-templates':'tax_templates','bank-accounts':'bank_accounts'}
routes=json.load(open(sys.argv[1])); jobs=[]; skipped=0
for r in routes:
    u=r['url']
    if 'GET' not in r['methods'] or '[' not in u or u.startswith('/api/sys-control') or u.startswith('/api/c/') or '[...' in u: continue
    params=re.findall(r'\[([^\]]+)\]',u)
    if len(params)!=1: skipped+=1; continue
    seg=u.split('/[')[0].split('/api/')[1]
    key=seg if seg in alias else seg.split('/')[-1]
    tbl=alias.get(key, key.replace('-','_'))
    if tbl not in tables: skipped+=1; continue
    rid=psql(f"select id from {tbl} where tenant_id='{T}' limit 1") if params[0] in ('id',) else ''
    if not rid: skipped+=1; continue
    jobs.append(re.sub(r'\[[^\]]+\]',rid,u))
with ThreadPoolExecutor(max_workers=6) as ex: res=list(ex.map(lambda p:(p,)+call('GET',p,H),jobs))
bad=[x for x in res if x[1]>=500 or x[1]==0]; ok=[x for x in res if 200<=x[1]<300]
print(f'real-id detail GETs: {len(res)} called, {len(ok)} returned 2xx, {len(bad)} errors, {skipped} skipped (no data/table)')
for p,st,b,ms in bad: print('  ',st,p,'::',b[:150])
for p,st,b,ms in res:
    if 300<=st<500 and st not in (401,403): print('   non-2xx',st,p,'::',b[:100])
