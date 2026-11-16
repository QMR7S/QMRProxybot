# QMR Proxy: card-free hosting alternatives (2026-11-16)

**Oracle is excluded because the account owner cannot complete signup. Nothing here requires replacing the working @QMRProxybot handler or changing its webhook.**

## Best experimental candidate: VPSFree.io

Official provider site: https://vpsfree.io/

Advertises 192 MB RAM, 256 MB swap, 3GB SSD, 30 Mbit/s nominal, NAT/shared public IPv4 with 20 forwarded ports, email-only signup, and free 10-day periods that require sponsored renewal. Not independently provisioned, audited, or tested. Verify AUP permits Telegram MTProto and check assigned public TCP port before deploying.

**Why the previous Docker-only kit is unsuitable**: 192 MB RAM is too constrained for Docker engine plus mtg under load. Use a single upstream mtg v2.3.0 Linux amd64 binary with systemd and a concurrency limit.

Upstream reference: https://github.com/9seconds/mtg/releases/tag/v2.3.0
Upstream archive: https://github.com/9seconds/mtg/releases/download/v2.3.0/mtg-2.3.0-linux-amd64.tar.gz
Official release artifact SHA256: `11c038ea5eeebd5d49148048975c24f7b0c4fa4c1cf4f15a2410203e2da01812`.

## Safeguarded operator workflow

1. **Account owner** completes any email verification and sponsor step themselves. Do not share passwords, cookies, GitHub tokens, Bot API token, SSH keys, or payment details.
2. From the VPS panel record `public_ip`, `public_tcp_port` and `internal_tcp_port`. Confirm NAT forwarding of public port to internal port. MTProto client links must contain the **public** TCP port, not a Docker/localhost port. This is frequently **not TCP/443**.
3. In the VPS Linux terminal, install the verified upstream Linux amd64 binary after checking its SHA256. Do not run downloaded install scripts as root before inspecting them. Do not start a second service on an existing port.
4. Create a dedicated system user and a root-controlled TOML config with `secret = "<generated mtg FakeTLS key>"`, `bind-to = "0.0.0.0:<internal_tcp_port>"`, `concurrency = 32`, and `prefer-ip = "prefer-ipv4"`. Choose a real FakeTLS hostname that the provider's acceptable-use rules permit.
5. Start the `mtg run /etc/qmrproxy-mtg.toml` systemd service. Review service memory, logs and `mtg doctor` output. Local uptime is not proof of reachable Telegram access.
6. Generate a test-only `https://t.me/proxy?server=<public_ip>&port=<public_tcp_port>&secret=<generated_secret>` URL. Verify client connection and chat/media loading from actual Iraqi carriers **before** publishing it.
7. Export a confirmed node with the existing `proxy-node/export-node.py` using `--port <public_tcp_port> --config /etc/qmrproxy-mtg.toml --confirm-client-test`, then pass the node to Work Sites. Change only the active **Sites v3 `nodes.json`**, not the whole deployed design. Reconcile TGCloud node data in a separate diff review; do not change its webhook.

## Backup candidate: Openworld

https://openworld.eu.org/ and https://openworld.eu.org/faq

No-card registration via Discord and a free dedicated **public IPv6** plus NAT IPv4; periods are 7 days and require free renewal. The provider FAQ says proxies can be hosted, but Iraq carrier IPv6 connectivity and IPv4 NAT ingress must be verified first. It is not suitable as the only node without those tests.

## Avoid unqualified claims

- Neither candidate is a guaranteed free permanent public TCP proxy: both need accounts and frequent renewals.
- The 192MB NAT host may crash under real traffic, and non-443 TCP ports may be filtered by Iraqi networks.
- Do not use ngrok TCP Free without a payment method: the provider explicitly requires card verification.
- Do not add a dummy server, public IP, FakeTLS secret, or made-up uptime/speed to Sites or the bot.
- Nothing has been deployed to a new host; no live IPv4:port allocation is known.
