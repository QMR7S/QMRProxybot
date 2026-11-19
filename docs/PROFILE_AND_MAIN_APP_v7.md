# Telegram BotFather / profile release — QMR Proxy v7

**FIRST** revoke the exposed token via @BotFather: `/mybots` → @QMRProxybot → API Token → Revoke. Keep the new token private; do not paste it into chat, GitHub, commands, screenshots or shell history.

The script `scripts/configure_profile.py` prompts for the **new token privately**. It authenticates via `getMe`, verifies Bot ID 9239734904 and username QMRProxybot, and saves a local non-secret profile snapshot before profile mutations.

- Dry run: `python3 scripts/configure_profile.py`
- Apply: `python3 scripts/configure_profile.py --apply`
- Profile photo: `assets/QMRProxy_avatar_512.jpg` (JPG upload via setMyProfilePhoto).
- Updates: setMyName, setMyShortDescription (<=120), setMyDescription (<=512), public and owner-specific commands, setChatMenuButton of type `web_app`.
- Does **NOT** call setWebhook/deleteWebhook, push Serverless code or read Telegram chat content.

**Main Mini App and Open App on the bot's PROFILE**: @BotFather → My Bots → @QMRProxybot → Bot Settings → Configure Mini App → Enable Main Mini App. Use the HTTPS URL `https://qmr-proxy.alialnyamy675.chatgpt.site`. Then set high-quality media preview using `assets/QMRProxy_main_app_preview_1080x1920.jpg`. Unlike the in-chat inline button and Menu button, the main profile Open App button requires BotFather configuration and cannot be fabricated by sending an ordinary message.

The public static site cannot enforce @QMR7S subscription; bot command buttons do. Owner ID: 6246913670. Support: @QMRSupportbot.
