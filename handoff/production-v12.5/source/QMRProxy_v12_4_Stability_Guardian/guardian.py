#!/usr/bin/env python3
"""QMR v12.4: local supervisor. Never stops a process or modifies webhook."""
import argparse, contextlib, datetime as dt, hashlib, json, os, shlex, socket, subprocess, sys, time
from pathlib import Path
import base_monitor as lab
HERE=Path(__file__).resolve().parent
ROOT=lab.ROOT
SESSION='qmr-guardian-v124'
BOT='qmrproxy'; HEALTH='qmr-health-v117'; QUALITY='qmr-quality-v121'; TUNNEL='qmrproxy-tunnel-v10'
MIN_SAMPLES=3; MIN_SPAN=240; MAX_GAP=360; COOLDOWN=1800
SVC={BOT:('QMRProxy_Termux_Rebuild','webhook.py',['serve']),HEALTH:('QMRProxy_v12_3_Smart_Interface','monitor.py',['watch']),QUALITY:('QMRProxy_v12_1_Unified_Quality','unified.py',['watch','--interval','300','--limit','6'])}

def private(root):
    d=root/'data'/'v124-guardian'; d.mkdir(mode=0o700,exist_ok=True); os.chmod(d,0o700); return d

def tmux(*args):
    return subprocess.run(['tmux',*args],capture_output=True,text=True,timeout=10,check=True).stdout

def sessions():
    return set(tmux('list-sessions','-F','#{session_name}').splitlines())

def valid_files(root):
    m=lab.read_json(HERE/'manifest.json'); result={}
    for name in SVC:
        folder=SVC[name][0]; entries={k:v for k,v in m.items() if k.startswith(folder+'/')}
        try:
            result[name]=bool(entries) and all(hashlib.sha256((root.parent/k).read_bytes()).hexdigest()==v for k,v in entries.items())
        except OSError: result[name]=False
    return result

def epoch(s):
    try: return dt.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
    except (ValueError,TypeError,AttributeError): return 0

def read(path,default):
    try: return lab.read_json(path)
    except (OSError,ValueError,TypeError): return default

def age(path,field,now):
    r=read(path,{})
    t=epoch(r.get(field)) if isinstance(r,dict) else 0
    return round(now-t) if t and now>=t else None

def collect(root,now):
    names=sessions(); files=valid_files(root); h=lab.sample(root); now=time.time()
    d=root/'data'/'v117-health'; mon=read(d/'latest.json',{})
    ma=age(d/'latest.json','checked_at',now); qa=age(root/'site'/'quality-public-v119.json','generated_at',now)
    issues=[]
    for name in (BOT,HEALTH,QUALITY,TUNNEL):
        if name not in names: issues.append('missing:'+name)
    if not h['local_ready']:issues.append('receiver_unready')
    if h['telegram_identity']!='verified':issues.append('telegram_unverified')
    if h['public_ready'] is not True:issues.append('public_unverified')
    if type(h['pending_telegram']) is int and h['pending_telegram']>0:issues.append('telegram_pending')
    if (h.get('queue') or {}).get('dead',0):issues.append('dead_queue_nonzero')
    if 0<=now-epoch(h.get('last_delivery_error_utc'))<=300:issues.append('recent_delivery_error')
    if not isinstance(mon,dict) or mon.get('monitor_release')!='v12.3-health' or ma is None or ma>360:issues.append('health_report_stale_or_incompatible')
    if qa is None or qa>600:issues.append('quality_report_stale')
    for name,ok in files.items():
        if not ok:issues.append('source_unverified:'+name)
    for name,src in h['sources'].items():
        if not src['fresh']:issues.append('source_stale:'+name)
    return {'checked_at':lab.utc(),'version':'v12.4-guardian','sessions':{s:s in names for s in (BOT,HEALTH,QUALITY,TUNNEL)},'source_hashes':files,'local_ready':h['local_ready'],'public_ready':h['public_ready'],'telegram_identity':h['telegram_identity'],'pending_telegram':h['pending_telegram'],'queue':h['queue'],'last_delivery_error_utc':h['last_delivery_error_utc'],'health_age_seconds':ma,'quality_age_seconds':qa,'issues':sorted(issues)}

def confirmed(history,now):
    # Require consecutive distinct, recent observations and sufficient time span.
    if len(history)<MIN_SAMPLES:return []
    tail=history[-MIN_SAMPLES:]; times=[epoch(x.get('checked_at')) for x in tail]
    if not all(times) or not 0<=now-times[-1]<=MAX_GAP or times[-1]-times[0]<MIN_SPAN or any(not 0<b-a<=MAX_GAP for a,b in zip(times,times[1:])):return []
    return sorted(set.intersection(*(set(x.get('issues',[])) for x in tail)))

def local_port_free():
    # Conservative: refuse to start if listener or socket bind is unavailable.
    with socket.socket() as s:
        try:s.bind(('127.0.0.1',8765));return True
        except OSError:return False

def launch(root,name):
    folder,script,args=SVC[name]; cwd=root.parent/folder
    cmd='exec '+shlex.join([sys.executable,'-u',script,*args])
    if name==BOT:cmd+=' >> logs/bot.log 2>&1'
    elif name==QUALITY:cmd+=' >> unified.log 2>&1'
    tmux('new-session','-d','-s',name,'-c',str(cwd),cmd)

def recover(root,name,sample):
    # NO STOP, no force kill, no lock deletion. Existing names are left alone.
    if name not in SVC or name in sessions() or not valid_files(root).get(name):return 'refused_session_or_hash'
    d=root/'data'/'v117-health'
    locks={BOT:[root/'data'/'poll.lock'],HEALTH:[d/'watch.lock'],QUALITY:[d/'quality-watch.lock',d/'quality-publish-v119.lock',d/'probe.lock']}[name]
    if name==BOT:
        if sample.get('local_ready') is not False or sample.get('telegram_identity')!='verified' or not local_port_free():return 'refused_receiver_preflight'
        if not all((root/p).is_file() for p in ('data/qmr.sqlite3','.secrets/bot_token','.secrets/webhook_secret','.secrets/installation_id','data/poll.lock')):return 'refused_missing_existing_data'
    if name==QUALITY and not (sample.get('local_ready') is True and sample.get('public_ready') is True and sample.get('telegram_identity')=='verified' and sample.get('pending_telegram')==0 and sample.get('health_age_seconds') is not None and sample['health_age_seconds']<=360 and 'health_report_stale_or_incompatible' not in sample['issues'] and not (sample.get('queue') or {}).get('pending') and not (sample.get('queue') or {}).get('processing')):return 'refused_health_gate'
    try:
        # Same deployment lock as v11.6/v12.2. Existing worker locks checked without unlinking.
        with lab.locked(root/'data'/'v116-deployment.lock'):
            with contextlib.ExitStack() as st:
                for lock in locks:st.enter_context(lab.locked(lock))
            if name in sessions() or not valid_files(root).get(name):return 'refused_changed_preflight'
            if name==BOT and not local_port_free():return 'refused_port'
            launch(root,name)
        return 'start_requested_not_yet_verified'
    except BlockingIOError:return 'refused_busy_lock'
    except (OSError,subprocess.SubprocessError,ValueError):return 'start_failed'

def notify(root,text):
    if not valid_files(root).get(BOT):return False
    code='import qmr,sys; a=qmr.Telegram(qmr.load_token()); b=qmr.check_bot(a); assert b.get("username","").lower()=="qmrproxybot"; a.send(qmr.OWNER_ID,sys.stdin.read())'
    try:
        p=subprocess.run([sys.executable,'-B','-c',code],input=text,cwd=root,capture_output=True,text=True,timeout=35,check=True);return p.returncode==0
    except (OSError,subprocess.SubprocessError):return False

def valid_state(state):
    return state if isinstance(state,dict) and isinstance(state.get('history'),list) and isinstance(state.get('attempts'),dict) and isinstance(state.get('notified'),list) else {'history':[],'attempts':{},'notified':[],'last_notification_attempt':0}

def step(root,enable_recovery=False,enable_notify=False):
    d=private(root);now=time.time();s=collect(root,now);now=time.time()
    state=valid_state(read(d/'state.json',{}));state['history']=(state['history']+[s])[-360:]
    c=confirmed(state['history'],now);s['confirmed_issues']=c;actions=[]
    if enable_recovery:
        for name in (BOT,HEALTH,QUALITY):
            if 'missing:'+name not in c:continue
            if now-state['attempts'].get(name,0)<COOLDOWN:continue
            # Persist attempt BEFORE side effects; never rapid restart loops.
            state['attempts'][name]=now;lab.write_json(d/'state.json',state)
            actions.append({'service':name,'result':recover(root,name,s)})
            break # at most one service per cycle
    s['recovery_actions']=actions
    # Recovery notice only for a completely clear new sample, not a transient gap in confirmations.
    desired=c if c else ([] if not s['issues'] else state['notified'])
    if enable_notify and desired!=state['notified'] and s['telegram_identity']=='verified' and now-state.get('last_notification_attempt',0)>=COOLDOWN:
        state['last_notification_attempt']=now;lab.write_json(d/'state.json',state)
        text='QMR Proxy v12.4\n'+('تنبيه: '+', '.join(desired) if desired else 'عادت مؤشرات الصحة إلى الحالة السليمة.')+'\n'+s['checked_at']+'\nلا تغيير تلقائي للـWebhook.'
        s['owner_notification_sent']=notify(root,text)
        if s['owner_notification_sent']:state['notified']=desired
    lab.write_json(d/'state.json',state);lab.write_json(d/'latest.json',s);print(json.dumps(s,ensure_ascii=False,indent=2),flush=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['check','report','watch']);p.add_argument('--recover-missing',action='store_true');p.add_argument('--notify-owner',action='store_true');a=p.parse_args();root=ROOT.resolve()
    if not (root/'data'/'qmr.sqlite3').is_file():raise ValueError('existing QMR project required')
    if a.action=='check':
        if a.recover_missing or a.notify_owner:p.error('options only for watch')
        s=collect(root,time.time());print(json.dumps(s,indent=2));print('CHECK PASS' if all(s['source_hashes'].values()) else 'CHECK STOP: source mismatch');return 0 if all(s['source_hashes'].values()) else 1
    if a.action=='report':
        print(json.dumps(read(private(root)/'latest.json',{'status':'no guardian samples yet'}),indent=2));return 0
    with lab.locked(private(root)/'guardian.lock'):
        while True:
            try:step(root,a.recover_missing,a.notify_owner)
            except (OSError,ValueError,TypeError,KeyError,subprocess.SubprocessError) as e:print('GUARDIAN SAMPLE SKIPPED:',type(e).__name__,flush=True)
            time.sleep(120)
if __name__=='__main__':
    try:raise SystemExit(main())
    except KeyboardInterrupt:print('Guardian stopped; existing services untouched.')
    except (OSError,ValueError,subprocess.SubprocessError) as e:raise SystemExit('STOP: '+type(e).__name__)
