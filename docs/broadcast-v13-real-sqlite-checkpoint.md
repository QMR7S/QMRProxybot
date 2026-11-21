# v13 SQLite integration and SDK schema candidate — review checkpoint

**2026-11-21. Review branch only. No production migration.**

## Changes verified
- `tools/tgcloud_broadcast_real_sqlite.test.mjs` uses actual Node 22 SQLite, the same SQL DDL and the v13 adapter and bridge modules. It validates successful delivery journaling, blocked recipients, unknown delivery, atomic lease takeover and stale-worker fencing, cancellation, missing user-table handling, and absent recipient records.
- `tools/tgcloud_broadcast_adapter_v13.mjs` now rejects missing/invalid recipients rather than treating an absent record as unblocked.
- `tools/broadcast_v13_sdk_schema_candidate.mjs` stages additive table declarations with composite PK, state checks and pending index using `sdk/db` DSL. It is located **outside** `tgcloud/schema.js`, so it cannot be picked up by normal Telegram module deployment. No cloud migration performed.
- `node --check` of the SDK declaration is a **syntax** test, not resolution/validation of the real SDK's exported functions.

## Verified CI evidence

- [v13 isolated tests + actual in-memory SQLite, run 44897075234](https://github.com/QMR7S/QMRProxybot/actions/runs/44897075234): **success**.
- [Existing repository validation, run 44897075154](https://github.com/QMR7S/QMRProxybot/actions/runs/44897075154): **success**.

## Release gates still open

1. Get a **safe, separate** staging environment or supported local Telegram Serverless SDK emulator to load the `sdk/db` candidate and prove generated DDL matches reference SQL. Compare the migration plan, schema names and indexes. **Do not push or migrate against original production project before review and explicit cutover approval.**
2. Move the approved declarations into `tgcloud/schema.js` only after a reviewed dry-run plan with no table drops, verified backup, row counts and rollback.
3. Implement verified recipient snapshot population and journal reconciliation based on the user's private data; no private identifiers or databases belong in public GitHub.
4. Add a bounded Telegram request deadline and cancellation semantics with API evidence; an in-flight send can outlast the lease and cannot be treated as exactly-once. Manual reconciliation must remain possible.
5. Test owner-only callbacks and Mini App signatures against exact staged native handlers, plus /extra, /best, /quality, forced subscription, and one-consumer webhook migration.
6. Resolve the existing `tools/audit_broadcast_safety.mjs` **BLOCK** on legacy native `tgcloud/lib/store.js`; no live handler imports v13 yet.

**Disposition:** PR #5 stays Draft, no merge, no production `tgcloud push`, `migrate`, webhook switching, Termux shutdown or Sites modification.
