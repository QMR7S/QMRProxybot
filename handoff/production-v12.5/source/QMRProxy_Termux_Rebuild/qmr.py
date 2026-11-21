#!/usr/bin/env python3
"""QMR Proxy Termux edition: stdlib-only Telegram long polling + local PWA host.

No user credentials are sent to third-party services. Token is kept in a
mode-0600 local file, never printed. Preserves the existing Telegram bot ID.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import contextlib
import datetime as dt
import fcntl
import getpass
import http.server
import json
import math
import hmac
import secrets
import logging
import os
from pathlib import Path
import re
import shutil
import signal
import sqlite3
import sys
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
SECRETS = ROOT / '.secrets'
BACKUPS = ROOT / 'backups'
SITE = ROOT / 'site'
DB_PATH = DATA / 'qmr.sqlite3'
TOKEN_FILE = SECRETS / 'bot_token'
WEBHOOK_SECRET_FILE = SECRETS / 'webhook_secret'
OWNER_ID = 6246913670
EXPECTED_BOT_ID = 9239734904
CHANNEL = '@QMR7S'
SUPPORT = 'https://t.me/QMRSupportbot'
SMART_RELEASE = "v12.2-smart-20261121"
MAX_TEXT = 3800
PORT = 8765
FEED = 'https://iwizard7.github.io/MTProxy_list/endpoints.json'
logger = logging.getLogger('qmr')
STOP = False


def ensure_dirs():
    for path in (DATA, SECRETS, BACKUPS, SITE, ROOT / 'logs'):
        path.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        os.chmod(SECRETS, 0o700)


def now():
    return int(time.time())


class APIError(Exception):
    def __init__(self, code, description, retry_after=0):
        super().__init__(f'{code}: {description}')
        self.code = code
        self.description = description
        self.retry_after = retry_after


def load_token():
    if not TOKEN_FILE.is_file():
        raise RuntimeError('لم يُضبط توكن البوت. شغّل python qmr.py configure')
    token = TOKEN_FILE.read_text(encoding='utf-8').strip()
    if not re.fullmatch(r'\d{6,15}:[A-Za-z0-9_-]{25,}', token):
        raise RuntimeError('صيغة التوكن غير صحيحة. أعد ضبطه محليًا.')
    return token


class Telegram:
    def __init__(self, token):
        self.token = token

    def call(self, method, **params):
        url = 'https://api.telegram.org/bot' + self.token + '/' + method
        request = Request(url, data=json.dumps(params, ensure_ascii=False).encode(),
                          headers={'Content-Type': 'application/json'}, method='POST')
        try:
            with urlopen(request, timeout=40 if method=='getUpdates' else 12) as response:
                payload = json.load(response)
        except HTTPError as exc:
            try:
                payload = json.loads(exc.read().decode('utf-8'))
            except Exception:
                raise APIError(exc.code, 'HTTP error from Telegram') from None
        except (URLError, TimeoutError, OSError) as exc:
            # Exceptions never include the Bot API request URL or secret.
            raise APIError(0, 'Network unavailable / connection timeout') from None
        if not payload.get('ok'):
            body = payload.get('parameters') or {}
            raise APIError(payload.get('error_code', 0),
                           payload.get('description', 'Telegram request failed'),
                           int(body.get('retry_after', 0)))
        return payload['result']

    def send(self, chat, text, keyboard=None):
        kwargs = {'chat_id': chat, 'text': text[:MAX_TEXT],
                  'link_preview_options': {'is_disabled': True}}
        if keyboard:
            kwargs['reply_markup'] = {'inline_keyboard': keyboard}
        return self.call('sendMessage', **kwargs)

    def screen(self, chat, text, keyboard=None, edit_id=None):
        if edit_id:
            try:
                kwargs = {'chat_id': chat, 'message_id': edit_id, 'text': text[:MAX_TEXT],
                          'link_preview_options': {'is_disabled': True}}
                if keyboard:
                    kwargs['reply_markup'] = {'inline_keyboard': keyboard}
                return self.call('editMessageText', **kwargs)
            except APIError as e:
                if 'message is not modified' in e.description.lower():
                    return None
                if not ('message to edit not found' in e.description.lower() or
                        "message can't be edited" in e.description.lower()):
                    raise
        return self.send(chat, text, keyboard)


def connect_db():
    ensure_dirs()
    cx = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None)
    cx.row_factory = sqlite3.Row
    cx.execute('PRAGMA journal_mode=WAL')
    cx.execute('PRAGMA busy_timeout=30000')
    cx.executescript('''
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      uid INTEGER PRIMARY KEY, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
      requests INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS broadcasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', cursor_id INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS deliveries (
      broadcast_id INTEGER NOT NULL, uid INTEGER NOT NULL,
      status TEXT NOT NULL, claimed_at INTEGER NOT NULL,
      PRIMARY KEY(broadcast_id,uid));
    CREATE TABLE IF NOT EXISTS processed_actions (
      update_id INTEGER PRIMARY KEY, claimed_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS webhook_updates (
      update_id INTEGER PRIMARY KEY, payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt INTEGER NOT NULL DEFAULT 0, received_at INTEGER NOT NULL,
      last_error TEXT NOT NULL DEFAULT '');
    ''')
    return cx


def getmeta(cx, key, default=''):
    row = cx.execute('SELECT value FROM meta WHERE key=?', (key,)).fetchone()
    return row['value'] if row else default


def setmeta(cx, key, value):
    cx.execute('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
               (key, str(value)))


def button(text, data=None, url=None, web_app=False):
    entry = {'text': text}
    if data is not None:
        entry['callback_data'] = data
    if url:
        entry['web_app' if web_app else 'url'] = {'url': url} if web_app else url
    return entry


def menu(owner=False, site_url=''):
    rows = [[button('🌐 البروكسيات الأصلية', 'q:servers:1'),button('🆕 المجموعة الإضافية', 'q:extra:1')],
            [button('⚡ اختيار حسب الجودة', 'q:best:all'),button('📡 حالة القائمة', 'q:status')],
            [button('🧭 التعليمات', 'q:steps'),button('❔ المساعدة', 'q:help')],
            [button('💡 أسئلة شائعة', 'q:faq'),button('🛡️ الأمان', 'q:safety')],
            [button('🔐 الخصوصية', 'q:privacy'),button('📜 الشروط', 'q:terms')],
            [button('📣 القناة', url='https://t.me/QMR7S'),button('🛟 الدعم', url=SUPPORT)]]
    if site_url.startswith('https://'):
        rows.insert(1, [button('✨ تطبيق QMR Mini', url=site_url.rstrip('/')+'/mini/', web_app=True)])
        if owner:
            rows.insert(1,[button('📊 التشغيل',url=site_url.rstrip('/')+'/ops/',web_app=True),
                           button('🛡 Admin',url=site_url.rstrip('/')+'/admin/',web_app=True)])
    if owner:
        rows.insert(0, [button('⚙️ لوحة المالك', 'q:admin')])
    return rows


def subscribe_keyboard():
    return [[button('📣 الاشتراك بقناة QMR7S', url='https://t.me/QMR7S')],
            [button('✅ التحقق من الاشتراك', 'q:verify')],
            [button('🛟 الدعم', url=SUPPORT)]]


TEXTS = {
    'welcome': '◈ QMR Proxy | QMR7S\n\nدليل لقائمتين مستقلتين من روابط MTProto المجتمعية وتطبيق ويب قابل للتثبيت.\n\nالروابط الخارجية ليست خوادم نملكها، وقد تتوقف أو تعرض قنوات إعلانية.\nاختر القائمة الأصلية أو المجموعة الإضافية:',
    'help': '📚 الأوامر\n/start — الرئيسية\n/servers — القائمة الأصلية\n/extra — المجموعة الإضافية\n/app — موقع QMR Proxy\n/status — حالة المصادر\n/steps — طريقة الاستخدام\n/faq — الأسئلة الشائعة\n/safety — الأمان\n/terms — الشروط\n/privacy — الخصوصية\n/support — الدعم\n/delete_my_data — حذف سجل حسابك',
    'steps': '🧭 طريقة الاستخدام\n١) اشترك في @QMR7S واضغط تحقق.\n٢) افتح قائمة البروكسيات واختر رابط MTProto.\n٣) وافق على الإضافة من تطبيق Telegram نفسه.\n٤) إذا لم يتصل، جرب رابطًا آخر ولا تكرر تسجيل الدخول.\n٥) افتح الإعدادات ← البيانات والتخزين ← إعدادات البروكسي لإدارة الاتصالات.',
    'faq': '💡 أسئلة شائعة\n• هل الروابط تعمل دومًا؟ لا، إنها قوائم خارجية وتتغير حسب الشبكة.\n• هل المجموعة الإضافية مضمونة؟ لا، قياسات المصدر خارجية ولا تثبت الاتصال على شبكتك.\n• لماذا قد تظهر قناة دعائية؟ يحددها مشغّل البروكسي.\n• هل هذا VPN؟ لا، MTProto يخدم Telegram فقط.\n• هل يضمن الخصوصية أو إزالة الإعلانات؟ لا.',
    'safety': '🛡️ الأمان\nلا ترسل كود تسجيل الدخول أو كلمة مرور التحقق بخطوتين لأي بوت أو موقع بروكسي.\nمشغّل البروكسي الخارجي قد يعرف عنوان IP وتوقيت اتصالك.\nلا يضمن هذا المشروع اتصالًا أو سرعة أو خلوًا من الإعلانات داخل العراق.',
    'terms': '📜 الشروط\nهذه الخدمة دليل روابط مجتمع وليست مشغل خوادم. لا ضمان للسرعة أو الخصوصية أو التوفر. يُمنع الاستغلال والرسائل غير المرغوبة. الدعم: @QMRSupportbot.',
    'privacy': '🔐 الخصوصية\nيحتفظ بوت Termux بمعرّف Telegram وتاريخ الاستخدام والعداد وحالة الحظر داخل SQLite على جهاز المشغّل. لا يخزن الرسائل الشخصية العادية.\nتُحفظ مسودات إشعارات المالك ونواتج التسليم. الموقع يحفظ اختياراتك محليًا في المتصفح. /delete_my_data لحذف سجل استخدامك.',
    'support': '🛟 الدعم الرسمي: @QMRSupportbot\nلا ترسل رموز التحقق أو كلمات السر.',
    'required': '🔒 الاشتراك بقناة @QMR7S مطلوب للوصول للروابط عبر البوت. اشترك ثم اضغط تحقق.',
    'verify_error': '⚠️ تعذر التحقق من الاشتراك. تأكد من إضافة البوت مشرفًا في @QMR7S ثم أعد المحاولة.',
    'blocked': '⛔ هذا الحساب محظور عن استخدام البوت. للدعم: @QMRSupportbot',
    'maintenance': '🛠️ صيانة مؤقتة: خدمة البروكسيات غير متاحة الآن.',
}


def valid_node_fields(host,port,secret):
    if not (1<=len(host)<=253 and re.fullmatch(r'[A-Za-z0-9.-]+',host)
            and not host.startswith('.') and not host.endswith('.') and '..' not in host
            and all(0<len(p)<=63 and not p.startswith('-') and not p.endswith('-') for p in host.split('.'))):
        return False
    return (1<=port<=65535 and
            ((bool(re.fullmatch(r'[a-fA-F0-9]{32,512}',secret)) and len(secret)%2==0)
             or bool(re.fullmatch(r'[A-Za-z0-9_-]{22,684}={0,2}',secret))))


def refresh_source():
    """Update public link snapshot only from a fresh, validated third-party feed.

    Network failures and stale/weak data never replace the saved snapshot.
    Nothing here tests MTProto connectivity or promises ad-free proxies.
    """
    request=Request(FEED,headers={'User-Agent':'QMRProxy-Termux/1.0'})
    with urlopen(request,timeout=12) as response:
        content=response.read(512*1024+1)
    if len(content)>512*1024:raise ValueError('Oversized feed')
    payload=json.loads(content.decode('utf-8'))
    if not isinstance(payload,dict) or not isinstance(payload.get('endpoints'),list):
        raise ValueError('Bad feed schema')
    stamp=str(payload.get('updated_at') or '')
    try: updated=dt.datetime.fromisoformat(stamp.replace('Z','+00:00'))
    except ValueError:raise ValueError('Invalid source timestamp') from None
    if updated.tzinfo is None:raise ValueError('Feed timestamp needs timezone')
    age=(dt.datetime.now(dt.timezone.utc)-updated).total_seconds()
    if not -600<=age<=36*3600:raise ValueError('Source stale or timestamp in future')
    candidates=[]
    for item in payload['endpoints']:
        if not isinstance(item,dict) or item.get('verified') is not True:
            continue
        if (item.get('ads') or {}).get('status')=='present':continue
        try:
            host=str(item['server']);port=int(item['port']);secret=str(item['secret'])
            rate=float(item.get('success_rate',0));samples=int(item.get('samples',0))
            rtt=float(item.get('median_rtt_ms'))
        except (KeyError,ValueError,TypeError):continue
        if (rate<0.8 or samples<5 or not math.isfinite(rate) or not math.isfinite(rtt)
                or not valid_node_fields(host,port,secret)):
            continue
        candidates.append((rate,rtt,host,port,secret,item))
    candidates.sort(key=lambda x:(-x[0],x[1]))
    nodes=[]; unique=set()
    for rate,rtt,host,port,secret,item in candidates:
        key=(host.lower(),port)
        if key in unique:continue
        unique.add(key)
        nodes.append({'id':f'community-live-{len(nodes)+1:02d}',
                      'name':f'مجتمعي {len(nodes)+1:02d} — خارجي',
                      'server':host,'port':port,'secret':secret,
                      'median_rtt_ms':round(rtt),'success_rate':rate,'samples':int(item['samples']),
                      'ads_status':(item.get('ads') or {}).get('status','unknown'),
                      'source':'third_party','enabled':True})
        if len(nodes)>=60:break
    if len(nodes)<20:raise ValueError('Insufficient verified candidates (min 20)')
    result={'updated_at':stamp,'source_checked_at':stamp,'source_url':FEED,
            'source_note':'External third-party health statistics, not live proof of availability in Iraq; advertising status is not independently verified.',
            'nodes':nodes}
    serialized=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    current=SITE/'nodes.json'
    if current.exists() and current.read_text(encoding='utf-8')==serialized:
        return len(nodes)
    ensure_dirs()
    tmp=SITE/'nodes.json.tmp'
    tmp.write_text(serialized,encoding='utf-8')
    os.replace(tmp,current)
    logger.info('Updated link snapshot: %s externally checked nodes',len(nodes))
    return len(nodes)


def safe_proxy_list():
    path = SITE / 'nodes.json'
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        raw = data.get('nodes', data.get('endpoints', []))
    except (OSError, ValueError, AttributeError):
        return [], 'غير متاح'
    if not isinstance(raw, list):
        return [], 'غير متاح'
    valid, keys = [], set()
    for n in raw:
        if not isinstance(n, dict) or n.get('enabled') is False:
            continue
        host, port, secret = str(n.get('server','')), n.get('port'), str(n.get('secret',''))
        try: port = int(port)
        except (TypeError, ValueError): continue
        if not valid_node_fields(host,port,secret):
            continue
        key = (host, port, secret)
        if key in keys: continue
        keys.add(key)
        valid.append({'server':host,'port':port,'secret':secret,
                      'name':str(n.get('name','مجتمعي'))[:45]})
    return valid[:60], str(data.get('source_checked_at') or data.get('updated_at') or 'غير معلوم')[:40]



def safe_extra_proxy_list():
    """Read a separate community feed; never merge it into the original nodes.json."""
    path=SITE/'extra-proxies.json'
    try:
        data=json.loads(path.read_text(encoding='utf-8'))
        raw=data.get('nodes',[])
        if data.get('schema')!='qmr-extra-v1' or not isinstance(raw,list):
            return [],'غير متاح','مصدر غير صالح',True
    except (OSError,ValueError,AttributeError,TypeError):
        return [],'غير متاح','مصدر غير متاح',True
    stamp=str(data.get('source_checked_at') or data.get('updated_at') or 'غير معلوم')[:40]
    source=str(data.get('source_name') or 'مصدر مجتمعي خارجي')[:80]
    try:
        age=(dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(stamp.replace('Z','+00:00'))).total_seconds()
        stale=age<0 or age>72*3600
    except (ValueError,TypeError):
        stale=True
    valid=[];keys={(n['server'].lower(),n['port'],n['secret']) for n in safe_proxy_list()[0]}
    for n in raw:
        if not isinstance(n,dict) or n.get('origin')!='extra' or n.get('ads_status')!='unknown':
            continue
        host,secret=str(n.get('server','')),str(n.get('secret',''))
        port=n.get('port')
        if type(port) is not int or not valid_node_fields(host,port,secret):continue
        import ipaddress
        try:
            if not ipaddress.ip_address(host).is_global:continue
        except ValueError:
            if '.' not in host or host.lower().endswith(('.local','.internal','.test','.invalid')):continue
        if set(secret)=={'0'} or secret.lower().count('0')/len(secret)>=.76:continue
        if not isinstance(n.get('community_source'),str) or not n['community_source'].strip():continue
        try:
            checks=int(n.get('source_checks',0));uptime=float(n.get('source_uptime',0));rtt=float(n.get('source_rtt_ms',0))
        except (TypeError,ValueError):continue
        if checks<72 or not .96<=uptime<=1 or not 0<rtt<=250:continue
        key=(host.lower(),port,secret)
        if key in keys:continue
        keys.add(key)
        valid.append({'server':host,'port':port,'secret':secret,
                      'name':str(n.get('name','بروكسي إضافي'))[:45],
                      'country':str(n.get('country',''))[:2],
                      'rtt_ms':round(rtt),'uptime':uptime,'checks':checks})
        if len(valid)>=160:break
    return valid,stamp,source,stale


def refresh_extra_source():
    """Refresh only the optional extra feed; stale/broken sources keep the previous file."""
    path=ROOT/'refresh_extra_v116.py'
    if not path.is_file():return 0
    import importlib.util
    spec=importlib.util.spec_from_file_location('qmr_extra_refresh',path)
    if spec is None or spec.loader is None:raise RuntimeError('extra refresh helper unavailable')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    count=module.refresh(SITE,apply=True)
    logger.info('Updated separate extra proxy collection: %s candidates',count)
    return count

def proxy_url(n):
    return ('https://t.me/proxy?server=' + quote(n['server'],safe='') + '&port=' + str(n['port']) +
            '&secret=' + quote(n['secret'],safe=''))



QUALITY_KINDS = {'all':'الكل','classic':'Classic','padded':'DD','fake_tls':'FakeTLS'}


def quality_kind(secret):
    try:
        raw=bytes.fromhex(secret) if re.fullmatch(r'[0-9a-fA-F]{32,512}',secret) and len(secret)%2==0 else base64.b64decode(secret+'='*((-len(secret))%4),altchars=b'-_',validate=True)
    except (ValueError,TypeError):return None
    if len(raw)==16:return 'classic'
    if len(raw)==17 and raw[0]==0xdd:return 'padded'
    if len(raw)>17 and raw[0]==0xee:return 'fake_tls'
    return None


def quality_id(node):
    return hashlib.sha256(json.dumps([node['server'].lower(),node['port'],node['secret']]).encode()).hexdigest()[:24]


def quality_time(value):
    if not isinstance(value,str):raise ValueError('timestamp')
    t=dt.datetime.fromisoformat(value.replace('Z','+00:00'))
    if t.tzinfo is None:raise ValueError('timezone')
    return t.timestamp()


def smart_candidates(kind='all',at=None):
    """Local snapshot only; strict evidence gate; no network, file or DB writes."""
    at=time.time() if at is None else at
    if kind not in QUALITY_KINDS:kind='all'
    try:
        with (SITE/'quality-public-v119.json').open('rb') as f:
            raw=f.read(524289)
        if len(raw)>524288:raise ValueError('size')
        report=json.loads(raw)
        if report.get('schema')!='qmr-public-quality-v119' or report.get('engine')!='v12.1-beta1' or report.get('window_hours')!=24:raise ValueError('schema')
        published=quality_time(report.get('generated_at')); measured=quality_time(report.get('last_scheduler_measurement'))
        age=at-published
        if not 0<=age<=600 or not 0<=at-measured<=900 or measured>published:raise ValueError('stale')
        records=report['nodes']
        if not isinstance(records,dict) or not 0<len(records)<=500 or type(report.get('total')) is not int or report['total']!=len(records):raise ValueError('inventory')
    except (OSError,ValueError,TypeError,AttributeError,KeyError,OverflowError):return 'unavailable',[],0
    original,_=safe_proxy_list();extra,_,_,extra_stale=safe_extra_proxy_list()
    current=original+([] if extra_stale else extra)
    selected=[];seen=set(); matched=0
    for n in current:
        mode=quality_kind(n['secret'])
        if mode is None or (kind!='all' and kind!=mode):continue
        ident=quality_id(n)
        if ident in seen:continue
        seen.add(ident)
        r=records.get(ident)
        if not isinstance(r,dict):continue
        matched+=1
        count=r.get('observations');good=r.get('responses');ms=r.get('median_ms');last=r.get('last_age_seconds')
        if r.get('state')!='responsive_sample' or type(count) is not int or not 3<=count<=1000 or type(good) is not int or not 0<=good<=count or good*10<count*9:continue
        if type(ms) is not int or not 0<=ms<=15000 or type(last) is not int or not 0<=last or last+age>21600:continue
        selected.append(dict(n,kind=mode,measurements=count,responses=good,median_ms=ms,age_seconds=int(last+age),quality_id=ident))
    # Prioritize actual response rate and then sample count and latency; no security score.
    selected.sort(key=lambda n:(-n['responses']/n['measurements'],-n['measurements'],n['median_ms'],n['age_seconds'],n['quality_id']))
    return 'ok',selected,matched


class Engine:
    def __init__(self, api, cx):
        self.api, self.cx = api, cx

    def site_url(self):
        return getmeta(self.cx, 'site_url')

    def owner(self, uid):
        return uid == OWNER_ID

    def blocked(self, uid):
        row = self.cx.execute('SELECT blocked FROM users WHERE uid=?',(uid,)).fetchone()
        return bool(row and row['blocked'])

    def track(self, uid):
        t=now()
        self.cx.execute('''INSERT INTO users(uid,first_seen,last_seen,requests)
          VALUES(?,?,?,1) ON CONFLICT(uid) DO UPDATE SET last_seen=excluded.last_seen,
          requests=requests+1''',(uid,t,t))

    def subscribed(self, uid):
        if self.owner(uid): return True, False
        try:
            member = self.api.call('getChatMember', chat_id=CHANNEL, user_id=uid)
            status = member.get('status')
            return (status in ('creator','administrator','member') or
                    (status=='restricted' and member.get('is_member') is True), False)
        except APIError as exc:
            if exc.code in (400,403):return False, True
            raise

    def send_screen(self, chat, text, kb=None, edit=None):
        self.api.screen(chat,text,kb,edit)

    def subscription_screen(self, chat, unavailable=False, edit=None):
        self.send_screen(chat,TEXTS['verify_error' if unavailable else 'required'],subscribe_keyboard(),edit)

    def home(self, uid, chat, edit=None):
        ok, unavailable = self.subscribed(uid)
        if not ok:
            return self.subscription_screen(chat,unavailable,edit)
        self.send_screen(chat,TEXTS['welcome'],menu(self.owner(uid),self.site_url()),edit)

    def servers(self, uid, chat, page=1, edit=None):
        ok, unavailable=self.subscribed(uid)
        if not ok:return self.subscription_screen(chat,unavailable,edit)
        if not self.owner(uid) and getmeta(self.cx,'maintenance','0')=='1':
            return self.send_screen(chat,TEXTS['maintenance'],None,edit)
        nodes, timestamp=safe_proxy_list()
        if not nodes:
            return self.send_screen(chat,'⚠️ لا توجد روابط موثقة في ملف nodes.json حاليًا. شغّل ./sync-site.sh لاستعادة نسخة المصدر.',None,edit)
        maxpage=max(1,(len(nodes)+9)//10)
        try: page=int(page)
        except (TypeError,ValueError):page=1
        page=max(1,min(page,maxpage))
        chunk=nodes[(page-1)*10:page*10]
        lines=[f'{(page-1)*10+i+1:02d}. {n["server"]}:{n["port"]}' for i,n in enumerate(chunk)]
        rows=[[button('🔗 '+str((page-1)*10+i+1).zfill(2)+' · اتصال',url=proxy_url(n))]
              for i,n in enumerate(chunk)]
        nav=[]
        if page>1:nav.append(button('◀ السابق',f'q:servers:{page-1}'))
        nav.append(button(f'{page}/{maxpage}','q:status'))
        if page<maxpage:nav.append(button('التالي ▶',f'q:servers:{page+1}'))
        rows.append(nav)
        rows.append([button('🆕 المجموعة الإضافية','q:extra:1'),button('⌂ الرئيسية','q:home')])
        msg='⚡ QMR Proxy — روابط MTProto مجتمعية\n\n'+'\n'.join(lines)
        msg+='\n\nفحص المصدر: '+timestamp+'\n⚠️ التوفر والإعلانات والخصوصية غير مضمونة.'
        self.send_screen(chat,msg,rows,edit)

    def extra_servers(self, uid, chat, page=1, edit=None):
        ok, unavailable=self.subscribed(uid)
        if not ok:return self.subscription_screen(chat,unavailable,edit)
        if not self.owner(uid) and getmeta(self.cx,'maintenance','0')=='1':
            return self.send_screen(chat,TEXTS['maintenance'],None,edit)
        nodes,stamp,source,stale=safe_extra_proxy_list()
        if not nodes:
            return self.send_screen(chat,'⚠️ المجموعة الإضافية غير متاحة حاليًا. القائمة الأصلية ما زالت مستقلة ومتاحة من الزر أدناه.',
                [[button('🌐 القائمة الأصلية','q:servers:1')],[button('⌂ الرئيسية','q:home')]],edit)
        maxpage=max(1,(len(nodes)+9)//10)
        try:page=int(page)
        except (TypeError,ValueError):page=1
        page=max(1,min(page,maxpage));chunk=nodes[(page-1)*10:page*10]
        lines=[];rows=[]
        for i,n in enumerate(chunk):
            number=(page-1)*10+i+1
            country=(' · '+n['country']) if n.get('country') else ''
            lines.append(f'{number:02d}. {n["server"]}:{n["port"]}{country} · {n["rtt_ms"]}ms حسب المصدر')
            rows.append([button('🔗 '+str(number).zfill(2)+' · اتصال',url=proxy_url(n))])
        nav=[]
        if page>1:nav.append(button('◀ السابق',f'q:extra:{page-1}'))
        nav.append(button(f'{page}/{maxpage}','q:status'))
        if page<maxpage:nav.append(button('التالي ▶',f'q:extra:{page+1}'))
        rows.append(nav)
        rows.append([button('🌐 القائمة الأصلية','q:servers:1'),button('⌂ الرئيسية','q:home')])
        freshness='⚠️ بيانات المصدر قديمة؛ لا تعتبرها فحصًا حاليًا.' if stale else 'قياسات خارجية حديثة نسبيًا؛ ليست اختبارًا من شبكتك.'
        msg='🆕 QMR Proxy — المجموعة الإضافية\n\n'+'\n'.join(lines)
        msg+=f'\n\nالمصدر: {source}\nتاريخ المصدر: {stamp}\n{freshness}\n⚠️ لا ضمان للسرعة أو الخصوصية أو خلو الروابط من الإعلانات.'
        self.send_screen(chat,msg,rows,edit)

    def best(self, uid, chat, kind='all', edit=None):
        if self.blocked(uid) and not self.owner(uid):return self.send_screen(chat,TEXTS['blocked'],None,edit)
        ok,unavailable=self.subscribed(uid)
        if not ok:return self.subscription_screen(chat,unavailable,edit)
        if not self.owner(uid) and getmeta(self.cx,'maintenance','0')=='1':return self.send_screen(chat,TEXTS['maintenance'],None,edit)
        if kind not in QUALITY_KINDS:kind='all'
        status,nodes,matched=smart_candidates(kind)
        rows=[]
        if status!='ok':
            msg='⚡ QMR Proxy — الاختيار حسب الجودة\n\nتقرير الجودة غير متاح أو قديم حاليًا. لا يوجد ترشيح موثوق بالقياسات الآن.'
        elif not nodes:
            msg=f'⚡ QMR Proxy — {QUALITY_KINDS[kind]}\n\nلا توجد قياسات كافية للترشيح المتكرر حاليًا. روابط مطابقة للتقرير: {matched}. يمكنك فتح القوائم العادية، والتقييم يستمر تلقائيًا.'
        else:
            msg=f'⚡ QMR Proxy — {QUALITY_KINDS[kind]}\n\nالأعلى ترتيبًا وفق قياسات المراقب (حتى 5 روابط من {len(nodes)}):\n'
            for i,n in enumerate(nodes[:5],1):
                msg+=f'\n{i}. {n["server"]}:{n["port"]} · {QUALITY_KINDS[n["kind"]]}\n   {n["responses"]}/{n["measurements"]} قياس · {n["median_ms"]} ms مصافحة\n'
                rows.append([button(f'🔗 {i} · اتصال',url=proxy_url(n))])
        msg+='\nقياسات من شبكة المراقب خلال 24 ساعة، لا تضمن سرعة جهازك أو الأمان أو خلو البروكسي من الإعلانات. لا تُحذف الروابط غير المرشحة.'
        rows.extend([[button('الكل','q:best:all'),button('Classic','q:best:classic')],
                     [button('DD','q:best:padded'),button('FakeTLS','q:best:fake_tls')],
                     [button('🌐 الأصلية','q:servers:1'),button('🆕 الإضافية','q:extra:1')],
                     [button('⌂ الرئيسية','q:home')]])
        return self.send_screen(chat,msg,rows,edit)

    def status(self,chat,edit=None):
        nodes,stamp=safe_proxy_list()
        extra,extra_stamp,extra_source,extra_stale=safe_extra_proxy_list()
        text=(f'📡 QMR Proxy\n\nالقائمة الأصلية: {len(nodes)}\nالمجموعة الإضافية: {len(extra)}\nآخر مصدر أصلي: {stamp}\nمصدر الإضافية: {extra_stamp}\n'
              'حالة الإعلانات: غير مؤكدة\nاختبار السرعة بالعراق: لم يتم\n'
              'هذه القيم لا تعني أن كل رابط يعمل الآن.')
        self.send_screen(chat,text,[[button('🌐 الأصلية','q:servers:1'),button('🆕 الإضافية','q:extra:1')],[button('⌂ الرئيسية','q:home')]],edit)

    def app(self, chat,edit=None):
        site=self.site_url()
        if not site:
            return self.send_screen(chat,'✨ موقع QMR Proxy يعمل محليًا على نفس هاتف Termux:\nhttp://127.0.0.1:8765\n\nلرابط HTTPS عام مؤقت شغّل ./share-site.sh، ثم python qmr.py set-url https://....trycloudflare.com',None,edit)
        self.send_screen(chat,'✨ تطبيق QMR Proxy\nافتح الواجهة من الرابط:',
                         [[button('🚀 فتح Mini App',url=site.rstrip('/')+'/mini/',web_app=True)],
                          [button('🌐 الموقع الخارجي',url=site)], [button('⌂ الرئيسية','q:home')]],edit)

    def admin(self,chat,edit=None):
        count=self.cx.execute('SELECT COUNT(*) FROM users').fetchone()[0]
        blocked=self.cx.execute('SELECT COUNT(*) FROM users WHERE blocked=1').fetchone()[0]
        pending=self.cx.execute("SELECT COUNT(*) FROM broadcasts WHERE status IN ('draft','sending')").fetchone()[0]
        msg=(f'⚙️ إدارة QMR Proxy\nالمستخدمون: {count}\nالمحظورون: {blocked}\n'
             f'مسودات وإشعارات قيد التنفيذ: {pending}\nالصيانة: {getmeta(self.cx,"maintenance","0")}\n'
             'لإرسال إشعار: /broadcast نص الرسالة\nللتحكم: /maintenance on|off  /ban ID  /unban ID')
        kb=[]
        if self.site_url().startswith('https://'):
            base=self.site_url().rstrip('/')
            kb.extend([[button('📊 لوحة التشغيل',url=base+'/ops/',web_app=True)],
                       [button('🛡 لوحة Admin',url=base+'/admin/',web_app=True)]])
        kb.append([button('⌂ الرئيسية','q:home')])
        self.send_screen(chat,msg,kb,edit)

    def begin_broadcast(self,chat,body):
        if not 5 <=len(body)<=1500:
            return self.send_screen(chat,'أرسل: /broadcast نص الرسالة (5–1500 حرف).')
        cur=self.cx.execute('INSERT INTO broadcasts(body,created_at) VALUES(?,?)',(body,now()))
        bid=cur.lastrowid
        self.send_screen(chat,f'📢 معاينة الإشعار #{bid}\n\n{body}\n\nالتسليم على دفعات حتى 15 مستخدمًا.',
                         [[button('✅ تأكيد وإرسال',f'q:a:bcast:{bid}')],
                          [button('❌ إلغاء المسودة',f'q:a:cancel:{bid}')]])

    def send_batch(self,bid,chat,edit=None):
        b=self.cx.execute('SELECT * FROM broadcasts WHERE id=?',(bid,)).fetchone()
        if not b or b['status'] not in ('draft','sending'):
            return self.send_screen(chat,'الإشعار غير موجود أو اكتمل أو أُلغي.',None,edit)
        people=self.cx.execute('SELECT uid FROM users WHERE uid>? AND blocked=0 ORDER BY uid LIMIT 15',
                               (b['cursor_id'],)).fetchall()
        for row in people:
            uid=row['uid']
            # Claim is committed before sending. If interrupted, do not replay
            # uncertain deliveries; exactly-once external delivery is impossible.
            self.cx.execute('BEGIN IMMEDIATE')
            try:
                reserved=self.cx.execute("UPDATE broadcasts SET cursor_id=?,status='sending' WHERE id=? AND cursor_id<? AND status IN ('draft','sending')",
                                (uid,bid,uid))
                claimed=self.cx.execute("INSERT OR IGNORE INTO deliveries(broadcast_id,uid,status,claimed_at) VALUES(?,?,'unknown',?)",
                                (bid,uid,now()))
                self.cx.execute('COMMIT')
                if reserved.rowcount != 1 or claimed.rowcount != 1:
                    continue # Already claimed; never send duplicate.
            except Exception:
                self.cx.execute('ROLLBACK')
                raise
            try:
                self.api.send(uid,'📣 إشعار QMR Proxy\n\n'+b['body'])
                self.cx.execute("UPDATE deliveries SET status='sent' WHERE broadcast_id=? AND uid=?",(bid,uid))
            except APIError as exc:
                logger.warning('broadcast delivery failed uid=%s code=%s',uid,exc.code)
                self.cx.execute("UPDATE deliveries SET status='failed' WHERE broadcast_id=? AND uid=?",(bid,uid))
        current=self.cx.execute('SELECT cursor_id FROM broadcasts WHERE id=?',(bid,)).fetchone()['cursor_id']
        more=self.cx.execute('SELECT 1 FROM users WHERE uid>? AND blocked=0 LIMIT 1',(current,)).fetchone()
        if not more:
            self.cx.execute("UPDATE broadcasts SET status='done' WHERE id=?",(bid,))
        counts=dict(self.cx.execute('SELECT status,COUNT(*) FROM deliveries WHERE broadcast_id=? GROUP BY status',(bid,)).fetchall())
        msg=(f'📣 إشعار #{bid}\n✅ أُرسل: {counts.get("sent",0)}\n'
             f'⚠️ فشل: {counts.get("failed",0)}\n'
             f'❔ غير مؤكد بعد انقطاع محتمل: {counts.get("unknown",0)}\n'
             + ('➡️ دفعات أخرى متاحة.' if more else '🏁 انتهى الإرسال.'))
        kb=[[button('➡️ إرسال الدفعة التالية',f'q:a:bcast:{bid}')]] if more else []
        kb.append([button('⚙️ الإدارة','q:admin')])
        self.send_screen(chat,msg,kb,edit)

    def message(self,m):
        chat=m.get('chat') or {}
        user=m.get('from') or {}
        if chat.get('type')!='private':return
        uid=user.get('id'); cid=chat.get('id'); txt=m.get('text') or ''
        if type(uid)!=int or type(cid)!=int or not txt.startswith('/'):return
        self.track(uid)
        command, _, arg=txt.partition(' ')
        cmd=command.split('@')[0].lower();arg=arg.strip()
        if self.blocked(uid) and not self.owner(uid):
            return self.send_screen(cid,TEXTS['blocked'])
        if cmd=='/start': return self.home(uid,cid)
        if cmd in ('/servers','/proxy'):
            page=arg if re.fullmatch(r'[0-9]{1,3}',arg) else '1'
            return self.servers(uid,cid,page)
        if cmd in ('/extra','/servers_extra'):
            page=arg if re.fullmatch(r'[0-9]{1,3}',arg) else '1'
            return self.extra_servers(uid,cid,page)
        if cmd in ('/best','/quality'):return self.best(uid,cid,arg.lower() if arg.lower() in QUALITY_KINDS else 'all')
        if cmd=='/status':return self.status(cid)
        if cmd=='/app':return self.app(cid)
        if cmd in ('/help','/steps','/faq','/safety','/terms','/privacy','/support'):
            return self.send_screen(cid,TEXTS[cmd[1:]],[[button('⌂ الرئيسية','q:home')]])
        if cmd=='/delete_my_data':
            if self.owner(uid):return self.send_screen(cid,'لا يمكن حذف سجل المالك عبر الأمر العام.')
            self.cx.execute('DELETE FROM users WHERE uid=?',(uid,))
            self.cx.execute('DELETE FROM deliveries WHERE uid=?',(uid,))
            return self.send_screen(cid,'✅ حُذف سجل استخدامك وتسليم الإشعارات من قاعدة Termux المحلية.')
        if self.owner(uid):
            if cmd in ('/admin','/stats','/panel','/ops'):return self.admin(cid)
            if cmd=='/broadcast':return self.begin_broadcast(cid,arg)
            if cmd=='/maintenance':
                if arg not in ('on','off'):return self.send_screen(cid,'/maintenance on أو /maintenance off')
                setmeta(self.cx,'maintenance','1' if arg=='on' else '0')
                return self.send_screen(cid,'✅ وضع الصيانة '+('مفعل' if arg=='on' else 'متوقف'))
            if cmd in ('/ban','/unban'):
                if not re.fullmatch(r'[1-9][0-9]{2,17}',arg) or int(arg)==OWNER_ID:
                    return self.send_screen(cid,'معرّف المستخدم غير صحيح.')
                t=now()
                self.cx.execute('''INSERT INTO users(uid,first_seen,last_seen,blocked) VALUES(?,?,?,?)
                    ON CONFLICT(uid) DO UPDATE SET blocked=excluded.blocked''',
                    (int(arg),t,t,int(cmd=='/ban')))
                return self.send_screen(cid,'✅ تم تحديث حالة المستخدم.')
        return self.send_screen(cid,TEXTS['help'])

    def callback(self,q):
        uid=(q.get('from') or {}).get('id')
        msg=q.get('message') or {};chat=(msg.get('chat') or {}).get('id')
        mid=msg.get('message_id'); data=q.get('data') or ''
        if not isinstance(uid,int) or not isinstance(chat,int) or not isinstance(mid,int) or not data.startswith('q:'):
            with contextlib.suppress(APIError):self.api.call('answerCallbackQuery',callback_query_id=q['id'],text='زر غير مدعوم')
            return
        if data.startswith('q:a:') or data=='q:admin':
            if not self.owner(uid):
                with contextlib.suppress(APIError):self.api.call('answerCallbackQuery',callback_query_id=q['id'],text='غير مخوّل')
                return
        with contextlib.suppress(APIError):self.api.call('answerCallbackQuery',callback_query_id=q['id'])
        if self.blocked(uid) and not self.owner(uid):return self.send_screen(chat,TEXTS['blocked'],None,mid)
        if data in ('q:home','q:verify'):return self.home(uid,chat,mid)
        if data.startswith('q:servers:'):
            p=data.split(':')[2]
            return self.servers(uid,chat,p if p.isdecimal() else 1,mid)
        if data.startswith('q:extra:'):
            p=data.split(':')[2]
            return self.extra_servers(uid,chat,p if p.isdecimal() else 1,mid)
        if data.startswith('q:best:') and data[7:] in QUALITY_KINDS:return self.best(uid,chat,data[7:],mid)
        if data=='q:status':return self.status(chat,mid)
        if data=='q:admin':return self.admin(chat,mid)
        if data.startswith('q:a:bcast:'):
            bid=data.split(':')[-1]
            if bid.isdecimal():return self.send_batch(int(bid),chat,mid)
        if data.startswith('q:a:cancel:'):
            bid=data.split(':')[-1]
            if bid.isdecimal():
                self.cx.execute("UPDATE broadcasts SET status='cancelled' WHERE id=? AND status='draft'",(int(bid),))
                return self.send_screen(chat,'أُلغيت المسودة إن لم تكن قد بدأت.',None,mid)
        name=data[2:]
        if name in TEXTS:return self.send_screen(chat,TEXTS[name],[[button('⌂ الرئيسية','q:home')]],mid)
        return self.send_screen(chat,TEXTS['help'],None,mid)

    def process(self,upd):
        # Never replay an owner mutation when Telegram redelivers the same update
        # after a crash. Reserve BEFORE side effects; owner can retry with a NEW
        # command/click if delivery was interrupted.
        msg=upd.get('message') or {}
        callback=upd.get('callback_query') or {}
        command=(msg.get('text') or '').split(' ',1)[0].split('@')[0].lower()
        data=callback.get('data') or ''
        guarded=(command in ('/broadcast','/maintenance','/ban','/unban','/delete_my_data')
                 or data.startswith('q:a:'))
        update_id=upd.get('update_id')
        if guarded and isinstance(update_id,int):
            claimed=self.cx.execute('INSERT OR IGNORE INTO processed_actions(update_id,claimed_at) VALUES(?,?)',
                                    (update_id,now()))
            if claimed.rowcount!=1:
                logger.info('Skipped already-processed privileged update id=%s',update_id)
                return
            if update_id%300==0:
                self.cx.execute('DELETE FROM processed_actions WHERE claimed_at<?',(now()-30*86400,))
        if 'message' in upd:return self.message(upd['message'])
        if 'callback_query' in upd:return self.callback(upd['callback_query'])


def webhook_secret(create=True):
    """Keep the verification secret only in an owner-readable file."""
    if not WEBHOOK_SECRET_FILE.exists():
        if not create: raise RuntimeError('Webhook secret missing. Start webhook listener first.')
        ensure_dirs()
        secret=secrets.token_urlsafe(36)
        fd=os.open(WEBHOOK_SECRET_FILE,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w',encoding='ascii') as handle:handle.write(secret+'\n')
    return WEBHOOK_SECRET_FILE.read_text(encoding='ascii').strip()


class SiteHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(SITE),**kwargs)
    def log_message(self,format,*args):
        logger.info('site %s',format % args)
    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff')
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Cache-Control','no-store' if self.path.startswith('/healthz') else 'max-age=0')
        super().end_headers()
    def do_GET(self):
        if self.path == '/healthz':
            body=json.dumps({'service':'qmrproxy','mode':self.server.mode,'ready':True}).encode()
            self.send_response(200);self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(body)));self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()
    def do_POST(self):
        if self.path != '/telegram-webhook' or self.server.mode != 'webhook':
            self.send_error(404);return
        secret=self.headers.get('X-Telegram-Bot-Api-Secret-Token','')
        if not hmac.compare_digest(secret,self.server.webhook_secret):
            self.send_error(403);return
        try:length=int(self.headers.get('Content-Length','0'))
        except ValueError:length=0
        if not 0 < length <= 512*1024:
            self.send_error(413);return
        try:
            update=json.loads(self.rfile.read(length))
            update_id=update.get('update_id') if isinstance(update,dict) else None
            if type(update_id)!=int or update_id<0:raise ValueError('invalid update')
        except (UnicodeDecodeError,ValueError,TypeError):
            self.send_error(400);return
        try:
            cx=connect_db()
            try:
                cx.execute('INSERT OR IGNORE INTO webhook_updates(update_id,payload,received_at) VALUES(?,?,?)',
                    (update_id,json.dumps(update,ensure_ascii=False),now()))
            finally:cx.close()
        except sqlite3.Error:
            logger.exception('Webhook durable enqueue failed')
            self.send_error(503);return  # Telegram should retry the request.
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length','11')
        self.end_headers()
        self.wfile.write(b'{"ok":true}')


def http_start(mode='polling'):
    httpd=http.server.ThreadingHTTPServer(('127.0.0.1',PORT),SiteHandler)
    httpd.daemon_threads=True
    httpd.mode=mode
    httpd.webhook_secret=webhook_secret() if mode=='webhook' else ''
    threading.Thread(target=httpd.serve_forever,daemon=True,name='qmr-web').start()
    logger.info('Local site / %s on http://127.0.0.1:%s',mode,PORT)
    return httpd


def webhook_worker(api,stop):
    """Single sequential worker with durable retry queue, decoupled from HTTP ACK."""
    cx=connect_db()
    try:
        # Uncertain in-flight updates are recovered after an unclean exit;
        # privileged commands have a separate idempotency table.
        cx.execute("UPDATE webhook_updates SET status='pending' WHERE status='processing'")
        engine=Engine(api,cx)
        while not stop.is_set():
            row=cx.execute("SELECT update_id,payload,attempts FROM webhook_updates WHERE status='pending' AND next_attempt<=? ORDER BY update_id LIMIT 1",(now(),)).fetchone()
            if row is None:
                stop.wait(.4);continue
            uid=row['update_id']
            cx.execute("UPDATE webhook_updates SET status='processing',attempts=attempts+1 WHERE update_id=?",(uid,))
            try:
                engine.process(json.loads(row['payload']))
            except Exception as error:
                delay=min(120,2**min(row['attempts']+1,7))
                logger.warning('Webhook processing retry id=%s after %ss; kind=%s',uid,delay,type(error).__name__)
                cx.execute("UPDATE webhook_updates SET status='pending',next_attempt=?,last_error=? WHERE update_id=?",
                    (now()+delay,type(error).__name__,uid))
            else:
                cx.execute("UPDATE webhook_updates SET status='done',payload='{}',last_error='' WHERE update_id=?",(uid,))
                if uid % 200 == 0:
                    cx.execute("DELETE FROM webhook_updates WHERE status='done' AND received_at<?",(now()-30*86400,))
    finally:cx.close()


def run_webhook(api,cx):
    global STOP
    check_bot(api)
    lock_path=DATA/'poll.lock'  # Same lock as polling: never run two consumers.
    with open(lock_path,'w') as lock:
        try:fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('نسخة أخرى تعمل على Termux: استخدم ./stop.sh أولاً')
        server=http_start('webhook')
        worker_stop=threading.Event()
        worker=threading.Thread(target=webhook_worker,args=(api,worker_stop),daemon=True,name='qmr-webhook-worker')
        worker.start()
        refresh_stop=threading.Event()
        def source_worker():
            while not refresh_stop.is_set():
                try:refresh_source()
                except Exception as error:logger.warning('Source refresh skipped: %s',type(error).__name__)
                refresh_stop.wait(1800)
        threading.Thread(target=source_worker,daemon=True,name='qmr-feed').start()
        def stop_handler(signum,frame):
            global STOP
            STOP=True
        signal.signal(signal.SIGINT,stop_handler)
        signal.signal(signal.SIGTERM,stop_handler)
        logger.info('Webhook listener ready; owner=%s; not auto-registering webhook',OWNER_ID)
        try:
            while not STOP:time.sleep(.5)
        finally:
            worker_stop.set();refresh_stop.set()
            server.shutdown();worker.join(timeout=3)


def enable_webhook(api,cx,url_override='',allow_move=False):
    """Explicit opt-in switch. No deletion, no dropped pending updates."""
    check_bot(api)
    base=validate_url(url_override or getmeta(cx,'site_url'))
    secret=webhook_secret(create=False)
    for location in ('http://127.0.0.1:'+str(PORT)+'/healthz',base+'/healthz'):
        try:
            with urlopen(Request(location,headers={'User-Agent':'QMRProxy-preflight/8'}),timeout=10) as rsp:
                health=json.load(rsp)
                if rsp.status!=200 or health.get('mode')!='webhook' or health.get('service')!='qmrproxy':
                    raise RuntimeError('Wrong listener at '+location)
        except Exception as error:
            raise RuntimeError('تعذر فحص Webhook Listener: '+location+' ('+type(error).__name__+')') from None
    info=api.call('getWebhookInfo')
    current=info.get('url','')
    destination=base+'/telegram-webhook'
    if current and current!=destination:
        if not allow_move:
            raise RuntimeError('Webhook مختلف ما زال مسجلاً. لا يتم استبداله تلقائيًا. استخدم webhook-move فقط بعد مراجعة العنوان.')
        ensure_dirs()
        stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')
        backup_path=BACKUPS/('webhook-before-replacement-'+stamp+'.json')
        fd=os.open(backup_path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w',encoding='utf-8') as stream:
            json.dump({'url_sensitive':current,'pending_update_count':info.get('pending_update_count'),
                       'allowed_updates':info.get('allowed_updates'),
                       'last_error_date':info.get('last_error_date')},stream)
        print('نسخة إعدادات Webhook القديمة محفوظة بصلاحية 0600:',backup_path)
        print('الوجهة القديمة:',urlparse(current).hostname,'| الجديدة:',urlparse(destination).hostname)
        if input('اكتب MOVE_WEBHOOK لتغيير العنوان من دون إسقاط التحديثات: ').strip()!='MOVE_WEBHOOK':
            print('لم يُعدّل Webhook.');return

    result=api.call('setWebhook',url=destination,secret_token=secret,
                    allowed_updates=['message','callback_query'],max_connections=4,drop_pending_updates=False)
    if not result:raise RuntimeError('setWebhook did not confirm success')
    verify=api.call('getWebhookInfo')
    if verify.get('url')!=destination:raise RuntimeError('Webhook URL mismatch after registration')
    setmeta(cx,'webhook_active_url',destination)
    print('✅ تم تفعيل Webhook على رابط HTTPS الحالي دون حذف التحديثات: '+destination)
    print('مهم: رابط trycloudflare مؤقت؛ بعد تغييره أعد تفعيل Webhook مع التحقق من العنوان.')


def configure():
    ensure_dirs()
    print('أدخل توكن @QMRProxybot الجديد/الصالح. الإدخال مخفي؛ لا ترسله في الدردشة.')
    token=getpass.getpass('Telegram Bot Token: ').strip()
    if not re.fullmatch(r'\d{6,15}:[A-Za-z0-9_-]{25,}',token):
        raise RuntimeError('صيغة توكن غير مقبولة')
    result=Telegram(token).call('getMe')
    if result.get('id')!=EXPECTED_BOT_ID:
        raise RuntimeError('توكن البوت لا يطابق رقم @QMRProxybot الأصلي. لا تغيير تم.')
    temp=TOKEN_FILE.with_name('bot_token.tmp')
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as stream:stream.write(token+'\n')
    os.replace(temp,TOKEN_FILE)
    os.chmod(TOKEN_FILE,0o600)
    print('✅ تم التحقق من هوية البوت الأصلي وحفظ التوكن محليًا بصلاحية 600.')


def check_bot(api):
    bot=api.call('getMe')
    if bot.get('id')!=EXPECTED_BOT_ID:raise RuntimeError('Bot ID mismatch; refusing to run')
    return bot


def diagnose(api,cx):
    b=check_bot(api)
    info=api.call('getWebhookInfo')
    nodes,stamp=safe_proxy_list()
    print(f'Bot: @{b.get("username")} | ID={b["id"]}')
    print('Webhook:', 'ACTIVE' if info.get('url') else 'none',
          '| pending:',info.get('pending_update_count','?'))
    if info.get('last_error_message'):
        print('Last webhook error (truncated):',str(info['last_error_message'])[:200])
    print('Site files:',(SITE/'index.html').exists(), '| validated nodes:',len(nodes),
          '| source date:',stamp)
    print('Site HTTPS URL:',getmeta(cx,'site_url') or 'not set')
    print('Termux local DB:',DB_PATH)
    with contextlib.suppress(sqlite3.Error):
        pending=cx.execute("SELECT COUNT(*) FROM webhook_updates").fetchone()[0]
        print('Local webhook queue:',pending)


def migrate(api):
    ensure_dirs()
    check_bot(api)
    info=api.call('getWebhookInfo')
    safe={k:info.get(k) for k in ('pending_update_count','has_custom_certificate',
          'max_connections','allowed_updates','last_error_date')}
    # Original URL is sensitive: it may include a bot token in the URL path.
    # Preserve it only in a local backup restricted to owner-readable mode.
    safe['webhook_url_sensitive']=info.get('url','')
    safe['had_webhook']=bool(info.get('url'))
    target=BACKUPS / ('webhook-before-move-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')+'.json')
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as stream:
        json.dump(safe,stream,ensure_ascii=False,indent=2)
    print('Private read-only snapshot (0600) stored:',target)
    if not info.get('url'):
        print('✅ No webhook is set. Polling is already eligible.')
        return
    print('تحذير: هذا سيعطل webhook الموجود؛ لا ينبغي تشغيل خادم قديم بالتوازي.')
    confirm=input('اكتب MOVE_TO_TERMUX لمتابعة النقل دون إسقاط التحديثات: ').strip()
    if confirm!='MOVE_TO_TERMUX':
        print('لم يتم تغيير Webhook.');return
    api.call('deleteWebhook',drop_pending_updates=False)
    new=api.call('getWebhookInfo')
    if new.get('url'):raise RuntimeError('Webhook still active after migration')
    print('✅ أُزيل Webhook دون drop_pending_updates. يمكن تشغيل Long Polling.')


def backup(cx):
    ensure_dirs()
    target=BACKUPS / ('qmr-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S-%f')+'.sqlite3')
    dst=sqlite3.connect(target)
    try:cx.backup(dst)
    finally:dst.close()
    with contextlib.suppress(OSError):os.chmod(target,0o600)
    print('Backup:',target)
    print('Token is NOT included.')


def validate_url(url):
    parts=urlparse(url)
    if parts.scheme!='https' or not parts.hostname or parts.username or parts.password or parts.fragment:
        raise ValueError('يلزم رابط HTTPS عام وصحيح بلا بيانات اعتماد أو #')
    return url.rstrip('/')


def run(api,cx):
    global STOP
    check_bot(api)
    current=api.call('getWebhookInfo')
    if current.get('url'):
        raise RuntimeError('Webhook ما زال نشطًا. شغّل python qmr.py migrate ولا تحذف التحديثات.')
    lock_path=DATA/'poll.lock'
    with open(lock_path,'w') as lock:
        try:fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError('نسخة أخرى من البوت تعمل بالفعل على هذا الجهاز.')
        server=http_start()
        # The original v7 site refreshes in-browser. This separate worker also
        # refreshes the snapshot that powers the Termux bot's /servers command.
        refresh_stop=threading.Event()
        def source_worker():
            while not refresh_stop.is_set():
                try:refresh_source()
                except Exception as exc:logger.warning('External source update skipped: %s',type(exc).__name__)
                refresh_stop.wait(1800)
        threading.Thread(target=source_worker,daemon=True,name='qmr-feed').start()
        engine=Engine(api,cx)
        logger.info('QMR Proxy bot started; owner=%s',OWNER_ID)
        def stop_handler(signum,frame):
            global STOP
            STOP=True
        signal.signal(signal.SIGINT,stop_handler)
        signal.signal(signal.SIGTERM,stop_handler)
        try:
            while not STOP:
                offset=int(getmeta(cx,'last_update_id','0'))+1
                try:
                    updates=api.call('getUpdates',offset=offset,timeout=30,limit=30,
                                     allowed_updates=['message','callback_query'])
                    for upd in updates:
                        uid=int(upd['update_id'])
                        if uid<offset:continue
                        try:
                            engine.process(upd)
                            setmeta(cx,'last_update_id',uid)
                            offset=uid+1
                        except APIError as exc:
                            logger.error('Telegram delivery code=%s description=%s',exc.code,exc.description)
                            if exc.code==401:raise RuntimeError('401: توكن البوت غير صالح أو أُلغي.') from None
                            time.sleep(min(max(exc.retry_after,3),30))
                            break  # Do not acknowledge failed update.
                        except Exception:
                            logger.exception('Update handling failed; retrying without acknowledging.')
                            time.sleep(3)
                            break
                except APIError as exc:
                    if exc.code==401:raise RuntimeError('401: تأكد من التوكن عبر python qmr.py configure') from None
                    if exc.code==409:
                        raise RuntimeError('409 Conflict: يوجد Webhook أو Polling منافس لنفس البوت.') from None
                    logger.warning('Polling temporarily unavailable: code=%s',exc.code)
                    time.sleep(min(max(exc.retry_after,3),30))
        finally:
            refresh_stop.set()
            server.shutdown()


def main(argv=None):
    parser=argparse.ArgumentParser(description='QMR Proxy standalone Termux rebuild')
    sub=parser.add_subparsers(dest='command',required=True)
    for c in ['configure','diagnose','migrate','run','run-webhook','webhook-enable','webhook-move','backup','test','refresh-source']:
        sub.add_parser(c)
    site=sub.add_parser('set-url');site.add_argument('url')
    args=parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO,format='%(asctime)s [%(levelname)s] %(message)s')
    ensure_dirs()
    if args.command=='configure':return configure()
    if args.command=='test':
        import unittest
        suite=unittest.defaultTestLoader.discover(str(ROOT/'tests'))
        if not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful():sys.exit(1)
        return
    if args.command=='refresh-source':
        print('Validated external nodes:',refresh_source());return
    cx=connect_db()
    try:
        if args.command=='backup':return backup(cx)
        if args.command=='set-url':
            value=validate_url(args.url)
            setmeta(cx,'site_url',value)
            print('✅ URL:',value)
            return
        api=Telegram(load_token())
        if args.command=='diagnose':return diagnose(api,cx)
        if args.command=='migrate':return migrate(api)
        if args.command=='run':return run(api,cx)
        if args.command=='run-webhook':return run_webhook(api,cx)
        if args.command=='webhook-enable':return enable_webhook(api,cx)
        if args.command=='webhook-move':return enable_webhook(api,cx,allow_move=True)
    finally:
        cx.close()


if __name__=='__main__':
    try:main()
    except (RuntimeError,APIError,ValueError) as exc:
        print('❌',str(exc),file=sys.stderr)
        sys.exit(1)
