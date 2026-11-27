# QMR cloud v14 — controlled upgrade of original app
Base production evidence 27 Nov 2026: app9239734904 revision 5, seven modules,
webhook in sync, no pending updates, no schema changes; operator confirms replies.
No new app, new bot, VPS or paid service.

## Candidate
- Owner-only native qmr_admin / qmr_ops endpoints use verified Telegram ctx.initData and a one-hour freshness gate. No initDataUnsafe or user-supplied identity. Ops does not invent queue statistics (getWebhookInfo is restricted).
- Additive qmr_board_audit_v14 table: intent before dashboard mutation, confirmation after success. An interrupted or uncertain mutation remains pending; no exactly-once or multi-statement atomicity claim. This journal covers dashboard actions only, not existing chat commands.
- /extra and callbacks fetch independently attributed source data with freshness, validation and deduplication; retain static fallback. /best and /quality report no independent fresh measurements, instead of making up rankings. Browser sources use HTTPS and the same validators, then fall back to preserved static files. Browser CORS/outbound access is not guaranteed. Privacy notice identifies direct GitHub requests.
- Deploy from a copy of the exact prior release. All 39 static files must match the private manifest and live content. The script refuses divergent dashboard sources; it never replaces existing private data or publishes a token. Review config and status before full push, which mirrors the project.
- No changes to the existing public ChatGPT Sites project. The TGCloud root and its mini/admin/ops routes remain separate.
- Ops is initially owner-only because no verified cloud operator allowlist was provided.
- V13 broadcast migration remains held: no recipient delivery from candidate modules.
- Telegram Serverless is event-driven and exposes HTTP fetch, not raw TCP or a persistent monitor. Independent V12 MTProto handshake measurements and periodic scheduler require a separately authorized monitor. No fake health report is generated.

## Release
From the existing repository after fast-forward pull:
    bash tools/deploy_cloud_v14.sh \
      "$HOME/QMRProxy_Cloud_Release.wLIGwY" \
      "$HOME/QMRCloud_Static_Backup.q1ob33ag"

The owner reviews the additive migration plan and types explicit confirmation.
If any stage fails, keep the release directory and the original revision-5
baseline. Do not paste private preflight logs or database contents into chat.
The script does not reset or force-push. Check the original cloud static inventory
in BotFather before the full push. Existing static routing settings were not
exported by Telegram CLI; the candidate sets spa:false for the known directory
routes, so browser verification is mandatory. A schema-only push may increment
the revision even if a subsequent step stops; do not rerun blindly.

After actual deployment, open /start, /servers, /extra, /app, /admin, and use
the new Admin and Ops buttons from the owner's private bot chat. Test denial
from a non-owner account and a normal browser; verify current counts.
Only a deliberate real owner action validates the journal and mutation.
For rollback, preserve the old revision-5 modules and static manifest. A
targeted code rollback retains the new audit table; never drop it or overwrite
a newer database with old data. Full static rollback needs the verified original
static directory and complete current module inventory; do not use reset or force.

## Reviewed production baseline
Owner-provided QMRCloud_V14_Actual_Source.zip (10 public files, 2026-11-27) confirms the deployed JS already uses Serverless.call, but references absent adminSummary/adminUsers/adminAudit/opsOverview endpoints, disables writes, and displays a placeholder audit. Its exact SHA-256 digests are now pinned in the stager; unknown variants still fail closed. The preserved HTML layout and public storage keys remain unchanged. The new overlay restores the intended owner-only actions and real audit reads, subject to runtime gates.
