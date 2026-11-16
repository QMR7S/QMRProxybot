#!/usr/bin/env python3
"""Compile verified public MTProto node inventory into tgcloud/lib/nodes.js without cloud mutations."""
import argparse, json, pathlib, re, sys
from urllib.parse import urlsplit
R=pathlib.Path(__file__).resolve().parents[1]
def main():
 p=argparse.ArgumentParser()
 p.add_argument('--web-url', default='')
 a=p.parse_args()
 if a.web_url:
  u=urlsplit(a.web_url)
  if u.scheme!='https' or not u.hostname or u.username or u.password: p.error('Website URL must use HTTPS and contain no credentials')
 src=json.loads((R/'site/nodes.json').read_text(encoding='utf8'))
 if not isinstance(src.get('nodes'),list): p.error('nodes must be an array')
 good=[]
 for n in src['nodes']:
  if not isinstance(n,dict) or n.get('enabled') is False: continue
  if not isinstance(n.get('server'),str) or not re.fullmatch(r'[A-Za-z0-9.-]{1,253}',n['server']): p.error('bad host')
  if type(n.get('port')) is not int or not 1<=n['port']<=65535: p.error('bad port')
  if not isinstance(n.get('secret'),str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,}',n['secret']): p.error('bad public secret')
  good.append({k:n[k] for k in ('name','server','port','secret','enabled') if k in n})
 target=R/'tgcloud/lib/nodes.js'
 result='// Auto-generated public MTProto links; does not mutate Telegram.\nexport const PUBLIC_SITE_URL = '+json.dumps(a.web_url,ensure_ascii=False)+';\nexport const nodes = '+json.dumps(good,ensure_ascii=False,indent=2)+';\n'
 target.write_text(result,encoding='utf8')
 print('Generated',len(good),'node entries. No network health or Serverless deployment occurred.')
if __name__=='__main__':main()
