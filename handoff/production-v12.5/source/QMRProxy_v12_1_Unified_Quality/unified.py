#!/usr/bin/env python3
"""Unified single local observer and compatible v11.9 publisher. No bot writes."""
import argparse, collections, datetime as dt, json, os, re, statistics, subprocess, sys, time
from pathlib import Path
import health_lab as lab
import quality as q
import faketls as f
VERSION='v12.1-beta1'
PUBLIC='quality-public-v119.json'
KINDS=('classic','padded','fake_tls')
FAKE_STATES={'res_pq_received','dns_unconfirmed','tcp_unconfirmed','fake_tls_unconfirmed','inner_mtproto_unconfirmed','inner_unconfirmed','probe_unconfirmed','invalid_secret'}

def stamp(t):return dt.datetime.fromtimestamp(t,dt.timezone.utc).isoformat(timespec='seconds')
def current(root):return lab.candidates(root)
def history(root):return q.load(root),f.load(root)
def index(nodes,normal,fake,now):
    byid={n['id']:n for n in nodes}; out=collections.defaultdict(list); last={}
    for rows,isfake in ((normal,False),(fake,True)):
        for r in rows:
            if not isinstance(r,dict) or not isinstance(r.get('id'),str):continue
            k=r['id'];n=byid.get(k); t=q.epoch(r.get('checked_at'))
            if not n or (n['kind']=='fake_tls')!=isfake or t is None or not 0<=now-t<=q.WINDOW:continue
            if isfake:
                if r.get('version')!=f.VERSION or r.get('status') not in FAKE_STATES:continue
            elif r.get('probe_version')!=lab.PROBE_VERSION:continue
            last[k]=max(t,last.get(k,0))
            status=r.get('status');ms=r.get('probe_ms')
            good=status=='res_pq_received' and type(ms) is int and 0<=ms<=15000 and (not isfake or r.get('hello_hmac_verified') is True)
            if status=='res_pq_received' and not good:continue
            # Unknown execution errors/invalid secret do not become endpoint failures.
            if not good and (status not in (FAKE_STATES if isfake else q.VALID) or status in ('probe_unconfirmed','invalid_secret')):continue
            out[k].append((t,{'status':'res_pq_received' if good else 'not_confirmed','probe_ms':ms if good else None}))
    return {k:sorted(v,key=lambda x:x[0]) for k,v in out.items()},last

def assess(node,rows,now):
    # Existing assessment computes gaps, span, median, jitter. For FakeTLS, an unconfirmed
    # exchange is not evidence of downtime; even repeated negatives only request retest.
    result=q.assessment(dict(node,kind='padded') if node['kind']=='fake_tls' else node,rows,now)
    result['kind']=node['kind']
    return result

def snapshot(root,now=None):
    now=time.time() if now is None else now
    nodes=current(root);normal,fake=history(root)
    obs,last=index(nodes,normal['results'],fake['results'],now)
    rows=[assess(n,obs.get(n['id'],[]),now) for n in nodes]
    for r in rows:
        # Existing UI may label stale data independently. Missing/invalid execution is not a failed probe.
        if r['state']=='untested' and r['id'] in last:r['state']='insufficient_evidence'
    return rows,last,normal,fake

def public_snapshot(rows,now,last_cycle):
    def bounded(v,lo,hi):return v if type(v) is int and lo<=v<=hi else None
    public={}
    for r in rows:
        if not re.fullmatch('[0-9a-f]{24}',r['id']):raise ValueError('bad id')
        n=bounded(r.get('observations'),0,1000) or 0
        public[r['id']]={'state':r['state'],'observations':n,'responses':bounded(r.get('responses'),0,n),'median_ms':bounded(r.get('median_probe_ms'),0,15000),'last_age_seconds':bounded(r.get('last_age_seconds'),0,86400)}
    if not public:raise ValueError('empty inventory: previous report retained')
    return {'schema':'qmr-public-quality-v119','engine':VERSION,'generated_at':stamp(now),'window_hours':24,'last_scheduler_measurement':stamp(last_cycle) if last_cycle is not None and 0<=now-last_cycle<=86400 else None,'states':dict(collections.Counter(r['state'] for r in public.values())),'total':len(public),'nodes':public}

def cycle_stamp(root,now):
    p=lab.private_dir(root)/'unified-cycle-v121.json'
    if not p.exists():return None
    t=q.epoch(lab.read_json(p).get('last_scheduler_measurement'))
    return t if t is not None and 0<=now-t<=86400 else None

def publish(root):
    now=time.time();rows,_,_,_=snapshot(root,now)
    site=root/'site';target=site/PUBLIC
    if site.is_symlink() or target.is_symlink() or not (site/'nodes.json').is_file():raise ValueError('invalid site')
    result=public_snapshot(rows,now,cycle_stamp(root,now));lab.write_json(target,result);os.chmod(target,0o644)
    return result

def select(nodes,last,now,limit):
    # Oldest first within each mode; take one candidate per available mode per round.
    # A large new feed cannot starve FakeTLS or DD in a full six-probe batch.
    pools={k:sorted((n for n in nodes if n['kind']==k and now-last.get(n['id'],0)>=q.MIN_GAP),key=lambda n:(last.get(n['id'],0),n['id'])) for k in KINDS}
    selected=[]
    while len(selected)<limit:
        choices=sorted((p for p in pools.values() if p),key=lambda p:(last.get(p[0]['id'],0),p[0]['id']))
        if not choices:break
        for p in choices:
            selected.append(p.pop(0))
            if len(selected)>=limit:break
    return selected

def call(node):
    path=Path(f.__file__ if node['kind']=='fake_tls' else lab.__file__).resolve()
    try:
        p=subprocess.run([sys.executable,str(path),'_child'],input=json.dumps(node),capture_output=True,text=True,timeout=18,check=True)
        r=json.loads(p.stdout)
        if not isinstance(r,dict) or not isinstance(r.get('status'),str):raise ValueError('bad child')
        return r
    except (OSError,ValueError,subprocess.SubprocessError):return {'status':'probe_unconfirmed'}

def cycle(root,limit):
    d=lab.private_dir(root)
    with lab.locked(d/'probe.lock'):
        normal,fake=history(root);nodes=current(root);now=time.time();_,last=index(nodes,normal['results'],fake['results'],now)
        if not q.health_gate(root,now):print('SKIP: healthy recent production sample required',flush=True);return 0
        count=0
        for n in select(nodes,last,now,limit):
            if not q.health_gate(root,time.time()):break
            r=call(n); ts=lab.utc();r.update(id=n['id'],checked_at=ts)
            if n['kind']=='fake_tls':
                r.update(version=f.VERSION);container=fake; filename=f.FILE
            else:
                r.update(probe_version=lab.PROBE_VERSION,kind=n['kind'],group=n['group']);container=normal;filename=lab.PROBE_FILE
            # Preserve existing report fields and manual offsets; retain prior 1000 entries policy.
            container['results']=(container['results']+[r])[-1000:]
            lab.write_json(d/filename,container)
            lab.write_json(d/'unified-cycle-v121.json',{'last_scheduler_measurement':ts,'version':VERSION})
            count+=1;print(n['kind'],r['status'],flush=True);time.sleep(1)
        return count

def summary(root):
    rows,_,_,_=snapshot(root)
    kinds={k:dict(collections.Counter(r['state'] for r in rows if r['kind']==k)) for k in KINDS}
    return {'engine':VERSION,'total':len(rows),'states':dict(collections.Counter(r['state'] for r in rows)),'by_kind':kinds,'note':'Local preliminary handshake evidence. FakeTLS negatives inconclusive; no safety guarantee or production list changes.'}

def rootcheck(root):
    if not (root/'data/qmr.sqlite3').is_file() or not (root/'site/nodes.json').is_file():raise ValueError('existing QMR project required')
    import cryptography
    rows,_,_,_=snapshot(root)
    if not rows:raise ValueError('no candidates')
    # Reject unrelated/incompatible UI, do not mutate its files.
    js=root/'site/quality-v119.js'
    if not js.is_file() or 'qmr-public-quality-v119' not in js.read_text():raise ValueError('v11.9 UI required')

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['check','report','once','watch']);p.add_argument('--root',type=Path,default=lab.ROOT);p.add_argument('--limit',type=int,default=6);p.add_argument('--interval',type=int,default=300);a=p.parse_args();root=a.root.resolve()
    if not 1<=a.limit<=6 or not 300<=a.interval<=3600:p.error('limit 1..6; interval 300..3600')
    rootcheck(root)
    if a.action in ('check','report'):
        print(json.dumps(summary(root),indent=2));print('HEALTH GATE:',q.health_gate(root,time.time()))
        if a.action=='check':print('CHECK PASS: compatible files/history; no probes or publication performed')
        return
    d=lab.private_dir(root)
    # Hold the exact locks used by both old workers; cannot publish concurrently with v11.9.
    with lab.locked(d/'quality-watch.lock'),lab.locked(d/'quality-publish-v119.lock'):
        while True:
            try:
                cycle(root,a.limit)
                r=publish(root);print(json.dumps({k:v for k,v in r.items() if k!='nodes'}),flush=True)
            except (OSError,ValueError,KeyError,TypeError) as e:
                if a.action=='once':raise
                print('SKIP:',type(e).__name__,flush=True)
            if a.action=='once':break
            # Keep reports fresh while probing at most once per interval.
            until=time.monotonic()+a.interval
            while time.monotonic()<until:
                time.sleep(min(120,max(0,until-time.monotonic())))
                if time.monotonic()>=until:break
                try:publish(root)
                except (OSError,ValueError,KeyError,TypeError) as e:print('PUBLISH SKIP:',type(e).__name__,flush=True)
if __name__=='__main__':
    try:main()
    except KeyboardInterrupt:print('Stopped; bot untouched.')
    except BlockingIOError:raise SystemExit('BUSY: old scheduler/publisher or unified service still holds its lock')
    except (OSError,ValueError,KeyError,TypeError,ImportError) as e:raise SystemExit('STOP: '+type(e).__name__)
