#!/usr/bin/env python3
"""QMR Proxy v10: independent webhook transport with durable SQLite inbox.

This module deliberately does not use the legacy v8 HTTP/webhook functions.
It retains only the tested business Engine and database schema, preserving
users and queued updates during a controlled replacement. One active bot
receiver only. No tokens, secrets or session data are packaged.
"""
from __future__ import annotations
import argparse
import contextlib
import datetime as dt
import fcntl
import hmac
import http.server
import json
import logging
import os
from pathlib import Path
import secrets
import signal
import sqlite3
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import qmr as core
import boards

ROOT=Path(__file__).resolve().parent
STORE=ROOT/'data'
SECRETS=ROOT/'.secrets'
BACKUPS=ROOT/'backups'
SITE=ROOT/'site'
TOKEN_FILE=SECRETS/'bot_token'
SECRET_FILE=SECRETS/'webhook_secret'
INSTALL_FILE=SECRETS/'installation_id'
PORT=int(os.environ.get('QMR_PORT','8765'))
MAX_PAYLOAD=512*1024
MAX_ATTEMPTS=12
VERSION='v10-separated-20261120'
APP_RELEASE='v11.6-stable-20261121'
HEADER='X-Telegram-Bot-Api-Secret-Token'
log=logging.getLogger('qmr.webhook')

def now():return int(time.time())

def mkdirs():
    for p in (STORE,SECRETS,BACKUPS,SITE,ROOT/'logs'):p.mkdir(parents=True,exist_ok=True)
    os.chmod(SECRETS,0o700)

def private_value(path:Path, *, create=False):
    mkdirs()
    if create and not path.exists():
        val=secrets.token_urlsafe(40)
        fd=os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
        with os.fdopen(fd,'w',encoding='ascii') as stream:stream.write(val+'\n')
    if not path.is_file():raise RuntimeError('Missing locally saved credential: '+path.name)
    if (path.stat().st_mode & 0o077):
        os.chmod(path,0o600)
    val=path.read_text(encoding='ascii').strip()
    if len(val)<30:raise RuntimeError('Invalid local credential: '+path.name)
    return val

def inbox(cx):
    """Additive schema; reuses v8 webhook_updates so old pending rows survive."""
    cx.executescript('''
    CREATE TABLE IF NOT EXISTS webhook_updates(
       update_id INTEGER PRIMARY KEY, payload TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
       next_attempt INTEGER NOT NULL DEFAULT 0, received_at INTEGER NOT NULL,
       last_error TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS qmr_v9_inbox_due ON webhook_updates(status,next_attempt,update_id);
    ''')
    return cx

def connect():return inbox(core.connect_db())

def queue_stats(cx):
    rows=cx.execute('SELECT status, COUNT(*) AS qty FROM webhook_updates GROUP BY status').fetchall()
    return {str(row['status']):int(row['qty']) for row in rows}

def installation_id():return private_value(INSTALL_FILE,create=True)

def masked_url(url):
    p=urlparse(url)
    return f'{p.scheme}://{p.hostname or ""}/…' if url else '(none)'

def https_url(value):
    p=urlparse(value)
    if p.scheme!='https' or not p.hostname or p.username or p.password or p.fragment or p.port not in (None,443):
        raise ValueError('Webhook must use a public https:// hostname with no credentials or fragment')
    if p.path not in ('','/') or p.query:raise ValueError('Provide the HTTPS site root only, without a path or query')
    if p.hostname in ('localhost','127.0.0.1','0.0.0.0') or p.hostname.endswith('.local'):
        raise ValueError('A loopback address cannot be the public webhook')
    return value.rstrip('/')

def json_bytes(data):return json.dumps(data,ensure_ascii=False,separators=(',',':')).encode('utf-8')

class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def __init__(self,*a,**k):super().__init__(*a,directory=str(SITE),**k)
    def log_message(self,fmt,*args):
        # Do not log URLs with query strings: MTProto links contain secrets.
        log.info('http %s %s',self.command,self.path.split('?',1)[0][:100])
    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        # Mini Apps are embedded by Telegram Web from a different origin; no X-Frame-Options.
        self.send_header('Cache-Control','no-store' if self.path.startswith(('/healthz','/readyz','/api/','/ops/','/admin/')) else 'max-age=0')
        super().end_headers()
    def respond(self,code,payload):
        body=json_bytes(payload)
        self.send_response(code)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        with contextlib.suppress(OSError):self.wfile.write(body)
    def do_GET(self):
        if self.path.startswith('/api/'):
            try:self.respond(200,boards.api_get(self))
            except boards.AccessError as exc:self.respond(exc.code,{'error':exc.error})
            except (OSError,sqlite3.Error):log.exception('Admin GET unavailable');self.respond(503,{'error':'storage_unavailable'})
            return
        if self.path in ('/healthz','/readyz'):
            ready=self.server.worker.is_alive() and not self.server.stop.is_set()
            details={'service':'qmrproxy','version':VERSION,'mode':'webhook',
                     'ready':bool(ready),'release':APP_RELEASE,'smart_release':core.SMART_RELEASE,'installation_id':self.server.installation_id}
            if self.path=='/readyz':
                try:
                    db=connect()
                    try:details['inbox']=queue_stats(db)
                    finally:db.close()
                except sqlite3.Error:ready=False;details['ready']=False
            self.respond(200 if ready else 503,details);return
        if self.path.startswith(('/.','/data/','/.secrets/','/backups/')):
            self.respond(404,{'error':'not_found'});return
        super().do_GET()
    def do_POST(self):
        if self.path.startswith('/api/'):
            try:self.respond(200,boards.api_post(self))
            except boards.AccessError as exc:self.respond(exc.code,{'error':exc.error})
            except (OSError,sqlite3.Error):log.exception('Admin POST unavailable');self.respond(503,{'error':'storage_unavailable'})
            return
        if self.path!='/telegram-webhook':self.respond(404,{'error':'not_found'});return
        provided=self.headers.get(HEADER,'')
        if not provided or not hmac.compare_digest(provided,self.server.auth_secret):
            self.respond(403,{'error':'forbidden'});return
        try:size=int(self.headers.get('Content-Length',''))
        except (TypeError,ValueError):size=-1
        if size<1 or size>MAX_PAYLOAD:
            self.respond(413,{'error':'invalid_size'});return
        if 'application/json' not in self.headers.get('Content-Type','application/json').lower():
            self.respond(415,{'error':'content_type'});return
        try:
            raw=self.rfile.read(size)
            if len(raw)!=size:raise ValueError('truncated')
            message=json.loads(raw.decode('utf-8'))
            if not isinstance(message,dict) or type(message.get('update_id')) is not int or message['update_id']<0:
                raise ValueError('invalid update')
        except (ValueError,UnicodeError):
            self.respond(400,{'error':'invalid_json'});return
        if self.server.stop.is_set() or not self.server.worker.is_alive():
            self.respond(503,{'error':'worker_unavailable'});return
        try:
            cx=connect()
            try:
                # Durably enqueue before replying 200; duplicated update IDs are idempotent.
                cx.execute('INSERT OR IGNORE INTO webhook_updates(update_id,payload,received_at) VALUES(?,?,?)',
                           (message['update_id'],raw.decode('utf-8'),now()))
            finally:cx.close()
        except sqlite3.Error:
            log.exception('Database enqueue error (Telegram should retry)')
            self.respond(503,{'error':'storage_unavailable'});return
        self.respond(200,{'ok':True})

class Worker(threading.Thread):
    def __init__(self,stop,api):
        super().__init__(daemon=True,name='qmr-v9-queue')
        self.stop=stop;self.api=api
    def run(self):
        cx=connect()
        try:
            cx.execute("UPDATE webhook_updates SET status='pending' WHERE status='processing'")
            engine=core.Engine(self.api,cx)
            while not self.stop.is_set():
                row=cx.execute("SELECT update_id,payload,attempts FROM webhook_updates WHERE status='pending' AND next_attempt<=? ORDER BY update_id LIMIT 1",(now(),)).fetchone()
                if not row:
                    self.stop.wait(.25);continue
                ident=row['update_id'];attempts=int(row['attempts'])+1
                cx.execute("UPDATE webhook_updates SET status='processing',attempts=? WHERE update_id=?",(attempts,ident))
                try:
                    engine.process(json.loads(row['payload']))
                except Exception as error:
                    # A single bad update must never block later messages indefinitely.
                    if attempts>=MAX_ATTEMPTS:
                        cx.execute("UPDATE webhook_updates SET status='dead',last_error=? WHERE update_id=?",(type(error).__name__,ident))
                        log.error('Update id=%s held in dead-letter queue after %s failures',ident,attempts)
                    else:
                        delay=min(300,2**min(attempts,8))
                        cx.execute("UPDATE webhook_updates SET status='pending',next_attempt=?,last_error=? WHERE update_id=?",(now()+delay,type(error).__name__,ident))
                        log.warning('Update id=%s delayed; attempt=%s; class=%s',ident,attempts,type(error).__name__)
                else:
                    # Scrub message bodies but keep the ID for deduplication.
                    cx.execute("UPDATE webhook_updates SET status='done',payload='{}',last_error='' WHERE update_id=?",(ident,))
                    if ident%500==0:
                        cx.execute("DELETE FROM webhook_updates WHERE status='done' AND received_at<?",(now()-30*86400,))
        finally:cx.close()

def source_refresher(stop):
    while not stop.is_set():
        try:core.refresh_source()
        except Exception as exc:log.warning('Original source update failed; retained last snapshot: %s',type(exc).__name__)
        try:core.refresh_extra_source()
        except Exception as exc:log.warning('Extra source update failed; retained last snapshot: %s',type(exc).__name__)
        stop.wait(1800)

def serve(api,port=PORT):
    mkdirs()
    bot=core.check_bot(api)
    if bot.get('username','').lower()!='qmrproxybot':
        raise RuntimeError('Bot username mismatch; refusing to start')
    auth=private_value(SECRET_FILE,create=True)
    ident=installation_id()
    stop=threading.Event()
    with (STORE/'poll.lock').open('w') as lock:
        try:fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('Another Polling/Webhook worker is running. Stop it before cutover.')
        worker=Worker(stop,api)
        worker.start()
        thread=threading.Thread(target=source_refresher,args=(stop,),daemon=True,name='qmr-v9-feed')
        thread.start()
        httpd=http.server.ThreadingHTTPServer(('127.0.0.1',port),Handler)
        httpd.daemon_threads=True
        httpd.auth_secret=auth;httpd.installation_id=ident
        httpd.stop=stop;httpd.worker=worker
        def shutdown(signum,frame):stop.set();threading.Thread(target=httpd.shutdown,daemon=True).start()
        if threading.current_thread() is threading.main_thread():
            signal.signal(signal.SIGINT,shutdown);signal.signal(signal.SIGTERM,shutdown)
        log.info('QMR v9 receiver ready on localhost:%s, bot id=%s, no auto webhook changes',port,core.EXPECTED_BOT_ID)
        try:httpd.serve_forever(poll_interval=.2)
        finally:
            stop.set();httpd.server_close();worker.join();thread.join(timeout=2)

def fetch_health(url):
    with urlopen(Request(url,headers={'User-Agent':'QMRProxy-v9-preflight'}),timeout=12) as response:
        if response.status!=200:raise RuntimeError('Health status was not HTTP 200')
        data=json.load(response)
        if not isinstance(data,dict):raise RuntimeError('Invalid health payload')
        return data

def audit(api,base=None,local_port=PORT):
    bot=core.check_bot(api)
    info=api.call('getWebhookInfo')
    cx=connect()
    try:stats=queue_stats(cx)
    finally:cx.close()
    print('Identity: @'+str(bot.get('username'))+' / '+str(bot['id']))
    print('Telegram webhook:',masked_url(info.get('url','')))
    print('Pending Telegram:',info.get('pending_update_count','unknown'))
    print('Last delivery error:',str(info.get('last_error_message') or '(none)')[:160])
    print('Local queues:',stats)
    try:
        health=fetch_health(f'http://127.0.0.1:{local_port}/healthz')
        print('Local ready:',health.get('version'),health.get('ready'))
    except Exception as exc:print('Local ready: unavailable ('+type(exc).__name__+')')
    if base:
        remote=fetch_health(https_url(base)+'/healthz')
        print('Public ready:',remote.get('version'),remote.get('ready'))
    return info

def snapshot(api):
    mkdirs()
    stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
    directory=BACKUPS/('v9-preflight-'+stamp)
    directory.mkdir(mode=0o700)
    old=api.call('getWebhookInfo')
    filename=directory/'webhook-private.json'
    fd=os.open(filename,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf8') as fp:
        json.dump(old,fp,ensure_ascii=False,indent=2)
    with connect() as src:
        with sqlite3.connect(directory/'qmr.sqlite3') as dest:src.backup(dest)
    os.chmod(directory/'qmr.sqlite3',0o600)
    print('Backup: '+str(directory))
    return old

def register(api,base,confirmation=None):
    base=https_url(base)
    local=fetch_health(f'http://127.0.0.1:{PORT}/healthz')
    public=fetch_health(base+'/healthz')
    required={'service':'qmrproxy','version':VERSION,'mode':'webhook','ready':True}
    for key,val in required.items():
        if local.get(key)!=val or public.get(key)!=val:
            raise RuntimeError(f'Preflight failed: local/public {key} mismatch')
    if not local.get('installation_id') or not hmac.compare_digest(str(local['installation_id']),str(public.get('installation_id',''))):
        raise RuntimeError('Preflight failed: public URL routes to another instance')
    bot=core.check_bot(api)
    if bot.get('username','').lower()!='qmrproxybot':raise RuntimeError('Unexpected username')
    old=api.call('getWebhookInfo')
    dest=base+'/telegram-webhook'
    print('Current:',masked_url(old.get('url','')))
    print('Target:',masked_url(dest))
    print('Pending Telegram:',old.get('pending_update_count'))
    if old.get('url')==dest:
        print('Target already selected; will re-register secret safely if confirmed.')
    else:
        print('WARNING: this will replace the current webhook destination, not delete it.')
    if confirmation is None:confirmation=input('Type ACTIVATE_QMR_V9 to confirm cutover: ').strip()
    if confirmation!='ACTIVATE_QMR_V9':
        print('Cancelled: no Telegram settings changed.');return False
    snapshot(api)
    secret=private_value(SECRET_FILE,create=False)
    if not api.call('setWebhook',url=dest,secret_token=secret,
               max_connections=4,allowed_updates=['message','callback_query'],drop_pending_updates=False):
        raise RuntimeError('setWebhook rejected')
    state=api.call('getWebhookInfo')
    if state.get('url')!=dest:raise RuntimeError('Bot API did not confirm the target URL')
    print('Active: '+masked_url(dest)+' / pending='+str(state.get('pending_update_count','unknown')))
    return True

def main(argv=None):
    parser=argparse.ArgumentParser(description='QMR Proxy v9 independent Telegram webhook gateway')
    sub=parser.add_subparsers(dest='action',required=True)
    sub.add_parser('serve');sub.add_parser('audit');sub.add_parser('snapshot')
    go=sub.add_parser('activate');go.add_argument('https_site_root')
    args=parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO,format='%(asctime)s [%(levelname)s] %(message)s')
    mkdirs()
    token=core.load_token()
    api=core.Telegram(token)
    if args.action=='serve':return serve(api)
    if args.action=='audit':return audit(api)
    if args.action=='snapshot':return snapshot(api)
    if args.action=='activate':return register(api,args.https_site_root)

if __name__=='__main__':
    try:main()
    except (RuntimeError,ValueError,core.APIError,HTTPError,URLError,sqlite3.Error) as error:
        print('ERROR:',str(error)[:200] if not isinstance(error,core.APIError) else f'Bot API {error.code}: {error.description}',flush=True)
        raise SystemExit(1)
