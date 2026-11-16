#!/usr/bin/env bash
# First-time provisioning only, on a dedicated VPS with Docker.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# -ne 2 ]];then echo 'Usage: bash scripts/setup.sh PUBLIC_IP REAL_SNI_DOMAIN' >&2; exit 2;fi
HOST="$1"; SNI="$2"
if [[ ! "$HOST" =~ ^[A-Za-z0-9.-]{1,253}$ || ! "$SNI" =~ ^[A-Za-z0-9.-]{1,253}$ ]];then echo 'Invalid host/domain' >&2;exit 2;fi
command -v docker >/dev/null || { echo 'Docker missing' >&2;exit 1; }
command -v python3 >/dev/null || { echo 'Python3 missing' >&2;exit 1; }
if [[ -e "$ROOT/runtime/config.toml" ]];then echo 'Existing MTProto config: refusing overwrite' >&2;exit 1;fi
# Protect any already-distributed proxy inventory, never replace it with a single new node.
ROOT="$ROOT" python3 - <<'PY'
import json,os,pathlib,sys
p=pathlib.Path(os.environ['ROOT'])/'site/nodes.json'
if p.exists():
 try:
  d=json.loads(p.read_text(encoding='utf8'))
  if not isinstance(d.get('nodes'),list) or len(d['nodes'])!=0: raise ValueError('existing nodes or unexpected inventory')
 except (ValueError,KeyError) as e:
  print('Refusing to overwrite site/nodes.json:',e,file=sys.stderr);sys.exit(1)
PY
mkdir -p "$ROOT/runtime"
SECRET="$(docker run --rm nineseconds/mtg:2 generate-secret --hex "$SNI" | tr -d '\r\n')"
if [[ ! "$SECRET" =~ ^ee[0-9A-Fa-f]{34,}$ ]];then echo 'Unexpected mtg secret format' >&2;exit 1;fi
umask 077
printf 'secret = "%s"\nbind-to = "0.0.0.0:3128"\n' "$SECRET" > "$ROOT/runtime/config.toml"
ROOT="$ROOT" HOST="$HOST" SECRET="$SECRET" python3 - <<'PY'
import datetime,json,os,pathlib
p=pathlib.Path(os.environ['ROOT'])/'site/nodes.json'
data={'updated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'nodes':[{'id':'main','name':'QMR Proxy الأساسي','server':os.environ['HOST'],'region':'Primary','port':443,'secret':os.environ['SECRET'],'enabled':True}]}
p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
PY
chmod 644 "$ROOT/runtime/config.toml"
cd "$ROOT"
docker compose up -d mtg
echo 'Started locally on VPS; confirm firewall TCP/443, DNS/FakeTLS suitability and connection tests from Iraq BEFORE publication.'
