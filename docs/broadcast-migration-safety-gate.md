# QMR Proxy — broadcast safety migration gate

**Scope:** Native Telegram Serverless broadcast implementation present on the review branch. This is an **offline, read-only audit**; it does not contact Telegram, upload files, access credentials, or touch the webhook.

## Observed blockers (2026-11-21)

1. The legacy `broadcastBatch` persists `cursorId` before a send attempt. If Telegram rejects delivery or a worker terminates after persisting the cursor, a recipient can be skipped permanently; the current method does not guarantee eventual delivery.
2. There is no per-recipient durable delivery result / retry ledger. `sent`, `failed` and `cursorId` are not enough to reconstruct which recipient needs attention after crashes.
3. Two callbacks may race on the same broadcast cursor because the function reads status and then processes without a durable exclusive claim. Duplication is possible.
4. The source includes an owner-only callback guard, but this alone does not prove that **deployed** Revision 3 or the new release candidate has correct authorization. Test every administrative callback using non-owner identities.

## Repeatable local gate

Run `node tools/audit_broadcast_safety.mjs` in this review checkout. The auditor returns a non-zero exit status when structural deployment blockers are present. Its checks are intentionally narrow and cannot replace behavioral tests. A clean parse or successful v6 CI workflow does not supersede a failed audit.

## Required implementation and tests before cutover

- Pick and **document** a delivery policy (at-most-once vs retryable at-least-once) and its tradeoffs. Telegram Bot API does not provide an end-to-end idempotency key for `sendMessage`; exactly-once delivery must **not** be promised.
- Introduce a durable per-broadcast/recipient attempt record and atomic single-dispatcher claim (or equivalent supported transactional queue), including recovery after lease expiry.
- Never silently advance a recipient past a failure without reconcilable state. Retain error codes, limited timestamps and retry counts; avoid logging message contents or secrets.
- Add simulated tests for: two concurrent owner callbacks; crash before send; crash after send before acknowledgement; Telegram 429 with retry-after; a permanently blocked recipient; repeated callback replay; cancellation mid-batch; an interrupted 15-recipient batch; non-owner admin callback denial.
- Perform schema mapping from the existing Termux SQLite source to Telegram Serverless database using synthetic data first, and then a private verified backup. Never upload raw user DB to GitHub.
- Require a one-consumer cutover and rollback rehearsal; keep live Termux, its webhook, production DB and original ChatGPT Sites unchanged until explicitly approved and demonstrated.

**Disposition:** PR #5 stays Draft. This document and its auditor are not a fix for production broadcasting; they are a fail-closed prerequisite to building and verifying one.
