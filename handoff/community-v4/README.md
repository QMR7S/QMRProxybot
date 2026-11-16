# QMR Proxy community proxies v4 — staged, not live

GitHub review branch only. Do not merge without independent review.
Site ZIP `QMRProxy_Community_Ready_v4.zip` contains the **existing Sites v3 design** plus a community list; the older repository `site/` tree is not the deployed Sites v3 source and must **not** replace it.

Source: https://iwizard7.github.io/MTProxy_list/best.txt
Source's reported MTProto validation: 2026-11-16T06:25:41Z.
Four unowned public links selected from that source; no servers/IPs/secrets were invented.
These are **not private QMR servers**, and the operator may log IP/time, show promotional channels, go offline, or be blocked in Iraq. A successful handshake by an aggregator is not a privacy endorsement or Iraq connectivity test.

Assets staged:
- `handoff/community-v4/nodes.json`: data for existing ChatGPT Sites site's live `nodes.json`. Do not deploy without preserving UI v3 and showing external-source banner.
- `tgcloud/lib/nodes.js`: staged target data module for Serverless.
- `tgcloud/handlers/message.js`: staged handler wording distinguishing third-party endpoints. The **live bot** still has its previous deployed handler unless an authenticated targeted release occurs.

Deployment steps:
1. Via ChatGPT Work Sites, update **existing** `https://qmr-proxy.alialnyamy675.chatgpt.site` with the v4 ZIP's `site/` only. Validate the unchanged PWA install, cache, personal saved settings, privacy, backup and all links. No new site.
2. In Termux run read-only `npx tgcloud fetch`, `status`, and `diff`. After comparing the currently running source and taking a rollback snapshot, separately target only the intended message/data modules. **Do not change the webhook** or existing database.
3. Check the real client from Iraq before claiming functional bypass or reliable speed; remove failed/outdated third-party endpoints.

**This GitHub commit is NOT a live deployment.**
