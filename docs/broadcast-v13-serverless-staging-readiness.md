# v13 broadcast storage bridge — staging readiness

**Date:** 2026-11-21. This is a review-branch implementation, not a production migration.

## Implemented

- `tools/tgcloud_broadcast_adapter_v13.mjs` implements native SQLite-style `db.get`/`db.all` queries that use `UPDATE ... RETURNING` for atomic lease claims, guarded recipient-state transitions, cancellation-aware reads, and fencing of stale workers. Dependency injection avoids credentials in CI.
- `tools/tgcloud_broadcast_adapter_v13.test.mjs` checks seven isolated adapter behaviors with a deterministic database emulator.
- `tools/broadcast_v13_review_schema.sql` and `tools/test_broadcast_v13_sqlite.py` exercise the SQL model against in-memory SQLite.
- Existing isolated dispatcher and six tests continue to pass.

## Integration blockers (do not bypass)

1. **SDK compatibility:** Test the emitted `UPDATE ... RETURNING` syntax against a clean Telegram Serverless staging database, confirming its exact `db.get` query behavior. Unit tests and generic SQLite are not substitutes for a real SDK test.
2. **Schema declaration and migration:** Convert v13 review SQL to reviewed `tgcloud/schema.js` declarations and conduct an explicit `tgcloud migrate --dry-run`; perform no production migration before reviewed backups and data mapping.
3. **Dispatcher binding:** The v13 adapter has token/fence parameters; the isolated dispatcher is interface-agnostic. Introduce a fencing-aware session bridge before it can be invoked by an actual Bot API handler. Current `tgcloud/lib/store.js` still uses legacy broadcast code.
4. **Populate recipients:** Use a private, auditable migration from source users, including exclusions for banned/deleted users, deterministic snapshots, batch bounds, and row-count/checksum checks. There is intentionally no automatic import from live users.
5. **Operator controls:** Require strong owner authorization; confirmation, cancellation, manual reconciliation of `attempting`/`unknown` states; never auto-retry ambiguous `sendMessage` results. Do not claim exactly-once delivery.
6. **Lease refresh and backpressure:** A long network call may outlive the 30-second dispatcher lease. Add bounded request timeouts or lease renewal with correct fencing. Test 429 `retry_after` and cancellation during in-flight calls.
7. **Runtime parity:** Preserve /extra, /best, /quality, mandatory membership, Mini App authorization, Ops/Admin endpoint checks, and a single live webhook consumer before any cutover.

## Evidence / status

- CI `Broadcast dispatcher isolated tests (review only)`: [run 44896556937](https://github.com/QMR7S/QMRProxybot/actions/runs/44896556937) — success (isolated Node + SQLite).
- CI `Validate QMR Proxy (no deployment)`: [run 44896556886](https://github.com/QMR7S/QMRProxybot/actions/runs/44896556886) — success (existing code).
- Existing `tools/audit_broadcast_safety.mjs` remains intentionally **BLOCKED** against native `tgcloud/lib/store.js`; this is the correct state until the production-facing code is replaced and covered by integration tests.

**Decision:** Leave PR #5 Draft. Do not push handlers, merge into main, change the webhook, or transfer private SQLite data.
