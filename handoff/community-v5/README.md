# QMR Proxy v5 — Work Sites and TGCloud release instructions

The website source **is in the attached QMRProxy_v5 ZIP**, not in the older `site/` folder on this GitHub branch. Do not replace the active ChatGPT Sites design with old v2 files.

## Community feed
- 60 real public MTProto links in `handoff/community-v5/nodes.json`.
- Source: https://iwizard7.github.io/MTProxy_list/endpoints.json
- Last source check: 2026-11-16T06:25:41.547232+00:00
- All 60 had `ads_status: unknown`: none is certified free of sponsored channels.
- A source MTProto handshake is NOT an Iraq censorship bypass, speed, operator trust or privacy test.

## Website
1. In ChatGPT Work / Sites edit **the existing** https://qmr-proxy.alialnyamy675.chatgpt.site .
2. Use the ZIP's `site/` files, keep PWA assets, saved browser state and installability, do not create a second site.
3. The site fetches the public endpoint JSON at launch and every 30 minutes while the page is active; if direct browser fetch is forbidden by CORS, use the 60 static `nodes.json` fallback. Display last source-check date.
4. Test opening link, showing 20/60 cards, search, confirmed-no-promotion filter, QMR7S channel link, personal nodes and export/import.
5. Never show “ad-free,” “secure,” “fast in Iraq,” or QMR-owned server as a claim about third-party links.

## Bot
- Current `@QMRProxybot` works in Serverless. Preserve its webhook and installed state.
- `tgcloud/handlers/message.js`, `tgcloud/lib/source.js` and `tgcloud/lib/nodes.js` are review-only files until owner's authenticated Termux runs `npx tgcloud fetch`, `status`, `diff` and targeted `push`.
- Source uses **SDK outbound HTTP** `fetch as sdkFetch` from `sdk`, not global fetch. If source access fails, bot displays static 60 links.
- Once live, test /start, /proxy, /servers, /servers 2, /servers 6, /channel and webhook status.
- Do not run `webhook sync`, delete webhook, force push, or touch `schema.js`.

## Sponsored channel
Telegram determines the promoted channel from the **server operator's advertising tag**, not from the URL. For a real owner-operated MTProxy that promotes @QMR7S use `telemt` and @MTProxybot /newproxy and /myproxies → Set promotion; mtg v2 does NOT support adtag.
