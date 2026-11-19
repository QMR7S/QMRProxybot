# QMR Proxy — source v7 on main; production release NOT VERIFIED

Last reviewed: 19 November 2026. This repository is the original source for [@QMRProxybot](https://t.me/QMRProxybot), Telegram Serverless app `app9239734904`, and the existing [QMR Proxy website](https://qmr-proxy.alialnyamy675.chatgpt.site/).

## Verified source status

- v7 source and audited maintenance changes were merged into `main` on 16 November 2026 at `cd6a941aa874e0b3ca57f5fc5981713825e5b888` (PR #1; PR #2 also merged).
- The post-merge GitHub Actions validation passed. **GitHub CI does not deploy** Telegram Serverless or ChatGPT Sites.
- The last known Sites production publication was **v5**, with 60 external MTProto entries. Current live site content, Android installation, and end-to-end Telegram delivery have not been independently rechecked.
- The last reported Telegram Serverless console test returned `api.sendMessage 401 Unauthorized`; TGCloud synchronization/webhook operations had also returned authorization errors. Their current production state is **unknown**, not presumed repaired.
- A temporary polling process had been reported. Its shutdown is **not confirmed**; preserve its saved offset and pending updates.

## v7 release assets

- **Current website update source:** `handoff/miniapp-v7/site/` (PWA, Telegram Mini App bridge, saved local proxy lists, 60 third-party entries).
- **Bot source:** `tgcloud/handlers/` and `tgcloud/lib/`; schema in `tgcloud/schema.js`.
- **BotFather/profile helper:** `scripts/configure_profile.py` (dry-run by default; requires private local credential entry for `--apply`).
- **Profile/preview artwork:** `assets/`.
- **Offline tests:** `python3 -m unittest discover -s tests -v`, `npm run test:syntax`, and `npm run test:bot`. These do not verify real Telegram or MTProto connectivity.

**Security:** An earlier Bot API token was disclosed in a chat. Treat it as compromised, rotate it privately through the owner and @BotFather before any credential-dependent profile operation, and never commit or paste a token. Do not rotate automatically or replace a working Serverless credential without verifying the integration and arranging recovery.

## Required production gates

1. Confirm the real `app9239734904` identity, current code revision, credential health, webhook state, pending updates and any still-running polling process through authenticated read-only checks.
2. Preserve live handlers, datastore and configuration; review only targeted code differences. Do not drop updates, delete/reset the webhook, force push, overwrite the database or guess an endpoint.
3. If the Bot API credential is invalid, resolve that via the owner and the official platform first. Verify a working message delivery before deploying source updates.
4. Review additive `tgcloud/schema.js` migration with a dry run. Publish only after backup, clear diff and rollback verification.
5. Update **only the existing** ChatGPT Sites project at `https://qmr-proxy.alialnyamy675.chatgpt.site/`; use `handoff/miniapp-v7/site/` and never the obsolete root `site/` or a new project.
6. Verify on a real Android phone: launch from Telegram, HTTPS, PWA install, all 60 entries, search, filters, local save/backup/import, link fallback and offline shell.

Full details: `docs/RELEASE_CURRENT.md`, `docs/RELEASE_GATES.md`, `docs/RELEASE_AND_ROLLBACK_v7.md`.

All MTProto endpoints in the community snapshot belong to third parties. Availability, performance in Iraq, ad-channel behavior and privacy **are not guaranteed**. The static public site does not enforce channel membership; bot handlers enforce membership for bot commands.
