# QMR Proxy — safe deployment checklist (16 November 2026)

## Inspected state
- GitHub repository `QMR7S/QMRProxybot` was empty on initial audit, no branches or commits. A non-deploying main README bootstrapped the repository.
- `@QMRProxybot` was provided as target; its Telegram Serverless deployment, Bot API webhook, token and external services have **not** been inspected and must be treated as live/unknown.
- The local v2 starter passed 7 Python tests and JavaScript syntax checks. These are not Telegram traffic/availability tests.

## Hard safety rules
- No `deleteWebhook`, `setWebhook`, polling, `tgcloud push --force`, `tgcloud pull`, or change to an existing deployed handler without a read-only diff and an explicit migration decision.
- No bot API token, CLI access token, SSH private key, hosting credential, subscriber data, or deployment secrets in source control or action logs.
- Preserve backups of Serverless source, database/export when supported, any configured routing, and existing webhook URLs. Never overwrite an operational configuration with the empty starter.
- Keep website publication manual. A GitHub Pages site is publicly visible even if its source repository is private when hosting is supported.
- GitHub Pages from **private** repositories requires appropriate paid GitHub plan. On GitHub Free, use a separate public, sanitized site repo or independent static host; keep bot source private.

## Read-only verification (owner-side Termux)
1. Identify current bot and current TGCloud CLI project. Confirm in BotFather that `@QMRProxybot` owns the intended Serverless instance.
2. In an **existing** authenticated TGCloud project, read CLI status and diff; beware that local `status` may use cached state. Consult platform-specific commands for a fresh cloud fetch (do not overwrite local content).
3. Check Telegram Bot API `getWebhookInfo` from a trusted local machine using the existing bot token **privately**; log only `url present?`, `pending_update_count`, and status. Never paste token or complete response into chat.
4. Confirm if a custom webhook or polling bot is already active and identify who operates it. No deployment until conflicts are resolved safely.
5. Inspect configured BotFather Mini App URLs, user-facing commands, and current handler behavior.

## Site publication gates
- Site inventory must be valid JSON and contain only **verified** working nodes.
- No assertion of live, fast, or available unless measured from Iraqi mobile/Wi-Fi networks.
- Verify `tg://proxy` fallback behavior and manual settings on Android/iOS/Desktop.
- Test public HTTPS access **without Telegram** and on multiple Iraqi providers. Plan an independent mirror to resist domain blocking.
- No automatic Pages deployment via a main push.

## Actual MTProto node gates
- Dedicated VPS/public IP, TCP ingress (often 443), reachability to Telegram's datacenters, DNS, and suitable FakeTLS host configured.
- Use `nineseconds/mtg:2` with version pinning after review; its simple FakeTLS mode is a starting point, not a guarantee of bypass.
- Do not rotate an operational secret or replace node inventories without a migration window.
- Test VPS health then **client connectivity from inside Iraq**. Measure time-to-connect, latency, packet loss, reliability and bandwidth (actual improvement not guaranteed).
- Keep at least two independently hosted nodes if availability is important. Monitor resource ceilings and egress costs without collecting user identifiers.

## Serverless / webhook release gates
- Diff any handler and schema against live before changes. If the current Serverless handler already exists, merge behavior instead of replacement.
- Stage in a separate bot if production changes are risky, without changing @QMRProxybot.
- Confirm /start, /proxy, /servers, /help, empty-state, real link entry, inline buttons, rate limits and error behavior.
- Record release version and rollback plan. Roll back by restoring preserved old code, not deleting webhook or database.

## Current status
Only the **GitHub source review stage** is authorized/completed. No Telegram production settings, website hosting, MTProto VPS or Serverless release are verified.
