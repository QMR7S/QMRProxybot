# QMR Proxy — real MTProto server (mtg v2)

**The server software is open source; GitHub does not host the server's TCP traffic.**
The website published on ChatGPT Sites is a **link directory**, not a MTProto proxy.
Telegram Serverless serves the existing @QMRProxybot; **do not** modify its webhook.
This folder is a first-time deployment kit for a dedicated Linux VPS with its own
public IPv4. The scripts do not install or deploy anything from your Android device.

Upstream: https://github.com/9seconds/mtg — https://core.telegram.org/proxy

## Requirements

- Ubuntu/Debian Linux VPS, public routable IPv4, internet access to Telegram.
- Docker Engine with the Docker Compose plugin and Python3.
- Free incoming TCP port 443 on the host and provider firewall. Restrict SSH
  (TCP 22) to the operator's IP. Keep OS/Docker patched and monitor bandwidth costs.
- Use an appropriate FakeTLS SNI hostname, ideally a domain you control that
  resolves to your VPS. Inexpensive/free hosting offers are not guaranteed to expose TCP.
- No active production MTProto service on TCP/443 (script refuses to replace a config).

## Install (ON THE VPS — not in ChatGPT Sites or Serverless)

Clone the **review branch** from the private repository using your authenticated
GitHub access or copy just this folder to the VPS. Never expose personal access tokens.

```bash
cd QMRProxybot
bash proxy-node/install.sh YOUR_PUBLIC_IP YOUR_REAL_FAKETLS_DOMAIN
docker compose -f proxy-node/docker-compose.yml -p qmrproxy-node ps
docker compose -f proxy-node/docker-compose.yml -p qmrproxy-node logs --tail=40 mtg
```

The script generates a FakeTLS hex secret, writes an untracked
`proxy-node/runtime/config.toml` (permissions 600), and runs Docker with
host TCP/443 forwarded to the container's TCP/3128. It refuses to overwrite
an existing configuration or take an in-use TCP/443 port.

## Test first, publish later

1. Inspect firewall ingress and local Docker status. A running container alone
   **does not** prove that Telegram works from Iraq.
2. Generate a test connection URL on the VPS:
   ```bash
   python3 proxy-node/export-node.py --server YOUR_PUBLIC_IP --preview
   ```
3. Open the generated URL on an actual Telegram Android/iOS client connected
   to a network in Iraq. Confirm Telegram connects, receives messages, and
   loads media. Test at least two local networks when feasible.
4. **Only after successful real-client verification**, export a node inventory:
   ```bash
   python3 proxy-node/export-node.py --server YOUR_PUBLIC_IP --confirm-client-test --output /tmp/qmr-node.json
   ```
5. Have ChatGPT Work Sites read `/tmp/qmr-node.json` by an authorized file
   transfer, or paste its *public node metadata* into the site's existing
   `nodes.json`. Keep the existing v3 PWA files intact. Never invent a node.
6. For the existing TGCloud bot, sync the validated public inventory with the
   repository's `scripts/sync_nodes.py` and inspect the diff **before** any
   targeted Serverless push. Do not change existing webhook.
7. When a second server is available, **merge** the new node into the existing
   array; do not replace all previous nodes.

Important: the value called `secret` is a shared **client connection key**, so
it is present in public Telegram links. Do not confuse it with your bot token,
SSH private key, hosting credentials, or TGCloud CLI token, which must **never**
be published.

## Security and maintenance

- Keep the Docker image version pinned to the major tag `nineseconds/mtg:2`.
  For reproducibility, pin an audited image digest before public scale.
- The basic FakeTLS listener improves obfuscation but is not guaranteed to evade
  deep-packet inspection. For stronger active-probe resistance, consider the
  upstream SNI router with HAProxy + Caddy and a real domain:
  https://github.com/9seconds/mtg/tree/master/contrib/sni-router
- Check host/server logs and network throughput. Avoid storing user IPs or
  personal data in the website or telemetry systems.
- Public internet hosts, bandwidth, and firewall exposure remain the host
  operator's responsibility. The scripts perform **no uptime or country tests**.
- Do not claim 'fast' or 'online' merely because the site lists a server.
