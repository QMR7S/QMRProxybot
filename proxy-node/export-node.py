#!/usr/bin/env python3
"""Build a node inventory for manual publication AFTER a successful Telegram client test.

Does not deploy the web site, call Telegram APIs, or change any webhook.
The MTProto secret is necessarily shared with clients that use the published node.
"""
import argparse
import datetime as dt
import ipaddress
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlencode

DEFAULT_CONFIG = Path(__file__).resolve().parent / 'runtime/config.toml'

def is_public_host(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
        return ip.version == 4 and ip.is_global
    except ValueError:
        pass
    if not 3 <= len(host) <= 253 or '..' in host or '.' not in host:
        return False
    if host.endswith(('.localhost', '.local', '.test', '.invalid', '.example')):
        return False
    if host.lower() in ('localhost', 'example.com', 'example.net', 'example.org'):
        return False
    labels = host.split('.')
    return all(re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', label) for label in labels)

def read_secret(config: Path) -> str:
    try:
        data = config.read_text(encoding='utf-8')
    except OSError as exc:
        raise ValueError(f'Cannot read mtg configuration: {exc}') from exc
    match = re.search(r'^\s*secret\s*=\s*"([^"]+)"\s*$', data, re.MULTILINE)
    if not match:
        raise ValueError('No quoted secret entry in mtg config')
    secret = match.group(1)
    if not re.fullmatch(r'ee[0-9a-fA-F]{34,}', secret) or len(secret) % 2:
        raise ValueError('Invalid FakeTLS hex secret')
    return secret

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--server', required=True, help='Real public IPv4 or hostname')
    parser.add_argument('--port', type=int, default=443)
    parser.add_argument('--name', default='QMR Proxy — Main')
    parser.add_argument('--config', type=Path, default=DEFAULT_CONFIG)
    parser.add_argument('--preview', action='store_true', help='Print test link, not publishable inventory')
    parser.add_argument('--confirm-client-test', action='store_true', help='Operator attests Telegram connection worked from a target network')
    parser.add_argument('--output', type=Path, help='Write JSON to a local path (never to source tree automatically)')
    args = parser.parse_args()

    if not is_public_host(args.server) or not 1 <= args.port <= 65535:
        parser.error('A real public server hostname/IPv4 and valid port are required')
    if args.output and args.output.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        parser.error('Refusing to write to the source repository; export to /tmp first')
    try:
        secret = read_secret(args.config)
    except ValueError as exc:
        parser.error(str(exc))
    link = 'https://t.me/proxy?' + urlencode({'server': args.server, 'port': args.port, 'secret': secret})
    if args.preview:
        print('TEST LINK ONLY; do not add to the public web directory until tested:')
        print(link)
        return 0
    if not args.confirm_client_test:
        parser.error('Publication inventory requires --confirm-client-test after a successful real Telegram client test')

    payload = {
        'updated_at': dt.datetime.now(dt.timezone.utc).isoformat(),
        'nodes': [
            {
                'id': 'qmr-main',
                'name': args.name[:48],
                'server': args.server,
                'port': args.port,
                'secret': secret,
                'enabled': True
            }
        ]
    }
    content = json.dumps(payload, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.write_text(content, encoding='utf-8')
        print('Exported verified-by-operator inventory to:', args.output)
    else:
        print(content, end='')
    return 0

if __name__ == '__main__':
    sys.exit(main())
