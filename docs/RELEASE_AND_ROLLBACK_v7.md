# QMR Proxy v7 — safe staged release and rollback

## Critical security gate

The bot token was posted in chat and must be revoked in @BotFather. Do not use the posted token again; rotate it first. Run the local profile script with only the NEW token entered through getpass. Do not place it in source, Telegram chat, GitHub Actions, or env logs.

## Bot code

The bot source is under `tgcloud/`; the website release source is under `handoff/miniapp-v7/site/`. Telegram Serverless production is not updated simply because GitHub changes.

1. Read-only: `npx tgcloud fetch && npx tgcloud status && npx tgcloud diff` from the actual linked project root, confirm the bot ID remains `9239734904`.
2. Save a copy of the currently deployed handlers and webhook settings. Do not use `tgcloud pull` over your new source.
3. Verify BotFather token rotation did not invalidate Serverless; manually test /start from Telegram before touching code.
4. Review targeted changes to `tgcloud/handlers/message.js`, `tgcloud/handlers/callback_query.js`, and `tgcloud/lib/ui.js` against live source. The 60 third-party node list is unchanged.
5. Only after read-only review, deploy targeted modules; never force or delete webhooks.
6. Test subscriber /start, /servers, /faq, /safety, /app; test owner /admin and unauthorised access; test WebApp button on mobile.

## Profile photo / descriptions / Menu Mini App

From authenticated owner's Termux working tree: `python3 scripts/configure_profile.py` (dry run), then `python3 scripts/configure_profile.py --apply`. Token entered securely at prompt and never saved. Script verifies Telegram bot ID and keeps a non-token local backup under `.tgcloud/profile-backups/`; it does not alter webhook or Serverless.

For a *profile* Open App button and preview gallery, enable **Main Mini App** via @BotFather. Use the already published HTTPS Sites URL and the supplied 1080×1920 image preview. Telegram Bot API's menu WebApp button does not by itself enable the profile's Main App badge.

## ChatGPT Sites

Work must update **existing** https://qmr-proxy.alialnyamy675.chatgpt.site using `handoff/miniapp-v7/site/`, not the obsolete repository-root `site/` folder, and must not create a second site. This preserves the v5 design, 60 third-party links, storage key and existing PWA data. Test on a real phone before announcing.

## Rollback

For Telegram Serverless restore the old handler/lib code from an authenticated pre-release backup and deploy only those module paths (no `--force` or webhook reset). For profile use the local non-secret JSON backup with manually reviewed Bot API or BotFather changes. For ChatGPT Sites restore its previous version through Sites version history. Never rotate the user's secret without owner action.
