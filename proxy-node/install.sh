#!/usr/bin/env bash
# Use only on a Linux VPS with a public IP and Docker installed.
# First-time setup, refuses to replace an existing configuration.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${1:-}" == "--help" || $# -ne 2 ]]; then
  echo "Usage: bash proxy-node/install.sh PUBLIC_IP YOUR_FAKETLS_DOMAIN" >&2
  echo "Requires a public Linux VPS, free TCP/443, Docker with compose plugin." >&2
  exit 2
fi

PUBLIC_IP="$1"
SNI_DOMAIN="$2"
command -v docker >/dev/null || { echo "Docker not found." >&2; exit 1; }
docker compose version >/dev/null || { echo "Docker Compose plugin not found." >&2; exit 1; }
command -v python3 >/dev/null || { echo "Python3 not found." >&2; exit 1; }

python3 - "$PUBLIC_IP" "$SNI_DOMAIN" <<'PY'
import ipaddress
import re
import sys
ip, domain = sys.argv[1:]
try:
    address = ipaddress.ip_address(ip)
    assert address.version == 4 and address.is_global
except (ValueError, AssertionError):
    raise SystemExit("PUBLIC_IP must be a public routable IPv4 address")
if not (3 <= len(domain) <= 253 and re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", domain)):
    raise SystemExit("Invalid FakeTLS hostname")
if '.' not in domain or '..' in domain or domain.endswith(('.test', '.invalid', '.localhost')):
    raise SystemExit("Use a real resolvable domain, preferably one you control")
PY

CONFIG="$ROOT/runtime/config.toml"
if [[ -e "$CONFIG" ]]; then
  echo "Existing config found. Refusing to overwrite: $CONFIG" >&2
  exit 1
fi
if command -v ss >/dev/null 2>&1 && ss -ltn | awk '{print $4}' | grep -Eq '(^|:|\])443$'; then
  echo "TCP/443 already in use; refusing to interfere with another service." >&2
  exit 1
fi
mkdir -p "$ROOT/runtime"
chmod 700 "$ROOT/runtime"
umask 077
echo "Generating a FakeTLS secret using the upstream mtg v2 Docker image..."
SECRET="$(docker run --rm nineseconds/mtg:2 generate-secret --hex "$SNI_DOMAIN" | tr -d '\r\n')"
if [[ ! "$SECRET" =~ ^ee[[:xdigit:]]{34,}$ || $(( ${#SECRET} % 2 )) -ne 0 ]]; then
  echo "Invalid secret from mtg. Refusing to create a configuration." >&2
  exit 1
fi

# Secret is a client access key; it becomes public if you publish the proxy.
printf 'secret = "%s"\nbind-to = "0.0.0.0:3128"\n' "$SECRET" > "$CONFIG"
chmod 600 "$CONFIG"

cd "$ROOT"
docker compose -p qmrproxy-node up -d
echo
echo "MTProto container command started, but network reachability is NOT yet verified."
echo "Public IPv4: $PUBLIC_IP"
echo "Check firewall TCP/443 and run: docker compose -p qmrproxy-node ps"
echo "Check logs: docker compose -p qmrproxy-node logs --tail=40 mtg"
echo "Generate a TEST-ONLY link (do not publish yet):"
echo "  python3 proxy-node/export-node.py --server $PUBLIC_IP --preview"
echo "After successful connection from a Telegram client, run:"
echo "  python3 proxy-node/export-node.py --server $PUBLIC_IP --confirm-client-test --output /tmp/qmr-node.json"
