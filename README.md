# QMR Proxy v2 — safe integration for @QMRProxybot

This repository contains a **staged** Telegram MTProto proxy directory: a standalone Arabic website, optional Telegram Serverless bot handlers, and VPS setup templates.

**Deployment status: NOT DEPLOYED.** This commit does not change @QMRProxybot, Telegram webhooks, Serverless state, hosting, existing customers, or secrets. Site inventory starts empty; there is no operational proxy yet.

## Components
- `site/`: static HTTPS web PWA to distribute Telegram proxy connection links *outside Telegram*.
- `tgcloud/`: JavaScript message handler for Telegram Serverless. The bot **only distributes links**; it does **not** transport MTProto TCP traffic.
- `scripts/`: inventory sync, initial VPS MTProto setup, and validation helpers.
- `docker-compose.yml`: optional dedicated mtg v2 TCP proxy **on an independently hosted VPS**.
- `.github/workflows/ci.yml`: non-deploying tests.
- `.github/workflows/pages.yml`: **manual** Pages deployment only.

## First checks (safe)
```bash
python3 -m unittest discover -s tests -v
node --check site/app.js
node --check tgcloud/handlers/message.js
node --check tgcloud/lib/nodes.js
node --check site/sw.js
```

## Production sequence (not automatically triggered)
1. Inspect the live @QMRProxybot webhook, TGCloud CLI project, and existing Serverless state without replacing or disabling anything.
2. Decide whether it is safe to adopt the current bot or use a separate bot. No polling bot may operate concurrently on an existing Webhook/Serverless bot.
3. Provision a public, always-on **TCP** MTProto node with Docker on an independent VPS; check real traffic from Iraq.
4. Insert verified node connection details into `site/nodes.json`. These MTProto client secrets are intentionally public; never publish bot tokens or hosting keys.
5. Synchronize the handler's node data with `python3 scripts/sync_nodes.py --web-url HTTPS_SITE_URL`.
6. Publish and test the standalone site (check whether private-repository Pages is available on the GitHub plan). This needs a separate publicly accessible HTTPS endpoint.
7. Only after inspecting `npx tgcloud status` and `npx tgcloud diff`, upload the handler from the owner's authenticated environment, provided no existing handlers would be overwritten.

Read [safe deployment checklist](docs/DEPLOYMENT_CHECKLIST.md) before any publication. The repository remains private. Never change repository visibility automatically.
