# QMR Proxy — migration to the ORIGINAL Telegram Serverless bot (review only)

**Date:** 2026-11-21  
**Target:** `@QMRProxybot` / Bot ID `9239734904` / existing Serverless project `app9239734904`.  
**DO NOT** create a replacement bot or overwrite the live Termux system.

## Distinguish the two interfaces

- **Telegram Serverless inside BotFather:** Native JavaScript handlers, endpoints, an SQLite-backed database, and Mini App hosting. This is the target compute backend.
- **TG Cloud / Bot Operation Mode storage website:** A separately branded Telegram-channel file-storage interface. It is not the bot's runtime or an equivalent drop-in SQLite database. Do not upload private user data, credentials, or unencrypted backup files to it.

The screenshot showing Serverless toggled on does **not** prove that the currently active Telegram webhook points at Serverless. The last verified production webhook was the working Termux Cloudflare URL.

## Repository inventory already confirmed

- Native Serverless implementation exists in `main/tgcloud/`: `handlers/message.js`, `handlers/callback_query.js`, `lib/ui.js`, `lib/store.js`, `lib/nodes.js`, and `schema.js`.
- The native handler is at an older feature level (v6): no full v12.2 `/extra`, `/best`, or `/quality` command parity.
- Termux v12.2 uses **Python**, local `qmr.sqlite3`, custom webhook/inbox processing, refresh and quality workers, and local `/ops` and `/admin` web APIs. None of those Python or filesystem services can simply be copied into V8 isolate handlers.
- Native Serverless schema uses `qmr_users_v6`, `qmr_settings_v6`, `qmr_broadcasts_v6`. The Termux database includes different tables and queue state. A field-by-field migration is needed, not upload of the SQLite file.
- No `tgcloud.jsonc` / backend `endpoints/` were found in the reviewed `main` tree. An official Mini App build/configuration and protected API replacement must be staged.
- `.gitignore` already ignores `.tgcloud/`, `node_modules/`, `.env*`, and runtime logs.

## Safe discovery from Termux — NO CLOUD WRITE

In the existing non-production GitHub review checkout:

```bash
cd ~/QMRProxy_v12_6_Git_Review
git status --short
git check-ignore .tgcloud/credentials
node -v && npm -v
# If local node_modules are absent:
npm install --no-audit --no-fund
# Token is entered ONLY in the Termux CLI. Get it from BotFather > your existing bot > Serverless > CLI Access.
npx --no-install tgcloud login
npx --no-install tgcloud fetch
npx --no-install tgcloud status
```

Keep `.tgcloud/credentials` private (it is NOT your standard Bot API token). Do not post the access token, `.tgcloud` contents, raw user database, or any unredacted diff.

**NOT ALLOWED during discovery:** `tgcloud push`, `tgcloud migrate`, `tgcloud webhook` (can re-sync), `tgcloud reset`, `tgcloud run` (can send live Bot API messages), or switching BotFather's Serverless toggle. `push` mirrors the local module set and can remove remote modules absent locally or change the handler/webhook state.

If the CLI cannot execute on Android/Termux, stop cleanly and use a supported Linux/macOS/Windows environment with the same review checkout. Do NOT attempt to share tokens in chat or bypass authentication.

## Stage-to-production gates

1. **Cloud inventory:** inspect the already-deployed module list and current database schema via approved read-only CLI; save a local private backup of any remote code before making changes.
2. **Native feature parity:** port all live v12.2 commands/callbacks, subscriptions, owner-only administration, source refreshing, and proxy quality results to supported V8/SDK paths; do not invent uptime or safety metrics.
3. **Persistent data:** map and reconcile `users`, settings, broadcasts, and pending/in-flight delivery state. Keep private data local; create reversible migration with row counts and checksum-based reconciliation.
4. **Mini App and dashboards:** implement the actual file bundle and Telegram-authenticated endpoints. Original standalone ChatGPT Sites project remains independent and must not be replaced without explicit approval.
5. **Staging tests:** test using synthetic credentials and DB, not a second production consumer. Verify no service writes to live state.
6. **One-consumer cutover:** when ready and explicitly authorized, quiesce the Termux receiver, capture a consistent final DB/queue snapshot, verify the target deployment and permitted webhook binding, then switch exactly once without discarding pending Telegram updates. No `deleteWebhook` or `drop_pending_updates`. Rollback must not overwrite newer DB rows.
7. **Validation:** /start, /servers, /extra, /best, /quality, paging, forced membership, Mini App, Ops/Admin auth, preview/mobile layout, live pending queue, and restore tests before retiring Termux.

## Current outcome

The source remains on the **review branch / Draft PR #5**. No Telegram Serverless deployment, Cloud DB migration, webhook cutover, original ChatGPT Sites edit or production service change has occurred. Next step is the user's **private CLI read-only discovery**, followed by a verified capability/feature comparison.

References: https://core.telegram.org/bots/serverless and the current CLI documentation supplied through BotFather.
