# QMR Proxy — staged integration and real MTProto node kit

**Current status, 16 Nov 2026**
- **Telegram bot:** @QMRProxybot already works on Telegram Serverless. Its user-verified Bot ID is `9239734904`; an existing Serverless handler and webhook are operational. **Nothing in this GitHub integration has redeployed or modified them.**
- **Public PWA:** https://qmr-proxy.alialnyamy675.chatgpt.site — a separate ChatGPT Sites deployment based on the v3 site handoff. It lets users save/import/share MTProto links. **It is not a TCP proxy itself.**
- **Public MTProto nodes:** none have been provisioned or verified yet. The published `nodes.json` inventory is empty.
- **GitHub:** only a review/draft PR is staged; this does not automatically deploy anything.

## Important layout

- **`proxy-node/`** — **recommended new MTProto deployment kit** using upstream `nineseconds/mtg:2`. A Docker Compose service, guarded first-time setup, a test-only link preview, and export of public node data after a successful Telegram client test.
- `docs/MTProto_GITHUB_INTEGRATION.md` — source comparisons and deployment boundaries.
- `site/` — earlier standalone website code kept for history. **Do not overwrite the current live ChatGPT Sites v3 design with this older snapshot.**
- `tgcloud/` — optional Serverless source for link distribution. **Do not push over the deployed bot without an authenticated diff and safe migration plan.**
- `scripts/sync_nodes.py` — compiles public node data for the bot when a verified server exists.
- `docker-compose.yml` and `scripts/setup.sh` (repository root) — **older v2 prototype**, not recommended. Use the newer isolated `proxy-node/` deployment kit instead.
- `.github/workflows/ci.yml` — tests only; `.github/workflows/pages.yml` — manual Pages workflow, NOT the active ChatGPT Sites hosting.

## Non-destructive review checks

```bash
python3 -m unittest discover -s tests -v
node --check site/app.js
node --check tgcloud/handlers/message.js
node --check tgcloud/lib/nodes.js
node --check site/sw.js
```

## Actual MTProto hosting

1. Obtain a dedicated Linux VPS with public routable IPv4, an available TCP/443 port, and allowed egress to Telegram. **GitHub, Telegram Serverless, ChatGPT Sites and normal HTTP serverless platforms cannot do this job.**
2. Read [proxy-node/README.md](proxy-node/README.md) and only then run `bash proxy-node/install.sh PUBLIC_IP OWN_REAL_DOMAIN` **on that VPS**, not in Termux or the site.
3. Generate a test link with `python3 proxy-node/export-node.py --server PUBLIC_IP --preview`.
4. Test the actual Telegram connection from at least one network in Iraq. Container running, ping, or HTTP status is not enough.
5. Export the confirmed public node with `--confirm-client-test` and update **the existing live Sites v3 `nodes.json`** without replacing the website source. Update the bot's inventory in a separate reviewed TGCloud release, keeping its webhook untouched.
6. Keep nodes and host secrets distinct: MTProto client secret becomes public by design; bot API tokens, TGCloud CLI credentials and SSH keys must never be committed or shared.

This project does not provide fake/free upstream MTProto servers and cannot promise censorship bypass or faster connections without real target-network tests.

Refer to [docs/DEPLOYMENT_CHECKLIST.md](docs/DEPLOYMENT_CHECKLIST.md) for additional precautions.
