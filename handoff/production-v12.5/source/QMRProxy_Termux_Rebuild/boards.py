#!/usr/bin/env python3
"""QMR Proxy v10 privileged dashboards.

Only Telegram-signed Mini App initData authorizes any dashboard API request.
The public website and Mini App never receive administrator data or tokens.
No alternative user/password or URL query access is accepted.
"""
from __future__ import annotations
import hashlib
import contextlib
import hmac
import json
from pathlib import Path
import re
import sqlite3
import time
from urllib.parse import parse_qsl, urlsplit
import qmr as core

MAX_AUTH_AGE = 3600
MAX_BODY = 4096
MAX_INIT = 8192
OPERATORS_FILE = core.SECRETS / 'operators.allow'

class AccessError(Exception):
    def __init__(self, code=403, error='forbidden'):
        self.code=code
        self.error=error
        super().__init__(error)


def signed_user(init_data, bot_token, when=None):
    """Check Telegram WebApp signature, replay window, and validated Telegram id."""
    if not isinstance(init_data,str) or not init_data or len(init_data)>MAX_INIT:
        raise AccessError(401,'telegram_sign_in_required')
    try:
        fields=parse_qsl(init_data,keep_blank_values=True,strict_parsing=True,max_num_fields=64)
        values=dict(fields)
        if len(values)!=len(fields):raise ValueError('duplicate field')
        claimed=values.pop('hash','')
        if not re.fullmatch(r'[a-fA-F0-9]{64}',claimed):raise ValueError('invalid hash')
        signed='\n'.join(f'{k}={v}' for k,v in sorted(values.items()))
        secret=hmac.new(b'WebAppData',bot_token.encode('utf-8'),hashlib.sha256).digest()
        actual=hmac.new(secret,signed.encode('utf-8'),hashlib.sha256).hexdigest()
        if not hmac.compare_digest(actual,claimed.lower()):raise ValueError('bad signature')
        auth=int(values.get('auth_date',''))
        current=int(time.time() if when is None else when)
        if auth>current+60 or current-auth>MAX_AUTH_AGE:raise ValueError('expired')
        user=json.loads(values.get('user',''))
        uid=user.get('id') if isinstance(user,dict) else None
        if type(uid) is not int or uid<=0:raise ValueError('invalid id')
        return uid
    except (ValueError,TypeError,KeyError,UnicodeError) as exc:
        raise AccessError(401,'invalid_or_expired_telegram_signature') from None


def operator_ids():
    # Optional local allowlist (Telegram numeric ids only), not shipped in source.
    try:
        lines=OPERATORS_FILE.read_text(encoding='ascii').splitlines()
    except FileNotFoundError:
        return set()
    allowed=set()
    for line in lines:
        line=line.strip()
        if re.fullmatch(r'[1-9][0-9]{3,18}',line):allowed.add(int(line))
    return allowed


def authorize(request, required):
    # Signed initData is mandatory. Do not trust forwarded Host/Origin values: a
    # tunnel may rewrite Host to 127.0.0.1 while retaining the public Origin.
    # This API emits no CORS headers, so foreign browser origins cannot read it.
    uid=signed_user(request.headers.get('X-Telegram-Init-Data',''),core.load_token())
    if required=='admin':
        if uid!=core.OWNER_ID:raise AccessError(403,'owner_only')
    elif uid!=core.OWNER_ID and uid not in operator_ids():
        raise AccessError(403,'operator_access_required')
    return uid


def audit(cx, uid, action, target):
    cx.execute('''CREATE TABLE IF NOT EXISTS board_audit (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       actor INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
       created_at INTEGER NOT NULL)''')
    cx.execute('INSERT INTO board_audit(actor,action,target,created_at) VALUES(?,?,?,?)',
               (uid,action,str(target)[:80],int(time.time())))


def overview(cx):
    t=int(time.time())
    users=cx.execute('''SELECT COUNT(*) total,
        COALESCE(SUM(CASE WHEN last_seen>=? THEN 1 ELSE 0 END),0) active,
        COALESCE(SUM(blocked),0) blocked,
        COALESCE(SUM(requests),0) requests
        FROM users''',(t-7*86400,)).fetchone()
    queues=dict(cx.execute('SELECT status,COUNT(*) FROM webhook_updates GROUP BY status').fetchall())
    broadcasts=dict(cx.execute('SELECT status,COUNT(*) FROM broadcasts GROUP BY status').fetchall())
    source={}
    try:
        data=json.loads((core.SITE/'nodes.json').read_text(encoding='utf-8'))
        source={'count':len(data.get('nodes',[])),
                'checked_at':str(data.get('source_checked_at') or data.get('updated_at') or ''),
                'origin':'third_party'}
    except (OSError,ValueError,TypeError):source={'count':0,'checked_at':'','origin':'unknown'}
    return {'updated_at':t,'webhook':{'mode':'webhook','receiver':'ready',
                'inbox':{k:int(queues.get(k,0)) for k in ('pending','processing','done','dead')}},
            'activity':{'users':int(users['total']),'active_7d':int(users['active']),
                        'blocked':int(users['blocked']),'requests':int(users['requests'])},
            'broadcasts':{k:int(broadcasts.get(k,0)) for k in ('draft','sending','done','cancelled')},
            'source':source}


def admin_summary(cx):
    data=overview(cx)
    data['maintenance']=core.getmeta(cx,'maintenance','0')=='1'
    data['owner_id']=core.OWNER_ID
    return data


def list_users(cx,limit=25):
    return [dict(row) for row in cx.execute('''SELECT uid,first_seen,last_seen,requests,blocked
             FROM users ORDER BY last_seen DESC LIMIT ?''',(limit,)).fetchall()]


def list_audit(cx):
    cx.execute('''CREATE TABLE IF NOT EXISTS board_audit (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       actor INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL,
       created_at INTEGER NOT NULL)''')
    return [dict(row) for row in cx.execute('SELECT actor,action,target,created_at FROM board_audit ORDER BY id DESC LIMIT 20')]


def apply_admin(cx, uid, payload):
    if not isinstance(payload,dict):raise AccessError(400,'invalid_json')
    action=payload.get('action')
    if action=='maintenance':
        state=payload.get('enabled')
        if type(state) is not bool or payload.get('confirm')!='CONFIRM':
            raise AccessError(400,'confirmation_required')
        core.setmeta(cx,'maintenance','1' if state else '0')
        audit(cx,uid,'maintenance','on' if state else 'off')
        return {'ok':True,'maintenance':state}
    if action in ('ban','unban'):
        ident=payload.get('uid')
        if type(ident) is not int or ident<=0 or ident==core.OWNER_ID or payload.get('confirm')!='CONFIRM':
            raise AccessError(400,'invalid_id_or_confirmation')
        value=1 if action=='ban' else 0
        t=int(time.time())
        cx.execute('''INSERT INTO users(uid,first_seen,last_seen,blocked) VALUES(?,?,?,?)
          ON CONFLICT(uid) DO UPDATE SET blocked=excluded.blocked''',(ident,t,t,value))
        audit(cx,uid,action,ident)
        return {'ok':True,'uid':ident,'blocked':bool(value)}
    raise AccessError(400,'unsupported_action')


def api_get(request):
    path=urlsplit(request.path).path
    if path=='/api/ops/overview':
        authorize(request,'ops')
        with contextlib.closing(core.connect_db()) as cx:return overview(cx)
    if path.startswith('/api/admin/'):
        authorize(request,'admin')
        with contextlib.closing(core.connect_db()) as cx:
            if path=='/api/admin/summary':return admin_summary(cx)
            if path=='/api/admin/users':return {'users':list_users(cx)}
            if path=='/api/admin/audit':return {'events':list_audit(cx)}
    raise AccessError(404,'not_found')


def api_post(request):
    path=urlsplit(request.path).path
    if path!='/api/admin/action':raise AccessError(404,'not_found')
    uid=authorize(request,'admin')
    if request.headers.get('Content-Type','').split(';')[0].strip().lower()!='application/json':
        raise AccessError(415,'json_required')
    try:
        size=int(request.headers.get('Content-Length',''))
        if size<=0 or size>MAX_BODY:raise ValueError()
        raw=request.rfile.read(size)
        payload=json.loads(raw)
    except (ValueError,TypeError,UnicodeError):raise AccessError(400,'invalid_body') from None
    with contextlib.closing(core.connect_db()) as cx:
        cx.execute('BEGIN IMMEDIATE')
        try:
            result=apply_admin(cx,uid,payload)
            cx.execute('COMMIT')
            return result
        except Exception:
            cx.execute('ROLLBACK')
            raise
