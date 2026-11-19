# QMR Proxy v7 — source merged, production NOT verified (19 November 2026)

## Verified

- Original repository: `QMR7S/QMRProxybot`; `main` contains v7 source merged at `cd6a941aa874e0b3ca57f5fc5981713825e5b888` on 16 November 2026.
- PR #1 and PR #2 merged. GitHub Actions validation on that source passed. CI checks are offline-only, not a Telegram Serverless/Sites deploy.
- Source website release lives in `handoff/miniapp-v7/site/`: PWA, Telegram Web App bridge, local storage/export/import, and 60 **external** MTProto snapshots. Each entry's advertising status is `unknown`.
- Bot source lives in `tgcloud/handlers/` and `tgcloud/lib/`; existing owner `6246913670`, channel `@QMR7S` and support `@QMRSupportbot` must be preserved.

## Observed earlier, NOT confirmed fixed

- Last reported website production release: v5 on `https://qmr-proxy.alialnyamy675.chatgpt.site/`.
- Last reported Telegram Serverless deployment: older revision; `api.sendMessage` failed with `401 Unauthorized`. TGCloud webhook/sync requests returned authorization errors.
- Webhook was previously seen empty with two pending updates. **This is a dated observation**, not a current count; a temporary polling process was reported but shutdown was not confirmed.
- No confirmed subsequent Telegram Serverless deployment, Sites v7 publication, Webhook restoration, database backup/restore, or authenticated end-to-end tests.

## Next safe steps

1. Read-only audit of the actual `app9239734904` Serverless project and BotFather ownership; verify which credential is valid **without exposing it**.
2. Verify whether temporary polling is running, preserve update offsets, then coordinate an orderly single-consumer transition. Do not delete the webhook or drop pending updates.
3. Back up current deployed source, database and configuration; compare targeted handlers and additive schema migration; verify rollback.
4. Restore Telegram-managed message delivery before v7 code publication; stop on 401/unauthorized until credentials are repaired by the owner.
5. Publish v7 handoff **only to the existing Sites project**, then test on Android with real Telegram Mini App launch, PWA, proxy list, save/export/import and links.

## Security/limits

The prior Bot API token was exposed in chat. Rotate it **privately with owner involvement** before credential-dependent operations; never put it in a chat, commit or logging. Token rotation alone does not guarantee the Serverless integration is repaired.

MTProto community entries are owned by third parties and are not proven ad-free, private or usable from Iraq. The public site cannot enforce channel membership on its own. See `docs/RELEASE_AND_ROLLBACK_v7.md` for safe release and rollback details.
