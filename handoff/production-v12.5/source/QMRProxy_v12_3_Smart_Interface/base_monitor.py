#!/usr/bin/env python3
"""QMR independent read-only health monitor and opt-in MTProto transport probe."""
from __future__ import annotations
import argparse, base64, contextlib, datetime as dt, fcntl, hashlib, ipaddress, json, os, re, secrets, socket, statistics, struct, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler
from urllib.parse import urlsplit
ROOT = Path.home()/'QMRProxy_Termux_Rebuild'
RELEASE='v11.6-stable-20261121'
HASHES={'qmr.py': 'fe3d1e0f7432904a6a2c5bb2976aa50ff2b267d6c16dce935f07d6bb4c8af653', 'webhook.py': 'ace7ee36544159dc3dd919ae3e123a5aa302192f941e9ce8b0d3ab13b07b4bb1'}
SMART_RELEASE="v12.2-smart-20261121"
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*a,**k): return None

def utc(): return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
def private_dir(root):
    p=root/'data'/'v117-health'; p.mkdir(exist_ok=True,mode=0o700); os.chmod(p,0o700); return p
@contextlib.contextmanager
def locked(path):
    with os.fdopen(os.open(path,os.O_CREAT|os.O_RDWR,0o600),'a') as f:
        fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB); yield

def write_json(path,obj):
    fd,tmp=tempfile.mkstemp(dir=path.parent,prefix='.health-')
    try:
        with os.fdopen(fd,'w') as f: json.dump(obj,f,ensure_ascii=False,indent=2,allow_nan=False); f.write('\n'); f.flush(); os.fsync(f.fileno())
        os.replace(tmp,path)
    finally:
        with contextlib.suppress(FileNotFoundError): os.unlink(tmp)

def read_json(path,maxbytes=2_000_000):
    with path.open('rb') as f: raw=f.read(maxbytes+1)
    if len(raw)>maxbytes: raise ValueError('too large')
    return json.loads(raw)

def http_json(url):
    try:
        with build_opener(ProxyHandler({}),NoRedirect()).open(Request(url,headers={'Cache-Control':'no-cache','User-Agent':'QMR-health-lab/1.0'}),timeout=8) as r:
            if r.status!=200:return None,'HTTP '+str(r.status)
            v=json.loads(r.read(65536)); return (v,'HTTP 200') if isinstance(v,dict) else (None,'invalid JSON')
    except Exception as e:
        return None, 'HTTP '+str(e.code) if isinstance(getattr(e,'code',None),int) else type(e).__name__

def trusted(root):
    return all((root/f).is_file() and hashlib.sha256((root/f).read_bytes()).hexdigest()==h for f,h in HASHES.items())

def api_info(root):
    if not trusted(root): return None,'unknown source hash; refused local import'
    # Only read-only getMe/getWebhookInfo. stdout captured, never print raw API data.
    code='import qmr,json; a=qmr.Telegram(qmr.load_token()); b=qmr.check_bot(a); print(json.dumps({"id":b["id"],"username":b["username"],"info":a.call("getWebhookInfo")}))'
    try:
        p=subprocess.run([sys.executable,'-B','-c',code],cwd=root,capture_output=True,text=True,timeout=32,check=True)
        d=json.loads(p.stdout)
        if d['id']!=9239734904 or d['username'].lower()!='qmrproxybot':return None,'wrong identity'
        return d['info'],'verified'
    except Exception:return None,'unavailable'

def public_url(info):
    try:
        p=urlsplit(info['url']); host=p.hostname
        # Only established Cloudflare Quick Tunnel hosts; no redirect, no arbitrary target.
        if p.scheme!='https' or not re.fullmatch(r'[a-z0-9-]+\.trycloudflare\.com',host or '') or p.port not in (443,None) or p.username or p.password or p.query or p.fragment or p.path!='/telegram-webhook':return None
        return 'https://'+host+'/readyz'
    except (KeyError,TypeError,ValueError):return None

def ready(d,ident):
    return isinstance(d,dict) and d.get('service')=='qmrproxy' and d.get('version')=='v10-separated-20261120' and d.get('release')==RELEASE and d.get('smart_release')==SMART_RELEASE and d.get('mode')=='webhook' and d.get('ready') is True and d.get('installation_id')==ident

def safe_int(v):return v if type(v) is int and v>=0 else None

def source(root,name):
    try:
        d=read_json(root/'site'/name); rows=d['nodes']; stamp=d.get('source_checked_at') or d.get('updated_at')
        if not isinstance(rows,list) or not isinstance(stamp,str):raise ValueError()
        when=dt.datetime.fromisoformat(stamp.replace('Z','+00:00')); age=(dt.datetime.now(dt.timezone.utc)-when).total_seconds()
        limit=72 if name.startswith('extra') else 36
        return {'count':len(rows),'source_date':when.isoformat(),'age_hours':round(age/3600,2),'fresh':0<=age<=limit*3600}
    except Exception:return {'count':None,'fresh':False,'reason':'invalid/missing source'}

def sample(root):
    h,reason=http_json('http://127.0.0.1:8765/readyz')
    try: ident=(root/'.secrets'/'installation_id').read_text().strip()
    except OSError: ident=None
    local=bool(ident and ready(h,ident)); info,api=api_info(root)
    remote,why=None,'not checked'; pending=error=None
    if isinstance(info,dict):
        pending=safe_int(info.get('pending_update_count')); error=safe_int(info.get('last_error_date')); url=public_url(info)
        if url: remote,why=http_json(url)
        else:why='unexpected or non-Quick-Tunnel host; manual verification required'
    public=bool(ident and ready(remote,ident)) if isinstance(info,dict) else None
    inbox=h.get('inbox',{}) if local else {}; inbox=inbox if isinstance(inbox,dict) else {}
    return {'checked_at':utc(),'release':RELEASE,'monitor_release':'v12.3-health','active_release':SMART_RELEASE,'local_ready':local,'local_detail':reason,'telegram_identity':api,'public_ready':public,'public_detail':why,'pending_telegram':pending,'last_delivery_error_utc':dt.datetime.fromtimestamp(error,dt.timezone.utc).isoformat() if error is not None and error<253402300799 else None,'queue':{k:safe_int(inbox.get(k,0)) for k in ('pending','processing','done','dead')} if local else {},'sources':{n:source(root,n) for n in ('nodes.json','extra-proxies.json')},'status':'healthy_sample' if local and public and pending==0 else 'attention_required','note':'GET readiness and pending count are not a fresh end-to-end Telegram reply. Last delivery error may be historical.'}

def run_health(root):
    d=private_dir(root)
    with locked(d/'health.lock'):
        result=sample(root)
        try: hist=read_json(d/'history.json'); hist=hist if isinstance(hist,list) else []
        except Exception:hist=[]
        hist=(hist+[result])[-720:];write_json(d/'history.json',hist);write_json(d/'latest.json',result)
    print(json.dumps(result,ensure_ascii=False,indent=2),flush=True);return result

def secret_bytes(value):
    if not isinstance(value,str) or len(value)>684:return None
    try:
        raw=bytes.fromhex(value) if re.fullmatch(r'[0-9a-fA-F]{32,512}',value) and len(value)%2==0 else base64.b64decode(value+'='*((-len(value))%4),altchars=b'-_',validate=True)
    except (ValueError,TypeError):return None
    if len(raw)==16:return ('classic',raw)
    if len(raw)==17 and raw[0]==0xdd:return ('padded',raw[1:])
    if len(raw)>17 and raw[0]==0xee:return ('fake_tls',raw[1:17])
    return None

def candidates(root):
    # Snapshot only. Never read user-added links or arbitrary URL/host parameters.
    seen=set(); groups=[]
    for name in ('nodes.json','extra-proxies.json'):
        group=[]
        try:rows=read_json(root/'site'/name)['nodes']
        except Exception:rows=[]
        if not isinstance(rows,list):continue
        for n in rows[:250]:
            if not isinstance(n,dict) or n.get('enabled') is False:continue
            host=n.get('server'); port=n.get('port'); raw=n.get('secret')
            if not isinstance(host,str) or not re.fullmatch(r'[a-zA-Z0-9.-]{1,253}',host) or '.' not in host or not all(re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?',p) for p in host.split('.')) or type(port) is not int or not 1<=port<=65535:continue
            dec=secret_bytes(raw)
            if not dec:continue
            key=(host.lower(),port,dec[0],dec[1]);
            if key in seen:continue
            seen.add(key); group.append({'host':host.lower(),'port':port,'secret':raw,'kind':dec[0],'id':hashlib.sha256(json.dumps([host.lower(),port,raw]).encode()).hexdigest()[:24],'group':name})
        groups.append(group)
    # Interleave original and extra; prioritize supported modes, rotate in CLI.
    out=[]
    for i in range(max(map(len,groups),default=0)):
        for g in groups:
            if i<len(g):out.append(g[i])
    return out

def public_address(s):
    a=ipaddress.ip_address(s); return a.is_global and not a.is_multicast and not a.is_reserved and not a.is_unspecified and not a.is_loopback and not a.is_link_local

def resolve_global(host,port):
    rows=socket.getaddrinfo(host,port,type=socket.SOCK_STREAM)
    if not rows or any(not public_address(r[4][0]) for r in rows):raise ValueError('non-public/mixed DNS result')
    return rows[0]

def cipher(key,iv):
    from cryptography.hazmat.primitives.ciphers import Cipher,algorithms,modes
    return Cipher(algorithms.AES(key),modes.CTR(iv)).encryptor()

def streams(init,key):
    rev=init[::-1]
    return cipher(hashlib.sha256(init[8:40]+key).digest(),init[40:56]),cipher(hashlib.sha256(rev[8:40]+key).digest(),rev[40:56])

def make_init(kind,key):
    while True:
        init=bytearray(secrets.token_bytes(64))
        if init[0]==0xef or bytes(init[:4]) in (b'HEAD',b'POST',b'GET ',b'OPTI',b'\x16\x03\x01\x02',b'\xdd'*4,b'\xee'*4) or bytes(init[4:8])==b'\0'*4:continue
        break
    init[56:60]=b'\xef'*4 if kind=='classic' else b'\xdd'*4;init[60:62]=struct.pack('<h',2)
    enc,dec=streams(bytes(init),key); encrypted=enc.update(bytes(init));return bytes(init[:56])+encrypted[56:],enc,dec

def read_exact(sock,n,deadline):
    chunks=bytearray()
    while len(chunks)<n:
        remain=deadline-time.monotonic()
        if remain<=0:raise TimeoutError()
        sock.settimeout(remain); chunk=sock.recv(n-len(chunks))
        if not chunk:raise EOFError()
        chunks.extend(chunk)
    return bytes(chunks)

def query_packet(nonce):
    body=struct.pack('<I',0xbe7e8ef1)+nonce
    msgid=(time.time_ns()*(1<<32)//1_000_000_000)&~3
    return struct.pack('<QqI',0,msgid,len(body))+body

def frame(body,kind):
    if kind=='classic':return bytes([len(body)//4])+body
    padding=secrets.token_bytes(secrets.randbelow(16));return struct.pack('<I',len(body)+len(padding))+body+padding

def receive(sock,dec,kind,deadline):
    def get(n):return dec.update(read_exact(sock,n,deadline))
    if kind=='classic':
        first=get(1)[0];n=(int.from_bytes(get(3),'little') if first==127 else first)*4
    else:n=struct.unpack('<I',get(4))[0]
    if not 20<=n<=4096:raise ValueError('unexpected frame length')
    return get(n)

def valid_resp(packet,nonce):
    if len(packet)<20:return False
    auth,mid,length=struct.unpack_from('<QqI',packet)
    if auth or not mid&1 or length<48 or length%4 or length>len(packet)-20 or len(packet)-20-length>15:return False
    body=packet[20:20+length]
    if body[:4]!=struct.pack('<I',0x05162463) or body[4:20]!=nonce:return False
    b=body[36:]; first=b[0]
    if not 1<=first<=8:return False
    n=(first+1+3)//4*4
    if len(b)<n+8 or b[n:n+4]!=struct.pack('<I',0x1cb5c415):return False
    count=struct.unpack_from('<I',b,n+4)[0]
    return 1<=count<=16 and len(b)==n+8+count*8

def protocol_probe(sock,kind,key,seconds=7):
    start=time.monotonic();deadline=start+seconds;nonce=secrets.token_bytes(16)
    init,enc,dec=make_init(kind,key); sock.settimeout(seconds);sock.sendall(init+enc.update(frame(query_packet(nonce),kind)))
    answer=receive(sock,dec,kind,deadline)
    return valid_resp(answer,nonce),round((time.monotonic()-start)*1000)

def child_probe(n):
    kind,key=secret_bytes(n['secret'])
    if kind=='fake_tls':return {'status':'unsupported_fake_tls'}
    try:
        import cryptography
    except ImportError:return {'status':'missing_optional_crypto'}
    stage='dns'
    try:
        family,typ,proto,_,addr=resolve_global(n['host'],n['port']);stage='tcp'
        with socket.socket(family,typ,proto) as s:
            s.settimeout(4);t=time.monotonic();s.connect(addr);tcp=round((time.monotonic()-t)*1000);stage='mtproto';ok,ms=protocol_probe(s,kind,key)
        return {'status':'res_pq_received' if ok else 'unexpected_response','tcp_ms':tcp,'probe_ms':ms}
    except Exception as e:return {'status':stage+'_failed','error':type(e).__name__}

def run_probes(root,limit):
    try:
        import cryptography
    except ImportError:
        print('OPTIONAL DEPENDENCY MISSING: cryptography. No probes performed; bot unchanged.',file=sys.stderr);return 2
    d=private_dir(root)
    with locked(d/'probe.lock'):
        rows=candidates(root); supported=[n for n in rows if n['kind']!='fake_tls']; unsupported=len(rows)-len(supported)
        try:old=read_json(d/'probes.json'); start=int(old.get('next_offset',0))%max(1,len(supported)); history=old.get('results',[])
        except Exception:start=0;history=[]
        selected=(supported+supported)[start:start+min(limit,len(supported))]; results=[]
        for j,n in enumerate(selected):
            try:
                p=subprocess.run([sys.executable,str(Path(__file__).resolve()),'_child'],input=json.dumps(n),capture_output=True,text=True,timeout=15,check=True); result=json.loads(p.stdout)
            except Exception as e:result={'status':'probe_unconfirmed','error':type(e).__name__}
            result.update({'id':n['id'],'group':n['group'],'kind':n['kind'],'checked_at':utc()});results.append(result)
            print(f'{j+1}/{len(selected)} {n["group"]} {n["kind"]}: {result["status"]}',flush=True)
            if j+1<len(selected):time.sleep(1)
        old_rows=history if isinstance(history,list) else [];merged=(old_rows+results)[-1000:]
        summary={'checked_at':utc(),'available_supported':len(supported),'unsupported_fake_tls':unsupported,'tested':len(results),'responses':sum(r['status']=='res_pq_received' for r in results),'next_offset':(start+len(selected))%max(1,len(supported)),'results':merged,'note':'Private local measurements. Unauthenticated nonce-matching resPQ is evidence of protocol response, not cryptographic proof of server identity or safety. No list changes.'}
        write_json(d/'probes.json',summary);print(json.dumps({k:v for k,v in summary.items() if k!='results'},ensure_ascii=False,indent=2))

def rank(root,records,now=None):
    now=now or dt.datetime.now(dt.timezone.utc); grouped={}
    eligible={'res_pq_received','dns_failed','tcp_failed','mtproto_failed','unexpected_response'}
    for r in records:
        if not isinstance(r,dict) or r.get('status') not in eligible:continue
        try:
            t=dt.datetime.fromisoformat(r['checked_at'].replace('Z','+00:00'));age=(now-t).total_seconds()
            if not 0<=age<=86400:continue
            grouped.setdefault(r['id'],[]).append(r)
        except (ValueError,TypeError,KeyError):continue
    ranked=[]
    for node in candidates(root):
        rows=grouped.get(node['id'],[]);good=[x for x in rows if x['status']=='res_pq_received'];lat=[x['probe_ms'] for x in good if type(x.get('probe_ms')) is int and 0<=x['probe_ms']<=15000]
        if len(rows)<2 or not lat:continue
        ranked.append({'server':node['host'],'port':node['port'],'group':node['group'],'responses':len(good),'attempts':len(rows),'median_probe_ms':round(statistics.median(lat))})
    return sorted(ranked,key=lambda x:(-x['responses']/x['attempts'],-x['attempts'],x['median_probe_ms']))[:20]

def main():
    if sys.argv[1:]==['_child']:
        print(json.dumps(child_probe(json.load(sys.stdin))));return
    p=argparse.ArgumentParser();p.add_argument('action',choices=['check','watch','probe','report','rank']);p.add_argument('--root',type=Path,default=ROOT);p.add_argument('--limit',type=int,default=6);p.add_argument('--interval',type=int,default=120);a=p.parse_args();root=a.root.resolve()
    if not (root/'site/nodes.json').is_file() or not (root/'data/qmr.sqlite3').is_file():p.error('existing QMR project required')
    if not 1<=a.limit<=12 or not 120<=a.interval<=3600:p.error('limit 1..12 and interval 120..3600')
    if a.action=='check':run_health(root)
    elif a.action=='watch':
        with locked(private_dir(root)/'watch.lock'):
            while True:
                try:run_health(root)
                except OSError:print('sample unavailable',flush=True)
                time.sleep(a.interval)
    elif a.action=='probe':
        code=run_probes(root,a.limit)
        if code:sys.exit(code)
    elif a.action=='rank':
        try:records=read_json(private_dir(root)/'probes.json')['results']
        except Exception:records=[]
        print(json.dumps({'window_hours':24,'minimum_observations':2,'ranking':rank(root,records),'note':'Local, unauthenticated protocol response history only. No security assurance or automatic removal.'},ensure_ascii=False,indent=2))
    else:
        for name in ('latest.json','probes.json'):
            try:
                obj=read_json(private_dir(root)/name);obj.pop('results',None);print(name,json.dumps(obj,ensure_ascii=False,indent=2))
            except Exception:print(name,'not yet recorded')
if __name__=='__main__':
    try:main()
    except KeyboardInterrupt:print('Stopped by operator; bot untouched.')
    except (OSError,ValueError) as e:print('STOP:',type(e).__name__,file=sys.stderr);sys.exit(1)
