#!/usr/bin/env python3
"""Health-only migration. Never stops the bot/tunnel/quality worker."""
import argparse,json,os,re,shlex,subprocess,sys,time,datetime as dt
from pathlib import Path
import base_monitor as lab
HERE=Path(__file__).resolve().parent
SESSION='qmr-health-v117'
def tmux(*args):return subprocess.run(['tmux',*args],capture_output=True,text=True,check=True).stdout.strip()
def pane():
    rows=[r.split('\t') for r in tmux('list-panes','-a','-F','#{session_name}\t#{pane_id}\t#{pane_pid}').splitlines() if r.split('\t')[0]==SESSION]
    if len(rows)>1:raise ValueError('health session has multiple panes')
    return rows[0] if rows else None
def worker(row):
    _,target,pid=row
    if not re.fullmatch(r'%\d+',target) or not pid.isdecimal():raise ValueError('invalid pane')
    proc=Path('/proc')/pid;args=[x.decode() for x in (proc/'cmdline').read_bytes().split(b'\0') if x];cwd=(proc/'cwd').resolve()
    if not args or not re.fullmatch(r'python(?:3(?:\.\d+)?)?',Path(args[0]).name):raise ValueError('health pane is not Python')
    if cwd==Path.home()/'QMRProxy_v11_7_Health_Lab' and args[1:]==['-u','health_lab.py','watch','--interval','120']:return 'old'
    if cwd==HERE and args[1:]==['-u','monitor.py','watch']:return 'new'
    raise ValueError('unrecognized health pane command; no stop')
def check(root):
    if not lab.trusted(root):raise ValueError('expected exact v12.2 source hashes')
    r=lab.sample(root);print(json.dumps(r,indent=2),flush=True)
    if not (r['local_ready'] and r['public_ready'] and r['telegram_identity']=='verified'):raise ValueError('live identity/readiness not verified; no migration')
    return r
def switch(root):
    check(root); row=pane()
    if row:
        state=worker(row)
        if state=='new':print('MONITOR ALREADY ACTIVE');return
        # exact pane and current command; never act on names alone
        if pane()!=row or worker(row)!='old':raise ValueError('health worker changed')
        tmux('send-keys','-t',row[1],'C-c')
        for _ in range(40):
            if pane() is None:break
            time.sleep(.5)
        else:raise ValueError('old monitor did not exit; do not force stop')
    lock=lab.private_dir(root)/'watch.lock'
    with lab.locked(lock):pass
    cmd='exec '+shlex.quote(sys.executable)+' -u monitor.py watch'
    tmux('new-session','-d','-s',SESSION,'-c',str(HERE),cmd)
    start=time.time()
    for _ in range(75):
        if pane() is None:raise ValueError('new monitor exited; use manual watch command in README')
        try:
            r=lab.read_json(lab.private_dir(root)/'latest.json');t=dt.datetime.fromisoformat(r['checked_at']).timestamp()
            if r.get('monitor_release')=='v12.3-health' and t>=start-2 and r.get('local_ready') and r.get('public_ready') and r.get('telegram_identity')=='verified':
                print('MONITOR ACTIVE: v12.3-health; quality gate can resume');return
        except (OSError,ValueError,KeyError,TypeError):pass
        time.sleep(1)
    raise ValueError('new monitor started but fresh healthy sample not confirmed; inspect status, do not start duplicates')
def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['check','switch','watch','status']);a=p.parse_args();root=lab.ROOT.resolve()
    if a.action=='check':check(root);print('MONITOR CHECK PASS')
    elif a.action=='switch':switch(root)
    elif a.action=='status':print(json.dumps(lab.read_json(lab.private_dir(root)/'latest.json'),indent=2))
    else:
        if not lab.trusted(root):raise ValueError('unknown bot source')
        with lab.locked(lab.private_dir(root)/'watch.lock'):
            while True:
                try:lab.run_health(root)
                except OSError:print('sample unavailable',flush=True)
                time.sleep(120)
if __name__=='__main__':
    try:main()
    except KeyboardInterrupt:print('Monitor stopped; bot untouched.')
    except (OSError,ValueError,subprocess.SubprocessError,KeyError,TypeError) as e:raise SystemExit('STOP: '+str(e))
