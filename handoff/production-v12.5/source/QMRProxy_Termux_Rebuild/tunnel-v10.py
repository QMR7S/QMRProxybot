#!/usr/bin/env python3
"""Safe, version-aware recovery of QMRProxybot webhook via Cloudflare Quick Tunnel.

No token printing; no dropping updates; no blind registration. All writes require
verified local/public GET identity match, real POST/403 handler preflight and typed
operator confirmation. Does not replace bot.py, webhook.py, site, or SQLite schema.
"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

import qmr
import webhook

ROOT = Path(__file__).resolve().parent
PORT = 8765
SESSION = 'qmrproxy-tunnel-v10'
LOG_PATTERN = 'cloudflared-v10-*.log'
HOST_RE = re.compile(r'https://[a-z0-9-]+\.trycloudflare\.com(?![a-z0-9.-])', re.I)
EXPECTED_VERSION = 'v10-separated-20261120'
EXPECTED_BOT = 9239734904


def check_identity():
    if webhook.VERSION != EXPECTED_VERSION:
        raise RuntimeError('This repair tool requires QMR Proxy v10, not the current installed version.')
    api = qmr.Telegram(qmr.load_token())
    bot = qmr.check_bot(api)
    if int(bot.get('id', 0)) != EXPECTED_BOT or str(bot.get('username','')).lower() != 'qmrproxybot':
        raise RuntimeError('Bot identity mismatch. Refusing to modify Telegram.')
    return api


def health(base):
    try:
        data=webhook.fetch_health(base.rstrip('/')+'/healthz')
        if not isinstance(data,dict): return None,'invalid_payload'
        return data,'ok'
    except HTTPError as exc: return None, 'http_'+str(exc.code)
    except (URLError, TimeoutError, OSError, ValueError, RuntimeError) as exc:
        return None,type(exc).__name__


def local_health():
    data,reason=health(f'http://127.0.0.1:{PORT}')
    if data is None:raise RuntimeError('LOCAL unavailable: '+reason+'. Start current receiver using bash start-v10.sh')
    if data.get('service')!='qmrproxy' or data.get('version') != EXPECTED_VERSION or data.get('mode')!='webhook' or data.get('ready') is not True or not data.get('installation_id'):
        raise RuntimeError('Local webhook version/identity/readiness mismatch; refusing to alter Telegram.')
    return data


def identity_matches(local,remote):
    return (bool(remote) and all(local.get(key)==remote.get(key) for key in
        ('service','version','mode','installation_id')) and remote.get('ready') is True)


def probe_post(base):
    """Fake secret must produce the LOCAL app's own 403 JSON, never an enqueued update."""
    body=b'{"update_id":1}'
    req=Request(base+'/telegram-webhook',data=body,method='POST',headers={
        'Content-Type':'application/json',
        'X-Telegram-Bot-Api-Secret-Token':'qmr-preflight-invalid',
        'User-Agent':'QMRProxy-v10-transport-test'})
    try:
        with urlopen(req, timeout=12) as r:
            return False,'unexpected_http_'+str(r.status)
    except HTTPError as exc:
        if exc.code!=403:return False,'http_'+str(exc.code)
        try:
            payload=json.loads(exc.read(4096).decode('utf-8'))
        except (ValueError, UnicodeError):return False,'non_app_403'
        return (payload=={'error':'forbidden'},'app_forbidden' if payload=={'error':'forbidden'} else 'non_app_403')
    except (URLError,TimeoutError,OSError) as exc:
        return False,type(exc).__name__


def verify(local,base,*,post=True):
    remote,why=health(base)
    if remote is None:return False,'GET '+why
    if not identity_matches(local,remote):return False,'GET identity/version mismatch'
    if post:
        ok,reason=probe_post(base)
        if not ok:return False,'POST '+reason
    return True,'GET identity + POST route verified'


def webhook_base(info):
    u=info.get('url','') or ''
    p=urlsplit(u)
    if p.path!='/telegram-webhook' or p.query or p.fragment or p.scheme!='https':return None
    try:return webhook.https_url(f'{p.scheme}://{p.netloc}')
    except ValueError:return None


def diagnosed(api=None,local=None):
    local=local or local_health()
    api=api or check_identity()
    info=api.call('getWebhookInfo')
    base=webhook_base(info)
    print('LOCAL:',local['version'],'ready=True')
    print('TELEGRAM: @QMRProxybot /',EXPECTED_BOT)
    print('PENDING:',info.get('pending_update_count','?'))
    print('LAST DELIVERY ERROR:',str(info.get('last_error_message') or '(none)')[:160])
    print('WEBHOOK HOST:',urlsplit(base).hostname if base else '(unknown/not configured)')
    if base:
        ok,reason=verify(local,base)
    else:ok,reason=False,'Missing or unexpected webhook destination'
    print('PUBLIC:', 'PASS' if ok else 'FAIL',reason)
    return ok,base,info


def session_running():
    return subprocess.run(['tmux','has-session','-t',SESSION],stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL,check=False).returncode==0


def discover(path):
    try:
        log=path.read_text(encoding='utf8',errors='replace')
    except OSError:return None
    matches=HOST_RE.findall(log)
    return matches[-1].lower() if matches else None


def candidate_url():
    logs=sorted((ROOT/'logs').glob(LOG_PATTERN),key=lambda p:p.stat().st_mtime,reverse=True)
    for path in logs:
        url=discover(path)
        if url:return url,path
    return None,None


def start_tunnel():
    if not (shutil.which('tmux') and shutil.which('cloudflared')):
        raise RuntimeError('Run: pkg install -y tmux cloudflared')
    logs=ROOT/'logs';logs.mkdir(parents=True,exist_ok=True)
    path=logs/('cloudflared-v10-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')+'.log')
    fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
    cmd=(f'cd {shlex.quote(str(ROOT))} && '
         'TUNNEL_TRANSPORT_PROTOCOL=http2 '
         'cloudflared tunnel --url http://127.0.0.1:8765 --no-autoupdate '
         f'>> {shlex.quote(str(path))} 2>&1')
    subprocess.run(['tmux','new-session','-d','-s',SESSION,cmd],check=True)
    print('Started one NEW v10 tunnel; old production tunnel untouched.')
    print('LOG:',path)
    for _ in range(40):
        url=discover(path)
        if url:return url
        if not session_running():raise RuntimeError('Tunnel exited early; inspect log without sharing secrets.')
        time.sleep(1)
    raise RuntimeError('No public URL discovered; Telegram webhook unchanged.')


def candidate(local):
    if not session_running():return False,None,'V10 tunnel is not running'
    url,path=candidate_url()
    if not url:return False,None,'V10 tunnel has no URL'
    print('CANDIDATE HOST:',urlsplit(url).hostname)
    print('LOG:',path)
    ok,reason=verify(local,url)
    print('CANDIDATE:', 'PASS' if ok else 'FAIL',reason)
    return ok,url,reason


def activate(api, local, url, confirmed=False, expected_old_url=None):
    """Register a preflight-validated candidate with a one-step, auditable cutover.

    The v10.2 code did an extra unchecked GET in webhook.register(), causing an
    uncaught HTTPError 501 after a passing preflight. We preflight with typed
    errors here, recheck just before the switch, save a snapshot, and perform
    only one explicit Telegram setWebhook call. No delete/drop operations.
    """
    if not confirmed:
        return False
    target = webhook.https_url(url)
    parts = urlsplit(target)
    if parts.hostname is None or not parts.hostname.endswith('.trycloudflare.com'):
        raise RuntimeError('Candidate hostname is not a Cloudflare Quick Tunnel.')

    # A short, bounded retry handles transient 501/530 responses while not
    # bypassing any identity, route, version or Telegram-origin validation.
    for attempt in range(1, 5):
        ok, reason = verify(local, target)
        if ok:
            break
        if ('identity/version mismatch' in reason or 'non_app_403' in reason
                or 'unexpected_http_' in reason):
            raise RuntimeError('Unsafe preflight result; Telegram unchanged: '+reason)
        print('CUTOVER PREFLIGHT',attempt,'/4:',reason,flush=True)
        if attempt < 4:
            time.sleep(2)
    else:
        raise RuntimeError('Cutover preflight unavailable; Telegram unchanged: '+reason)

    actual = api.call('getWebhookInfo')
    if expected_old_url is not None and (actual.get('url') or '') != (expected_old_url or ''):
        raise RuntimeError('Webhook destination changed during recovery; refusing overwrite.')
    destination = target + '/telegram-webhook'
    print('CURRENT HOST:',urlsplit(actual.get('url') or '').hostname or '(none)')
    print('TARGET HOST:',parts.hostname)
    print('PENDING:',actual.get('pending_update_count', '?'))

    # Snapshot webhook configuration and local SQLite before changing Telegram.
    webhook.snapshot(api)
    secret = webhook.private_value(webhook.SECRET_FILE, create=False)

    print('STAGE: Telegram setWebhook (retaining pending updates)',flush=True)
    if not api.call('setWebhook', url=destination, secret_token=secret,
                    max_connections=4,
                    allowed_updates=['message','callback_query'],
                    drop_pending_updates=False):
        raise RuntimeError('Telegram rejected setWebhook; Telegram destination unverified.')
    state = api.call('getWebhookInfo')
    if state.get('url') != destination:
        raise RuntimeError('Telegram response did not confirm the new Webhook URL; inspect getWebhookInfo.')
    print('TELEGRAM: new Webhook host confirmed; pending:',state.get('pending_update_count','?'))
    try:
        with qmr.connect_db() as cx:
            qmr.setmeta(cx,'site_url',target)
            qmr.setmeta(cx,'webhook_active_url',destination)
    except Exception:
        print('WARNING: Telegram Webhook active, but local site URL metadata failed to update.')
    return True


def repair():
    local=local_health()
    api=check_identity()
    ok,old,info=diagnosed(api,local)
    if ok:
        print('Existing public webhook is healthy: no change needed.')
        return 0
    if session_running():
        usable,url,_=candidate(local)
        if not usable:
            print('Existing managed v10 tunnel is stale. Only its tmux session can be restarted.')
            if input('Type RESTART_V10_TUNNEL to restart that stale v10 tunnel: ').strip()!='RESTART_V10_TUNNEL':
                print('Cancelled. Telegram unchanged.');return 2
            subprocess.run(['tmux','kill-session','-t',SESSION],check=True)
            url=start_tunnel()
    else:
        if input('Type NEW_V10_TUNNEL to start a separate replacement tunnel: ').strip()!='NEW_V10_TUNNEL':
            print('Cancelled. Telegram unchanged.');return 2
        url=start_tunnel()
    print('NEW CANDIDATE HOST:',urlsplit(url).hostname)
    for i in range(1,25):
        if not session_running():
            print('STOP: tunnel exited; Telegram unchanged.');return 2
        valid,reason=verify(local,url)
        print(f'CHECK [{i}/24]:', 'PASS' if valid else reason,flush=True)
        if valid:break
        if 'identity/version mismatch' in reason or 'non_app_403' in reason:
            print('STOP: untrusted endpoint; Telegram unchanged.');return 2
        if i<24:time.sleep(5)
    else:
        print('No live candidate; Telegram unchanged. Inspect Cloudflare log.');return 2
    print('Webhook will be changed to the tested URL without dropping pending updates.')
    if input('Type ACTIVATE_QMR_V10 to apply: ').strip()!='ACTIVATE_QMR_V10':
        print('Cancelled. Telegram unchanged.');return 2
    if not activate(api,local,url,confirmed=True,expected_old_url=info.get('url','')):return 2
    print('Registered verified v10 webhook. Test /start and check Telegram pending count.')
    diagnosed(api,local)
    return 0


def main():
    parser=argparse.ArgumentParser(description='QMR Proxy v10 Cloudflare recovery; no token or DB deletion')
    parser.add_argument('action',choices=['diagnose','candidate','repair'])
    args=parser.parse_args()
    try:
        if args.action=='diagnose':
            ok,_,_=diagnosed();return 0 if ok else 2
        if args.action=='candidate':
            ok,_,_=candidate(local_health());return 0 if ok else 2
        return repair()
    except (RuntimeError,ValueError,qmr.APIError,OSError,subprocess.CalledProcessError) as exc:
        if isinstance(exc,qmr.APIError):
            print('ERROR: Telegram API',exc.code,exc.description[:100],file=sys.stderr)
        else:
            print('ERROR:',str(exc)[:160],file=sys.stderr)
        return 1

if __name__=='__main__':sys.exit(main())
