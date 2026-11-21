# QMR Proxy v13 — bridge validation / no production cutover

Date: 2026-11-21. Scope: existing PR #5 review branch. No Telegram API calls, handler deployments or database migration.

## What is implemented and independently tested

- `tools/tgcloud_broadcast_bridge_v13.mjs`: a staged bridge to the v13 SQLite journal. One durable claim per invocation, maximum 15 recipients, no send before recording an attempt, blocked-user check, and no automatic re-send of ambiguous outcomes.
- `tools/tgcloud_broadcast_bridge_v13.test.mjs`: eight isolated scenarios covering ordering, timeout/uncertainty, 429 backpressure, blocked recipients, lease-near-expiry, late response, concurrent claims, and invalid input.
- The v13 adapter now checks `qmr_users_v6.blocked` before delivering. An unavailable user table must cause a DB error and halt delivery rather than bypass a known block.
- Lease deadline is derived from **claim start time**, not response time.
- Reviewed SDK reference documents async `db.get(query, params)` / `db.all(query, params)` for raw SQL, but raw-query support alone is **not** a cloud staging integration test.

## Known unavoidable tradeoffs and release blockers

1. A successful Telegram send followed by an expired lease may remain `attempting`, requiring manual reconciliation. This is intentional: there is no Bot API idempotency key that can prove exactly-once sends.
2. A send may take longer than the lease; stopping *new* attempts near expiry is only mitigation. Integrate bounded request timeouts or real lease renewal and test it with a genuine Telegram Serverless staging database before activation.
3. A claimed, cancelled, or deleted broadcast must stop when the fencing check fails. Cancellation while an already-started send is in flight may still deliver that message; do not promise instantaneous cancellation.
4. The present bridge is **not** registered in `tgcloud/handlers/` and is not deployed; it does not replace the old `broadcastBatch` in `tgcloud/lib/store.js`. The legacy structural audit remains BLOCKED.
5. Additive schema declaration using `sdk/db`, cloud staging migration dry-run, durable recipient snapshot creation, and fake-user integration test must be completed before a real push/migrate.
6. Signed owner authorization must be tested with non-owner callback identity and forged Mini App requests. Preserve exactly one webhook consumer and all pending updates at migration.

## CI evidence

- [Broadcast isolated tests #44896747192](https://github.com/QMR7S/QMRProxybot/actions/runs/44896747192): success.
- [Existing repository validation #44896747183](https://github.com/QMR7S/QMRProxybot/actions/runs/44896747183): success.

## Release disposition

**PR #5 remains Draft.** Keep live Termux, Telegram Serverless Revision 3 handlers, Telegram webhook, user SQLite and the original Sites project unchanged. Neither passing unit tests nor a static-site upload is proof of end-to-end cloud readiness.
