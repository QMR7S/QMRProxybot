# QMR Proxy v6 — Telegram Serverless (Safe Release)

Updated 16 Nov 2026. This is the release **source**, not a completed cloud deployment.

Production identifiers:
- Bot: `@QMRProxybot` (Bot ID 9239734904)
- Owner: Telegram user ID `6246913670`
- Mandatory channel: `@QMR7S` (bot must be administrator of channel)
- Support: `@QMRSupportbot`
- PWA website: https://qmr-proxy.alialnyamy675.chatgpt.site

## What is built
- Native Telegram inline keyboard interface with theme-native default transparent buttons, up to 60 public MTProto links, paginated 10 per view, edit-in-place callback actions and subscription verify button.
- Owner-only `/admin` dashboard, stats, maintenance toggles, user bans/unbans and guarded broadcast previews with manual batches (the last four features require an explicit **additive database migration**).
- Clear Arabic steps, terms and privacy, BotFather descriptions and official support links.
- Public proxy feed with 60 source-tested links and fixed snapshot fallback; NO endpoint is claimed QMR-owned, ad-free, fast or safe for use in Iraq without a user-side test.
- Self-contained source refresh in `tgcloud/lib/nodes.js`: **the old `tgcloud/lib/source.js` module is no longer used or deployed**.
- `scripts/repair-tgcloud-root.sh` to fix incorrect TGCloud workspace discovery without touching any production webhook.
- New custom QMR Proxy avatar PNG, included under `assets/`; not installed on Telegram automatically.

## Quick steps in Termux

```bash
cd ~/QMR_Proxy/QMRProxybot
git pull --ff-only origin review/qmr-proxy-v2-safe-integration
npm run test:syntax
npm run test:bot
python3 -m unittest discover -s tests -v
bash scripts/repair-tgcloud-root.sh
```

The repair script must print **READY FOR REVIEW** and list the expected changed modules. If not, DO NOT run `tgcloud push`.

Afterward follow the carefully ordered database migration, targeted deployment and webhook checks in [docs/RELEASE_GATES.md](docs/RELEASE_GATES.md). There is **no** automatic migration, webhook reset, database deletion or public broadcast in these files.

## User privacy
The bot only stores a Telegram numeric user ID, first/last interaction timestamps, request count, and an optional ban flag, if the owner enables the additive DB schema. It does not collect chats, phone numbers, login codes or Telegram passwords. `/delete_my_data` removes the user's record.