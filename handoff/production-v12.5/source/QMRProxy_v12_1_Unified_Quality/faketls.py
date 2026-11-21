#!/usr/bin/env python3
"""Opt-in FakeTLS protocol lab. Separate results; no production mutation."""
import argparse, base64, collections, hashlib, hmac, json, re, secrets, socket, struct, subprocess, sys, time
from pathlib import Path
import health_lab as lab
import quality
VERSION='v12.0-beta1'
FILE='faketls-v120.json'

def decode(raw):
    if not isinstance(raw,str) or len(raw)>684: raise ValueError('invalid secret')
    b=bytes.fromhex(raw) if re.fullmatch(r'[0-9a-fA-F]+',raw) and len(raw)%2==0 else base64.b64decode(raw+'='*((-len(raw))%4),altchars=b'-_',validate=True)
    if not 18<=len(b)<=270 or b[0]!=0xee: raise ValueError('invalid FakeTLS secret')
    domain=b[17:].decode('ascii')
    if len(domain)>253 or '.' not in domain or not all(re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?',p) for p in domain.split('.')): raise ValueError('invalid SNI')
    return b[1:17],domain.encode('ascii')

def u16(n):return struct.pack('>H',n)
def vec(b):return u16(len(b))+b
def ext(n,b):return u16(n)+vec(b)
def record(t,b,version=b'\x03\x03'):return bytes([t])+version+vec(b)
def mac(k,b):return hmac.digest(k,b,'sha256')

def client_hello(key,domain,now=None):
    # Build once: random/session/key share must not change after computing HMAC.
    from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding,PublicFormat
    pub=X25519PrivateKey.generate().public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)
    extensions=b''.join([ext(0,vec(b'\x00'+vec(domain))),ext(10,vec(bytes.fromhex('001d00170018'))),ext(13,vec(bytes.fromhex('040308040805040105010806'))),ext(43,b'\x04\x03\x04\x03\x03'),ext(51,vec(u16(29)+vec(pub))),ext(45,b'\x01\x01'),ext(16,vec(b'\x02h2\x08http/1.1')),ext(11,b'\x01\x00'),ext(23,b'')])
    prefix=b'\x03\x03'+b'\0'*32+b'\x20'+secrets.token_bytes(32)+vec(bytes.fromhex('130113021303c02bc02fc02cc030cca9cca8'))+b'\x01\x00'
    pad=max(0,517-(5+4+len(prefix)+2+len(extensions)+4))
    body=prefix+vec(extensions+ext(21,b'\0'*pad))
    wire=record(22,b'\x01'+len(body).to_bytes(3,'big')+body,b'\x03\x01')
    digest=mac(key,wire); stamp=int(time.time() if now is None else now).to_bytes(4,'little')
    rnd=digest[:28]+bytes(a^b for a,b in zip(digest[28:],stamp))
    return wire[:11]+rnd+wire[43:],rnd

class ProtocolError(Exception):pass

def recv_record(sock,deadline):
    header=lab.read_exact(sock,5,deadline)
    if header[1:3]!=b'\x03\x03':raise ProtocolError('record_version')
    n=int.from_bytes(header[3:5],'big')
    if n>18432:raise ProtocolError('record_size')
    data=lab.read_exact(sock,n,deadline)
    return header[0],data,header+data

def server_hello(sock,key,rnd,deadline):
    typ,p,a=recv_record(sock,deadline)
    if typ!=22 or len(p)<38 or p[0]!=2 or int.from_bytes(p[1:4],'big')!=len(p)-4 or p[4:6]!=b'\x03\x03':raise ProtocolError('server_hello_shape')
    t,p,b=recv_record(sock,deadline)
    if t!=20 or p!=b'\x01':raise ProtocolError('change_cipher_spec')
    t,p,c=recv_record(sock,deadline)
    if t!=23 or not p:raise ProtocolError('server_app_record')
    wire=a+b+c
    expected=mac(key,rnd+wire[:11]+b'\0'*32+wire[43:])
    if not hmac.compare_digest(expected,wire[11:43]):raise ProtocolError('server_hmac_mismatch')

class RecordStream:
    def __init__(self,sock,deadline):self.sock=sock;self.deadline=deadline;self.buffer=bytearray();self.first=True
    def settimeout(self,n):self.sock.settimeout(min(n,max(.001,self.deadline-time.monotonic())))
    def sendall(self,b):
        if self.first:self.sock.sendall(record(20,b'\x01'));self.first=False
        for off in range(0,len(b),16384):self.sock.sendall(record(23,b[off:off+16384]))
    def recv(self,n):
        for _ in range(32):
            if self.buffer:
                p=bytes(self.buffer[:n]);del self.buffer[:n];return p
            t,p,_=recv_record(self.sock,self.deadline)
            if t!=23:raise ProtocolError('unexpected_record')
            self.buffer.extend(p)
        raise ProtocolError('too_many_empty_records')

def exchange(sock,key,domain):
    t=time.monotonic();deadline=t+10;stage='fake_tls';verified=False;result={}
    try:
        hello,rnd=client_hello(key,domain);sock.settimeout(5);sock.sendall(hello)
        server_hello(sock,key,rnd,deadline);verified=True
        result['hello_ms']=round((time.monotonic()-t)*1000);stage='inner_mtproto'
        ok,ms=lab.protocol_probe(RecordStream(sock,deadline),'padded',key,seconds=max(.01,deadline-time.monotonic()),details=result)
        return dict(result,status='res_pq_received' if ok else 'inner_unconfirmed',hello_hmac_verified=True,probe_ms=ms,total_ms=round((time.monotonic()-t)*1000))
    except Exception as e:return dict(result,status=stage+'_unconfirmed',hello_hmac_verified=verified,reason=str(e) if isinstance(e,ProtocolError) else type(e).__name__)

def child(node):
    try:key,domain=decode(node['secret'])
    except Exception:return {'status':'invalid_secret','hello_hmac_verified':False}
    stage='dns'
    try:
        family,typ,proto,_,addr=lab.resolve_global(node['host'],node['port']);stage='tcp'
        with socket.socket(family,typ,proto) as s:
            s.settimeout(4);s.connect(addr);return exchange(s,key,domain)
    except Exception as e:return {'status':stage+'_unconfirmed','hello_hmac_verified':False,'reason':type(e).__name__}

def load(root):
    p=lab.private_dir(root)/FILE
    if not p.exists():return {'results':[],'offset':0}
    d=lab.read_json(p)
    if not isinstance(d,dict) or not isinstance(d.get('results'),list) or type(d.get('offset')) is not int:raise ValueError('invalid history')
    return d

def pool(root):return [n for n in lab.candidates(root) if n['kind']=='fake_tls']
def summary(root,d):
    current={n['id'] for n in pool(root)}; latest={}
    for r in d['results']:
        t=quality.epoch(r.get('checked_at'))
        if r.get('id') in current and r.get('version')==VERSION and t is not None and 0<=time.time()-t<=86400:latest[r['id']]=r
    return {'version':VERSION,'current_candidates':len(current),'unique_tested_24h':len(latest),'latest_states':dict(collections.Counter(r['status'] for r in latest.values())),'hello_matches':sum(r.get('hello_hmac_verified') is True for r in latest.values()),'next_offset':d['offset'],'note':'Experimental legacy-size ClientHello. Shared public secret HMAC is not identity/safety proof; failures inconclusive. No production changes.'}

def run(root,limit,retest):
    ddir=lab.private_dir(root)
    with lab.locked(ddir/'probe.lock'):
        d=load(root);nodes=pool(root)
        if not quality.health_gate(root,time.time()):raise SystemExit('STOP: recent healthy production sample required')
        if not nodes:return summary(root,d)
        start=d['offset']%len(nodes)
        if retest:
            ids=d.get('last_batch',[]);selected=[n for n in nodes if n['id'] in ids][:limit]
            if not selected:raise SystemExit('STOP: no previous current batch')
        else:selected=(nodes+nodes)[start:start+min(limit,len(nodes))]
        done=[]
        for n in selected:
            if not quality.health_gate(root,time.time()):break
            try:
                p=subprocess.run([sys.executable,str(Path(__file__).resolve()),'_child'],input=json.dumps(n),capture_output=True,text=True,timeout=18,check=True);r=json.loads(p.stdout)
                if not isinstance(r,dict):raise ValueError()
            except Exception as e:r={'status':'probe_unconfirmed','reason':type(e).__name__,'hello_hmac_verified':False}
            r.update(id=n['id'],checked_at=lab.utc(),version=VERSION);d['results']=(d['results']+[r])[-1000:];done.append(n['id']);d['last_batch']=done
            if not retest:d['offset']=(start+len(done))%len(nodes)
            lab.write_json(ddir/FILE,d);print('FakeTLS',r['status'],'HMAC:',r.get('hello_hmac_verified'),r.get('reason',''),flush=True)
            time.sleep(1)
        return summary(root,d)

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['probe','report','_child']);p.add_argument('--limit',type=int,default=6);p.add_argument('--retest',action='store_true');p.add_argument('--root',type=Path,default=lab.ROOT);a=p.parse_args()
    if a.action=='_child':print(json.dumps(child(json.load(sys.stdin))));return
    root=a.root.resolve()
    if not 1<=a.limit<=6 or not (root/'site/nodes.json').is_file() or not (root/'data/qmr.sqlite3').is_file():p.error('existing QMR project and limit 1..6 required')
    if a.action=='probe':
        import cryptography
        x=run(root,a.limit,a.retest)
    else:x=summary(root,load(root))
    print(json.dumps(x,indent=2))
if __name__=='__main__':
    try:main()
    except BlockingIOError:raise SystemExit('BUSY: existing quality cycle in progress; retry later')
    except (OSError,ValueError,ImportError) as e:raise SystemExit('STOP: '+type(e).__name__)
