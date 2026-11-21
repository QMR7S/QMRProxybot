#!/usr/bin/env python3
"""Independent local quality scheduler; no bot, site or webhook writes."""
import argparse, collections, datetime as dt, json, math, statistics, subprocess, sys, time
from pathlib import Path
import health_lab as lab
WINDOW=86400
MIN_GAP=900
MIN_SPAN=1800
VALID={'res_pq_received','dns_failed','tcp_failed','mtproto_failed','unexpected_response'}

def epoch(s):
    try:
        x=dt.datetime.fromisoformat(s.replace('Z','+00:00'))
        return x.timestamp() if x.tzinfo else None
    except (AttributeError, ValueError, TypeError, OverflowError):return None

def load(root):
    path=lab.private_dir(root)/lab.PROBE_FILE
    if not path.exists():return {'results':[],'offsets':{}}
    obj=lab.read_json(path)
    if not isinstance(obj,dict) or not isinstance(obj.get('results'),list):raise ValueError('invalid history')
    return obj

def observations(records,now):
    groups=collections.defaultdict(list)
    for r in records:
        if not isinstance(r,dict) or r.get('probe_version')!=lab.PROBE_VERSION or not isinstance(r.get('id'),str) or r.get('status') not in VALID:continue
        t=epoch(r.get('checked_at'))
        if t is None or not 0<=now-t<=WINDOW:continue
        if r['status']=='res_pq_received' and (type(r.get('probe_ms')) is not int or not 0<=r['probe_ms']<=15000):continue
        groups[r['id']].append((t,r))
    return {k:sorted(v,key=lambda x:x[0]) for k,v in groups.items()}

def separated(rows):
    chosen=[]
    for t,r in rows:
        if not chosen or t-chosen[-1][0]>=MIN_GAP:chosen.append((t,r))
    return chosen

def assessment(node,rows,now):
    res={'id':node['id'],'server':node['host'],'port':node['port'],'kind':node['kind'],'group':node['group']}
    if node['kind']=='fake_tls':return dict(res,state='unsupported',observations=0)
    separated_rows=separated(rows)
    n=len(separated_rows);good=[r['probe_ms'] for _,r in separated_rows if r['status']=='res_pq_received'];p=len(good)/n if n else None
    span=round(separated_rows[-1][0]-separated_rows[0][0]) if n else 0
    age=round(now-rows[-1][0]) if rows else None
    # No score certifies safety. A DNS/network failure is a local observation only.
    if not n:state='untested'
    elif n<3 or span<MIN_SPAN:state='insufficient_evidence'
    elif age>6*3600:state='stale'
    elif p>=.9:state='responsive_sample'
    elif p<=1/3:state='retest_priority'
    else:state='variable_sample'
    return dict(res,state=state,observations=n,raw_attempts=len(rows),responses=len(good),response_rate=round(p,4) if p is not None else None,span_seconds=span,last_age_seconds=age,median_probe_ms=round(statistics.median(good)) if good else None,jitter_mad_ms=round(statistics.median(abs(x-statistics.median(good)) for x in good)) if len(good)>=2 else None)

def select(nodes,records,now,limit):
    obs=observations(records,now)
    # Also respect recent inconclusive attempts, preventing loops on child errors.
    last={}
    for r in records:
        if not isinstance(r,dict) or r.get('probe_version')!=lab.PROBE_VERSION or not isinstance(r.get('id'),str):continue
        t=epoch(r.get('checked_at'))
        if t is not None and 0<=now-t<=WINDOW:last[r['id']]=max(t,last.get(r['id'],0))
    pool=[x for x in nodes if x['kind']!='fake_tls' and now-last.get(x['id'],0)>=MIN_GAP]
    return sorted(pool,key=lambda x:(last.get(x['id'],0),len(obs.get(x['id'],[])),x['id']))[:limit]

def health_gate(root,now):
    try:
        x=lab.read_json(lab.private_dir(root)/'latest.json');t=epoch(x.get('checked_at'));q=x.get('queue',{})
        return (t is not None and 0<=now-t<=360 and x.get('release')==lab.RELEASE and x.get('local_ready') is True and x.get('public_ready') is True and x.get('telegram_identity')=='verified' and type(x.get('pending_telegram')) is int and x['pending_telegram']==0 and type(q.get('pending')) is int and q['pending']==0 and type(q.get('processing')) is int and q['processing']==0)
    except Exception:return False

def report(root,records,now):
    nodes=lab.candidates(root); obs=observations(records,now)
    rows=[assessment(n,obs.get(n['id'],[]),now) for n in nodes]
    order={'responsive_sample':0,'variable_sample':1,'insufficient_evidence':2,'untested':3,'stale':4,'retest_priority':5,'unsupported':6}
    rows.sort(key=lambda r:(order[r['state']],-(r.get('response_rate') or 0),-r['observations'],r.get('median_probe_ms') if r.get('median_probe_ms') is not None else 99999,r['id']))
    return {'schema':'qmr-quality-v118','checked_at':lab.utc(),'window_hours':24,'minimum_gap_seconds':MIN_GAP,'minimum_span_seconds':MIN_SPAN,'states':dict(collections.Counter(x['state'] for x in rows)),'total_current':len(rows),'nodes':rows,'note':'Local unauthenticated handshake measurements only. No security assurance, user speed guarantee, or production list changes.'}

def publish(root,records,now):
    obj=report(root,records,now);lab.write_json(lab.private_dir(root)/'quality-v118.json',obj)
    print(json.dumps({k:v for k,v in obj.items() if k!='nodes'},indent=2),flush=True)
    return obj

def cycle(root,limit):
    import cryptography
    d=lab.private_dir(root)
    with lab.locked(d/'probe.lock'):
        old=load(root);records=old['results']; now=time.time()
        if not health_gate(root,now):
            print('SKIP: recent healthy production sample required; no probes.',flush=True);return publish(root,records,now)
        selected=select(lab.candidates(root),records,now,limit)
        for n in selected:
            if not health_gate(root,time.time()):break
            try:
                p=subprocess.run([sys.executable,str(Path(lab.__file__).resolve()),'_child'],input=json.dumps(n),capture_output=True,text=True,timeout=15,check=True)
                result=json.loads(p.stdout)
                if not isinstance(result,dict):raise ValueError('invalid result')
            except Exception as e:result={'status':'probe_unconfirmed','error':type(e).__name__}
            result.update(id=n['id'],group=n['group'],kind=n['kind'],checked_at=lab.utc(),probe_version=lab.PROBE_VERSION)
            records=(records+[result])[-1000:];old.update(results=records,last_scheduler_at=lab.utc(),probe_version=lab.PROBE_VERSION,last_scheduler_status=result['status'])
            # Preserve prior manual-batch fields and offsets; scheduler has separate summary.
            lab.write_json(d/lab.PROBE_FILE,old)
            print(n['kind'],result['status'],flush=True);time.sleep(1)
        return publish(root,records,time.time())

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['report','rank','once','watch']);p.add_argument('--root',type=Path,default=lab.ROOT);p.add_argument('--limit',type=int,default=6);p.add_argument('--interval',type=int,default=300);a=p.parse_args();root=a.root.resolve()
    if not (root/'site/nodes.json').is_file() or not (root/'data/qmr.sqlite3').is_file():p.error('existing QMR project required')
    if not 1<=a.limit<=6 or not 300<=a.interval<=3600:p.error('limit 1..6; interval 300..3600')
    d=lab.private_dir(root)
    if a.action in ('report','rank'):
        with lab.locked(d/'probe.lock'):
            obj=publish(root,load(root)['results'],time.time())
            if a.action=='rank':
                ranked=[{k:v for k,v in row.items() if k!='id'} for row in obj['nodes'] if row['state'] in ('responsive_sample','variable_sample','retest_priority')]
                print(json.dumps({'ranked_sample':ranked[:20]},indent=2),flush=True)
    elif a.action=='once':cycle(root,a.limit)
    else:
        with lab.locked(d/'quality-watch.lock'):
            while True:
                try:cycle(root,a.limit)
                except BlockingIOError:print('SKIP: another probe in progress',flush=True)
                except (OSError,ValueError) as e:print('SKIP:',type(e).__name__,flush=True)
                time.sleep(a.interval)
if __name__=='__main__':
    try:main()
    except KeyboardInterrupt:print('Stopped; production untouched.')
    except (OSError,ValueError,ImportError) as e:print('STOP:',type(e).__name__,file=sys.stderr);sys.exit(1)
