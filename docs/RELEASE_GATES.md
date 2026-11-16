# QMR Proxy v6 — staged production handoff (Telegram Serverless)

**Never deploy from the parent folder.** Commands must run in the Git checkout at `~/QMR_Proxy/QMRProxybot`; `.tgcloud` must be inside that directory. CLI discovers the nearest ancestor containing `.tgcloud` and silently switches into that root; that was the source of the earlier `lib/source — not found` misrouting. This package **does not depend on `lib/source.js`**.

## Files

- `tgcloud/handlers/message.js`: command router, subscription checks, admin text commands
- `tgcloud/handlers/callback_query.js`: editable inline menus, pagination, subscriber verification, owner panel
- `tgcloud/lib/nodes.js`: 60 third-party public proxies and validated feed refresh (no new `lib/source` dependency)
- `tgcloud/lib/ui.js`: reusable screens, transparent inline buttons, help/terms/privacy/support
- `tgcloud/lib/store.js`: optional privacy-limited statistics, maintenance, ban/unban, broadcast batches
- `tgcloud/schema.js`: NEW additive DB tables; requires separate reviewed `migrate`
- `assets/QMRProxy_avatar_512.png`: bot profile artwork. Upload with @BotFather or an explicit trusted Telegram API action; the source does not auto-change the profile photo.

## 1. Backups and local staging

```
cd ~/QMR_Proxy/QMRProxybot
git status --short
git fetch origin review/qmr-proxy-v2-safe-integration
git pull --ff-only origin review/qmr-proxy-v2-safe-integration
npm run test:syntax
python3 -m unittest discover -s tests -v
bash scripts/repair-tgcloud-root.sh
```

The repair script copies existing `.tgcloud` state from `../.tgcloud` only if the repository lacks local state. It never overwrites an existing checkout's `.tgcloud` or touches live Telegram.

Use `npx tgcloud --no-pager diff` **after the script** to compare exact changes. Check the bot identity `app9239734904` and previously deployed revision. Do not edit or delete the working webhook.

## 2. Database migration (new additive tables only)

For complete owner statistics, maintenance toggles, bans and broadcast: the persistent database tables must exist. Review `tgcloud/schema.js` and confirm its `qmr_*_v6` tables are additive and do not alter other tables.

1. **Do not migrate if the existing remote schema has unknown tables.** Compare first and preserve them.
2. Stage the schema only: `npx tgcloud push schema`. This changes deployed schema metadata, not DB tables.
3. Review `npx tgcloud migrate --dry-run` and inspect the migration plan.
4. Only if it adds exactly the three planned tables without dropping/replacing data: `npx tgcloud migrate` and confirm. Never use `--force` or `--yes` without reviewing.

If migration cannot be reviewed safely, leave DB-dependent admin operations disabled; the public proxy list, subscription verification and help screens are still functional via fallback handling.

## 3. Targeted handler deploy

Only after `repair-tgcloud-root.sh` prints `READY FOR REVIEW` and all syntax/tests pass:

```
npx tgcloud push lib/nodes lib/ui lib/store handlers/message handlers/callback_query
npx tgcloud status
npx tgcloud webhook
```

The new `handlers/callback_query` update type should be included in managed `allowed updates`; the CLI may say the webhook is out of sync. Inspect your live webhook and run only the platform-supported sync in an approved maintenance window **if needed**. Do not deleteWebhook, drop pending updates or replace an unrelated webhook.

Test from another Telegram account as subscriber and non-subscriber, verify the bot is channel admin in @QMR7S, and confirm callbacks, admin ID restrictions and status messages.

## 4. Bot configuration / profile

Owner ID is hardcoded as `6246913670` and verified at every administrative command and callback. Owner sends `/setup` to set Bot API commands and public description/short description. Bot photo must be uploaded separately; new `setMyProfilePhoto` requires a Telegram InputFile and is intentionally not run without explicit owner review. Default inline button style is Telegram's transparent theme; primary/success/danger styles are used sparingly. No invented custom emoji ID is used.

## 5. Production acceptance checklist

- `@QMRProxybot` /start works and new menu appears.
- Subscriber can view /servers 1..6 and tap actual MTProto links; non-subscriber is gated.
- Bot is an administrator of @QMR7S so getChatMember checks are reliable.
- Page navigation edits previous message; callbacks are acknowledged.
- Owner `/admin`, `/stats`, `/maintenance`, `/ban` and `/unban` work after migration.
- Owner-only broadcast requires explicit preview/confirmation and max 15 recipients per button press; no automatic blast.
- `/delete_my_data` removes user's aggregate record.
- Bot description and commands configured with `/setup`; upload avatar via BotFather.
- Webhook remains Telegram-managed, no pending updates, handles both `message` and `callback_query`.
- Live web PWA remains https://qmr-proxy.alialnyamy675.chatgpt.site, same layout and cached user data.
- External proxies are NEVER described as private QMR7S infrastructure, ad-free, safe, or reliably accessible from Iraqi networks.

## Rollback

Prepare a backup before first deploy. If a new handler fails, restore only the previous reviewed code modules and use targeted push after `fetch`; **do not** touch the database or drop the webhook. DB tables are additive and remain unless separately reviewed for deprecation.
