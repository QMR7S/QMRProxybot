#!/usr/bin/env python3
"""Safely refresh a SEPARATE, third-party MTProto candidate feed.

No Telegram token/SQLite/webhook access. No TCP scans; external historical
RTT/uptime are never rebranded as local measurements or guarantees.
"""
import argparse
import datetime as dt
import ipaddress
import json
import os
from pathlib import Path
import re
import ssl
import sys
import tempfile
import urllib.request

BASE = 'https://raw.githubusercontent.com/0xRadikal/Free-Telegram-Proxy/main/'
MAX_BYTES = 1_100_000
MAX_AGE_HOURS = 72
MAX_ITEMS = 160
CONTEXT = ssl.create_default_context()


def fetch_json(path):
    if path not in {'index.json', 'fast/proxies.json', 'stable/proxies.json'}:
        raise ValueError('source outside allowlist')
    request = urllib.request.Request(BASE + path, headers={
        'User-Agent': 'QMRProxy-SourceSync/1.3 (public-snapshot-only)',
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(request, timeout=16, context=CONTEXT) as response:
        if response.status != 200:
            raise RuntimeError('source status '+str(response.status))
        body = response.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise ValueError('remote JSON exceeds size limit')
    return json.loads(body)


def valid_node(n):
    if not isinstance(n, dict):
        return False
    host, secret = n.get('server'), n.get('secret')
    port = n.get('port')
    if not isinstance(host, str) or not re.fullmatch(r'[A-Za-z0-9.-]{1,253}', host):
        return False
    if host.lower() == 'localhost' or host.startswith('.') or host.endswith('.') or '..' in host:
        return False
    if not all(0 < len(part) <= 63 and not part.startswith('-') and not part.endswith('-') for part in host.split('.')):
        return False
    try:
        address = ipaddress.ip_address(host)
        if not address.is_global:
            return False
    except ValueError:
        if host.lower().endswith(('.local', '.internal', '.test', '.invalid')):
            return False
    if type(port) is not int or not 1 <= port <= 65535:
        return False
    if not isinstance(secret, str) or not re.fullmatch(r'[0-9a-fA-F]{32,512}', secret) or len(secret) % 2:
        return False
    if set(secret) == {'0'} or secret.lower().count('0')/len(secret) >= .76:
        return False
    try:
        ip = ipaddress.ip_address(n.get('ip', ''))
        if not ip.is_global:
            return False
    except (ValueError, TypeError):
        return False
    return (isinstance(n.get('checks'), int) and n['checks'] >= 72
            and isinstance(n.get('uptime'), (int, float)) and .96 <= n['uptime'] <= 1
            and isinstance(n.get('rtt_ms'), (int, float)) and 0 < n['rtt_ms'] <= 250)


def select(fast, stable, source_date, max_items=MAX_ITEMS):
    if not isinstance(fast, list) or not isinstance(stable, list):
        raise ValueError('invalid list')
    ordered = sorted((n for n in fast if valid_node(n)), key=lambda n: (n['rtt_ms'], -n['uptime']))
    ordered += sorted((n for n in stable if valid_node(n)), key=lambda n: (n['rtt_ms'], -n['uptime']))
    rows, ip_seen, link_seen, asns, countries = [], set(), set(), {}, {}
    for n in ordered:
        if not valid_node(n):
            continue
        ip = n['ip']
        key = (n['server'].lower(), n['port'], n['secret'].lower())
        if key in link_seen or ip in ip_seen:
            continue
        asn = str(n.get('asn') or 'unknown')
        country = str(n.get('country') or '??')[:2].upper()
        if asns.get(asn, 0) >= 8 or countries.get(country, 0) >= 35:
            continue
        ip_seen.add(ip)
        link_seen.add(key)
        asns[asn] = asns.get(asn, 0) + 1
        countries[country] = countries.get(country, 0) + 1
        rows.append({
            'name': f'إضافي {len(rows)+1:03} · {country}',
            'server': n['server'], 'port': n['port'], 'secret': n['secret'],
            'origin': 'extra', 'community_source': '0xRadikal',
            'source_rtt_ms': int(n['rtt_ms']), 'median_rtt_ms': int(n['rtt_ms']),
            'source_uptime': round(float(n['uptime']), 4),
            'source_checks': int(n['checks']), 'country': country,
            'asn': n.get('asn'), 'ads_status': 'unknown',
        })
        if len(rows) >= max_items:
            break
    if len(rows) < 15:
        raise ValueError('too few independently sourced valid candidates; preserving old snapshot')
    return {
        'schema': 'qmr-extra-v1',
        'source_name': '0xRadikal / Free-Telegram-Proxy',
        'source_url': 'https://github.com/0xRadikal/Free-Telegram-Proxy',
        'source_checked_at': source_date, 'updated_at': source_date,
        'method': 'Historical source-reported RTT/uptime; no independent privacy, security, long-term or local network assurance.',
        'nodes': rows,
    }


def refresh(site, apply=True):
    site=Path(site).resolve()
    target=site/'extra-proxies.json'
    if not site.is_dir() or not (site/'nodes.json').exists():
        raise ValueError('expected QMR Proxy site directory; no files changed')
    index=fetch_json('index.json')
    timestamp=index.get('updated')
    if not isinstance(timestamp,str):raise ValueError('source timestamp missing')
    when=dt.datetime.fromisoformat(timestamp.replace('Z','+00:00'))
    elapsed=(dt.datetime.now(dt.timezone.utc)-when).total_seconds()/3600
    if not (0<=elapsed<=MAX_AGE_HOURS):
        raise ValueError('source stale or timestamp from the future; existing snapshot preserved')
    fast=fetch_json('fast/proxies.json')
    stable=fetch_json('stable/proxies.json')
    result=select(fast,stable,timestamp)
    if not apply:return len(result['nodes'])
    if target.exists():
        try:
            prior=json.loads(target.read_text())
            if prior.get('schema')!='qmr-extra-v1':raise ValueError('unexpected target schema')
        except (json.JSONDecodeError,ValueError,AttributeError):
            raise ValueError('existing target not recognized; refusing overwrite')
    serialized=(json.dumps(result,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
    fd,tmp=tempfile.mkstemp(prefix='.qmr-extra-',dir=target.parent)
    try:
        with os.fdopen(fd,'wb') as f:
            f.write(serialized);f.flush();os.fsync(f.fileno())
        os.chmod(tmp,0o644);os.replace(tmp,target)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
    return len(result['nodes'])


def main():
    parser=argparse.ArgumentParser(description='Refresh optional public MTProto candidates; dry-run by default.')
    parser.add_argument('--site',type=Path,default=Path.home()/'QMRProxy_Termux_Rebuild'/'site')
    parser.add_argument('--apply',action='store_true',help='Write the optional extra-proxies.json atomically')
    args=parser.parse_args()
    try:
        count=refresh(args.site,apply=args.apply)
        print('SOURCE: 0xRadikal / Free-Telegram-Proxy','CANDIDATES:',count)
        print('NOTICE: External runner data only; no safety, availability or long-term guarantee.')
        print('UPDATED:' if args.apply else 'DRY RUN:',(args.site.resolve()/'extra-proxies.json') if args.apply else 'no files changed')
        return 0
    except Exception as exc:
        print('REFRESH FAILED; existing data preserved:',type(exc).__name__,str(exc)[:150],file=sys.stderr)
        return 1

if __name__=='__main__':
    sys.exit(main())
