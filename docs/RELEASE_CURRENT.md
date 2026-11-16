# QMR Proxy v7 (2026-11-16) — staged, NOT live

**Security:** Prior Telegram Bot API token was disclosed in chat; revoke in BotFather before attempting new profile uploads. Never commit or paste the rotated token.

### Working components
- Current public site v5: https://qmr-proxy.alialnyamy675.chatgpt.site ; 60 third-party MTProto links are present, operators and ad-channel status are not verified.
- Current @QMRProxybot uses Telegram Serverless; current webhook must be preserved.
- v7 code is staged in a draft GitHub review branch and complete ZIP, not deployed to the live service.

### v7 handoff
- `handoff/miniapp-v7/site/` — full v5 site with Telegram Web App bridge, social preview, PWA preserved. Use via **ChatGPT Work Sites** to update **existing site identity**, not create another site.
- `scripts/configure_profile.py` — secure, local hidden-token prompt for Bot API profile/commands/menu and optional JPG photo upload; `python3 scripts/configure_profile.py` is a dry run, `--apply` requires fresh rotated BotFather token, verifies bot identity 9239734904 before any mutations. Does not touch webhook.
- `assets/QMRProxy_avatar_512.jpg` and `assets/QMRProxy_main_app_preview_1080x1920.jpg` — Telegram profile assets.
- `tgcloud/lib/ui.js`, `handlers/message.js`, `handlers/callback_query.js` — inline web_app launch, FAQ, Safety, richer terms/privacy and navigation. No schema changes or fake proxies.

See `docs/RELEASE_AND_ROLLBACK_v7.md` for release gates and `docs/PROFILE_AND_MAIN_APP_v7.md` for enabling Main Mini App and BotFather media previews.
