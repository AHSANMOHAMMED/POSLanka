import os
import json, uuid, time, urllib.request, urllib.error, sys, re
from concurrent.futures import ThreadPoolExecutor
BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:3000')
routes=json.load(open(sys.argv[1]))
def call(method, path, body=None, headers=None, timeout=25):
    data=json.dumps(body).encode() if body is not None else None
    req=urllib.request.Request(BASE+path, data=data, method=method)
    req.add_header('Content-Type','application/json')
    for k,v in (headers or {}).items(): req.add_header(k,v)
    t0=time.time()
    try:
        r=urllib.request.urlopen(req, timeout=timeout); st=r.status; txt=r.read(4000).decode(errors='replace'); h=r.headers
    except urllib.error.HTTPError as e:
        st=e.code; txt=e.read(4000).decode(errors='replace'); h=e.headers
    except Exception as e:
        return 0, str(e)[:200], int((time.time()-t0)*1000), None
    return st, txt, int((time.time()-t0)*1000), h
# --- setup: admin cookie + fresh vendor + owner bearer
st,txt,_,h=call('POST','/api/sys-control/auth/login',{'email':os.environ['ADMIN_EMAIL'],'password':os.environ['ADMIN_PASSWORD']})
cookie='; '.join(c.split(';',1)[0] for c in (h.get_all('Set-Cookie') or []))
uid=uuid.uuid4().hex[:8]; slug='sweep'+uid
st,txt,_,_=call('POST','/api/sys-control/vendors',{'name':'Sweep Mart '+uid,'slug':slug,'email':f's{uid}@ex.com','businessType':'supermarket','plan':'trial','country':'LK','currency':'LKR','ownerName':'Sweep Owner','ownerPassword':'Owner@12345'},{'Cookie':cookie})
v=json.loads(txt); owner=v['owner']['email']
st,txt,_,_=call('POST','/api/auth/mobile-login',{'email':owner,'password':'Owner@12345','tenantSlug':slug})
tok=json.loads(txt)['token']
auth={'Authorization':'Bearer '+tok}
# a little data so list endpoints have rows
call('POST','/api/items',{'name':'Sweep Item','sellingPrice':100,'costPrice':80,'trackStock':False},auth)
call('POST','/api/customers',{'name':'Sweep Customer','phone':'07'+uid[:8].replace('a','1').replace('b','2').replace('c','3').replace('d','4').replace('e','5').replace('f','6')},auth)
rand=str(uuid.uuid4())
def fill(url):
    return re.sub(r'\[\.\.\.[^\]]+\]', 'x', re.sub(r'\[(id|[a-zA-Z]*Id|itemId|modifierId|txnId|inspectionId|ingredientId|conversationId|stepIndex)\]', lambda m: '0' if m.group(1)=='stepIndex' else rand, re.sub(r'\[slug\]', slug, re.sub(r'\[(token|key)\]', 'zz-test-token', url))))
jobs=[]
for r in routes:
    url=r['url']; path=fill(url)
    hdr=dict(cookie and {'Cookie':cookie} or {}) if url.startswith('/api/sys-control') else dict(auth)
    for m in r['methods']:
        if url.startswith('/api/auth/[...nextauth]') or url.startswith('/api/account-auth/[...nextauth]'): continue
        jobs.append((m,url,path,hdr))
def run(j):
    m,url,path,hdr=j
    body=None if m in ('GET','DELETE') else {}
    st,txt,ms,_=call(m,path,body,hdr)
    return {'m':m,'url':url,'path':path,'st':st,'ms':ms,'body':txt[:300]}
with ThreadPoolExecutor(max_workers=6) as ex: res=list(ex.map(run,jobs))
json.dump(res,open(sys.argv[2],'w'),indent=1)
bad=[x for x in res if x['st']>=500 or x['st']==0]
slow=[x for x in res if x['ms']>5000]
from collections import Counter
print('handlers called:',len(res),' status mix:',dict(Counter((x['st']//100)*100 for x in res)))
print('5xx/failed:',len(bad),' slow(>5s):',len(slow))
for x in sorted(bad,key=lambda x:x['url']): print(f"  {x['st']} {x['m']:6} {x['url']}  :: {x['body'][:140]}")
for x in slow: print(f"  SLOW {x['ms']}ms {x['m']} {x['url']}")
