# QMR Proxy — GitHub MTProto project selection and safe integration

Research date: 2026-11-16

## Reviewed open-source implementations

- **9seconds/mtg**: https://github.com/9seconds/mtg — Docker image
  `nineseconds/mtg:2`, supports FakeTLS secrets, modern Go implementation,
  minimal deployment. **Selected**.
- **TelegramMessenger/MTProxy**:
  https://github.com/TelegramMessenger/MTProxy — Telegram's official C
  implementation; manual build and config refresh; README notes its Docker
  image is outdated.
- **Riffee/AutoMTProxy**:
  https://github.com/Riffee/AutoMTProxy — an installer wrapping a proxy
  deployment with FakeTLS, but our own narrowly scoped Compose kit is easier
  to audit and avoids running an unfamiliar downloaded root script.

## What this integration includes

`proxy-node/` contains a Docker Compose MTProto TCP service,
a first-time safe installer, and a test-only/public-inventory exporter.
There are **no public server IPs or tested credentials** in the repository.

### Deployment boundaries

- **ChatGPT Sites**: static PWA and public node inventory only.
- **Telegram Serverless**: existing @QMRProxybot link distributor,
  *already deployed; its webhook is never changed by this kit*.
- **Independent Linux VPS**: the actual MTProto server, required because
  hosting/source repositories and serverless HTTP handlers are not public
  TCP port listeners.
- **No automatic publishing**: export requires an affirmative real-client
  test assertion. Then manually update Sites inventory; independently
  reconcile the TGCloud inventory without replacing the bot handler.

Future enhancements: two geographically independent working nodes, a
reliable externally monitored availability signal, a distribution
workflow for a verified server list, and testing from several Iraqi ISPs.
Never promise unmeasured connection speeds or censorship bypass.
